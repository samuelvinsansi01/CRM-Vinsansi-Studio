import { useCallback, useEffect, useMemo, useState } from 'react';
import { eventBus } from '../lib/events';
import { normalizeBrazilState } from '../services/geo/brazilState';
import { importService } from '../services/import/import.service';
import type { ImportLead, ImportLeadDestination } from '../services/import/types';
import { isValidInstagram } from '../services/instagram/instagram.utils';
import { sortByLeadScore } from '../services/lead-score/leadScore.service';
import { isStatusGroup } from '../services/status/status.mapper';

export type HomeSituationFilter = 'Todos' | 'Em aguarde' | 'Aprovado';

export type HomeFilters = {
  search: string;
  branch: string;
  state: string;
  destination: string;
  instagram: string;
  site: string;
  situation: HomeSituationFilter;
};

type DestinationMetric = {
  approved: number;
  total: number;
};

const emptyDestinationMetrics = {
  total: { approved: 0, total: 0 },
  whatsapp: { approved: 0, total: 0 },
  ownSite: { approved: 0, total: 0 },
  aggregators: { approved: 0, total: 0 },
  instagram: { approved: 0, total: 0 },
};

function finalDestination(lead: ImportLead): ImportLeadDestination {
  return (lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino) as ImportLeadDestination;
}

function metricKey(destination: ImportLeadDestination) {
  if (destination === 'Instagram') return 'instagram';
  if (destination === 'Com site') return 'ownSite';
  if (destination === 'Agregadores') return 'aggregators';
  return 'whatsapp';
}

function leadSituation(lead: ImportLead) {
  if (isStatusGroup(lead.status, 'approved')) return 'Aprovado';
  return 'Em aguarde';
}

function includesSearch(lead: ImportLead, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return lead.empresa.toLowerCase().includes(query);
}

function calculateMetrics(leads: ImportLead[]): Record<keyof typeof emptyDestinationMetrics, DestinationMetric> {
  const metrics = {
    total: { approved: 0, total: 0 },
    whatsapp: { approved: 0, total: 0 },
    ownSite: { approved: 0, total: 0 },
    aggregators: { approved: 0, total: 0 },
    instagram: { approved: 0, total: 0 },
  };

  leads.forEach((lead) => {
    const key = metricKey(finalDestination(lead));
    metrics.total.total += 1;
    metrics[key].total += 1;
    if (isStatusGroup(lead.status, 'approved')) {
      metrics.total.approved += 1;
      metrics[key].approved += 1;
    }
  });

  return metrics;
}

