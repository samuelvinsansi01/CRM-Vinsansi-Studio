import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull } from '../../services/config/branchIdentity';
import type { BaseFilters, BaseLead, BaseLeadStatus, BaseSummary, CreateBaseLeadInput, UpdateBaseLeadInput } from '../../services/base/types';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import { isStatusGroup, normalizeBaseStatus, normalizeStatusGroup } from '../../services/status/status.mapper';
import { createUuid, getCurrentUserId, nowIso } from '../supabase.helpers';
import type { BaseRepository } from './base.repository';

type BranchRule = {
  id: string;
  slug: string;
  name: string;
  terms: string[];
};

function baseTable() {
  return getSupabaseConfig().tables.basePermanent;
}

function sentTable() {
  return getSupabaseConfig().tables.sentContacts;
}

function leadsTable() {
  return getSupabaseConfig().tables.importLeads;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeComparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function textFrom(...values: unknown[]) {
  const found = values.find((value) => String(value ?? '').trim());
  return String(found ?? '');
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
  return raw.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').split(/[/?#\s]/)[0];
}

function createHistory(title: string, description: string) {
  return {
    id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: new Date().toISOString().slice(0, 10),
    title,
    description,
  };
}

function isInstagramLegacy(row: Record<string, unknown>, data: Partial<BaseLead>) {
  return [
    row.lead_channel,
    row.channel,
    row.source,
    row.destination,
    row.last_channel,
    row.status,
    data.origin,
    data.destination,
  ].some((value) => normalizeComparable(value).includes('instagram'));
}

function normalizeBaseDestinationValue(value: unknown): BaseLead['destination'] {
  const normalized = normalizeComparable(value);
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('agreg')) return 'Agregador';
  if (normalized.includes('com site') || normalized.includes('site')) return 'Com site';
  return 'WhatsApp';
}

function normalizeParentBranch(branchRules: BranchRule[], ...values: unknown[]) {
  return resolveParentBranch(branchRules, ...values)?.name ?? textFrom(...values);
}

function resolveParentBranch(branchRules: BranchRule[], ...values: unknown[]) {
  const first = textFrom(...values);
  const normalized = normalizeComparable(first);
  if (!normalized) return null;

  const candidates = values.map(normalizeComparable).filter(Boolean);
  for (const branch of branchRules) {
    const terms = [branch.id, branch.slug, branch.name, ...branch.terms].map(normalizeComparable).filter(Boolean);
    const matches = candidates.some((candidate) =>
      terms.some((term) => candidate === term || candidate.includes(term) || term.includes(candidate)),
    );
    if (matches) return branch;
  }

  if (branchRules.length === 1) return branchRules[0];
  return null;
}

