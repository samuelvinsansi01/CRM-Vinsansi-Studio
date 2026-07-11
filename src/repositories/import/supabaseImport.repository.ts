import { getSupabaseClient, getSupabaseConfig } from '../../lib/supabase';
import { branchIdOrNull } from '../../services/config/branchIdentity';
import { normalizeBrazilState } from '../../services/geo/brazilState';
import { extractImportItems, normalizeDomain, normalizeImportItems, normalizePhone } from '../../services/import/importValidation';
import type { ImportExecutionOptions, ImportLead, ImportLeadDestination, ImportLeadInput, ImportListFilters, ImportParseResult, ImportSummary } from '../../services/import/types';
import { normalizeInstagramUsername } from '../../services/instagram/instagram.utils';
import { isStatusGroup } from '../../services/status/status.mapper';
import { createId, createUuid, getCurrentUserId, nowIso } from '../supabase.helpers';
import type { ImportRepository } from './import.repository';

type BranchRule = {
  id: string;
  slug: string;
  name: string;
  terms: string[];
};

function table() {
  return getSupabaseConfig().tables.importLeads;
}

function normalizeLeadInput(input: ImportLeadInput): ImportLeadInput {
  const sendInstagram = input.send_instagram ?? false;
  const now = new Date().toISOString();
  return {
    ...input,
    estado: normalizeBrazilState(input.estado),
    original_destination: input.original_destination ?? input.destino,
    destination: sendInstagram ? 'Instagram' : input.destination ?? input.destino,
    destination_override: sendInstagram ? 'Instagram' : input.destination_override,
    send_instagram: sendInstagram,
    instagram_url: input.instagram_url ?? input.instagram,
    instagram_override_reason: sendInstagram ? input.instagram_override_reason || 'Override manual para Instagram' : '',
    override_by: sendInstagram ? input.override_by || 'Operador local' : '',
    override_at: sendInstagram ? input.override_at || now : '',
  };
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

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0;
}

function normalizeDestinationValue(value: unknown): ImportLeadDestination | undefined {
  const normalized = normalizeComparable(value);
  if (!normalized) return undefined;
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('agreg') || normalized.includes('aggregator')) return 'Agregadores';
  if (normalized.includes('com site') || normalized.includes('site proprio') || normalized.includes('own site')) return 'Com site';
  if (normalized === 'whatsapp' || normalized === 'sem site') return 'WhatsApp';
  return undefined;
}

function isAggregatorWebsite(site: string, websiteType: string) {
  const normalizedType = normalizeComparable(websiteType);
  if (['aggregator', 'external', 'linktree', 'beacons', 'carrd', 'taplink'].includes(normalizedType)) return true;
  return /(^|[/.])(linktr\.ee|linktree|beacons\.ai|carrd\.co|taplink|bio\.link|lnk\.bio)([/.]|$)/i.test(site);
}

function isOwnWebsite(site: string, websiteType: string) {
  const normalizedType = normalizeComparable(websiteType);
  if (!site.trim()) return false;
  if (['none', 'whatsapp', 'instagram', 'facebook'].includes(normalizedType)) return false;
  if (isAggregatorWebsite(site, websiteType)) return false;
  return true;
}

