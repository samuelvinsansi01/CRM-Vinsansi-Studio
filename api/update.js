const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://txyknazfufashgzlxkqh.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const EXTENSION_SECRET = process.env.INSTAGRAM_EXTENSION_SECRET || '';

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json();

  let current = data.result;
  while (typeof current === 'string') {
    try { current = JSON.parse(current); }
    catch { break; }
  }
  if (current && typeof current === 'object' && current.value !== undefined) {
    current = current.value;
    while (typeof current === 'string') {
      try { current = JSON.parse(current); }
      catch { break; }
    }
  }
  return current;
}

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${await res.text()}`);
}

function isFigmaUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (hostname === 'figma.com' || hostname.endsWith('.figma.com'));
  } catch {
    return false;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-instagram-extension-secret');
}

function cleanUsername(value = '') {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim();
  return s.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

async function sbRest(path, options = {}) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY ausente na Vercel');
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: options.prefer || 'return=representation',
    ...(options.headers || {})
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  const raw = await r.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
  if (!r.ok) throw new Error(data && data.message ? data.message : (raw || `Supabase HTTP ${r.status}`));
  return data;
}

async function findLead(userId, leadId) {
  if (!isUuid(leadId)) return null;
  const rows = await sbRest(`leads?select=*&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(leadId)}&limit=1`, { method:'GET', prefer:'return=minimal' });
  return Array.isArray(rows) ? rows[0] || null : null;
}


function normText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_]+/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getAny(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}

function extractTemplateText(template, which) {
  const keys1 = [
    'part_1','part1','message_1','message1','msg1','msg_1','mensagem1','mensagem_1','texto1','texto_1','body1','body_1','content1','content_1','first_message','firstMessage','text_1'
  ];
  const keys2 = [
    'part_2','part2','message_2','message2','msg2','msg_2','mensagem2','mensagem_2','texto2','texto_2','body2','body_2','content2','content_2','second_message','secondMessage','text_2'
  ];
  let value = getAny(template, which === 1 ? keys1 : keys2);
  if (!value && template && typeof template.payload === 'object') value = getAny(template.payload, which === 1 ? keys1 : keys2);
  if (!value && template && typeof template.raw_payload === 'object') value = getAny(template.raw_payload, which === 1 ? keys1 : keys2);
  if (!value && template && typeof template.content === 'object') value = getAny(template.content, which === 1 ? keys1 : keys2);
  return String(value || '').trim();
}

function renderTemplateText(text, lead, item) {
  const company = (lead && (lead.company_name || lead.name)) || item.company_name || 'sua empresa';
  const instagram = cleanUsername(item.instagram_username || item.instagram_url || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || '');
  const city = (lead && lead.city) || item.city || '';
  const state = (lead && lead.state) || item.state || '';
  return String(text || '')
    .replace(/\{\{\s*empresa\s*\}\}|\{\s*EMPRESA\s*\}|\{\s*empresa\s*\}/g, company)
    .replace(/\{\{\s*nome\s*\}\}|\{\s*NOME\s*\}|\{\s*nome\s*\}/g, company)
    .replace(/\{\{\s*instagram\s*\}\}|\{\s*INSTAGRAM\s*\}|\{\s*instagram\s*\}/g, instagram ? '@' + instagram : '')
    .replace(/\{\{\s*cidade\s*\}\}|\{\s*CIDADE\s*\}|\{\s*cidade\s*\}/g, city)
    .replace(/\{\{\s*estado\s*\}\}|\{\s*ESTADO\s*\}|\{\s*estado\s*\}/g, state);
}

function leadTypeOfForTemplate(item, lead) {
  const raw = String(item.lead_type || (lead && lead.lead_type) || '').trim().toLowerCase();
  const websiteType = String((lead && lead.website_type) || '').toLowerCase();
  const hasSite = Boolean((lead && lead.website) || item.website || websiteType.includes('own') || websiteType.includes('site'));
  if (raw.includes('agreg')) return 'agregador';
  if (raw.includes('com')) return 'com-site';
  if (raw.includes('sem')) return 'sem-site';
  return hasSite ? 'com-site' : 'sem-site';
}

function templateRamoAliases(value = '') {
  const base = normText(value);
  const out = new Set([base].filter(Boolean));
  const joined = base.replace(/-/g, ' ');
  if (joined.includes('moveis') || joined.includes('movel') || joined.includes('marcen') || joined.includes('planejad')) {
    out.add('marcenaria');
    out.add('moveis-planejados');
    out.add('moveis');
    out.add('moveis-planejados');
  }
  return [...out].filter(Boolean);
}

function selectTemplateForItem(templates, item, lead) {
  const ramo = item.parent_category || item.ramo || item.ramo_nome || (lead && (lead.parent_category || lead.category_name || lead.category)) || '';
  const tipo = leadTypeOfForTemplate(item, lead);
  const ramoAliases = new Set([
    ...templateRamoAliases(ramo),
    ...templateRamoAliases(item.ramo_id || item.branch_id || ''),
    ...templateRamoAliases(lead && (lead.ramo_id || lead.branch_id) || '')
  ].filter(Boolean));
  const nt = normText(tipo);
  const scored = (templates || []).map((t) => {
    const trValues = [
      getAny(t, ['ramo_id','branch_id']),
      getAny(t, ['ramo','ramo_pai','parent_category','category','category_name','niche','segment','segmento','name'])
    ].filter(Boolean);
    const trAliases = new Set(trValues.flatMap(templateRamoAliases));
    const tt = normText(getAny(t, ['tipo','lead_type','type','template_type','audience']));
    const ch = normText(getAny(t, ['channel','canal','channels']));
    const activeRaw = t.active ?? t.enabled ?? t.is_active;
    if (activeRaw === false) return null;
    const ramoOk = !trAliases.size || !ramoAliases.size || [...trAliases].some(a => [...ramoAliases].some(b => a === b || a.includes(b) || b.includes(a)));
    const tipoOk = !tt || tt === nt || tt.includes(nt) || nt.includes(tt) || (nt.includes('sem') && tt.includes('sem')) || (nt.includes('com') && tt.includes('com')) || (nt.includes('agreg') && tt.includes('agreg'));
    const canalOk = !ch || ch.includes('ambos') || ch.includes('instagram') || ch.includes('whatsapp');
    if (!ramoOk || !tipoOk || !canalOk) return null;
    let score = 0;
    if (trAliases.size && ramoAliases.size && [...trAliases].some(a => ramoAliases.has(a))) score += 12;
    else if (trAliases.size) score += 5;
    if (tt && tt === nt) score += 8; else if (tt) score += 3;
    if (ch.includes('instagram')) score += 3;
    if (ch.includes('ambos')) score += 2;
    return { t, score };
  }).filter(Boolean).sort((a,b) => b.score - a.score);
  return scored[0]?.t || null;
}

async function enrichInstagramItemsWithTemplates(userId, items = []) {
  if (!Array.isArray(items) || !items.length) return items;
  const templates = await sbRest(`message_templates?select=*&user_id=eq.${encodeURIComponent(userId)}&active=eq.true`, { method:'GET', prefer:'return=minimal' }).catch(() => []);
  const leadIds = [...new Set(items.map(i => String(i.lead_id || '')).filter(isUuid))];
  let leadsById = new Map();
  if (leadIds.length) {
    const leads = await sbRest(`leads?select=*&user_id=eq.${encodeURIComponent(userId)}&id=in.(${leadIds.map(encodeURIComponent).join(',')})`, { method:'GET', prefer:'return=minimal' }).catch(() => []);
    leadsById = new Map((Array.isArray(leads) ? leads : []).map(l => [String(l.id), l]));
  }
  const enriched = [];
  const patches = [];
  for (const item of items) {
    const lead = leadsById.get(String(item.lead_id || '')) || null;
    const template = selectTemplateForItem(templates, item, lead);
    const raw1 = template ? extractTemplateText(template, 1) : '';
    const raw2 = template ? extractTemplateText(template, 2) : '';
    const msg1 = raw1 ? renderTemplateText(raw1, lead, item) : String(item.message_1 || '').trim();
    const msg2 = raw2 ? renderTemplateText(raw2, lead, item) : String(item.message_2 || '').trim();
    const next = {
      ...item,
      company_name: item.company_name || (lead && lead.company_name) || 'Lead Instagram',
      instagram_username: cleanUsername(item.instagram_username || item.instagram_url || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || ''),
      instagram_url: item.instagram_url || (cleanUsername(item.instagram_username || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || '') ? `https://www.instagram.com/${cleanUsername(item.instagram_username || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || '')}/` : null),
      parent_category: item.parent_category || (lead && (lead.parent_category || lead.category_name || lead.category)) || null,
      lead_type: leadTypeOfForTemplate(item, lead),
      message_1: msg1,
      message_2: msg2,
      template_found: Boolean(template),
      template_id: template && template.id ? template.id : item.template_id || null
    };
    enriched.push(next);
    if (item.id && ((msg1 && msg1 !== item.message_1) || (msg2 && msg2 !== item.message_2) || (next.template_id && next.template_id !== item.template_id))) {
      patches.push({ id: item.id, message_1: msg1 || item.message_1 || '', message_2: msg2 || item.message_2 || '', template_id: next.template_id, updated_at: new Date().toISOString() });
    }
  }
  // Atualiza a fila em segundo plano para que a tela do CRM e a extensão passem a ler o template real.
  await Promise.allSettled(patches.slice(0, 80).map((patch) => {
    const id = patch.id;
    delete patch.id;
    return sbRest(`instagram_dispatch_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify(patch) });
  }));
  return enriched;
}


async function instagramNext(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const profileUsername = cleanUsername(input.profile_username || input.profileUsername || input.profile || '');
  const scheduledDate = String(input.scheduled_date || input.scheduledDate || todayISO()).slice(0, 10);
  const blockNumber = Number(input.block_number || input.blockNumber || input.batch_number || input.batchNumber || 0);
  if (!userId) throw new Error('user_id ausente');
  if (!profileUsername) throw new Error('profile_username ausente');

  const pathParts = [
    'instagram_dispatch_items?select=*',
    `user_id=eq.${encodeURIComponent(userId)}`,
    `profile_username=eq.${encodeURIComponent(profileUsername)}`,
    `scheduled_date=eq.${encodeURIComponent(scheduledDate)}`,
    'status=in.(queued,ready_to_dispatch,scheduled)',
    'order=block_number.asc,position.asc',
    'limit=1'
  ];
  if (Number.isFinite(blockNumber) && blockNumber > 0) {
    pathParts.splice(pathParts.length - 2, 0, `block_number=eq.${encodeURIComponent(String(blockNumber))}`);
  }
  const path = pathParts.join('&');
  const rows = await sbRest(path, { method:'GET', prefer:'return=minimal' });
  const enriched = await enrichInstagramItemsWithTemplates(userId, Array.isArray(rows) ? rows : []);
  return enriched[0] || null;
}


async function instagramQueue(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const profileUsername = cleanUsername(input.profile_username || input.profileUsername || input.profile || '');
  const scheduledDate = String(input.scheduled_date || input.scheduledDate || todayISO()).slice(0, 10);
  const blockNumber = Number(input.block_number || input.blockNumber || input.batch_number || input.batchNumber || 0);
  if (!userId) throw new Error('user_id ausente');
  if (!profileUsername) throw new Error('profile_username ausente');

  const profileRows = await sbRest(
    `instagram_profiles?select=*&user_id=eq.${encodeURIComponent(userId)}&username=eq.${encodeURIComponent(profileUsername)}&active=eq.true&limit=1`,
    { method:'GET', prefer:'return=minimal' }
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] || null : null;

  const pathParts = [
    'instagram_dispatch_items?select=*',
    `user_id=eq.${encodeURIComponent(userId)}`,
    `profile_username=eq.${encodeURIComponent(profileUsername)}`,
    `scheduled_date=eq.${encodeURIComponent(scheduledDate)}`,
    'status=in.(queued,ready_to_dispatch,scheduled)',
    'order=block_number.asc,position.asc'
  ];
  if (Number.isFinite(blockNumber) && blockNumber > 0) {
    pathParts.splice(pathParts.length - 1, 0, `block_number=eq.${encodeURIComponent(String(blockNumber))}`);
  }
  const path = pathParts.join('&');
  const rows = await sbRest(path, { method:'GET', prefer:'return=minimal' });
  const items = await enrichInstagramItemsWithTemplates(userId, Array.isArray(rows) ? rows : []);
  return { profile, items };
}

async function upsertBase(userId, item, lead, when) {
  const ig = cleanUsername(item.instagram_username || item.instagram_url || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || '');
  const phone = normalizePhone(lead && (lead.normalized_phone || lead.phone) || '');
  const payload = {
    user_id: userId,
    company_name: item.company_name || (lead && lead.company_name) || 'Lead Instagram',
    phone: lead && lead.phone || null,
    normalized_phone: phone || null,
    website: lead && lead.website || null,
    instagram_url: ig ? `https://www.instagram.com/${ig}/` : (lead && lead.instagram_url || null),
    instagram_username: ig || (lead && lead.instagram_username) || null,
    category: lead && lead.category || null,
    category_name: lead && lead.category_name || item.parent_category || null,
    categories: lead && lead.categories || null,
    city: lead && lead.city || null,
    state: lead && lead.state || null,
    country_code: lead && lead.country_code || 'BR',
    rating: lead && lead.rating || null,
    reviews_count: lead && lead.reviews_count || null,
    maps_url: lead && lead.maps_url || null,
    raw_payload: { ...((lead && lead.raw_payload) || {}), instagram_dispatch_item_id: item.id || null, lead_id: item.lead_id || (lead && lead.id) || null },
    source: 'instagram_extension_api',
    last_channel: 'instagram',
    last_event_type: 'instagram_sent',
    last_event_status: 'sent',
    instagram_sent_at: when,
    last_contact_at: when,
    status: 'instagram_sent',
    sent_channels: ['instagram'],
    updated_at: new Date().toISOString()
  };

  const or = [];
  if (phone) or.push(`normalized_phone.eq.${encodeURIComponent(phone)}`);
  if (ig) or.push(`instagram_username.eq.${encodeURIComponent(ig)}`);
  let existing = [];
  if (or.length) {
    existing = await sbRest(`base_permanente?select=id&user_id=eq.${encodeURIComponent(userId)}&or=(${or.join(',')})&limit=1`, { method:'GET', prefer:'return=minimal' });
  }
  let baseId = null;
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    baseId = existing[0].id;
    await sbRest(`base_permanente?id=eq.${encodeURIComponent(baseId)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify(payload) });
  } else {
    payload.created_at = new Date().toISOString();
    const inserted = await sbRest('base_permanente', { method:'POST', body: JSON.stringify(payload) });
    baseId = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
  }

  try {
    await sbRest('contact_events', { method:'POST', body: JSON.stringify({
      user_id: userId,
      lead_id: String(item.lead_id || (lead && lead.id) || ''),
      base_permanente_id: baseId,
      company_name: payload.company_name,
      normalized_phone: phone || null,
      website: payload.website,
      instagram_url: payload.instagram_url,
      maps_url: payload.maps_url,
      channel: 'instagram',
      source_account: item.profile_username || null,
      source_instance: item.profile_id || null,
      event_type: 'sent',
      status: 'sent',
      message_template: item.template_id || null,
      sent_at: when,
      metadata: { instagram_dispatch_item_id: item.id || null, message_1: item.message_1 || null, message_2: item.message_2 || null }
    }) });
  } catch (e) { console.warn('[instagram-api][contact_events]', e.message || e); }

  if (phone) {
    try {
      await sbRest('sent_contacts', { method:'POST', body: JSON.stringify({
        user_id: userId,
        lead_id: String(item.lead_id || (lead && lead.id) || ''),
        company_name: payload.company_name,
        phone: lead && lead.phone || phone,
        normalized_phone: phone,
        block_type: 'already_sent',
        source: 'instagram_fila',
        reason: 'instagram_sent',
        active: true,
        dispatched_at: when,
        raw_payload: { instagram_dispatch_item_id: item.id || null, instagram_username: ig || null }
      }), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
    } catch (e) { console.warn('[instagram-api][sent_contacts]', e.message || e); }
  }

  if (item.lead_id) {
    try {
      await sbRest(`leads?id=eq.${encodeURIComponent(item.lead_id)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify({
        current_stage: 'archived',
        current_status: 'instagram_sent',
        status: 'Enviada Instagram',
        archived_at: when,
        updated_at: new Date().toISOString()
      }) });
    } catch (e) { console.warn('[instagram-api][lead-update]', e.message || e); }
  }

  return { id: baseId };
}