function rowToBaseLead(row: Record<string, unknown>, branchRules: BranchRule[]): BaseLead {
  const data = (row.data && typeof row.data === 'object' ? row.data : row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}) as Partial<BaseLead>;
  const phone = String(row.phone ?? data.phone ?? '');
  const site = String(row.website ?? data.site ?? '');
  const instagram = String(row.instagram_url ?? data.instagram ?? '');
  const sentAt = String(row.sent_at ?? row.last_contact_at ?? data.sentAt ?? '');
  const instagramLegacy = isInstagramLegacy(row, data);
  const status = normalizeBaseStatus(row.status ?? data.status ?? 'sent') as BaseLeadStatus;
  const origin: BaseLead['origin'] = instagramLegacy ? 'Instagram' : 'WhatsApp';
  const destination = instagramLegacy ? 'Instagram' : normalizeBaseDestinationValue(row.destination ?? data.destination ?? row.last_channel ?? 'WhatsApp');
  const branchRule = resolveParentBranch(
    branchRules,
    row.branch_id,
    (data as Record<string, unknown>).branch_id,
    row.parent_category,
    row.category,
    row.category_name,
    data.branch,
    (data as Record<string, unknown>).parent_category,
  );
  const branch = branchRule?.name ?? normalizeParentBranch(branchRules, row.parent_category, row.category, row.category_name, data.branch, (data as Record<string, unknown>).parent_category);

  return {
    id: String(row.id),
    sourceLeadId: String(data.sourceLeadId ?? ''),
    company: String(row.company_name ?? data.company ?? ''),
    branch,
    branch_id: branchRule?.id ?? String((data as Record<string, unknown>).branch_id ?? row.branch_id ?? ''),
    branch_slug: branchRule?.slug ?? String((data as Record<string, unknown>).branch_slug ?? row.branch_slug ?? ''),
    state: normalizeBrazilState(row.state ?? data.state),
    city: String(row.city ?? data.city ?? ''),
    phone,
    normalizedPhone: String(row.normalized_phone ?? data.normalizedPhone ?? normalizeDigits(phone)),
    site,
    normalizedSite: String(row.website_domain ?? data.normalizedSite ?? normalizeDomain(site)),
    instagram,
    normalizedInstagram: String(row.instagram_username ?? data.normalizedInstagram ?? normalizeInstagram(instagram)),
    mapsUrl: String(row.maps_url ?? data.mapsUrl ?? ''),
    origin,
    destination,
    original_destination: data.original_destination ?? (row.original_destination as BaseLead['original_destination']),
    destination_override: data.destination_override ?? (row.destination_override as BaseLead['destination_override']),
    send_instagram: data.send_instagram ?? Boolean(row.send_instagram ?? false),
    instagram_override_reason: data.instagram_override_reason ?? String(row.instagram_override_reason ?? ''),
    override_by: data.override_by ?? String(row.override_by ?? ''),
    override_at: data.override_at ?? String(row.override_at ?? ''),
    status,
    sentAt,
    template: String(data.template ?? ''),
    chipOrProfile: String(data.chipOrProfile ?? row.source_instance ?? row.source_account ?? ''),
    notes: String(row.notes ?? data.notes ?? ''),
    history: Array.isArray(data.history) ? data.history : [createHistory('Lead carregado', 'Registro carregado da Base Permanente.')],
  };
}

function normalizeInput(input: CreateBaseLeadInput): CreateBaseLeadInput {
  return {
    ...input,
    state: normalizeBrazilState(input.state),
    normalizedPhone: input.normalizedPhone ?? normalizeDigits(input.phone),
    normalizedSite: input.normalizedSite ?? normalizeDomain(input.site),
    normalizedInstagram: input.normalizedInstagram ?? normalizeInstagram(input.instagram),
    mapsUrl: input.mapsUrl ?? '',
    original_destination: input.original_destination ?? input.destination,
    send_instagram: input.send_instagram ?? false,
    instagram_override_reason: input.instagram_override_reason ?? '',
    override_by: input.override_by ?? '',
    override_at: input.override_at ?? '',
  };
}