function classifyLegacyDestination(row: Record<string, unknown>, data: Partial<ImportLead>, raw: Partial<ImportLead>): ImportLeadDestination {
  const explicitDestination = normalizeDestinationValue(data.destination ?? row.destination ?? data.destino);
  if (explicitDestination) return explicitDestination;

  const phone = textFrom(row.normalized_phone, row.phone, data.normalizedPhone, data.whatsapp, raw.normalizedPhone, raw.whatsapp, (raw as Record<string, unknown>).phone);
  const instagram = textFrom(
    row.instagram_url,
    row.instagram,
    row.instagram_username,
    data.instagram_url,
    data.instagram,
    data.normalizedInstagram,
    raw.instagram_url,
    raw.instagram,
    raw.normalizedInstagram,
  );
  const site = textFrom(row.website, data.site, raw.site, (raw as Record<string, unknown>).website);
  const websiteType = textFrom(row.website_type, row.website_quality, (data as Record<string, unknown>).website_type, (raw as Record<string, unknown>).website_type, (raw as Record<string, unknown>).websiteType);

  if (hasText(phone) && isOwnWebsite(site, websiteType)) return 'Com site';
  if (hasText(phone) && isAggregatorWebsite(site, websiteType)) return 'Agregadores';
  if (hasText(phone)) return 'WhatsApp';
  if (hasText(instagram)) return 'Instagram';

  return normalizeDestinationValue(row.lead_channel ?? row.lead_type ?? data.destino) ?? 'WhatsApp';
}

function normalizeParentBranch(branchRules: BranchRule[], ...values: unknown[]) {
  return resolveParentBranch(branchRules, ...values)?.name ?? textFrom(...values);
}

function resolveParentBranch(branchRules: BranchRule[], ...values: unknown[]) {
  const candidates = values.map(normalizeComparable).filter(Boolean);
  if (!candidates.length) return null;

  for (const branch of branchRules) {
    const terms = [branch.id, branch.slug, branch.name, ...branch.terms].map(normalizeComparable).filter(Boolean);
    if (candidates.some((candidate) => terms.includes(candidate))) return branch;
  }

  return null;
}

function isTestLead(lead: ImportLead) {
  const signature = normalizeComparable(`${lead.empresa} ${lead.ramo} ${lead.subcategoria ?? ''} ${lead.site ?? ''} ${lead.instagram ?? ''}`);
  return signature.includes('teste supabase') || signature.includes('supabase real') || signature.includes('codex') || signature.includes('lead fake');
}

function rowToLead(row: Record<string, unknown>, branchRules: BranchRule[]): ImportLead {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Partial<ImportLead>;
  const raw = (row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}) as Partial<ImportLead>;
  const website = textFrom(row.website, data.site, raw.site, (raw as Record<string, unknown>).website);
  const instagram = textFrom(row.instagram_url, row.instagram, data.instagram_url, data.instagram, raw.instagram_url, raw.instagram);
  const destino = classifyLegacyDestination(row, data, raw);
  const branchRule = resolveParentBranch(branchRules, row.branch_id, (data as Record<string, unknown>).branch_id, row.parent_category, (data as Record<string, unknown>).parent_category, data.ramo, raw.ramo, row.category, row.category_name, (raw as Record<string, unknown>).categoryName);
  const parentBranch = branchRule?.name ?? normalizeParentBranch(branchRules, row.parent_category, (data as Record<string, unknown>).parent_category, data.ramo, raw.ramo, row.category, row.category_name, (raw as Record<string, unknown>).categoryName);
  return {
    id: String(row.id),
    empresa: textFrom(row.company_name, data.empresa, raw.empresa, (raw as Record<string, unknown>).title),
    ramo: parentBranch,
    branch_id: branchRule?.id ?? String((data as Record<string, unknown>).branch_id ?? row.branch_id ?? ''),
    branch_slug: branchRule?.slug ?? String((data as Record<string, unknown>).branch_slug ?? row.branch_slug ?? ''),
    subcategoria: textFrom(row.category_name, row.category, data.subcategoria, raw.subcategoria, (raw as Record<string, unknown>).categoryName),
    destino,
    original_destination: normalizeDestinationValue(data.original_destination ?? row.original_destination) ?? destino,
    destination: normalizeDestinationValue(data.destination ?? row.destination) ?? destino,
    destination_override: normalizeDestinationValue(data.destination_override ?? row.destination_override),
    send_instagram: Boolean(data.send_instagram ?? row.send_instagram ?? false),
    instagram_url: String(data.instagram_url ?? row.instagram_url ?? instagram),
    instagram_override_reason: String(data.instagram_override_reason ?? row.instagram_override_reason ?? ''),
    override_by: String(data.override_by ?? row.override_by ?? ''),
    override_at: String(data.override_at ?? row.override_at ?? ''),
    status: (row.status ?? data.status ?? 'approved') as ImportLead['status'],
    motivo: String(row.rejected_reason ?? data.motivo ?? ''),
    rejectionCode: data.rejectionCode,
    rating: Number(row.rating ?? data.rating ?? 0),
    reviews: Number(row.reviews_count ?? data.reviews ?? 0),
    whatsapp: textFrom(row.phone, data.whatsapp, raw.whatsapp, (raw as Record<string, unknown>).phone),
    instagram,
    site: website,
    cidade: textFrom(row.city, data.cidade, raw.cidade, (raw as Record<string, unknown>).city),
    estado: normalizeBrazilState(textFrom(row.state, data.estado, raw.estado, (raw as Record<string, unknown>).state)),
    existingId: data.existingId,
    normalizedPhone: String(row.normalized_phone ?? data.normalizedPhone ?? ''),
    normalizedSite: String(row.website_domain ?? data.normalizedSite ?? normalizeDomain(website)),
    normalizedInstagram: String(row.instagram_username ?? data.normalizedInstagram ?? normalizeInstagramUsername(instagram)),
    normalizedMapsUrl: String(row.maps_url ?? data.normalizedMapsUrl ?? ''),
    returned_from_queue: Boolean((data as Record<string, unknown>).returned_from_queue ?? false),
    returned_at: String((data as Record<string, unknown>).returned_at ?? ''),
    return_reason: String((data as Record<string, unknown>).return_reason ?? ''),
  };
}

