import { useCallback, useMemo, useState } from 'react';
import { normalizeBrazilState } from '../services/geo/brazilState';
import { importService } from '../services/import/import.service';
import type { ImportExecutionOptions, ImportLead, ImportLeadInput, ImportLeadStatus, ImportSummary } from '../services/import/types';
import { sortByLeadScore } from '../services/lead-score/leadScore.service';
import { permissionsFor } from '../services/permissions';
import { isStatusGroup } from '../services/status/status.mapper';

function calculateSummary(records: ImportLead[]): ImportSummary {
  const approved = records.filter((lead) => isStatusGroup(lead.status, 'approved'));
  const pending = records.filter((lead) => isStatusGroup(lead.status, 'pending'));
  const operational = [...approved, ...pending];
  const rejected = records.filter((lead) => isStatusGroup(lead.status, 'rejected'));
  const finalDestination = (lead: ImportLead) => (lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino);

  return {
    total: records.length,
    approved: approved.length,
    pending: pending.length,
    rejected: rejected.length,
    whatsapp: approved.filter((lead) => finalDestination(lead) === 'WhatsApp').length,
    ownSite: operational.filter((lead) => finalDestination(lead) === 'Com site').length,
    aggregators: operational.filter((lead) => finalDestination(lead) === 'Agregadores').length,
    instagram: operational.filter((lead) => finalDestination(lead) === 'Instagram').length,
  };
}

function applySessionFilters(records: ImportLead[], status: ImportLeadStatus, search: string) {
  const query = search.trim().toLowerCase();

  return records.filter((lead) => {
    const matchesStatus = status === 'approved'
      ? isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending')
      : isStatusGroup(lead.status, status);
    const matchesQuery = !query || Object.values(lead).some((item) => String(item ?? '').toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  });
}


function isPersistedLeadId(id: string) {
  return /^\d+$/.test(id);
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
    const lead = await importService.create(input);
    setSessionLeads((current) => [lead, ...current]);
    return lead;
  }, []);

  const updateLead = useCallback(async (id: string, input: Partial<ImportLeadInput>) => {
    if (!isPersistedLeadId(id)) {
      setSessionLeads((current) => current.map((lead) => (
        lead.id === id
          ? { ...lead, ...input, estado: normalizeBrazilState(input.estado ?? lead.estado), id }
          : lead
      )));
      return;
    }

    const updated = await importService.update(id, input);
    setSessionLeads((current) => current.map((lead) => (lead.id === id ? updated : lead)));
  }, []);

  const removeLead = useCallback(async (id: string) => {
    if (isPersistedLeadId(id)) await importService.remove(id);
    setSessionLeads((current) => current.filter((lead) => lead.id !== id));
  }, []);

  const moveLead = useCallback(async (id: string, nextStatus: 'approved' | 'rejected') => {
    const movedFromRepository = isPersistedLeadId(id)
      ? await importService.move(id, nextStatus)
      : null;

    setSessionLeads((current) =>
      current.map((lead) =>
        lead.id === id
          ? {
              ...lead,
              ...(movedFromRepository ?? {}),
              status: nextStatus,
              destino: movedFromRepository?.destino ?? (nextStatus === 'approved' ? (lead.destination ?? lead.destino) : 'Recusado'),
              destination: movedFromRepository?.destination ?? (nextStatus === 'approved' ? (lead.destination ?? lead.destino) : 'Recusado'),
              destination_override: movedFromRepository?.destination_override ?? lead.destination_override,
              send_instagram: movedFromRepository?.send_instagram ?? lead.send_instagram ?? false,
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

    const persistedIds = ids.filter(isPersistedLeadId);
    if (persistedIds.length) {
      if (nextStatus === 'approved') {
        await importService.approveMany(persistedIds);
      } else {
        await importService.rejectMany(persistedIds);
      }
    }

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
  }, [sessionLeads]);

  const clearSession = useCallback(() => {
    setSessionLeads([]);
    setError(null);
  }, []);

  const sendApprovedToInicio = useCallback(async (sourceLeads: ImportLead[] = sessionLeads) => {
    const operational = sourceLeads.filter((lead) =>
      !isPersistedLeadId(lead.id)
      && (isStatusGroup(lead.status, 'approved') || isStatusGroup(lead.status, 'pending'))
    );
    const result = await importService.persistLeads(operational);
    const duplicateIds = new Set(result.duplicateClientIds);
    const createdByIdentity = new Map<string, ImportLead>();
    for (const lead of result.created) {
      const keys = [lead.sourceLeadId, lead.normalizedPhone, lead.normalizedSite, lead.normalizedInstagram, lead.normalizedMapsUrl].filter(Boolean) as string[];
      keys.forEach((key) => createdByIdentity.set(key, lead));
    }

    setSessionLeads((current) => current.map((lead) => {
      if (duplicateIds.has(lead.id)) {
        return {
          ...lead,
          status: 'rejected',
          destino: 'Recusado',
          destination: 'Recusado',
          motivo: 'Lead duplicado: identidade já existente na plataforma.',
          rejectionCode: 'duplicate_site',
        };
      }
      const persisted = [lead.sourceLeadId, lead.normalizedPhone, lead.normalizedSite, lead.normalizedInstagram, lead.normalizedMapsUrl]
        .map((key) => key ? createdByIdentity.get(key) : undefined)
        .find(Boolean);
      return persisted ?? lead;
    }));

    return result.created;
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