function filterRecords(records: BaseLead[], filters: BaseFilters = {}) {
  const query = normalize(filters.search);
  return records.filter((lead) => {
    const searchable = normalize(JSON.stringify(lead));
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

function calculateSummary(records: BaseLead[]): BaseSummary {
  const sent = records.filter((lead) => isStatusGroup(lead.status, 'sent'));
  return {
    total: records.length,
    sent: sent.length,
    sentWhatsApp: sent.filter((lead) => lead.origin === 'WhatsApp').length,
    sentInstagram: sent.filter((lead) => lead.origin === 'Instagram' || lead.destination === 'Instagram').length,
    archived: records.filter((lead) => isStatusGroup(lead.status, 'archived')).length,
    invalid: records.filter((lead) => isStatusGroup(lead.status, 'invalid')).length,
    errors: records.filter((lead) => isStatusGroup(lead.status, 'error')).length,
  };
}

function uniqueBy(records: BaseLead[], key: keyof BaseLead) {
  return Array.from(new Set(records.map((lead) => (key === 'state' ? normalizeBrazilState(lead[key]) : String(lead[key] ?? '')).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function isTestConfigLike(record: Record<string, unknown>) {
  const signature = normalizeComparable(JSON.stringify(record));
  return signature.includes('teste supabase') || signature.includes('supabase real') || signature.includes('codex');
}

async function loadBranchRules(): Promise<BranchRule[]> {
  const { data, error } = await getSupabaseClient().from(getSupabaseConfig().tables.branches).select('*');
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const record = row as Record<string, unknown>;
      const config = (record.data && typeof record.data === 'object' ? record.data : {}) as Record<string, unknown>;
      if (record.active === false || config.active === false) return null;
      if (isTestConfigLike(record) || isTestConfigLike(config)) return null;

      const name = textFrom(record.name, config.name, record.category, config.category);
      if (!name) return null;
      const id = textFrom(record.id, config.id);
      const slug = textFrom(record.slug, config.slug, name);
      const terms = [
        id,
        slug,
        name,
        record.category,
        config.category,
        ...(Array.isArray(record.subcategories) ? record.subcategories : []),
        ...(Array.isArray(config.subcategories) ? config.subcategories : []),
        ...(Array.isArray(record.associated_categories) ? record.associated_categories : []),
        ...(Array.isArray(record.associatedCategories) ? record.associatedCategories : []),
        ...(Array.isArray(config.associatedCategories) ? config.associatedCategories : []),
      ].map(String);

      return { id, slug, name, terms };
    })
    .filter((rule): rule is BranchRule => Boolean(rule));
}

async function allRecords() {
  const branchRules = await loadBranchRules();
  const { data, error } = await getSupabaseClient().from(baseTable()).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToBaseLead(row, branchRules));
}

function dbPayload(lead: BaseLead, userId: string) {
  const normalizedLead = { ...lead, state: normalizeBrazilState(lead.state) };
  return {
    id: lead.id,
    user_id: userId,
    company_name: lead.company,
    phone: lead.phone,
    normalized_phone: lead.normalizedPhone ?? normalizeDigits(lead.phone),
    website: lead.site,
    website_domain: lead.normalizedSite ?? normalizeDomain(lead.site),
    instagram_url: lead.instagram,
    instagram_username: lead.normalizedInstagram ?? normalizeInstagram(lead.instagram),
    maps_url: lead.mapsUrl,
    status: lead.status,
    source: lead.origin,
    notes: lead.notes,
    last_contact_at: lead.sentAt || null,
    raw_payload: normalizedLead,
    data: normalizedLead,
    active: true,
    kind: 'base_permanente',
    channel: lead.origin,
    sent_at: lead.sentAt || null,
    branch_id: branchIdOrNull(lead.branch_id),
    branch_name: lead.branch,
    branch_slug: lead.branch_slug,
    destination: lead.destination,
    original_destination: lead.original_destination,
    destination_override: lead.destination_override,
    send_instagram: lead.send_instagram,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at || null,
    category: lead.branch,
    category_name: lead.branch,
    city: lead.city,
    state: normalizedLead.state,
    last_channel: lead.destination,
    source_instance: lead.chipOrProfile,
    whatsapp_sent_at: lead.origin === 'WhatsApp' ? lead.sentAt || null : null,
    instagram_sent_at: lead.origin === 'Instagram' ? lead.sentAt || null : null,
    updated_at: nowIso(),
  };
}

async function rememberSentContact(lead: BaseLead, userId: string) {
  const phone = lead.normalizedPhone ?? normalizeDigits(lead.phone);
  const site = lead.normalizedSite ?? normalizeDomain(lead.site);
  const instagram = lead.normalizedInstagram ?? normalizeInstagram(lead.instagram);
  const mapsUrl = normalize(lead.mapsUrl);
  const leadId = await resolveExistingLeadId(lead.sourceLeadId);
  const payload = {
    id: lead.id,
    user_id: userId,
    lead_id: leadId,
    company_name: lead.company,
    phone: lead.phone,
    normalized_phone: phone,
    raw_payload: { phone, site, instagram, mapsUrl, sentAt: lead.sentAt, leadId },
    data: { phone, site, instagram, mapsUrl, sentAt: lead.sentAt, leadId },
    site_normalized: site,
    instagram_username: instagram,
    maps_url: mapsUrl,
    dispatched_at: lead.sentAt || nowIso(),
    sent_at: lead.sentAt || nowIso(),
    block_type: lead.destination,
    source: lead.origin,
    active: true,
    reason: lead.notes || '',
    updated_at: nowIso(),
  };

  const { error } = await getSupabaseClient().from(sentTable()).upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

async function resolveExistingLeadId(candidate: unknown) {
  const leadId = String(candidate ?? '').trim();
  if (!leadId) return null;
  const { data, error } = await getSupabaseClient().from(leadsTable()).select('id').eq('id', leadId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`Lead id inexistente em public.${leadsTable()} para sent_contacts: ${leadId}`);
  return String(data.id);
}

export const supabaseBaseRepository: BaseRepository = {
  async list(filters = {}) {
    return filterRecords(await allRecords(), filters);
  },

  async summary() {
    return calculateSummary(await allRecords());
  },

  async options() {
    const [records, branchRules] = await Promise.all([allRecords(), loadBranchRules()]);
    const branchOptions = branchRules.map((rule) => rule.name);
    return {
      origins: ['Todos', 'WhatsApp', 'Instagram'],
      branches: ['Todos', ...(branchOptions.length ? branchOptions : uniqueBy(records, 'branch'))],
      states: ['Todos', ...uniqueBy(records, 'state')],
      cities: ['Todos', ...uniqueBy(records, 'city')],
      destinations: ['Todos', 'WhatsApp', 'Instagram', 'Com site', 'Agregador'],
      statuses: ['Todos', 'sent', 'archived', 'invalid', 'error'],
    };
  },

  async listSentIdentities() {
    const { data, error } = await getSupabaseClient()
      .from(sentTable())
      .select('normalized_phone,site_normalized,instagram_username,maps_url')
      .eq('active', true);
    if (error) throw new Error(error.message);

    return {
      phones: (data ?? []).map((row) => String(row.normalized_phone ?? '')).filter(Boolean),
      sites: (data ?? []).map((row) => String(row.site_normalized ?? '')).filter(Boolean),
      instagrams: (data ?? []).map((row) => String(row.instagram_username ?? '')).filter(Boolean),
      mapsUrls: (data ?? []).map((row) => String(row.maps_url ?? '')).filter(Boolean),
    };
  },

  async upsertSent(input) {
    const records = await allRecords();
    const normalizedInput = normalizeInput(input);
    const existing = records.find(
      (lead) =>
        (normalizedInput.sourceLeadId && lead.sourceLeadId === normalizedInput.sourceLeadId) ||
        (normalizedInput.normalizedPhone && (lead.normalizedPhone ?? normalizeDigits(lead.phone)) === normalizedInput.normalizedPhone) ||
        (normalizedInput.normalizedSite && (lead.normalizedSite ?? normalizeDomain(lead.site)) === normalizedInput.normalizedSite) ||
        (normalizedInput.normalizedInstagram && (lead.normalizedInstagram ?? normalizeInstagram(lead.instagram)) === normalizedInput.normalizedInstagram) ||
        (normalizedInput.mapsUrl && normalize(lead.mapsUrl) === normalize(normalizedInput.mapsUrl)),
    );
    const userId = await getCurrentUserId();

    const lead: BaseLead = existing
      ? { ...existing, ...normalizedInput, id: existing.id, history: [createHistory('Contato reenviado', 'Registro atualizado por fluxo Supabase.'), ...existing.history] }
      : { id: createUuid(), ...normalizedInput, history: normalizedInput.history?.length ? normalizedInput.history : [createHistory('Lead enviado', 'Registro criado por envio real/mockado.')] };

    const query = existing
      ? getSupabaseClient().from(baseTable()).update(dbPayload(lead, userId)).eq('id', lead.id)
      : getSupabaseClient().from(baseTable()).insert({ ...dbPayload(lead, userId), created_at: nowIso() });
    const { error } = await query;
    if (error) throw new Error(error.message);
    await rememberSentContact(lead, userId);
    return lead;
  },

  async update(id, input: UpdateBaseLeadInput) {
    const existing = (await allRecords()).find((lead) => lead.id === id);
    if (!existing) throw new Error('Lead nao encontrado na Base Permanente.');
    const normalizedInput = {
      ...input,
      ...(input.state !== undefined ? { state: normalizeBrazilState(input.state) } : {}),
    };
    const updated: BaseLead = {
      ...existing,
      ...normalizedInput,
      history: [createHistory('Lead atualizado', 'Dados editados na Base Permanente.'), ...existing.history],
    };
    const { error } = await getSupabaseClient().from(baseTable()).update(dbPayload(updated, await getCurrentUserId())).eq('id', id);
    if (error) throw new Error(error.message);
    return updated;
  },

  async setStatus(id, status: BaseLeadStatus) {
    return this.update(id, { status });
  },

  async archive(id) {
    return this.setStatus(id, 'archived');
  },
};