function applyFilters(records: ImportLead[], filters: ImportListFilters) {
  const query = filters.search?.trim().toLowerCase() ?? '';
  return records.filter((lead) => {
    const matchesStatus = isStatusGroup(lead.status, filters.status);
    const matchesQuery = !query || JSON.stringify(lead).toLowerCase().includes(query);
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

function idMap(records: ImportLead[], key: 'normalizedPhone' | 'normalizedSite' | 'normalizedInstagram' | 'normalizedMapsUrl') {
  const map = new Map<string, string>();
  for (const lead of records) {
    const value = String(lead[key] ?? '').trim();
    if (value && !map.has(value)) map.set(value, lead.id);
  }
  return map;
}

function findDuplicateLead(records: ImportLead[], lead: ImportLead) {
  const identities: Array<keyof Pick<ImportLead, 'normalizedPhone' | 'normalizedSite' | 'normalizedInstagram' | 'normalizedMapsUrl'>> = [
    'normalizedPhone',
    'normalizedSite',
    'normalizedInstagram',
    'normalizedMapsUrl',
  ];

  return records.find((record) =>
    identities.some((key) => {
      const current = String(lead[key] ?? '').trim();
      return current && current === String(record[key] ?? '').trim();
    }),
  );
}

async function allLeads(includeDeleted = false) {
  const branchRules = await loadBranchRules();
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient().from(table()).select('*').range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < pageSize) break;
  }

  return rows.map((row) => rowToLead(row, branchRules)).filter((lead) => !isTestLead(lead) && (includeDeleted || !isStatusGroup(lead.status, 'deleted')));
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

function dbLeadPayload(lead: ImportLead, userId: string) {
  const site = lead.site ?? '';
  const instagram = lead.instagram_url ?? lead.instagram ?? '';
  const destination = lead.send_instagram ? 'Instagram' : lead.destination ?? lead.destino;
  const normalizedLead = { ...lead, estado: normalizeBrazilState(lead.estado) };
  return {
    id: lead.id,
    user_id: userId,
    company_name: lead.empresa,
    phone: lead.whatsapp,
    website: site,
    instagram,
    instagram_url: instagram,
    instagram_username: lead.normalizedInstagram || normalizeInstagramUsername(instagram),
    maps_url: lead.normalizedMapsUrl,
    status: lead.status,
    current_status: lead.status,
    pipeline_status: lead.status,
    lead_channel: destination,
    lead_type: destination,
    branch_id: branchIdOrNull(lead.branch_id),
    branch_name: lead.ramo,
    branch_slug: lead.branch_slug,
    parent_category: lead.ramo,
    category: lead.ramo,
    category_name: lead.subcategoria,
    city: lead.cidade,
    state: normalizeBrazilState(lead.estado),
    rating: lead.rating,
    reviews_count: lead.reviews,
    has_own_site: destination === 'Com site',
    rejected_reason: lead.status === 'rejected' ? lead.motivo : null,
    raw_payload: normalizedLead,
    crm_data: normalizedLead,
    data: normalizedLead,
    original_destination: lead.original_destination,
    destination,
    destination_override: lead.destination_override,
    send_instagram: lead.send_instagram,
    instagram_override_reason: lead.instagram_override_reason,
    override_by: lead.override_by,
    override_at: lead.override_at || null,
    updated_at: nowIso(),
    created_at: nowIso(),
  };
}

async function rememberImportBatch(userId: string, leads: ImportLead[], parsed: unknown, source = 'react') {
  const batchId = createUuid();
  const { error } = await getSupabaseClient().from(getSupabaseConfig().tables.importBatches).insert({
    id: batchId,
    user_id: userId,
    source,
    quantity_total: leads.length,
    quantity_created: leads.filter((lead) => isStatusGroup(lead.status, 'approved')).length,
    quantity_blocked: leads.filter((lead) => isStatusGroup(lead.status, 'rejected')).length,
    quantity_duplicate: 0,
    raw_metadata: { source: 'react', parsed },
    created_at: nowIso(),
  });
  if (error) throw new Error(error.message);
  return batchId;
}

async function rememberLeadImports(userId: string, batchId: string, leads: ImportLead[]) {
  const rows = leads.map((lead) => ({
    id: createUuid(),
    user_id: userId,
    import_batch_id: batchId,
    lead_id: lead.id,
    status: lead.status,
    reason: lead.motivo,
    original_payload: lead,
    normalized_payload: lead,
    created_at: nowIso(),
  }));
  if (!rows.length) return;
  const { error } = await getSupabaseClient().from(getSupabaseConfig().tables.leadImports).insert(rows);
  if (error) throw new Error(error.message);
}

async function rememberRegistries(userId: string, leads: ImportLead[]) {
  const identityRows = leads.flatMap((lead) => {
    const identities = [
      ['phone', lead.normalizedPhone || normalizePhone(lead.whatsapp)],
      ['site', lead.normalizedSite || normalizeDomain(lead.site)],
      ['instagram', lead.normalizedInstagram || normalizeInstagramUsername(lead.instagram_url ?? lead.instagram)],
      ['maps', lead.normalizedMapsUrl],
    ].filter(([, value]) => value);
    return identities.map(([identityType, identityValue]) => ({
      id: createUuid(),
      user_id: userId,
      lead_id: lead.id,
      identity_type: identityType,
      identity_value: identityValue,
      source_table: 'leads',
      status: lead.status,
      company_name: lead.empresa,
      first_seen_at: nowIso(),
      last_seen_at: nowIso(),
      raw_payload: lead,
    }));
  });
  if (identityRows.length) {
    const { error } = await getSupabaseClient()
      .from(getSupabaseConfig().tables.leadRegistry)
      .upsert(identityRows, { onConflict: 'user_id,identity_type,identity_value', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
}

export const supabaseImportRepository: ImportRepository = {
  async list(filters) {
    return applyFilters(await allLeads(), filters);
  },

  async summary() {
    return calculateSummary(await allLeads());
  },

  async importFromJson(jsonText: string, options: ImportExecutionOptions = {}): Promise<ImportParseResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('JSON invalido. Revise o conteudo colado e tente novamente.');
    }

    const existing = await allLeads(true);
    const startedAt = performance.now?.() ?? Date.now();
    const normalized = await normalizeImportItems(extractImportItems(parsed), {
      existingPhones: new Set(existing.map((lead) => normalizePhone(lead.whatsapp)).filter(Boolean)),
      existingSites: new Set(existing.map((lead) => normalizeDomain(lead.site)).filter(Boolean)),
      existingInstagrams: new Set(existing.map((lead) => String(lead.normalizedInstagram ?? '').trim()).filter(Boolean)),
      existingMapsUrls: new Set(existing.map((lead) => String(lead.normalizedMapsUrl ?? '').trim()).filter(Boolean)),
      existingPhoneToId: idMap(existing, 'normalizedPhone'),
      existingSiteToId: idMap(existing, 'normalizedSite'),
      existingInstagramToId: idMap(existing, 'normalizedInstagram'),
      existingMapsUrlToId: idMap(existing, 'normalizedMapsUrl'),
      basePhones: new Set(options.context?.basePhones ?? []),
      baseSites: new Set(options.context?.baseSites ?? []),
      baseInstagrams: new Set(options.context?.baseInstagrams ?? []),
      baseMapsUrls: new Set(options.context?.baseMapsUrls ?? []),
      sentPhones: new Set(options.context?.sentPhones ?? []),
      sentSites: new Set(options.context?.sentSites ?? []),
      sentInstagrams: new Set(options.context?.sentInstagrams ?? []),
      sentMapsUrls: new Set(options.context?.sentMapsUrls ?? []),
    });

    const leads = normalized.items
      .filter((item) => !item.ignored)
      .map(({ input }) => ({ id: createId('lead'), ...normalizeLeadInput(input) } as ImportLead));
    const simulation = Boolean(options.simulate);

    if (!simulation) {
      const userId = await getCurrentUserId();
      const batchId = await rememberImportBatch(userId, leads, parsed);
      await Promise.all(leads.map((lead) => getSupabaseClient().from(table()).insert(dbLeadPayload(lead, userId)).then(({ error }) => {
        if (error) throw new Error(error.message);
      })));
      await rememberLeadImports(userId, batchId, leads);
      await rememberRegistries(userId, leads);
    }

    const approved = leads.filter((lead) => isStatusGroup(lead.status, 'approved')).length;
    const rejected = leads.filter((lead) => isStatusGroup(lead.status, 'rejected')).length;
    const ignored = normalized.items.filter((item) => item.ignored).length;

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

  async create(input) {
    const lead = { id: createId('lead'), ...normalizeLeadInput(input) } as ImportLead;
    const existing = findDuplicateLead(await allLeads(true), lead);
    if (existing) return existing;
    const userId = await getCurrentUserId();
    const { error } = await getSupabaseClient().from(table()).insert(dbLeadPayload(lead, userId));
    if (error) throw new Error(error.message);
    return lead;
  },

  async update(id, input) {
    const existing = (await allLeads()).find((lead) => lead.id === id);
    if (!existing) throw new Error('Lead nao encontrado.');
    const updated = { id, ...normalizeLeadInput({ ...existing, ...input }) } as ImportLead;
    const userId = await getCurrentUserId();
    const { error } = await getSupabaseClient().from(table()).update(dbLeadPayload(updated, userId)).eq('id', id);
    if (error) throw new Error(error.message);
    return updated;
  },

  async remove(id) {
    const { error } = await getSupabaseClient().from(table()).update({ status: 'rejected', rejected_reason: 'Removido da lista operacional.', updated_at: nowIso() }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async move(id, status: 'approved' | 'rejected') {
    const fallbackDestination: ImportLeadDestination = status === 'approved' ? 'WhatsApp' : 'Recusado';
    return this.update(id, {
      status,
      destino: fallbackDestination,
      destination: fallbackDestination,
      destination_override: undefined,
      send_instagram: false,
      motivo: status === 'rejected' ? 'Movido manualmente para recusados.' : '',
    });
  },
};
