import type { BaseRepository } from './base.repository';
import type { BaseFilters, BaseLead, BaseLeadStatus, BaseSummary, CreateBaseLeadInput, UpdateBaseLeadInput } from '../../services/base/types';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import { isStatusGroup, normalizeStatusGroup } from '../../services/status/status.mapper';

let records: BaseLead[] = [];
let sentContacts: Array<{ id: string; phone: string; site: string; instagram: string; mapsUrl: string; sentAt: string }> = [];

const delay = async () => new Promise((resolve) => setTimeout(resolve, 120));

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeDigits(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function normalizeDomain(value: unknown) {
  const raw = normalize(value);
  if (!raw) return '';

  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function normalizeInstagram(value: unknown) {
  const raw = normalize(value);
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .trim();
}

function filterRecords(filters: BaseFilters = {}) {
  const query = normalize(filters.search);

  return records.filter((lead) => !isStatusGroup(lead.status, 'deleted')).filter((lead) => {
    const searchable = normalize(`${lead.company} ${lead.branch} ${lead.state} ${lead.city} ${lead.phone} ${lead.site} ${lead.instagram ?? ''} ${lead.mapsUrl ?? ''} ${lead.origin} ${lead.destination} ${lead.original_destination ?? ''} ${lead.destination_override ?? ''} ${lead.status}`);
    const matchesSearch = !query || searchable.includes(query);
    const matchesOrigin = !filters.origin || filters.origin === 'Todos' || lead.origin === filters.origin;
    const matchesBranch = !filters.branch || filters.branch === 'Todos' || lead.branch === filters.branch;
    const matchesState = !filters.state || filters.state === 'Todos' || normalizeBrazilState(lead.state) === normalizeBrazilState(filters.state);
    const matchesCity = !filters.city || filters.city === 'Todos' || lead.city === filters.city;
    const matchesDestination = !filters.destination || filters.destination === 'Todos' || lead.destination === filters.destination;
    const matchesStatus = !filters.status || filters.status === 'Todos' || isStatusGroup(lead.status, normalizeStatusGroup(filters.status));

    return matchesSearch && matchesOrigin && matchesBranch && matchesState && matchesCity && matchesDestination && matchesStatus;
  });
}

function calculateSummary(list: BaseLead[]): BaseSummary {
  const activeList = list.filter((lead) => !isStatusGroup(lead.status, 'deleted'));
  const sent = activeList.filter((lead) => isStatusGroup(lead.status, 'sent'));
  return {
    total: activeList.length,
    sent: sent.length,
    sentWhatsApp: sent.filter((lead) => lead.origin === 'WhatsApp' || lead.destination === 'WhatsApp' || lead.destination === 'Com site').length,
    sentInstagram: sent.filter((lead) => lead.origin === 'Instagram' || lead.destination === 'Instagram').length,
    archived: activeList.filter((lead) => isStatusGroup(lead.status, 'archived')).length,
    invalid: activeList.filter((lead) => isStatusGroup(lead.status, 'invalid')).length,
    errors: activeList.filter((lead) => isStatusGroup(lead.status, 'error')).length,
  };
}

function uniqueBy(key: keyof BaseLead) {
  return Array.from(new Set(records.filter((lead) => !isStatusGroup(lead.status, 'deleted')).map((lead) => (key === 'state' ? normalizeBrazilState(lead[key]) : String(lead[key] ?? '')).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function createId() {
  return `base-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createHistory(title: string, description: string) {
  return {
    id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: new Date().toISOString().slice(0, 10),
    title,
    description,
  };
}

function normalizeBaseInput(input: CreateBaseLeadInput): CreateBaseLeadInput {
  return {
    ...input,
    state: normalizeBrazilState(input.state),
    normalizedPhone: input.normalizedPhone ?? normalizeDigits(input.phone),
    normalizedSite: input.normalizedSite ?? normalizeDomain(input.site),
    normalizedInstagram: input.normalizedInstagram ?? normalizeInstagram(input.instagram),
    mapsUrl: input.mapsUrl ?? '',
    original_destination: input.original_destination ?? input.destination,
    destination_override: input.destination_override,
    send_instagram: input.send_instagram ?? false,
    instagram_override_reason: input.instagram_override_reason ?? '',
    override_by: input.override_by ?? '',
    override_at: input.override_at ?? '',
  };
}

function rememberSentContact(lead: BaseLead) {
  const phone = lead.normalizedPhone ?? normalizeDigits(lead.phone);
  const site = lead.normalizedSite ?? normalizeDomain(lead.site);
  const instagram = lead.normalizedInstagram ?? normalizeInstagram(lead.instagram);
  const mapsUrl = normalize(lead.mapsUrl);
  const exists = sentContacts.some((item) => (phone && item.phone === phone) || (site && item.site === site) || (instagram && item.instagram === instagram) || (mapsUrl && item.mapsUrl === mapsUrl));
  if (exists) return;

  sentContacts = [
    {
      id: `sent-contact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      phone,
      site,
      instagram,
      mapsUrl,
      sentAt: lead.sentAt,
    },
    ...sentContacts,
  ];
}

export const mockBaseRepository: BaseRepository = {
  async list(filters: BaseFilters = {}) {
    await delay();
    return filterRecords(filters);
  },

  async summary() {
    await delay();
    return calculateSummary(records);
  },

  async options() {
    await delay();
    return {
      origins: ['Todos', 'WhatsApp', 'Instagram'],
      branches: ['Todos', ...uniqueBy('branch')],
      states: ['Todos', ...uniqueBy('state')],
      cities: ['Todos', ...uniqueBy('city')],
      destinations: ['Todos', 'WhatsApp', 'Instagram', 'Com site', 'Agregador'],
      statuses: ['Todos', 'importado', 'validado', 'pre_envio', 'na_fila', 'enviado', 'invalido', 'duplicado', 'arquivado'],
    };
  },

  async listSentIdentities() {
    return {
      phones: sentContacts.map((item) => item.phone).filter(Boolean),
      sites: sentContacts.map((item) => item.site).filter(Boolean),
      instagrams: sentContacts.map((item) => item.instagram).filter(Boolean),
      mapsUrls: sentContacts.map((item) => item.mapsUrl).filter(Boolean),
    };
  },

  async upsertSent(input: CreateBaseLeadInput) {
    await delay();
    const normalizedInput = normalizeBaseInput(input);
    const existingIndex = records.findIndex((lead) =>
      (normalizedInput.sourceLeadId && lead.sourceLeadId === normalizedInput.sourceLeadId) ||
      (normalizedInput.normalizedPhone && (lead.normalizedPhone ?? normalizeDigits(lead.phone)) === normalizedInput.normalizedPhone) ||
      (normalizedInput.normalizedSite && (lead.normalizedSite ?? normalizeDomain(lead.site)) === normalizedInput.normalizedSite) ||
      (normalizedInput.normalizedInstagram && (lead.normalizedInstagram ?? normalizeInstagram(lead.instagram)) === normalizedInput.normalizedInstagram) ||
      (normalizedInput.mapsUrl && normalize(lead.mapsUrl) === normalize(normalizedInput.mapsUrl)),
    );

    if (existingIndex >= 0) {
      const existing = records[existingIndex];
      const updated: BaseLead = {
        ...existing,
        ...normalizedInput,
        id: existing.id,
        history: [
          createHistory('Contato reenviado', 'Registro atualizado por fluxo mockado.'),
          ...existing.history,
        ],
      };
      records[existingIndex] = updated;
      rememberSentContact(updated);
      return updated;
    }

    const lead: BaseLead = {
      id: createId(),
      ...normalizedInput,
      history: normalizedInput.history?.length ? normalizedInput.history : [createHistory('Lead enviado', 'Registro criado por envio mockado.')],
    };
    records = [lead, ...records];
    rememberSentContact(lead);
    return lead;
  },

  async update(id: string, input: UpdateBaseLeadInput) {
    await delay();
    let updated: BaseLead | null = null;
    const normalizedInput = {
      ...input,
      ...(input.state !== undefined ? { state: normalizeBrazilState(input.state) } : {}),
    };

    records = records.map((lead) => {
      if (lead.id !== id) return lead;
      updated = {
        ...lead,
        ...normalizedInput,
        history: [
          {
            id: `history-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            title: 'Lead atualizado',
            description: 'Dados editados localmente no protótipo.',
          },
          ...lead.history,
        ],
      };
      return updated;
    });

    if (!updated) throw new Error('Lead não encontrado na Base Permanente.');
    return updated;
  },

  async setStatus(id: string, status: BaseLeadStatus) {
    return mockBaseRepository.update(id, { status });
  },

  async archive(id: string) {
    return mockBaseRepository.setStatus(id, 'arquivado');
  },

  async restore(id: string) {
    return mockBaseRepository.setStatus(id, 'enviado');
  },

  async remove(id: string) {
    throw new Error('A exclusão não será presumida no banco novo.');
  },
};
