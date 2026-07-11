import { useCallback, useMemo, useState } from 'react';
import { normalizeBrazilState } from '../services/geo/brazilState';
import { importService } from '../services/import/import.service';
import type { ImportExecutionOptions, ImportLead, ImportLeadInput, ImportLeadStatus, ImportSummary } from '../services/import/types';
import { sortByLeadScore } from '../services/lead-score/leadScore.service';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup } from '../services/status/status.mapper';

const emptySummary: ImportSummary = {
  total: 0,
  approved: 0,
  rejected: 0,
  whatsapp: 0,
  ownSite: 0,
  aggregators: 0,
  instagram: 0,
};

function calculateSummary(records: ImportLead[]): ImportSummary {
  const approved = records.filter((lead) => isStatusGroup(lead.status, 'approved'));
  const rejected = records.filter((lead) => isStatusGroup(lead.status, 'rejected'));
  const finalDestination = (lead: ImportLead) => (lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino);

  return {
    total: records.length,
    approved: approved.length,
    rejected: rejected.length,
    whatsapp: approved.filter((lead) => finalDestination(lead) === 'WhatsApp').length,
    ownSite: approved.filter((lead) => finalDestination(lead) === 'Com site').length,
    aggregators: approved.filter((lead) => finalDestination(lead) === 'Agregadores').length,
    instagram: approved.filter((lead) => finalDestination(lead) === 'Instagram').length,
  };
}

