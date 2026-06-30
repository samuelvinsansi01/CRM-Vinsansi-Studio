import type { ImportRepository } from './import.repository';
import type { ImportExecutionOptions, ImportLead, ImportLeadDestination, ImportLeadInput, ImportListFilters, ImportParseResult, ImportSummary } from '../../services/import/types';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import { extractImportItems, normalizeDomain, normalizeImportItems, normalizePhone } from '../../services/import/importValidation';
import { isStatusGroup } from '../../services/status/status.mapper';

let memoryStore: ImportLead[] = [];

function createId() {
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyFilters(records: ImportLead[], filters: ImportListFilters) {
  const query = filters.search?.trim().toLowerCase() ?? '';

  return records.filter((lead) => {
    const matchesStatus = isStatusGroup(lead.status, filters.status);
    const matchesQuery = !query || Object.values(lead).some((value) => String(value ?? '').toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  });
}

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

function normalizeLeadInput(input: ImportLeadInput): ImportLeadInput {
  const sendInstagram = input.send_instagram ?? false;
  const originalDestination = input.original_destination ?? input.destino;
  const now = new Date().toISOString();

  return {
    ...input,
    estado: normalizeBrazilState(input.estado),
    original_destination: originalDestination,
    destination: sendInstagram ? 'Instagram' : input.destination ?? input.destino,
    destination_override: sendInstagram ? 'Instagram' : input.destination_override,
    send_instagram: sendInstagram,
    instagram_url: input.instagram_url ?? input.instagram,
    instagram_override_reason: sendInstagram ? input.instagram_override_reason || 'Override manual para Instagram' : '',
    override_by: sendInstagram ? input.override_by || 'Operador local' : '',
    override_at: sendInstagram ? input.override_at || now : '',
  };
}

function existingPhones() {
  return new Set(memoryStore.map((lead) => normalizePhone(lead.whatsapp)).filter(Boolean));
}

function existingSites() {
  return new Set(memoryStore.map((lead) => normalizeDomain(lead.site)).filter(Boolean));
}

function existingInstagrams() {
  return new Set(memoryStore.map((lead) => String(lead.normalizedInstagram ?? '').trim()).filter(Boolean));
}

function existingMapsUrls() {
  return new Set(memoryStore.map((lead) => String(lead.normalizedMapsUrl ?? '').trim()).filter(Boolean));
}

function idMap(key: 'normalizedPhone' | 'normalizedSite' | 'normalizedInstagram' | 'normalizedMapsUrl') {
  const map = new Map<string, string>();
  for (const lead of memoryStore) {
    const value = String(lead[key] ?? '').trim();
    if (value && !map.has(value)) map.set(value, lead.id);
  }
  return map;
}

export const mockImportRepository: ImportRepository = {
  async list(filters: ImportListFilters) {
    return applyFilters(memoryStore, filters);
  },

  async summary() {
    return calculateSummary(memoryStore);
  },

  async importFromJson(jsonText: string, options: ImportExecutionOptions = {}): Promise<ImportParseResult> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('JSON inválido. Revise o conteúdo colado e tente novamente.');
    }

    const items = extractImportItems(parsed);
    const normalized = await normalizeImportItems(items, {
      existingPhones: existingPhones(),
      existingSites: existingSites(),
      existingInstagrams: existingInstagrams(),
      existingMapsUrls: existingMapsUrls(),
      existingPhoneToId: idMap('normalizedPhone'),
      existingSiteToId: idMap('normalizedSite'),
      existingInstagramToId: idMap('normalizedInstagram'),
      existingMapsUrlToId: idMap('normalizedMapsUrl'),
      basePhones: new Set(options.context?.basePhones ?? []),
      baseSites: new Set(options.context?.baseSites ?? []),
      baseInstagrams: new Set(options.context?.baseInstagrams ?? []),
      baseMapsUrls: new Set(options.context?.baseMapsUrls ?? []),
      sentPhones: new Set(options.context?.sentPhones ?? []),
      sentSites: new Set(options.context?.sentSites ?? []),
      sentInstagrams: new Set(options.context?.sentInstagrams ?? []),
      sentMapsUrls: new Set(options.context?.sentMapsUrls ?? []),
    });

    const startedAt = performance.now?.() ?? Date.now();
    const leads = normalized.items
      .filter((item) => !item.ignored)
      .map(({ input }) => ({ id: createId(), ...normalizeLeadInput(input) }));

    

    const simulation = Boolean(options.simulate);
    const ignored = normalized.items.filter((item) => item.ignored).length;

    if (!simulation) {
      memoryStore = [...leads, ...memoryStore];
    }

    const approved = leads.filter((lead) => isStatusGroup(lead.status, 'approved')).length;
    const rejected = leads.filter((lead) => isStatusGroup(lead.status, 'rejected')).length;

    return {
      created: simulation ? 0 : leads.length,
      approved,
      rejected,
      ignored,
      errors: normalized.errors,
      leads,
      report: {
        simulation,
        processed: normalized.processed,
        created: simulation ? 0 : leads.length,
        approved,
        rejected,
        ignored,
        duplicates: normalized.duplicates,
        durationMs: Math.max(0, Math.round((performance.now?.() ?? Date.now()) - startedAt)),
        reasons: normalized.reasons,
      },
    };
  },

  async create(input: ImportLeadInput) {
    const lead = { id: createId(), ...normalizeLeadInput(input) };
    memoryStore = [lead, ...memoryStore];
    return lead;
  },

  async update(id: string, input: Partial<ImportLeadInput>) {
    let updated: ImportLead | null = null;
    memoryStore = memoryStore.map((lead) => {
      if (lead.id !== id) return lead;
      updated = { id, ...normalizeLeadInput({ ...lead, ...input }) };
      return updated;
    });

    if (!updated) throw new Error('Lead não encontrado.');
    return updated;
  },

  async remove(id: string) {
    memoryStore = memoryStore.filter((lead) => lead.id !== id);
  },

  async move(id: string, status: 'approved' | 'rejected') {
    const fallbackDestination: ImportLeadDestination = status === 'approved' ? 'WhatsApp' : 'Recusado';
    return mockImportRepository.update(id, {
      status,
      destino: fallbackDestination,
      destination: fallbackDestination,
      destination_override: undefined,
      send_instagram: false,
      motivo: status === 'rejected' ? 'Movido manualmente para recusados.' : '',
    });
  },
};
