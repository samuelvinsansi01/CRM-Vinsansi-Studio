import { extensionScope, body, normalize, send, statusForError, text, type ApiRequest, type ApiResponse, type Row } from '../../server/maps/shared.js';
import { issueMapsExtensionToken, sha256, type MapsExtensionScope } from '../../server/maps/token.js';

const EXTENSION_VERSION = '0.16.0';
const TERMINAL_COVERAGE = new Set(['completed', 'exhausted']);
const ACTIVE_LEAD_STATUS_IDS = [1, 2, 3];
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

async function calculateTargets(client: ReturnType<typeof import('../../server/maps/shared.js').serviceClient>, usersId: number, branchesId: number, days: number) {
  const channels = await channelIds(client);
  const [chips, socials, levels, leads] = await Promise.all([
    client.from('chips').select('chips_id,levels_id,status_id').eq('users_id', usersId).eq('status_id', 1),
    client.from('socials').select('socials_id,levels_id,status_id').eq('users_id', usersId).eq('status_id', 1),
    client.from('levels').select('levels_id,channels_id,levels_daily_limit,status_id').eq('users_id', usersId).eq('status_id', 1),
    client.from('leads').select('leads_id,channels_id').eq('users_id', usersId).eq('branches_id', branchesId).in('lead_status_id', ACTIVE_LEAD_STATUS_IDS),
  ]);
  for (const result of [chips, socials, levels, leads]) if (result.error) throw new Error(`maps_targets_query_failed:${result.error?.message}`);
  const levelMap = new Map((levels.data ?? []).map((row) => [Number(row.levels_id), row]));
  const whatsappCapacityPerDay = (chips.data ?? []).reduce((sum, row) => {
    const level = levelMap.get(Number(row.levels_id));
    return sum + (Number(level?.channels_id) === channels.whatsapp ? Math.max(0, Number(level?.levels_daily_limit || 0)) : 0);
  }, 0);
  const instagramCapacityPerDay = (socials.data ?? []).reduce((sum, row) => {
    const level = levelMap.get(Number(row.levels_id));
    return sum + (Number(level?.channels_id) === channels.instagram ? Math.max(0, Number(level?.levels_daily_limit || 0)) : 0);
  }, 0);
  const whatsappStock = (leads.data ?? []).filter((row) => Number(row.channels_id) === channels.whatsapp).length;
  const instagramStock = (leads.data ?? []).filter((row) => Number(row.channels_id) === channels.instagram).length;
  return {
    days,
    whatsapp: { capacityPerDay: whatsappCapacityPerDay, capacity: whatsappCapacityPerDay * days, usefulStock: whatsappStock, needed: Math.max(0, whatsappCapacityPerDay * days - whatsappStock) },
    instagram: { capacityPerDay: instagramCapacityPerDay, capacity: instagramCapacityPerDay * days, usefulStock: instagramStock, needed: Math.max(0, instagramCapacityPerDay * days - instagramStock) },
  };
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
    client.from('maps_search_candidates').select('eligibility_status,effective_phone,effective_whatsapp,effective_instagram,excluded_by_user,promoted_leads_id').eq('maps_search_executions_id', execution.maps_search_executions_id),
    client.from('maps_search_coverage').select('status,found_count,rejected_count,duplicate_count').eq('maps_search_executions_id', execution.maps_search_executions_id),
  ]);
  if (candidates.error || coverage.error) throw new Error('maps_execution_summary_failed');
  const active = (candidates.data ?? []).filter((row) => !row.excluded_by_user);
  const counts = {
    found_count: (coverage.data ?? []).reduce((sum, row) => sum + Number(row.found_count || 0), 0),
    unique_count: (candidates.data ?? []).length,
    eligible_count: active.filter((row) => row.eligibility_status === 'ready_to_save').length,
    duplicate_count: (coverage.data ?? []).reduce((sum, row) => sum + Number(row.duplicate_count || 0), 0),
    rejected_count: (coverage.data ?? []).reduce((sum, row) => sum + Number(row.rejected_count || 0), 0),
    phone_whatsapp_candidate_count: active.filter((row) => row.effective_phone || row.effective_whatsapp).length,
    instagram_candidate_count: active.filter((row) => row.effective_instagram).length,
    promoted_leads_count: (candidates.data ?? []).filter((row) => row.promoted_leads_id).length,
  };
  await client.from('maps_search_executions').update({ ...counts, updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
  return counts;
}

function requiredScope(action: string): MapsExtensionScope[] {
  if (['catalogs','cities'].includes(action)) return ['maps:catalogs:read'];
  if (['targets'].includes(action)) return ['maps:targets:read'];
  if (['search_get','next_search','history','history_detail'].includes(action)) return ['maps:searches:read'];
  if (['search_create','coverage_transition','execution_transition','batch_sync'].includes(action)) return ['maps:searches:write'];
  if (['candidates_list'].includes(action)) return ['maps:candidates:read'];
  if (['candidate_update','candidate_exclude','candidate_restore'].includes(action)) return ['maps:candidates:write'];
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

    if (action === 'session_refresh') {
      const issued = await issueMapsExtensionToken({ userId: usersId, installationId: scope.installationId, scopes: scope.token.scopes });
      return send(req, res, 200, { ok: true, token: issued.token, expiresAt: new Date(issued.payload.exp * 1000).toISOString(), scopes: issued.payload.scopes });
    }
    if (action === 'session_revoke') {
      await client.from('maps_extension_installations').update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_extension_installations_id', scope.installationRowId);
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
      const targets = await calculateTargets(client, usersId, integer(input.branchesId, 1), integer(input.days, 1, 7));
      return send(req, res, 200, { ok: true, targets });
    }
    if (action === 'search_create') {
      const branchesId = integer(input.branchesId, 1);
      const statesId = integer(input.statesId, 1);
      const requestedDays = integer(input.days, 1, 7);
      const cityMode = input.cityMode === 'manual' ? 'manual' : 'automatic';
      const requestedCitiesId = cityMode === 'manual' ? integer(input.citiesId, 1) : null;
      const extractionMode = input.extractionMode === 'quick' ? 'quick' : 'complete';
      const [{ branch, terms }, state, targets] = await Promise.all([
        branchTerms(client, usersId, branchesId),
        client.from('states').select('states_id,states_name,states_code').eq('states_id', statesId).maybeSingle(),
        calculateTargets(client, usersId, branchesId, requestedDays),
      ]);
      if (state.error || !state.data) throw new Error('maps_state_not_found');
      if (!terms.length) throw new Error('maps_search_terms_required');
      if (targets.whatsapp.needed <= 0 && targets.instagram.needed <= 0) throw new Error('maps_targets_already_satisfied');
      if (requestedCitiesId) {
        const city = await client.from('cities').select('cities_id').eq('cities_id', requestedCitiesId).eq('states_id', statesId).maybeSingle();
        if (city.error || !city.data) throw new Error('maps_city_state_mismatch');
      }
      const executionId = crypto.randomUUID();
      const inserted = await client.from('maps_search_executions').insert({
        maps_search_executions_id: executionId,
        users_id: usersId,
        maps_extension_installations_id: scope.installationRowId,
        branches_id: branchesId,
        branch_name: branch.branches_name,
        states_id: statesId,
        requested_cities_id: requestedCitiesId,
        city_mode: cityMode,
        requested_days: requestedDays,
        extraction_mode: extractionMode,
        target_phone_whatsapp: targets.whatsapp.needed,
        target_instagram: targets.instagram.needed,
        status: 'pending',
        extension_version: text(input.extensionVersion) || EXTENSION_VERSION,
        search_terms_snapshot: terms,
        runner_strategy: { order: 'city_then_terms', terms: 'branch_plus_subcategories', coverageCreation: 'lazy_one_term_at_a_time', coverageExpiration: null },
      }).select('*').single();
      if (inserted.error) throw new Error(`maps_execution_create_failed:${inserted.error.message}`);
      const execution = { ...(inserted.data as Row), branch_name: branch.branches_name };
      // Cobertura é criada um termo por vez. Nenhuma cidade recebe todos os
      // subramos antecipadamente; o próximo termo só nasce quando o anterior acaba.
      const next = await nextCoverage(client, execution);
      return send(req, res, 200, { ok: true, execution: { ...execution, targets }, next });
    }
    if (action === 'search_get' || action === 'next_search') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const counts = await executionSummary(client, execution);
      const next = action === 'next_search' ? await nextCoverage(client, execution) : null;
      return send(req, res, 200, { ok: true, execution: { ...execution, ...counts }, next });
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
      for (const raw of items) {
        const dedupeKey = itemKey(raw);
        if (!dedupeKey) { rejected += 1; continue; }
        const current = await client.from('maps_search_candidates').select('maps_search_candidates_id,search_terms_found').eq('maps_search_executions_id', execution.maps_search_executions_id).eq('dedupe_key', dedupeKey).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        if (current.data) {
          duplicates += 1;
          const termsFound = strings([current.data.search_terms_found, coverage.data.search_term]);
          await client.from('maps_search_candidates').update({ search_terms_found: termsFound, updated_at: new Date().toISOString() }).eq('maps_search_candidates_id', current.data.maps_search_candidates_id);
          continue;
        }
        const effective = effectiveCandidate(raw);
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
          maps_url: text(raw.googleMapsUrl || raw.mapsUrl) || null,
          raw_payload: raw,
          effective_phone: effective.phone,
          effective_whatsapp: effective.whatsapp,
          effective_instagram: effective.instagram,
          effective_website: effective.website,
          website_classification: effective.websiteClassification,
          eligibility_status: effective.eligibilityStatus,
          eligibility_reason: effective.eligibilityReason,
          collected_at: text(raw.extractedAt) || new Date().toISOString(),
        });
        if (inserted.error) throw new Error(`maps_candidate_create_failed:${inserted.error.message}`);
        accepted += 1;
      }
      const response = { ok: true, confirmed: true, executionId: execution.maps_search_executions_id, batchId, accepted, duplicates, rejected };
      await client.from('maps_search_batches').update({ status: 'confirmed', response_payload: response, confirmed_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id).eq('batch_id', batchId);
      await executionSummary(client, execution);
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
      const targetsReached = (Number(execution.target_phone_whatsapp) <= 0 || counts.phone_whatsapp_candidate_count >= Number(execution.target_phone_whatsapp)) && (Number(execution.target_instagram) <= 0 || counts.instagram_candidate_count >= Number(execution.target_instagram));
      let next = null;
      if (status === 'error') {
        await client.from('maps_search_executions').update({ status: 'error', last_error: patch.last_error, updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
      } else if (TERMINAL_COVERAGE.has(status)) {
        // Regra de produto: uma cidade iniciada precisa ser limpa pelo ramo
        // principal + todos os subramos antes de a meta poder encerrar a execução.
        // Assim, atingir a meta no primeiro termo nunca pula os demais termos da
        // cidade atual; apenas impede avançar para uma nova cidade.
        const terms = strings(execution.search_terms_snapshot);
        const city = await cityWithState(client, Number(updated.data.cities_id), Number(execution.states_id));
        const sameCityNext = await nextCoverageForCity(client, execution, city, terms, execution.city_mode !== 'manual');
        if (sameCityNext.blocked) {
          next = sameCityNext;
        } else if (sameCityNext.coverage) {
          next = sameCityNext;
        } else if (targetsReached) {
          await client.from('maps_search_executions').update({ status: 'completed', termination_reason: 'candidate_targets_reached', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
        } else {
          next = await nextCoverage(client, execution);
          if (!next.coverage) await client.from('maps_search_executions').update({ status: 'exhausted', termination_reason: 'available_coverage_exhausted', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id);
        }
      }
      return send(req, res, 200, { ok: true, coverage: updated.data, counts, targetsReached, next });
    }
    if (action === 'execution_transition') {
      const execution = await ownedExecution(client, usersId, text(input.executionId));
      const status = text(input.status);
      if (!new Set(['running','paused','stopped','error']).has(status)) throw new Error('maps_execution_status_invalid');
      const updated = await client.from('maps_search_executions').update({ status, last_error: text(input.lastError) || null, termination_reason: text(input.terminationReason) || null, started_at: status === 'running' ? text(execution.started_at) || new Date().toISOString() : execution.started_at, finished_at: ['stopped','error'].includes(status) ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('maps_search_executions_id', execution.maps_search_executions_id).select('*').single();
      if (updated.error) throw new Error(updated.error.message);
      return send(req, res, 200, { ok: true, execution: updated.data });
    }
    if (action === 'candidates_list') {
      await ownedExecution(client, usersId, text(input.executionId));
      const candidates = await client.from('maps_search_candidates').select('*,branches:branches_id(branches_name),states:states_id(states_name,states_code),cities:cities_id(cities_name)').eq('users_id', usersId).eq('maps_search_executions_id', text(input.executionId)).order('created_at');
      if (candidates.error) throw new Error(candidates.error.message);
      return send(req, res, 200, { ok: true, candidates: candidates.data ?? [] });
    }
    if (['candidate_update','candidate_exclude','candidate_restore'].includes(action)) {
      const candidateId = text(input.candidateId);
      const current = await client.from('maps_search_candidates').select('*').eq('maps_search_candidates_id', candidateId).eq('users_id', usersId).maybeSingle();
      if (current.error || !current.data) throw new Error('maps_candidate_not_found');
      let patch: Row;
      if (action === 'candidate_update') {
        if (current.data.promoted_leads_id) throw new Error('maps_candidate_already_promoted');
        const effective = effectiveCandidate({ phone: input.phone, whatsapp: input.whatsapp, instagram: input.instagram, website: input.website });
        patch = { effective_phone: effective.phone, effective_whatsapp: effective.whatsapp, effective_instagram: effective.instagram, effective_website: effective.website, website_classification: effective.websiteClassification, eligibility_status: effective.eligibilityStatus, eligibility_reason: effective.eligibilityReason, edited_by_user: true, updated_at: new Date().toISOString() };
      } else patch = { excluded_by_user: action === 'candidate_exclude', updated_at: new Date().toISOString() };
      const updated = await client.from('maps_search_candidates').update(patch).eq('maps_search_candidates_id', candidateId).eq('users_id', usersId).select('*').single();
      if (updated.error) throw new Error(updated.error.message);
      return send(req, res, 200, { ok: true, candidate: updated.data });
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
        const destination = phoneWhatsapp ? 'whatsapp' : 'instagram';
        const sourceKey = destination === 'instagram' ? 'instagram' : text(candidate.website_classification || 'sem_site');
        const sourceId = sourceByKey.get(sourceKey);
        if (!sourceId) throw new Error(`maps_contact_source_not_found:${sourceKey}`);
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
          leads_categories: [text(execution.branch_name), ...strings(candidate.search_terms_found)],
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
      const [coverage, candidates, snapshots] = await Promise.all([
        client.from('maps_search_coverage').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).order('cities_id').order('created_at'),
        client.from('maps_search_candidates').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).order('created_at'),
        client.from('maps_search_snapshots').select('*').eq('users_id', usersId).eq('maps_search_executions_id', execution.maps_search_executions_id).order('created_at'),
      ]);
      if (coverage.error || candidates.error || snapshots.error) throw new Error('maps_history_detail_failed');
      return send(req, res, 200, { ok: true, execution, coverage: coverage.data ?? [], candidates: candidates.data ?? [], snapshots: snapshots.data ?? [] });
    }
    return send(req, res, 400, { ok: false, code: 'maps_action_invalid' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'maps_extension_failed';
    return send(req, res, statusForError(message), { ok: false, code: message.split(':')[0], message });
  }
}