function applySessionFilters(records: ImportLead[], status: ImportLeadStatus, search: string) {
  const query = search.trim().toLowerCase();

  return records.filter((lead) => {
    const matchesStatus = isStatusGroup(lead.status, status);
    const matchesQuery = !query || Object.values(lead).some((item) => String(item ?? '').toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  });
}

function createSessionId() {
  return `session-lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


function leadToImportInput(lead: ImportLead, status: ImportLeadStatus = 'approved'): ImportLeadInput {
  return {
    empresa: lead.empresa,
    ramo: lead.ramo,
    subcategoria: lead.subcategoria,
    destino: lead.destino,
    original_destination: lead.original_destination ?? lead.destino,
    destination: lead.destination ?? (lead.send_instagram ? 'Instagram' : lead.destino),
    destination_override: lead.destination_override ?? (lead.send_instagram ? 'Instagram' : undefined),
    send_instagram: lead.send_instagram ?? false,
    instagram_url: lead.instagram_url ?? lead.instagram,
    instagram_override_reason: lead.instagram_override_reason ?? '',
    override_by: lead.override_by ?? '',
    override_at: lead.override_at ?? '',
    status,
    motivo: lead.motivo ?? '',
    rejectionCode: lead.rejectionCode,
    rating: lead.rating,
    reviews: lead.reviews,
    whatsapp: lead.whatsapp ?? '',
    instagram: lead.instagram ?? '',
    site: lead.site ?? '',
    cidade: lead.cidade ?? '',
    estado: lead.estado ?? '',
    existingId: lead.existingId,
    normalizedPhone: lead.normalizedPhone,
    normalizedSite: lead.normalizedSite,
    normalizedInstagram: lead.normalizedInstagram,
    normalizedMapsUrl: lead.normalizedMapsUrl,
    returned_from_queue: lead.returned_from_queue,
    returned_at: lead.returned_at,
    return_reason: lead.return_reason,
  };
}

function toSessionLead(input: ImportLeadInput): ImportLead {
  return {
    id: createSessionId(),
    empresa: input.empresa,
    ramo: input.ramo,
    subcategoria: input.subcategoria,
    destino: input.destino,
    original_destination: input.original_destination ?? input.destino,
    destination: input.destination ?? (input.send_instagram ? 'Instagram' : input.destino),
    destination_override: input.destination_override ?? (input.send_instagram ? 'Instagram' : undefined),
    send_instagram: input.send_instagram ?? false,
    instagram_url: input.instagram_url ?? input.instagram,
    instagram_override_reason: input.instagram_override_reason,
    override_by: input.override_by,
    override_at: input.override_at,
    status: input.status,
    motivo: input.motivo,
    rejectionCode: input.rejectionCode,
    rating: input.rating,
    reviews: input.reviews,
    whatsapp: input.whatsapp,
    instagram: input.instagram,
    site: input.site,
    cidade: input.cidade,
    estado: normalizeBrazilState(input.estado),
    existingId: input.existingId,
    normalizedPhone: input.normalizedPhone,
    normalizedSite: input.normalizedSite,
    normalizedInstagram: input.normalizedInstagram,
    normalizedMapsUrl: input.normalizedMapsUrl,
  };
}

export function useImportLeads(status: ImportLeadStatus, search: string) {
  const [sessionLeads, setSessionLeads] = useState<ImportLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leads = useMemo(() => sortByLeadScore(applySessionFilters(sessionLeads, status, search)), [search, sessionLeads, status]);
  const summary = useMemo(() => calculateSummary(sessionLeads), [sessionLeads]);

  const refresh = useCallback(async () => {
    // A tela Importar é um processamento de sessão.
    // Ela não recarrega dados antigos do banco para não misturar importações anteriores com a prévia atual.
    setError(null);
  }, []);

  const importJson = useCallback(async (jsonText: string, options?: ImportExecutionOptions) => {
    setLoading(true);
    setError(null);

    try {
      const result = await importService.importFromJson(jsonText, options);
      setSessionLeads(result.leads);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao importar leads.';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createLead = useCallback(async (input: ImportLeadInput) => {
    try {
      const lead = await importService.create(input);
      setSessionLeads((current) => [lead, ...current]);
    } catch {
      setSessionLeads((current) => [toSessionLead(input), ...current]);
    }
  }, []);

  const updateLead = useCallback(async (id: string, input: Partial<ImportLeadInput>) => {
    let updatedFromRepository: ImportLead | null = null;

    try {
      updatedFromRepository = await importService.update(id, input);
    } catch {
      updatedFromRepository = null;
    }

    setSessionLeads((current) => current.map((lead) => (lead.id === id ? { ...lead, ...(updatedFromRepository ?? input), estado: normalizeBrazilState((updatedFromRepository ?? input).estado ?? lead.estado), id } : lead)));
  }, []);

  const removeLead = useCallback(async (id: string) => {
    try {
      await importService.remove(id);
    } catch {
      // Leads de simulação existem apenas na sessão atual e não precisam existir no banco para serem removidos da prévia.
    }

    setSessionLeads((current) => current.filter((lead) => lead.id !== id));
  }, []);

  const moveLead = useCallback(async (id: string, nextStatus: 'approved' | 'rejected') => {
    let movedFromRepository: ImportLead | null = null;

    try {
      movedFromRepository = await importService.move(id, nextStatus);
    } catch {
      movedFromRepository = null;
    }

    setSessionLeads((current) =>
      current.map((lead) =>
        lead.id === id
          ? {
              ...lead,
              ...(movedFromRepository ?? {}),
              status: nextStatus,
              destino: movedFromRepository?.destino ?? (nextStatus === 'approved' ? 'WhatsApp' : 'Recusado'),
              destination: movedFromRepository?.destination ?? (nextStatus === 'approved' ? 'WhatsApp' : 'Recusado'),
              destination_override: movedFromRepository?.destination_override,
              send_instagram: movedFromRepository?.send_instagram ?? false,
              motivo: movedFromRepository?.motivo ?? (nextStatus === 'rejected' ? 'Movido manualmente para recusados.' : ''),
            }
          : lead,
      ),
    );
  }, []);

  const moveMany = useCallback(async (ids: string[], nextStatus: 'approved' | 'rejected') => {
    if (!ids.length) throw new Error('Selecione pelo menos um lead.');
    const selected = ids.map((id) => sessionLeads.find((lead) => lead.id === id));
    if (selected.some((lead) => !lead)) throw new Error('Um ou mais leads nao foram encontrados.');
    const leadsToMove = selected as ImportLead[];
    const allowed = leadsToMove.every((lead) =>
      nextStatus === 'approved'
        ? !isStatusGroup(lead.status, 'approved') && permissionsFor('import', lead.status).canApprove()
        : !isStatusGroup(lead.status, 'rejected') && permissionsFor('import', lead.status).canReject()
    );
    if (!allowed) throw new Error('A selecao contem leads incompatíveis com esta acao.');

    setSessionLeads((current) =>
      current.map((lead) =>
        ids.includes(lead.id)
          ? {
              ...lead,
              status: nextStatus,
              destino: nextStatus === 'approved' ? (lead.destination ?? lead.destino) : 'Recusado',
              destination: nextStatus === 'approved' ? (lead.destination ?? lead.destino) : 'Recusado',
              motivo: nextStatus === 'rejected' ? lead.motivo || 'Movido manualmente para recusados.' : '',
            }
          : lead,
      ),
    );

    try {
      if (nextStatus === 'approved') {
        await importService.approveMany(ids);
      } else {
        await importService.rejectMany(ids);
      }
    } catch {
      // Leads simulados da sessao atual podem nao existir no banco; a validacao atomica acima protege a operacao local.
    }
  }, [sessionLeads]);

  const clearSession = useCallback(() => {
    setSessionLeads([]);
    setError(null);
  }, []);

  const sendApprovedToInicio = useCallback(async (sourceLeads: ImportLead[] = sessionLeads) => {
    const approved = sourceLeads.filter((lead) => isStatusGroup(lead.status, 'approved'));
    const created: ImportLead[] = [];
    for (const lead of approved) {
      const createdLead = await importService.create(leadToImportInput(lead, 'approved'));
      created.push(createdLead);
    }
    return created;
  }, [sessionLeads]);

  return {
    leads,
    summary,
    loading,
    error,
    refresh,
    importJson,
    createLead,
    updateLead,
    removeLead,
    moveLead,
    moveMany,
    clearSession,
    sendApprovedToInicio,
  };
}