async function upsertBaseInvalid(userId, item, lead, when, reason = 'Outros') {
  const ig = cleanUsername(item.instagram_username || item.instagram_url || (lead && (lead.instagram_username || lead.instagram_url || lead.instagram)) || '');
  const phone = normalizePhone(lead && (lead.normalized_phone || lead.phone) || '');
  const payload = {
    user_id: userId,
    company_name: item.company_name || (lead && lead.company_name) || 'Lead Instagram',
    phone: lead && lead.phone || null,
    normalized_phone: phone || null,
    website: lead && lead.website || null,
    instagram_url: ig ? `https://www.instagram.com/${ig}/` : (lead && lead.instagram_url || null),
    instagram_username: ig || (lead && lead.instagram_username) || null,
    category: lead && lead.category || null,
    category_name: lead && lead.category_name || item.parent_category || null,
    categories: lead && lead.categories || null,
    city: lead && lead.city || null,
    state: lead && lead.state || null,
    country_code: lead && lead.country_code || 'BR',
    rating: lead && lead.rating || null,
    reviews_count: lead && lead.reviews_count || null,
    maps_url: lead && lead.maps_url || null,
    raw_payload: { ...((lead && lead.raw_payload) || {}), instagram_dispatch_item_id: item.id || null, lead_id: item.lead_id || (lead && lead.id) || null, invalid_reason: reason || 'Outros' },
    source: 'instagram_extension_api',
    last_channel: 'instagram',
    last_event_type: 'instagram_invalidated',
    last_event_status: 'invalidated',
    invalid_reason: reason || 'Outros',
    invalid_source: 'instagram_extension',
    invalidated_at: when,
    last_contact_at: when,
    status: 'invalidado',
    updated_at: new Date().toISOString()
  };
  const or = [];
  if (phone) or.push(`normalized_phone.eq.${encodeURIComponent(phone)}`);
  if (ig) or.push(`instagram_username.eq.${encodeURIComponent(ig)}`);
  let existing = [];
  if (or.length) existing = await sbRest(`base_permanente?select=id&user_id=eq.${encodeURIComponent(userId)}&or=(${or.join(',')})&limit=1`, { method:'GET', prefer:'return=minimal' });
  let baseId = null;
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    baseId = existing[0].id;
    await sbRest(`base_permanente?id=eq.${encodeURIComponent(baseId)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify(payload) });
  } else {
    payload.created_at = new Date().toISOString();
    const inserted = await sbRest('base_permanente', { method:'POST', body: JSON.stringify(payload) });
    baseId = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
  }
  try {
    await sbRest('contact_events', { method:'POST', body: JSON.stringify({
      user_id: userId,
      lead_id: String(item.lead_id || (lead && lead.id) || ''),
      base_permanente_id: baseId,
      company_name: payload.company_name,
      normalized_phone: phone || null,
      website: payload.website,
      instagram_url: payload.instagram_url,
      maps_url: payload.maps_url,
      channel: 'instagram',
      source_account: item.profile_username || null,
      source_instance: item.profile_id || null,
      event_type: 'invalidated',
      status: 'invalidated',
      sent_at: when,
      metadata: { instagram_dispatch_item_id: item.id || null, reason: reason || 'Outros' }
    }) });
  } catch (e) { console.warn('[instagram-api][contact_events-invalid]', e.message || e); }
  if (item.lead_id) {
    try {
      await sbRest(`leads?id=eq.${encodeURIComponent(item.lead_id)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify({
        current_stage: 'archived',
        current_status: 'instagram_invalidated',
        status: 'Invalidado Instagram',
        rejected_at: when,
        rejected_reason: reason || 'Outros',
        archived_at: when,
        updated_at: new Date().toISOString()
      }) });
    } catch (e) { console.warn('[instagram-api][lead-invalid]', e.message || e); }
  }
  return { id: baseId };
}

