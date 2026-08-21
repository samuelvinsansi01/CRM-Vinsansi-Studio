import { extensionScope, body, normalize, send, statusForError, text, type ApiRequest, type ApiResponse, type Row } from '../../server/maps/shared.js';
import { sha256, type MapsExtensionScope } from '../../server/maps/token.js';

const EXTENSION_VERSION = '0.18.0';
const DEFAULT_BRANCH_TARGET_WHATSAPP = 1000;
const DEFAULT_BRANCH_TARGET_INSTAGRAM = 500;
const ACTIVE_EXECUTION_STATUSES = ['pending', 'running', 'paused'] as const;
const TERMINAL_COVERAGE = new Set(['completed', 'exhausted']);
const MAX_SNAPSHOT_BYTES = 1_500_000;
const AGGREGATORS = /(^|[/.])(linktr\.ee|linktree|beacons\.ai|carrd\.co|taplink|bio\.link|lnk\.bio)([/.]|$)/i;

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('integer_contract_invalid');
  return parsed;
}

function strings(value: unknown): string[] {
  const result: string[] = [];
  const visit = (input: unknown) => {
    if (typeof input === 'string') { if (text(input)) result.push(text(input)); return; }
    if (Array.isArray(input)) { input.forEach(visit); return; }
    if (input && typeof input === 'object') Object.values(input as Row).forEach(visit);
  };
  visit(value);
  const seen = new Set<string>();
  return result.filter((item) => { const key = normalize(item); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}

function branchSubcategories(value: unknown): string[] {
  if (Array.isArray(value) || typeof value === 'string') return strings(value);
  if (!value || typeof value !== 'object') return [];
  const metadata = value as Row;
  // A tela de Configurações grava os termos operacionais em associatedCategories.
  // Também aceitamos os aliases históricos para preservar compatibilidade.
  return strings([
    metadata.subcategories,
    metadata.subramos,
    metadata.keywords,
    metadata.associatedCategories,
    metadata.associated_categories,
    metadata.categories,
    metadata.categorias,
  ]);
}

function branchSearchTerms(branchName: unknown, categories: unknown): string[] {
  const main = text(branchName);
  const mainKey = normalize(main);
  const subcategories = branchSubcategories(categories).filter((item) => normalize(item) !== mainKey);
  return strings([main, subcategories]);
}

function digits(value: unknown) { return text(value).replace(/\D/g, ''); }
function plausiblePhone(value: unknown) { const valueDigits = digits(value); return valueDigits.length >= 10 && valueDigits.length <= 15 ? valueDigits : ''; }
function normalizeWhatsapp(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  if (/^(?:https?:\/\/)?(?:api\.)?whatsapp\.com\//i.test(raw) || /^(?:https?:\/\/)?wa\.me\//i.test(raw)) return plausiblePhone(raw);
  return plausiblePhone(raw);
}
function normalizeInstagram(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  let candidate = raw.replace(/^@/, '');
  if (/^(?:https?:\/\/|www\.)/i.test(raw)) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) return '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';
      candidate = parts[0];
    } catch { return ''; }
  }
  candidate = candidate.toLowerCase();
  const blocked = new Set(['about','accounts','direct','explore','p','reel','reels','stories','tv']);
  return /^[a-z0-9._]{1,30}$/.test(candidate) && !blocked.has(candidate) ? candidate : '';
}
function normalizeWebsite(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const socialHosts = new Set(['facebook.com', 'instagram.com', 'wa.me', 'whatsapp.com', 'api.whatsapp.com', 'web.whatsapp.com']);
    if ([...socialHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`))) return '';
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.toString() : '';
  } catch { return ''; }
}
function websiteClassification(value: string) { return !value ? 'sem_site' : AGGREGATORS.test(value) ? 'agregador' : 'dominio_proprio'; }
function itemKey(item: Row) { return text((item._operational as Row | undefined)?.key || item.operationalDedupeKey || item.placeId || item.mapsDataId || item.cid || item.googleMapsUrl || item.mapsUrl) || [item.name, item.address, item.phone].map(normalize).join('|'); }
function jsonByteLength(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

function effectiveCandidate(raw: Row) {
  const phone = plausiblePhone(raw.phone);
  const whatsapp = normalizeWhatsapp(raw.whatsapp ?? raw.whatsappUrl);
  const instagram = normalizeInstagram(raw.instagram);
  const website = normalizeWebsite(raw.website);
  const ready = Boolean(phone || whatsapp || instagram);
  return {
    phone: phone || null,
    whatsapp: whatsapp || null,
    instagram: instagram || null,
    website: website || null,
    websiteClassification: websiteClassification(website),
    eligibilityStatus: ready ? 'ready_to_save' : 'no_supported_contact',
    eligibilityReason: ready ? null : 'no_supported_contact',
  };
}

async function channelIds(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>) {
  const result = await client.from('channels').select('channels_id,channels_name');
  if (result.error) throw new Error(`channels_query_failed:${result.error.message}`);
  const find = (name: string) => Number((result.data ?? []).find((row) => normalize(row.channels_name) === name)?.channels_id);
  const whatsapp = find('whatsapp');
  const instagram = find('instagram');
  if (!Number.isSafeInteger(whatsapp) || !Number.isSafeInteger(instagram)) throw new Error('channels_catalog_invalid');
  return { whatsapp, instagram };
}

function metadataObject(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function nonnegativeInteger(value: unknown, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function branchAcquisitionTargets(categories: unknown) {
  const metadata = metadataObject(categories);
  const whatsapp = nonnegativeInteger(
    metadata.stockTargetWhatsapp ?? metadata.stock_target_whatsapp ?? metadata.targetWhatsapp ?? metadata.target_whatsapp,
    DEFAULT_BRANCH_TARGET_WHATSAPP,
  );
  const instagram = nonnegativeInteger(
    metadata.stockTargetInstagram ?? metadata.stock_target_instagram ?? metadata.targetInstagram ?? metadata.target_instagram,
    DEFAULT_BRANCH_TARGET_INSTAGRAM,
  );
  return { whatsapp, instagram, unique: whatsapp + instagram };
}

async function acquisitionTargets(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, usersId: number, branchesId: number) {
  const result = await client.from('branches').select('branches_id,branches_categories').eq('branches_id', branchesId).eq('users_id', usersId).eq('status_id', 1).maybeSingle();
  if (result.error || !result.data) throw new Error('maps_branch_not_available');
  return branchAcquisitionTargets(result.data.branches_categories);
}

function mapsRating(raw: Row) {
  const candidate = Number(raw.rating ?? raw.score ?? raw.mapsRating ?? raw.googleRating);
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > 5) return null;
  return Math.round(candidate * 100) / 100;
}

function mapsReviewsCount(raw: Row) {
  const direct = raw.reviewCount ?? raw.reviewsCount ?? raw.userRatingsTotal ?? raw.reviews;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return Math.trunc(direct);
  const digitsOnly = text(direct).replace(/[^0-9]/g, '');
  return digitsOnly ? nonnegativeInteger(digitsOnly, 0) : null;
}

function businessStatus(raw: Row): 'open' | 'temporarily_closed' | 'permanently_closed' | 'unknown' {
  const explicit = normalize(raw.businessStatus ?? raw.business_status ?? raw.openStatus ?? raw.statusText);
  const haystack = normalize(strings([explicit, raw.rawCardText, raw.rawDetailText, raw.statusText]).join(' '));
  if (/permanently closed|fechado permanentemente|cerrado permanentemente/.test(haystack)) return 'permanently_closed';
  if (/temporarily closed|fechado temporariamente|cerrado temporalmente/.test(haystack)) return 'temporarily_closed';
  if (/open|aberto|aberta/.test(explicit)) return 'open';
  return 'unknown';
}

function isClosedBusiness(status: string) {
  return status === 'temporarily_closed' || status === 'permanently_closed';
}

function bucketDeficit(target: number, count: number) {
  return target <= 0 ? -1 : Math.max(0, target - count) / target;
}

function chooseAcquisitionBucket(effective: ReturnType<typeof effectiveCandidate>, execution: Row, counts: { whatsapp: number; instagram: number }) {
  const hasWhatsappPool = Boolean(effective.phone || effective.whatsapp);
  const hasInstagram = Boolean(effective.instagram);
  const targetWhatsapp = Number(execution.target_phone_whatsapp || 0);
  const targetInstagram = Number(execution.target_instagram || 0);
  if (!hasWhatsappPool && !hasInstagram) return null;
  if (hasWhatsappPool && !hasInstagram) return targetWhatsapp > 0 ? 'whatsapp' : null;
  if (!hasWhatsappPool && hasInstagram) return targetInstagram > 0 ? 'instagram' : null;
  if (targetWhatsapp <= 0) return targetInstagram > 0 ? 'instagram' : null;
  if (targetInstagram <= 0) return 'whatsapp';
  const whatsappDeficit = bucketDeficit(targetWhatsapp, counts.whatsapp);
  const instagramDeficit = bucketDeficit(targetInstagram, counts.instagram);
  return instagramDeficit > whatsappDeficit ? 'instagram' : 'whatsapp';
}

function acquisitionTargetsReached(execution: Row, counts: Row) {
  const targetWhatsapp = Number(execution.target_phone_whatsapp || 0);
  const targetInstagram = Number(execution.target_instagram || 0);
  const targetUnique = Number(execution.target_unique || targetWhatsapp + targetInstagram);
  return Number(counts.whatsapp_bucket_count || 0) >= targetWhatsapp
    && Number(counts.instagram_bucket_count || 0) >= targetInstagram
    && Number(counts.unique_allocated_count || 0) >= targetUnique;
}

function leadPriorityScore(candidate: Row, rating: number | null, reviews: number | null) {
  let score = 500; // ramo conhecido
  if (candidate.effective_whatsapp || candidate.effective_phone) score += 300;
  if (candidate.website_classification === 'dominio_proprio') score += 150;
  if (candidate.effective_instagram) score += 50;
  if (rating != null) score += Math.round(rating * 100);
  if (reviews != null) score += Math.min(200, reviews);
  if (candidate.states_id && candidate.cities_id) score += 10;
  return Math.max(0, Math.trunc(score));
}

async function activeExecutionCount(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, usersId: number) {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await client.from('maps_search_executions').update({ status: 'stopped', termination_reason: 'stale_extension_session', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('users_id', usersId).in('status', [...ACTIVE_EXECUTION_STATUSES]).lt('last_heartbeat_at', staleBefore);
  const result = await client.from('maps_search_executions').select('maps_search_executions_id', { count: 'exact', head: true }).eq('users_id', usersId).in('status', [...ACTIVE_EXECUTION_STATUSES]);
  if (result.error) throw new Error(`maps_active_execution_query_failed:${result.error.message}`);
  return Number(result.count || 0);
}

async function ownedExecution(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, usersId: number, executionId: string) {
  const result = await client.from('maps_search_executions').select('*').eq('maps_search_executions_id', executionId).eq('users_id', usersId).maybeSingle();
  if (result.error || !result.data) throw new Error('maps_execution_not_found');
  return result.data as Row;
}

async function branchTerms(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, usersId: number, branchesId: number) {
  const result = await client.from('branches').select('branches_id,branches_name,branches_categories,status_id').eq('branches_id', branchesId).eq('users_id', usersId).eq('status_id', 1).maybeSingle();
  if (result.error || !result.data) throw new Error('maps_branch_not_available');
  const branch = result.data as Row;
  return { branch, terms: branchSearchTerms(branch.branches_name, branch.branches_categories) };
}

async function cityWithState(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, cityId: number, stateId: number) {
  const [city, state] = await Promise.all([
    client.from('cities').select('cities_id,cities_name,states_id').eq('cities_id', cityId).eq('states_id', stateId).maybeSingle(),
    client.from('states').select('states_id,states_name,states_code').eq('states_id', stateId).maybeSingle(),
  ]);
  if (city.error || !city.data) throw new Error('maps_city_state_mismatch');
  if (state.error || !state.data) throw new Error('maps_state_not_found');
  return { ...city.data, ...state.data } as Row;
}

async function createCoverageTerm(
  client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>,
  execution: Row,
  city: Row,
  term: string,
  position: number,
) {
  const inserted = await client.from('maps_search_coverage').insert({
    users_id: execution.users_id,
    maps_search_executions_id: execution.maps_search_executions_id,
    branches_id: execution.branches_id,
    states_id: execution.states_id,
    cities_id: city.cities_id,
    branch_name: text(execution.branch_name),
    state_name: text(city.states_name),
    state_code: text(city.states_code),
    city_name: text(city.cities_name),
    search_term: term,
    normalized_search_term: normalize(term),
    term_position: position,
    search_query: `${term} em ${text(city.cities_name)} ${text(city.states_code)}`,
    status: 'pending',
  }).select('*').single();
  if (inserted.error) throw new Error(`maps_coverage_create_failed:${inserted.error.message}`);
  return inserted.data as Row;
}

async function nextCoverageForCity(
  client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>,
  execution: Row,
  city: Row,
  terms: string[],
  skipHistorical: boolean,
) {
  const currentRows = await client.from('maps_search_coverage')
    .select('*')
    .eq('maps_search_executions_id', execution.maps_search_executions_id)
    .eq('cities_id', Number(city.cities_id));
  if (currentRows.error) throw new Error(`maps_coverage_query_failed:${currentRows.error.message}`);
  const currentByTerm = new Map((currentRows.data ?? []).map((row) => [text(row.normalized_search_term), row as Row]));

  let historical = new Set<string>();
  if (skipHistorical) {
    const previous = await client.from('maps_search_coverage')
      .select('normalized_search_term,status')
      .eq('users_id', Number(execution.users_id))
      .eq('branches_id', Number(execution.branches_id))
      .eq('cities_id', Number(city.cities_id))
      .in('status', ['completed','exhausted']);
    if (previous.error) throw new Error(previous.error.message);
    historical = new Set((previous.data ?? []).map((row) => text(row.normalized_search_term)));
  }

  for (let index = 0; index < terms.length; index += 1) {
    const term = text(terms[index]);
    const key = normalize(term);
    if (!key) continue;
    const current = currentByTerm.get(key);
    if (current) {
      if (current.status === 'error') return { blocked: true, reason: 'coverage_error_requires_operator', coverage: current };
      if (!TERMINAL_COVERAGE.has(text(current.status))) return { blocked: false, coverage: current };
      continue;
    }
    if (skipHistorical && historical.has(key)) continue;
    const created = await createCoverageTerm(client, execution, city, term, index + 1);
    return { blocked: false, coverage: created };
  }
  return { blocked: false, coverage: null };
}

async function nextCoverage(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, execution: Row) {
  const terms = strings(execution.search_terms_snapshot);
  if (!terms.length) throw new Error('maps_search_terms_required');

  // A fila é propositalmente lazy: existe somente o termo atual da cidade.
  // Terminou o termo? Criamos/retornamos o próximo. Terminou todos? Só então
  // mudamos de cidade. Isso espelha exatamente o uso humano do campo de busca.
  if (execution.city_mode === 'manual') {
    const city = await cityWithState(client, Number(execution.requested_cities_id), Number(execution.states_id));
    return nextCoverageForCity(client, execution, city, terms, false);
  }

  const cities = await client.from('cities').select('cities_id,cities_name,states_id').eq('states_id', Number(execution.states_id)).order('cities_name');
  if (cities.error) throw new Error(cities.error.message);
  const state = await client.from('states').select('states_id,states_name,states_code').eq('states_id', Number(execution.states_id)).maybeSingle();
  if (state.error || !state.data) throw new Error('maps_state_not_found');

  for (const cityRow of cities.data ?? []) {
    const next = await nextCoverageForCity(client, execution, { ...cityRow, ...state.data }, terms, true);
    if (next.blocked || next.coverage) return next;
  }
  return { blocked: false, coverage: null };
}

async function executionSummary(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, execution: Row) {
  const [candidates, coverage] = await Promise.all([
    client.from('maps_search_candidates').select('eligibility_status,effective_phone,effective_whatsapp,effective_instagram,excluded_by_user,promoted_leads_id,acquisition_bucket').eq('maps_search_executions_id', execution.maps_search_executions_id),
    client.from('maps_search_coverage').select('status,found_count,rejected_count,duplicate_count').eq('maps_search_executions_id', execution.maps_search_executions_id),
  ]);
  if (candidates.error || coverage.error) throw new Error('maps_execution_summary_failed');
  const active = (candidates.data ?? []).filter((row) => !row.excluded_by_user);
  const allocated = active.filter((row) => row.eligibility_status === 'ready_to_save' && ['whatsapp','instagram'].includes(String(row.acquisition_bucket || '')));
  const counts = {
    found_count: (coverage.data ?? []).reduce((sum, row) => sum + Number(row.found_count || 0), 0),
    unique_count: (candidates.data ?? []).length,
    eligible_count: active.filter((row) => row.eligibility_status === 'ready_to_save').length,
    duplicate_count: (coverage.data ?? []).reduce((sum, row) => sum + Number(row.duplicate_count || 0), 0),
    rejected_count: (coverage.data ?? []).reduce((sum, row) => sum + Number(row.rejected_count || 0), 0),
    phone_whatsapp_candidate_count: active.filter((row) => row.effective_phone || row.effective_whatsapp).length,
    instagram_candidate_count: active.filter((row) => row.effective_instagram).length,
    whatsapp_bucket_count: allocated.filter((row) => row.acquisition_bucket === 'whatsapp').length,
    instagram_bucket_count: allocated.filter((row) => row.acquisition_bucket === 'instagram').length,
    unique_allocated_count: allocated.length,
    promoted_leads_count: (candidates.data ?? []).filter((row) => row.promoted_leads_id).length,
  };
  await client.from('maps_search_executions').update({ ...counts, updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
  return counts;
}

function requiredScope(action: string): MapsExtensionScope[] {
  if (['catalogs','cities'].includes(action)) return ['maps:catalogs:read'];
  if (['targets'].includes(action)) return ['maps:targets:read'];
  if (['search_get','next_search','history','history_detail','active_executions'].includes(action)) return ['maps:searches:read'];
  if (['search_create','coverage_transition','execution_transition','execution_heartbeat','batch_sync'].includes(action)) return ['maps:searches:write'];
  if (['candidates_list'].includes(action)) return ['maps:candidates:read'];
  if (['candidate_update','candidate_exclude','candidate_restore','candidate_provenance'].includes(action)) return ['maps:candidates:write'];
  if (action === 'leads_promote') return ['maps:leads:promote'];
  if (['session_refresh','session_revoke'].includes(action)) return [];
  throw new Error('maps_action_invalid');
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return send(req, res, 405, { ok: false, code: 'method_not_allowed' });
  try {
    const input = body(req);
    const action = text(input.action);
    const scope = await extensionScope(req, requiredScope(action));
    const { client, usersId } = scope;
    if (['search_create','batch_sync','coverage_transition','execution_transition','candidate_update','candidate_exclude','candidate_restore','leads_promote'].includes(action)) {
      const activityTouch = await client.rpc('service_touch_tool_installation', {
        p_organizations_id: scope.organizationId,
        p_tool_id: 'vinsansi_capture',
        p_external_installation_id: scope.installationId,
        p_seen: true,
        p_meaningful_activity: true,
        p_installed_version: null,
        p_reported_capabilities: null,
        p_last_seen_member_id: null,
      });
      if (activityTouch.error) throw new Error(`canonical_installation_activity_failed:${activityTouch.error.message}`);
    }

    if (action === 'session_refresh') {
      return send(req, res, 200, { ok: true, refreshed: true, inactivityExpiresAt: new Date(Date.now()+30*86_400_000).toISOString(), scopes: scope.token.scopes });
    }
    if (action === 'session_revoke') {
      await client.from('tool_user_sessions').update({revoked_at:new Date().toISOString(),logout_reason:'user_logout'}).eq('tool_user_sessions_id',scope.sessionId);
      return send(req, res, 200, { ok: true, revoked: true });
    }
    if (action === 'catalogs') {
      const [branches, states] = await Promise.all([
        client.from('branches').select('branches_id,branches_name,branches_categories').eq('users_id', usersId).eq('status_id', 1).order('branches_name'),
        client.from('states').select('states_id,states_name,states_code').order('states_name'),
      ]);
      if (branches.error || states.error) throw new Error('maps_catalogs_query_failed');
      return send(req, res, 200, {
        ok: true,
        branches: (branches.data ?? []).map((row) => ({
          id: row.branches_id,
          name: row.branches_name,
          subcategories: branchSubcategories(row.branches_categories).filter((item) => normalize(item) !== normalize(row.branches_name)),
          stockTargets: branchAcquisitionTargets(row.branches_categories),
        })),
        states: states.data ?? [],
      });
    }
    if (action === 'cities') {
      const statesId = integer(input.statesId, 1);
      const cities = await client.from('cities').select('cities_id,cities_name,states_id').eq('states_id', statesId).order('cities_name');
      if (cities.error) throw new Error(`maps_cities_query_failed:${cities.error.message}`);
      return send(req, res, 200, { ok: true, cities: cities.data ?? [] });
    }
    if (action === 'targets') {
      const targets = await acquisitionTargets(client, usersId, integer(input.branchesId, 1));
      return send(req, res, 200, {
        ok: true,
        targets: {
          whatsapp: { target: targets.whatsapp },
          instagram: { target: targets.instagram },
          unique: targets.unique,
          source: 'branch_default',
        },
      });
    }
    if (action === 'active_executions') {
      const activeCount = await activeExecutionCount(client, usersId);
      return send(req, res, 200, { ok: true, activeCount, activeLimit: 5 });
    }
    if (action === 'search_create') {
      const branchesId = integer(input.branchesId, 1);
      const statesId = integer(input.statesId, 1);
      const requestedDays = 1; // retained only for backward schema compatibility
      const cityMode = input.cityMode === 'manual' ? 'manual' : 'automatic';
      const requestedCitiesId = cityMode === 'manual' ? integer(input.citiesId, 1) : null;
      const extractionMode = input.extractionMode === 'quick' ? 'quick' : 'complete';
      const [{ branch, terms }, state, defaults] = await Promise.all([
        branchTerms(client, usersId, branchesId),
        client.from('states').select('states_id,states_name,states_code').eq('states_id', statesId).maybeSingle(),
        acquisitionTargets(client, usersId, branchesId),
      ]);
      if (state.error || !state.data) throw new Error('maps_state_not_found');
      if (!terms.length) throw new Error('maps_search_terms_required');
      const targetWhatsapp = input.targetWhatsapp == null ? defaults.whatsapp : integer(input.targetWhatsapp, 0, 1_000_000);
      const targetInstagram = input.targetInstagram == null ? defaults.instagram : integer(input.targetInstagram, 0, 1_000_000);
      if (targetWhatsapp <= 0 && targetInstagram <= 0) throw new Error('maps_targets_required');
      const targetSource = input.targetWhatsapp == null && input.targetInstagram == null ? 'branch_default' : 'execution_override';
      if (requestedCitiesId) {
        const city = await client.from('cities').select('cities_id').eq('cities_id', requestedCitiesId).eq('states_id', statesId).maybeSingle();
        if (city.error || !city.data) throw new Error('maps_city_state_mismatch');
      }
      const executionId = crypto.randomUUID();
      const inserted = await client.rpc('create_maps_search_execution_v2', {
        p_execution_id: executionId,
        p_users_id: usersId,
        p_installation_id: scope.installationRowId,
        p_branches_id: branchesId,
        p_branch_name: branch.branches_name,
        p_states_id: statesId,
        p_requested_cities_id: requestedCitiesId,
        p_city_mode: cityMode,
        p_requested_days: requestedDays,
        p_extraction_mode: extractionMode,
        p_target_phone_whatsapp: targetWhatsapp,
        p_target_instagram: targetInstagram,
        p_target_source: targetSource,
        p_extension_version: text(input.extensionVersion) || EXTENSION_VERSION,
        p_search_terms_snapshot: terms,
        p_runner_strategy: { order: 'city_then_terms', terms: 'branch_plus_subcategories', coverageCreation: 'lazy_one_term_at_a_time', coverageExpiration: null, additiveTargets: true, maxConcurrentPerUser: 5 },
      });
      if (inserted.error) {
        const message = text(inserted.error.message);
        if (message.includes('MAPS_ACTIVE_EXECUTION_LIMIT')) throw new Error('MAPS_ACTIVE_EXECUTION_LIMIT');
        throw new Error(`maps_execution_create_failed:${message}`);
      }
      const pinned=await client.from('maps_search_executions').update({initiated_by_member_id:scope.memberId,source_installation_id:scope.organizationToolInstallationId}).eq('organizations_id',scope.organizationId).eq('maps_search_executions_id',executionId);
      if(pinned.error)throw new Error(`maps_execution_pin_failed:${pinned.error.message}`);
      const execution = { ...(inserted.data as Row), branch_name: branch.branches_name };
      const next = await nextCoverage(client, execution);
      const activeCount = await activeExecutionCount(client, usersId);
      return send(req, res, 200, { ok: true, execution, next, activeCount, activeLimit: 5 });
    }
    if (action === 'search_get' || action === 'next_search') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const counts = await executionSummary(client, execution);
      const reached = acquisitionTargetsReached(execution, counts);
      const next = action === 'next_search' && !reached && !['completed','exhausted','error','stopped'].includes(text(execution.status)) ? await nextCoverage(client, execution) : null;
      return send(req, res, 200, { ok: true, execution: { ...execution, ...counts }, targetsReached: reached, next });
    }
    if (action === 'batch_sync') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const batchId = text(input.batchId);
      const coverageId = text(input.coverageId);
      const items = Array.isArray(input.items) ? input.items as Row[] : [];
      if (!batchId || !coverageId || !items.length || items.length > 25) throw new Error('maps_batch_invalid');
      const payloadHash = await sha256(JSON.stringify({ coverageId, items }));
      const existingBatch = await client.from('maps_search_batches').select('*').eq('maps_search_executions_id', execution.maps_search_executions_id).eq('batch_id', batchId).maybeSingle();
      if (existingBatch.error) throw new Error(existingBatch.error.message);
      if (existingBatch.data) {
        if (existingBatch.data.payload_hash !== payloadHash) throw new Error('maps_batch_payload_divergent');
        if (existingBatch.data.status === 'confirmed') return send(req, res, 200, existingBatch.data.response_payload);
      } else {
        const created = await client.from('maps_search_batches').insert({ users_id: usersId, maps_search_executions_id: execution.maps_search_executions_id, batch_id: batchId, payload_hash: payloadHash, status: 'processing' });
        if (created.error) throw new Error(`maps_batch_create_failed:${created.error.message}`);
      }
      const coverage = await client.from('maps_search_coverage').select('*').eq('maps_search_coverage_id', coverageId).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('users_id', usersId).maybeSingle();
      if (coverage.error || !coverage.data) throw new Error('maps_coverage_not_found');
      let accepted = 0; let duplicates = 0; let rejected = 0;
      const startingCounts = await executionSummary(client, execution);
      const allocationCounts = {
        whatsapp: Number(startingCounts.whatsapp_bucket_count || 0),
        instagram: Number(startingCounts.instagram_bucket_count || 0),
      };
      for (const raw of items) {
        const dedupeKey = itemKey(raw);
        if (!dedupeKey) { rejected += 1; continue; }
        const current = await client.from('maps_search_candidates').select('maps_search_candidates_id,search_terms_found,coverage_ids_found').eq('maps_search_executions_id', execution.maps_search_executions_id).eq('dedupe_key', dedupeKey).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        if (current.data) {
          duplicates += 1;
          const termsFound = strings([current.data.search_terms_found, coverage.data.search_term]);
          const coverageIds = strings([current.data.coverage_ids_found, coverageId]);
          const duplicated = await client.from('maps_search_candidates').update({ search_terms_found: termsFound, coverage_ids_found: coverageIds, updated_at: new Date().toISOString() }).eq('maps_search_candidates_id', current.data.maps_search_candidates_id);
          if (duplicated.error) throw new Error(`maps_candidate_provenance_failed:${duplicated.error.message}`);
          continue;
        }
        const effective = effectiveCandidate(raw);
        const status = businessStatus(raw);
        const closed = isClosedBusiness(status);
        const bucket = closed ? null : chooseAcquisitionBucket(effective, execution, allocationCounts);
        const eligibilityStatus = closed ? 'closed_business' : effective.eligibilityStatus;
        const eligibilityReason = closed ? status : effective.eligibilityReason;
        const rating = mapsRating(raw);
        const reviews = mapsReviewsCount(raw);
        const inserted = await client.from('maps_search_candidates').insert({
          users_id: usersId,
          maps_search_executions_id: execution.maps_search_executions_id,
          branches_id: execution.branches_id,
          states_id: coverage.data.states_id,
          cities_id: coverage.data.cities_id,
          dedupe_key: dedupeKey,
          candidate_name: text(raw.name) || 'Empresa sem nome',
          maps_category: text(raw.category || raw.mapsCategory) || null,
          search_terms_found: [coverage.data.search_term],
          coverage_ids_found: [coverageId],
          maps_url: text(raw.googleMapsUrl || raw.mapsUrl) || null,
          maps_rating: rating,
          maps_reviews_count: reviews,
          business_status: status,
          acquisition_bucket: bucket,
          raw_payload: raw,
          effective_phone: effective.phone,
          effective_whatsapp: effective.whatsapp,
          effective_instagram: effective.instagram,
          effective_website: effective.website,
          website_classification: effective.websiteClassification,
          eligibility_status: eligibilityStatus,
          eligibility_reason: eligibilityReason,
          collected_at: text(raw.extractedAt) || new Date().toISOString(),
        });
        if (inserted.error) throw new Error(`maps_candidate_create_failed:${inserted.error.message}`);
        if (bucket === 'whatsapp') allocationCounts.whatsapp += 1;
        if (bucket === 'instagram') allocationCounts.instagram += 1;
        accepted += 1;
      }
      const counts = await executionSummary(client, execution);
      const response = {
        ok: true,
        confirmed: true,
        executionId: execution.maps_search_executions_id,
        batchId,
        accepted,
        duplicates,
        rejected,
        counts,
        targetsReached: acquisitionTargetsReached(execution, counts),
      };
      await client.from('maps_search_batches').update({ status: 'confirmed', response_payload: response, confirmed_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('batch_id', batchId);
      return send(req, res, 200, response);
    }
    if (action === 'coverage_transition') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const coverageId = text(input.coverageId);
      const status = text(input.status);
      const snapshotPayload = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : null;
      if (snapshotPayload) {
        const snapshotBytes = jsonByteLength(snapshotPayload);
        if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw new Error(`maps_snapshot_size_invalid:${snapshotBytes}:max_${MAX_SNAPSHOT_BYTES}`);
      }
      const allowed = new Set(['navigating','waiting_maps_ready','running','scraping','finishing','syncing','completed','exhausted','error','stopped','paused']);
      if (!allowed.has(status)) throw new Error('maps_coverage_status_invalid');
      const patch: Row = { status, updated_at: new Date().toISOString(), last_error: text(input.lastError) || null, termination_reason: text(input.terminationReason) || null };
      if (text(input.searchSignature)) patch.search_signature = text(input.searchSignature);
      if (status === 'running' || status === 'scraping') patch.started_at = text(input.startedAt) || new Date().toISOString();
      if (TERMINAL_COVERAGE.has(status) || ['error','stopped'].includes(status)) patch.finished_at = text(input.finishedAt) || new Date().toISOString();
      for (const key of ['found_count','unique_count','eligible_count','rejected_count','duplicate_count','phone_whatsapp_candidate_count','instagram_candidate_count']) if (input[key] != null) patch[key] = integer(input[key]);
      const updated = await client.from('maps_search_coverage').update(patch).eq('maps_search_coverage_id', coverageId).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('users_id', usersId).select('*').maybeSingle();
      if (updated.error || !updated.data) throw new Error('maps_coverage_not_found');
      if (snapshotPayload) {
        const snapshot = await client.from('maps_search_snapshots').upsert({ users_id: usersId, maps_search_executions_id: execution.maps_search_executions_id, maps_search_coverage_id: coverageId, snapshot_payload: snapshotPayload }, { onConflict: 'maps_search_coverage_id' });
        if (snapshot.error) throw new Error(`maps_snapshot_failed:${snapshot.error.message}`);
      }
      const counts = await executionSummary(client, execution);
      const targetsReached = acquisitionTargetsReached(execution, counts);
      let next = null;
      if (status === 'error') {
        await client.from('maps_search_executions').update({ status: 'error', last_error: patch.last_error, updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
      } else if (TERMINAL_COVERAGE.has(status)) {
        // A meta é um mínimo. O termo/cobertura já iniciado termina e preserva
        // o excedente, mas depois de atingir todos os buckets não nasce outro
        // subramo nem outra cidade.
        if (targetsReached) {
          await client.from('maps_search_executions').update({ status: 'completed', termination_reason: 'candidate_targets_reached', finished_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
        } else {
          next = await nextCoverage(client, execution);
          if (!next.coverage) await client.from('maps_search_executions').update({ status: 'exhausted', termination_reason: 'available_coverage_exhausted', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
        }
      }
      return send(req, res, 200, { ok: true, coverage: updated.data, counts, targetsReached, stopAfterCurrentCoverage: targetsReached, next });
    }
    if (action === 'execution_transition') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const status = text(input.status);
      if (!new Set(['running','paused','stopped','error']).has(status)) throw new Error('maps_execution_status_invalid');
      const updated = await client.from('maps_search_executions').update({ status, last_error: text(input.lastError) || null, termination_reason: text(input.terminationReason) || null, started_at: status === 'running' ? text(execution.started_at) || new Date().toISOString() : execution.started_at, finished_at: ['stopped','error'].includes(status) ? new Date().toISOString() : null, last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id).select('*').single();
      if (updated.error) throw new Error(updated.error.message);
      return send(req, res, 200, { ok: true, execution: updated.data });
    }
    if (action === 'execution_heartbeat') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      if (!ACTIVE_EXECUTION_STATUSES.includes(text(execution.status) as typeof ACTIVE_EXECUTION_STATUSES[number])) {
        return send(req, res, 200, { ok: true, execution, active: false });
      }
      const updated = await client.from('maps_search_executions').update({ last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('users_id', usersId).select('*').single();
      if (updated.error) throw new Error(`maps_execution_heartbeat_failed:${updated.error.message}`);
      return send(req, res, 200, { ok: true, execution: updated.data, active: true });
    }
    if (action === 'candidates_list') {
      await ownedExecution(client, usersId, text(input.executionId));
      const candidates = await client.from('maps_search_candidates').select('*,branches:branches_id(branches_name),states:states_id(states_name,states_code),cities:cities_id(cities_name)').eq('users_id', usersId).eq('maps_search_executions_id', text(input.executionId)).neq('eligibility_status', 'closed_business').order('created_at');
      if (candidates.error) throw new Error(candidates.error.message);
      return send(req, res, 200, { ok: true, candidates: candidates.data ?? [] });
    }
    if (action === 'candidate_provenance') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const dedupeKey = text(input.dedupeKey);
      const coverageId = text(input.coverageId);
      if (!dedupeKey || !coverageId) throw new Error('maps_candidate_provenance_invalid');
      const coverage = await client.from('maps_search_coverage').select('maps_search_coverage_id,search_term').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('maps_search_coverage_id', coverageId).maybeSingle();
      if (coverage.error || !coverage.data) throw new Error('maps_coverage_not_found');
      const current = await client.from('maps_search_candidates').select('maps_search_candidates_id,search_terms_found,coverage_ids_found').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('dedupe_key', dedupeKey).maybeSingle();
      if (current.error) throw new Error(`maps_candidate_provenance_query_failed:${current.error.message}`);
      if (!current.data) return send(req, res, 200, { ok: true, found: false });
      const termsFound = strings([current.data.search_terms_found, text(input.searchTerm) || coverage.data.search_term]);
      const coverageIds = strings([current.data.coverage_ids_found, coverageId]);
      const updated = await client.from('maps_search_candidates').update({ search_terms_found: termsFound, coverage_ids_found: coverageIds, updated_at: new Date().toISOString() }).eq('maps_search_candidates_id', current.data.maps_search_candidates_id).eq('users_id', usersId).select('maps_search_candidates_id,search_terms_found,coverage_ids_found').single();
      if (updated.error) throw new Error(`maps_candidate_provenance_failed:${updated.error.message}`);
      return send(req, res, 200, { ok: true, found: true, candidate: updated.data });
    }
    if (['candidate_update','candidate_exclude','candidate_restore'].includes(action)) {
      const candidateId = text(input.candidateId);
      const current = await client.from('maps_search_candidates').select('*').eq('maps_search_candidates_id', candidateId).eq('users_id', usersId).maybeSingle();
      if (current.error || !current.data) throw new Error('maps_candidate_not_found');
      let patch: Row;
      const execution = await ownedExecution(client, usersId, text(current.data.maps_search_executions_id));
      if (action === 'candidate_update') {
        if (current.data.promoted_leads_id) throw new Error('maps_candidate_already_promoted');
        const effective = effectiveCandidate({ phone: input.phone, whatsapp: input.whatsapp, instagram: input.instagram, website: input.website });
        const counts = await executionSummary(client, execution);
        const allocationCounts = {
          whatsapp: Math.max(0, Number(counts.whatsapp_bucket_count || 0) - (current.data.acquisition_bucket === 'whatsapp' && !current.data.excluded_by_user ? 1 : 0)),
          instagram: Math.max(0, Number(counts.instagram_bucket_count || 0) - (current.data.acquisition_bucket === 'instagram' && !current.data.excluded_by_user ? 1 : 0)),
        };
        const closed = isClosedBusiness(text(current.data.business_status));
        const bucket = closed ? null : chooseAcquisitionBucket(effective, execution, allocationCounts);
        patch = { effective_phone: effective.phone, effective_whatsapp: effective.whatsapp, effective_instagram: effective.instagram, effective_website: effective.website, website_classification: effective.websiteClassification, acquisition_bucket: bucket, eligibility_status: closed ? 'closed_business' : effective.eligibilityStatus, eligibility_reason: closed ? current.data.business_status : effective.eligibilityReason, edited_by_user: true, updated_at: new Date().toISOString() };
      } else patch = { excluded_by_user: action === 'candidate_exclude', updated_at: new Date().toISOString() };
      const updated = await client.from('maps_search_candidates').update(patch).eq('maps_search_candidates_id', candidateId).eq('users_id', usersId).select('*').single();
      if (updated.error) throw new Error(updated.error.message);
      const counts = await executionSummary(client, execution);
      return send(req, res, 200, { ok: true, candidate: updated.data, counts, targetsReached: acquisitionTargetsReached(execution, counts) });
    }
    if (action === 'leads_promote') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const selectedIds = Array.isArray(input.candidateIds) ? [...new Set(input.candidateIds.map(text).filter(Boolean))] : [];
      if (selectedIds.length > 25) throw new Error('maps_leads_promote_batch_too_large');
      const selected = selectedIds.length ? new Set(selectedIds) : null;
      let candidatesQuery = client
        .from('maps_search_candidates')
        .select('*')
        .eq('users_id', usersId)
        .eq('maps_search_executions_id', execution.maps_search_executions_id)
        .eq('excluded_by_user', false)
        .eq('eligibility_status', 'ready_to_save');
      if (selectedIds.length) candidatesQuery = candidatesQuery.in('maps_search_candidates_id', selectedIds);
      const candidates = await candidatesQuery;
      if (candidates.error) throw new Error(candidates.error.message);
      const channels = await channelIds(client);
      const sources = await client.from('contact_sources').select('contact_sources_id,contact_sources_key').eq('users_id', usersId).eq('status_id', 1);
      const country = await client.from('countries').select('countries_id').eq('countries_code', 'BR').maybeSingle();
      if (sources.error || country.error || !country.data) throw new Error('maps_lead_catalogs_invalid');
      const sourceByKey = new Map((sources.data ?? []).map((row) => [text(row.contact_sources_key), Number(row.contact_sources_id)]));
      let promoted = 0; let alreadyPromoted = 0; const failures: Array<{ candidateId: string; code: string }> = [];
      for (const candidate of candidates.data ?? []) {
        const candidateId = text(candidate.maps_search_candidates_id);
        if (selected && !selected.has(candidateId)) continue;
        if (candidate.promoted_leads_id) { alreadyPromoted += 1; continue; }
        const existingLead = await client.from('leads').select('leads_id').eq('users_id', usersId).eq('maps_search_candidates_id', candidateId).maybeSingle();
        if (existingLead.error) throw new Error(existingLead.error.message);
        if (existingLead.data) {
          await client.from('maps_search_candidates').update({ promoted_leads_id: existingLead.data.leads_id, promoted_at: new Date().toISOString() }).eq('maps_search_candidates_id', candidateId);
          alreadyPromoted += 1; continue;
        }
        const phoneWhatsapp = text(candidate.effective_phone || candidate.effective_whatsapp);
        const instagram = normalizeInstagram(candidate.effective_instagram);
        if (!phoneWhatsapp && !instagram) { failures.push({ candidateId, code: 'no_supported_contact' }); continue; }
        // Instagram válido tem prioridade operacional mesmo quando também existe
        // telefone/WhatsApp. A origem comercial permanece compatível com a regra
        // anterior: se havia telefone, conserva sem_site/dominio_proprio/agregador;
        // Instagram só vira origem quando ele é o único contato suportado.
        const destination = instagram ? 'instagram' : 'whatsapp';
        const sourceKey = phoneWhatsapp ? text(candidate.website_classification || 'sem_site') : 'instagram';
        const sourceId = sourceByKey.get(sourceKey);
        if (!sourceId) throw new Error(`maps_contact_source_not_found:${sourceKey}`);
        const rating = candidate.maps_rating == null ? mapsRating((candidate.raw_payload as Row) || {}) : mapsRating({ rating: candidate.maps_rating });
        const reviews = candidate.maps_reviews_count == null ? mapsReviewsCount((candidate.raw_payload as Row) || {}) : mapsReviewsCount({ reviewCount: candidate.maps_reviews_count });
        const inserted = await client.from('leads').insert({
          users_id: usersId,
          branches_id: execution.branches_id,
          countries_id: country.data.countries_id,
          states_id: candidate.states_id,
          cities_id: candidate.cities_id,
          channels_id: destination === 'whatsapp' ? channels.whatsapp : channels.instagram,
          lead_status_id: 1,
          contact_sources_id: sourceId,
          leads_name: candidate.candidate_name,
          leads_phone: text(candidate.effective_phone) || null,
          leads_whatsapp: text(candidate.effective_whatsapp) || null,
          leads_instagram: instagram || null,
          leads_website: text(candidate.effective_website) || null,
          leads_maps: text(candidate.maps_url) || null,
          leads_score: rating,
          leads_reviews_count: reviews,
          leads_priority_score: leadPriorityScore(candidate as Row, rating, reviews),
          leads_categories: strings([execution.branch_name, candidate.maps_category, candidate.search_terms_found]),
          leads_origin: 'google_maps',
          maps_search_candidates_id: candidateId,
        }).select('leads_id').single();
        if (inserted.error) { failures.push({ candidateId, code: `lead_insert_failed:${inserted.error.message}` }); continue; }
        await client.from('maps_search_candidates').update({ promoted_leads_id: inserted.data.leads_id, promoted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_candidates_id', candidateId);
        promoted += 1;
      }
      if (input.summarizeExecution !== false) await executionSummary(client, execution);
      return send(req, res, failures.length ? 207 : 200, { ok: failures.length === 0, promoted, alreadyPromoted, failures });
    }
    if (action === 'history') {
      const history = await client.from('maps_search_executions').select('*,branches:branches_id(branches_name),states:states_id(states_name,states_code),cities:requested_cities_id(cities_name)').eq('users_id', usersId).order('created_at', { ascending: false }).limit(100);
      if (history.error) throw new Error(history.error.message);
      return send(req, res, 200, { ok: true, searches: history.data ?? [] });
    }
    if (action === 'history_detail') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const coverageId = text(input.coverageId);
      if (coverageId) {
        const coverage = await client.from('maps_search_coverage').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('maps_search_coverage_id', coverageId).maybeSingle();
        if (coverage.error || !coverage.data) throw new Error('maps_coverage_not_found');
        const [candidates, snapshots] = await Promise.all([
          client.from('maps_search_candidates').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).contains('coverage_ids_found', [coverageId]).order('created_at'),
          client.from('maps_search_snapshots').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('maps_search_coverage_id', coverageId).order('created_at'),
        ]);
        if (candidates.error || snapshots.error) throw new Error('maps_history_detail_failed');
        return send(req, res, 200, { ok: true, execution, coverage: coverage.data, candidates: candidates.data ?? [], snapshots: snapshots.data ?? [] });
      }
      const [coverage, candidates] = await Promise.all([
        client.from('maps_search_coverage').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).order('cities_id').order('term_position').order('created_at'),
        client.from('maps_search_candidates').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).order('created_at'),
      ]);
      if (coverage.error || candidates.error) throw new Error('maps_history_detail_failed');
      return send(req, res, 200, { ok: true, execution, coverage: coverage.data ?? [], candidates: candidates.data ?? [] });
    }
    return send(req, res, 400, { ok: false, code: 'maps_action_invalid' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'maps_extension_failed';
    return send(req, res, statusForError(message), { ok: false, code: message.split(':')[0], message });
  }
}