function unique(values: Array<string | undefined>, formatter: (value: string) => string = (value) => value) {
  return [
    'Todos',
    ...Array.from(new Set(values.map((value) => formatter(String(value ?? '').trim())).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  ];
}

function nextWhatsAppDestination(lead: ImportLead): ImportLeadDestination {
  const previous = lead.original_destination ?? lead.destination ?? lead.destino;
  if (previous === 'Agregadores' || lead.destino === 'Agregadores') return 'Agregadores';
  if (lead.site?.trim()) return 'Com site';
  return 'WhatsApp';
}

export function useDashboardData(filters: HomeFilters) {
  const [records, setRecords] = useState<ImportLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const refresh = useCallback(() => setRefreshIndex((current) => current + 1), []);

  useEffect(() => {
    const offImport = eventBus.on('import:changed', refresh);
    const offPreSend = eventBus.on('pre-send:changed', refresh);
    const offWhatsAppQueue = eventBus.on('whatsapp-queue:changed', refresh);
    const offInstagramQueue = eventBus.on('instagram-queue:changed', refresh);

    return () => {
      offImport();
      offPreSend();
      offWhatsAppQueue();
      offInstagramQueue();
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const operational = await importService.listHomeOperationalLeads();
        if (active) setRecords(operational);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar leads da importacao.');
        setRecords([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [refreshIndex]);

  const operationalLeads = useMemo(
    () => sortByLeadScore(records.filter((lead) => isStatusGroup(lead.status, 'pending') || isStatusGroup(lead.status, 'approved'))),
    [records],
  );
  const metrics = useMemo(() => calculateMetrics(operationalLeads), [operationalLeads]);

  const options = useMemo(
    () => ({
      branches: unique(operationalLeads.map((lead) => lead.ramo)),
      states: unique(operationalLeads.map((lead) => lead.estado), normalizeBrazilState),
      destinations: ['Todos', 'WhatsApp', 'Com site', 'Agregadores', 'Instagram'],
      instagram: ['Todos', 'Com Instagram', 'Sem Instagram'],
      sites: ['Todos', 'Com site', 'Sem site'],
      situations: ['Todos', 'Em aguarde', 'Aprovado'],
    }),
    [operationalLeads],
  );

  const visibleLeads = useMemo(
    () =>
      operationalLeads.filter((lead) => {
        const destination = finalDestination(lead);
        const situation = leadSituation(lead);
        const matchesBranch = filters.branch === 'Todos' || lead.ramo === filters.branch;
        const matchesState = filters.state === 'Todos' || normalizeBrazilState(lead.estado) === normalizeBrazilState(filters.state);
        const matchesDestination = filters.destination === 'Todos' || destination === filters.destination;
        const hasInstagram = isValidInstagram(lead.instagram_url ?? lead.instagram ?? '');
        const matchesInstagram =
          filters.instagram === 'Todos' ||
          (filters.instagram === 'Com Instagram' && hasInstagram) ||
          (filters.instagram === 'Sem Instagram' && !hasInstagram);
        const hasSite = Boolean(lead.site?.trim());
        const matchesSite =
          filters.site === 'Todos' ||
          (filters.site === 'Com site' && hasSite) ||
          (filters.site === 'Sem site' && !hasSite);
        const matchesSituation = filters.situation === 'Todos' || filters.situation === situation || (filters.situation === 'Aprovado' && isStatusGroup(lead.status, 'approved'));
        return matchesBranch && matchesState && matchesDestination && matchesInstagram && matchesSite && matchesSituation && includesSearch(lead, filters.search);
      }),
    [operationalLeads, filters],
  );

  const updateDestination = useCallback(async (lead: ImportLead, channel: 'WhatsApp' | 'Instagram') => {
    if (channel === 'Instagram') {
      const instagramUrl = lead.instagram_url ?? lead.instagram ?? '';
      if (!isValidInstagram(instagramUrl)) throw new Error('Lead sem Instagram valido.');
      await importService.update(lead.id, {
        destination: 'Instagram',
        destination_override: 'Instagram',
        send_instagram: true,
        instagram_url: instagramUrl,
        instagram_override_reason: lead.instagram_override_reason || 'Destino ajustado manualmente no Inicio.',
        override_by: lead.override_by || 'Operador',
        override_at: lead.override_at || new Date().toISOString(),
      });
      refresh();
      return;
    }

    const destination = nextWhatsAppDestination(lead);
    await importService.update(lead.id, {
      destination,
      destination_override: undefined,
      send_instagram: false,
      instagram_override_reason: '',
      override_by: '',
      override_at: '',
    });
    refresh();
  }, [refresh]);

  const archiveLead = useCallback(async (lead: ImportLead) => {
    await importService.update(lead.id, { status: 'archived' });
    refresh();
  }, [refresh]);

  const approveLead = useCallback(async (lead: ImportLead) => {
    await importService.update(lead.id, { status: 'approved' });
    refresh();
  }, [refresh]);

  const unapproveLead = useCallback(async (lead: ImportLead) => {
    await importService.update(lead.id, { status: 'pending' });
    refresh();
  }, [refresh]);

  const invalidateLead = useCallback(async (lead: ImportLead) => {
    await importService.update(lead.id, {
      status: 'invalid',
      motivo: 'Outros',
    });
    refresh();
  }, [refresh]);

  const updateLead = useCallback(async (lead: ImportLead, input: Partial<ImportLead>) => {
    await importService.update(lead.id, input);
    refresh();
  }, [refresh]);

  const approveMany = useCallback(async (ids: string[]) => {
    await importService.approveMany(ids);
    refresh();
  }, [refresh]);

  const unapproveMany = useCallback(async (ids: string[]) => {
    await importService.unapproveMany(ids);
    refresh();
  }, [refresh]);

  const invalidateMany = useCallback(async (ids: string[]) => {
    await importService.invalidateMany(ids);
    refresh();
  }, [refresh]);

  const archiveMany = useCallback(async (ids: string[]) => {
    await importService.archiveMany(ids);
    refresh();
  }, [refresh]);

  const markAlreadySent = useCallback(async (ids: string[]) => {
    const marked = await importService.markAlreadySent(ids);
    refresh();
    return marked;
  }, [refresh]);

  return {
    metrics,
    options,
    visibleLeads,
    loading,
    error,
    refresh,
    updateDestination,
    approveLead,
    unapproveLead,
    archiveLead,
    invalidateLead,
    updateLead,
    approveMany,
    unapproveMany,
    invalidateMany,
    archiveMany,
    markAlreadySent,
  };
}