async function instagramUpdate(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const id = String(input.id || input.item_id || input.itemId || '').trim();
  const action = String(input.item_action || input.action_item || input.update_action || input.action || '').trim().toLowerCase();
  const reason = String(input.reason || input.error_message || '').trim();
  const followStatus = input.follow_status || input.followStatus || null;
  if (!userId) throw new Error('user_id ausente');
  if (!id) throw new Error('id do item ausente');

  const found = await sbRest(`instagram_dispatch_items?select=*&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}&limit=1`, { method:'GET', prefer:'return=minimal' });
  const item = Array.isArray(found) ? found[0] || null : null;
  if (!item) throw new Error('Item da fila Instagram não encontrado');

  const now = new Date().toISOString();
  let patch = { updated_at: now };
  if (action === 'sent' || action === 'mark_sent') {
    patch = { ...patch, status:'sent', sent_at: now, error_message:null };
    if (followStatus) patch.follow_status = followStatus;
    if (followStatus === 'followed' || followStatus === 'already_following') patch.followed_at = item.followed_at || now;
  } else if (action === 'error' || action === 'mark_error') {
    patch = { ...patch, status:'error', error_message: reason || 'erro operacional' };
  } else if (action === 'invalid' || action === 'invalidated' || action === 'mark_invalid') {
    patch = { ...patch, status:'invalidated', error_message: reason || 'Outros' };
  } else if (action === 'follow') {
    patch = { ...patch, follow_status: followStatus || 'followed', followed_at: item.followed_at || now };
  } else {
    throw new Error('action inválida');
  }

  const rows = await sbRest(`instagram_dispatch_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method:'PATCH', body: JSON.stringify(patch) });
  const updated = Array.isArray(rows) ? rows[0] || { ...item, ...patch } : { ...item, ...patch };
  if (patch.status === 'sent') {
    const lead = await findLead(userId, item.lead_id);
    await upsertBase(userId, updated, lead, now);
  }
  if (patch.status === 'invalidated') {
    const lead = await findLead(userId, item.lead_id);
    await upsertBaseInvalid(userId, updated, lead, now, reason || 'Outros');
  }
  return updated;
}


async function instagramProfilesList(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  if (!userId) throw new Error('user_id ausente');
  const rows = await sbRest(
    `instagram_profiles?select=*&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&order=username.asc`,
    { method:'GET', prefer:'return=minimal' }
  );
  return Array.isArray(rows) ? rows : [];
}

async function instagramProfileUpsert(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const username = cleanUsername(input.username || input.profile_username || input.profileUsername || input.profile || '');
  if (!userId) throw new Error('user_id ausente');
  if (!username) throw new Error('username do perfil ausente');
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    username,
    display_name: input.display_name || input.displayName || username,
    active: true,
    daily_limit: Number(input.daily_limit || input.dailyLimit || 60) || 60,
    blocks: Number(input.blocks || 4) || 4,
    block_size: Number(input.block_size || input.blockSize || 15) || 15,
    interval_minutes: Number(input.interval_minutes || input.intervalMinutes || 120) || 120,
    status: input.status || 'active',
    updated_at: now
  };
  const existing = await sbRest(
    `instagram_profiles?select=id&user_id=eq.${encodeURIComponent(userId)}&username=eq.${encodeURIComponent(username)}&limit=1`,
    { method:'GET', prefer:'return=minimal' }
  );
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    const rows = await sbRest(
      `instagram_profiles?id=eq.${encodeURIComponent(existing[0].id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method:'PATCH', body: JSON.stringify(payload) }
    );
    return Array.isArray(rows) ? rows[0] : rows;
  }
  payload.created_at = now;
  const rows = await sbRest('instagram_profiles', { method:'POST', body: JSON.stringify(payload) });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function instagramProfileRemove(input) {
  const userId = String(input.user_id || input.userId || '').trim();
  const id = String(input.id || input.profile_id || input.profileId || '').trim();
  if (!userId) throw new Error('user_id ausente');
  if (!id) throw new Error('id do perfil ausente');
  const rows = await sbRest(
    `instagram_profiles?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method:'PATCH', body: JSON.stringify({ active:false, updated_at:new Date().toISOString() }) }
  );
  return Array.isArray(rows) ? rows[0] || { id, active:false } : rows;
}

async function handleInstagram(input, req) {
  if (EXTENSION_SECRET) {
    const provided = String(req.headers['x-instagram-extension-secret'] || '').trim();
    if (provided !== EXTENSION_SECRET) throw new Error('Extensão não autorizada');
  }
  const action = String(input.action || '').trim().toLowerCase();
  if (action === 'instagram_next' || action === 'next') {
    const item = await instagramNext(input);
    return { success:true, item, empty:!item };
  }
  if (action === 'instagram_queue' || action === 'queue') {
    const queue = await instagramQueue(input);
    return { success:true, ...queue, empty:!queue.items.length };
  }
  if (action === 'instagram_update' || action === 'update') {
    const item = await instagramUpdate(input);
    return { success:true, item };
  }
  if (action === 'instagram_profiles_list') {
    const profiles = await instagramProfilesList(input);
    return { success:true, profiles };
  }
  if (action === 'instagram_profile_upsert') {
    const profile = await instagramProfileUpsert(input);
    return { success:true, profile };
  }
  if (action === 'instagram_profile_remove') {
    const profile = await instagramProfileRemove(input);
    return { success:true, profile };
  }
  throw new Error('action obrigatória: instagram_next, instagram_queue, instagram_update ou instagram_profile_*');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' || req.method === 'POST') {
      const input = req.method === 'GET' ? (req.query || {}) : (req.body || {});
      const action = String(input.action || '').trim().toLowerCase();
      if (action === 'instagram_next' || action === 'instagram_queue' || action === 'instagram_update' || action === 'next' || action === 'queue' || action === 'update' || action === 'instagram_profiles_list' || action === 'instagram_profile_upsert' || action === 'instagram_profile_remove') {
        const result = await handleInstagram(input, req);
        return res.status(200).json(result);
      }
    }

    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const { alias, deskUrl, mobUrl } = req.body;
    if (!alias) return res.status(400).json({ error: 'alias é obrigatório' });
    if (!deskUrl && !mobUrl) return res.status(400).json({ error: 'Informe ao menos um link para atualizar' });
    if ((deskUrl && !isFigmaUrl(deskUrl)) || (mobUrl && !isFigmaUrl(mobUrl))) {
      return res.status(400).json({ error: 'Os links precisam ser URLs HTTPS do Figma' });
    }

    const current = await redisGet(`redirect:${alias}`);
    if (!current) return res.status(404).json({ error: `Alias "${alias}" não encontrado no banco` });

    const updated = {
      ...current,
      deskUrl: deskUrl || current.deskUrl,
      mobUrl: mobUrl || current.mobUrl,
      updatedAt: new Date().toISOString(),
    };

    await redisSet(`redirect:${alias}`, updated);

    return res.status(200).json({
      ok: true,
      alias,
      deskUrl: updated.deskUrl,
      mobUrl: updated.mobUrl,
    });
  } catch (err) {
    console.error('update error:', err);
    return res.status(500).json({ success:false, error: err && err.message ? err.message : 'Erro ao atualizar no banco' });
  }
}
