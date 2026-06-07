
/* ════════════════════════════
   V51 DATABASE REAL STATE
   Fonte oficial: tabelas Supabase dedicadas.
   Não usa localStorage como fonte operacional.
════════════════════════════ */
window.__VS_OPERATIONAL_STATE = window.__VS_OPERATIONAL_STATE || {};
window.__VS_OPERATIONAL_STATE_LOADED = window.__VS_OPERATIONAL_STATE_LOADED || false;
window.__VS_OPERATIONAL_DIRTY_AT = window.__VS_OPERATIONAL_DIRTY_AT || '';

function getOperationalMemory() {
  window.__VS_OPERATIONAL_STATE = window.__VS_OPERATIONAL_STATE || {};
  return window.__VS_OPERATIONAL_STATE;
}
function parseJsonMaybe(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch(e) { return fallback; }
}
function getOperationalKeyName(storageKey) {
  if (!storageKey || typeof OPERATIONAL_DATA_KEYS === 'undefined') return '';
  const found = Object.entries(OPERATIONAL_DATA_KEYS).find(([, key]) => key === storageKey);
  return found ? found[0] : '';
}
function getOperationalStateByStorageKey(storageKey, fallback = null) {
  const name = getOperationalKeyName(storageKey);
  const mem = getOperationalMemory();
  if (name && Object.prototype.hasOwnProperty.call(mem, name)) return mem[name];
  return fallback;
}
function setOperationalStateByStorageKey(storageKey, value) {
  const name = getOperationalKeyName(storageKey);
  if (!name) return false;
  getOperationalMemory()[name] = value;
  return true;
}
function removeOperationalStateByStorageKey(storageKey) {
  const name = getOperationalKeyName(storageKey);
  if (!name) return false;
  delete getOperationalMemory()[name];
  return true;
}
function readDisabledBrowserStorageOnce() { return null; }
function v48StateGetArray(storageKey) {
  const val = getOperationalStateByStorageKey(storageKey, undefined);
  return Array.isArray(val) ? val : [];
}
function v48StateGetObject(storageKey) {
  const val = getOperationalStateByStorageKey(storageKey, undefined);
  return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
}
function v48StateSet(storageKey, value, reason = 'state-save') {
  if (!setOperationalStateByStorageKey(storageKey, value)) return false;
  scheduleOperationalSync?.({ delay:250, reason });
  return true;
}
function v48StateRemove(storageKey, reason = 'state-remove') {
  if (!removeOperationalStateByStorageKey(storageKey)) return false;
  scheduleOperationalSync?.({ delay:250, reason });
  return true;
}

const DB_TABLES_V51 = {
  leads: 'crm_leads',
  queueItems: 'queue_items',
  dispatchQueues: 'crm_dispatch_queues',
  settings: 'crm_settings',
  sentLedger: 'crm_sent_ledger',
  notes: 'crm_notes'
};
const OPERATIONAL_DIRTY_AT_KEY_V430 = 'crm_db_dirty_at_v51';

const OPERATIONAL_DATA_KEYS = {
  leadCrm: 'crm_notes',
  permanentLeads: LEADS_BASE_KEY,
  weeklyLeads: EMPRESAS_KEY,
  weeklyHistory: HISTORY_KEY,
  monthlyTracking: ACOMP_KEY,
  validationQueue: VAL_KEY,
  assignmentQueue: ATRIBUICAO_KEY,
  instagramQueue: INSTA_KEY,
  instagramWeek: INSTA_WEEK_KEY,
  instagramSchedule: INSTA_SCHED_KEY,
  whatsappDispatchQueues: FILA_DISPARO_KEY,
  whatsappBacklog: 'vin_zap_backlog',
  chipsConfig: CHIPS_KEY,
  evolutionConfigOldFormat: EVO_KEY,
  excludedDomains: EXCLUDED_KEY,
  branches: RAMOS_KEY,
  templatesConfig: TEMPLATES_KEY,
  branchTemplates: TEMPLATES_RAMO_KEY,
  instagramTemplates: 'crm_instagram_templates',
  batchConfig: 'crm_batch_config',
  whatsappQueue: 'crm_whatsapp_queue',
  queueCampaigns: 'crm_queue_campaigns',
  queueTemplates: 'crm_queue_templates',
  whatsappChips: 'crm_whatsapp_chips',
  chipUsage: 'crm_chip_usage',
  queueControl: 'crm_queue_control',
  dispatchLogs: 'crm_dispatch_logs',
  dispatchRuntime: 'crm_dispatch_runtime',
  evolutionResponses: 'crm_evolution_responses',
  whatsappOutbox: 'crm_whatsapp_outbox',
  evolutionSettings: 'crm_evolution_settings',
  sentLedger: 'crm_sent_ledger'
};

function getOperationalDefaultValue(name = '') {
  const arrays = new Set([
    'weeklyHistory','validationQueue','assignmentQueue','instagramQueue','instagramWeek','instagramSchedule',
    'whatsappBacklog','chipsConfig','excludedDomains','branches','templatesConfig','branchTemplates',
    'instagramTemplates','whatsappQueue','queueCampaigns','queueTemplates','whatsappChips','evolutionResponses','whatsappOutbox'
  ]);
  if (name === 'permanentLeads') return [];
  if (name === 'weeklyLeads') return null;
  if (name === 'whatsappDispatchQueues') return {};
  if (['leadCrm','monthlyTracking','evolutionConfigOldFormat','batchConfig','chipUsage','queueControl','dispatchLogs','dispatchRuntime','evolutionSettings','sentLedger'].includes(name)) return {};
  return arrays.has(name) ? [] : null;
}
function setPersistenceStatus(text, type = '') {
  const box = document.getElementById('persistenceStatus');
  if (!box) return;
  box.classList.remove('ok','warn');
  if (type) box.classList.add(type);
  box.textContent = text;
}
function isSupabaseOperationalReady() {
  return !!(typeof sbClient !== 'undefined' && sbClient && currentUser?.id);
}
function getOperationalDirtyAtV430() { return window.__VS_OPERATIONAL_DIRTY_AT || ''; }
function markOperationalDataDirtyV430(reason = 'db-change') {
  if (!currentUser?.id || !currentUser?.email) return '';
  const dirtyAt = new Date().toISOString();
  window.__VS_OPERATIONAL_DIRTY_AT = dirtyAt;
  uiSyncLog?.('db-state-dirty', { reason, dirtyAt });
  return dirtyAt;
}
function clearOperationalDataDirtyV430(expectedDirtyAt = '') {
  const currentDirtyAt = window.__VS_OPERATIONAL_DIRTY_AT || '';
  if (!expectedDirtyAt || currentDirtyAt === expectedDirtyAt) window.__VS_OPERATIONAL_DIRTY_AT = '';
}

function getOperationalSnapshot() {
  const data = {};
  const mem = getOperationalMemory();
  Object.entries(OPERATIONAL_DATA_KEYS).forEach(([name]) => {
    data[name] = Object.prototype.hasOwnProperty.call(mem, name) ? mem[name] : getOperationalDefaultValue(name);
  });
  if (typeof filterPersistentLeadsV433 === 'function' && Array.isArray(data.permanentLeads)) {
    data.permanentLeads = filterPersistentLeadsV433(data.permanentLeads, 'Base permanente');
  }
  return { version:'v51-database-real', exportedAt:new Date().toISOString(), data };
}
function restoreOperationalSnapshot(snapshot = {}) {
  const data = snapshot.data || {};
  const mem = getOperationalMemory();
  Object.entries(OPERATIONAL_DATA_KEYS).forEach(([name]) => {
    if (data[name] === undefined) mem[name] = getOperationalDefaultValue(name);
    else if (data[name] === null) delete mem[name];
    else mem[name] = data[name];
  });
  window.__VS_OPERATIONAL_STATE_LOADED = true;
  if (data.chipsConfig) window.__VS_CHIPS_UPDATED_AT = snapshot.exportedAt;
  if (data.whatsappDispatchQueues) window.__VS_FILA_DISPARO_UPDATED_AT = snapshot.exportedAt;
  applyOperationalStateToRuntime();
}
function applyOperationalStateToRuntime() {
  try { filaDisparo = v48StateGetObject(FILA_DISPARO_KEY); } catch(e) {}
  if (typeof loadRamos === 'function') loadRamos();
  if (typeof ensureTemplateDefaultsV434 === 'function') ensureTemplateDefaultsV434();
  if (typeof updateValidationBadges === 'function') updateValidationBadges();
  if (typeof updateFilaBadge === 'function') updateFilaBadge();
  if (typeof updateChipsBadge === 'function') updateChipsBadge();
  if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  if (typeof renderInicio === 'function') renderInicio();
  if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
  if (document.getElementById('panel-fila-zap')?.classList.contains('active') && typeof renderFilaZap === 'function') renderFilaZap();
}
function normalizeLeadIdV51(item, fallback = '') {
  return String(item?.id || item?.lead_id || item?.place_id || item?.phone || item?.telefone || fallback || '').trim() || ('lead_' + Math.random().toString(36).slice(2));
}
function chunkV51(arr, size = 400) {
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}
async function deleteUserRowsV51(table) {
  const { error } = await sbClient.from(table).delete().eq('user_id', currentUser.id);
  if (error) throw error;
}
async function insertRowsV51(table, rows) {
  if (!rows.length) return;
  for (const part of chunkV51(rows)) {
    const { error } = await sbClient.from(table).insert(part);
    if (error) throw error;
  }
}
function pushQueueRowsV51(rows, queueType, items, bucket = '') {
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    rows.push({
      user_id: currentUser.id,
      queue_type: queueType,
      bucket: String(bucket || ''),
      lead_id: normalizeLeadIdV51(item, `${queueType}_${index}`),
      position: index,
      data: item || {},
      updated_at: new Date().toISOString()
    });
  });
}
async function saveOperationalSnapshotToDatabaseV51(snapshot) {
  const data = snapshot.data || {};
  const now = new Date().toISOString();
  await Promise.all(Object.values(DB_TABLES_V51).map(deleteUserRowsV51));

  const leadRows = [];
  (Array.isArray(data.permanentLeads) ? data.permanentLeads : []).forEach((lead, index) => {
    leadRows.push({ user_id:currentUser.id, lead_id:normalizeLeadIdV51(lead, `permanent_${index}`), source:'permanent', status:String(lead?.status || ''), data:lead || {}, updated_at:now });
  });
  insertWeeklyLeadsRowsV51(leadRows, data.weeklyLeads, now);

  const queueRows = [];
  pushQueueRowsV51(queueRows, 'validation', data.validationQueue);
  pushQueueRowsV51(queueRows, 'assignment', data.assignmentQueue);
  pushQueueRowsV51(queueRows, 'instagram_queue', data.instagramQueue);
  pushQueueRowsV51(queueRows, 'instagram_week', data.instagramWeek);
  pushQueueRowsV51(queueRows, 'instagram_schedule', data.instagramSchedule);
  pushQueueRowsV51(queueRows, 'whatsapp_backlog', data.whatsappBacklog);
  pushQueueRowsV51(queueRows, 'whatsapp_queue', data.whatsappQueue);
  pushQueueRowsV51(queueRows, 'queue_campaigns', data.queueCampaigns);
  pushQueueRowsV51(queueRows, 'queue_templates', data.queueTemplates);
  pushQueueRowsV51(queueRows, 'whatsapp_chips_cache', data.whatsappChips);
  pushQueueRowsV51(queueRows, 'chips_config', data.chipsConfig);
  pushQueueRowsV51(queueRows, 'excluded_domains', data.excludedDomains);
  pushQueueRowsV51(queueRows, 'branches', data.branches);
  pushQueueRowsV51(queueRows, 'templates', data.templatesConfig);
  pushQueueRowsV51(queueRows, 'branch_templates', data.branchTemplates);
  pushQueueRowsV51(queueRows, 'instagram_templates', data.instagramTemplates);
  pushQueueRowsV51(queueRows, 'evolution_responses', data.evolutionResponses);
  pushQueueRowsV51(queueRows, 'whatsapp_outbox', data.whatsappOutbox);
  pushQueueRowsV51(queueRows, 'weekly_history', data.weeklyHistory);

  const dispatchRows = [];
  Object.entries(data.whatsappDispatchQueues || {}).forEach(([chipId, items]) => {
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      dispatchRows.push({ user_id:currentUser.id, chip_id:String(chipId || 'default'), lead_id:normalizeLeadIdV51(item, `${chipId}_${index}`), position:index, data:item || {}, updated_at:now });
    });
  });

  const settingsRows = [];
  ['monthlyTracking','evolutionConfigOldFormat','batchConfig','chipUsage','queueControl','dispatchLogs','dispatchRuntime','evolutionSettings','weeklyLeads'].forEach(key => {
    settingsRows.push({ user_id:currentUser.id, key, value:data[key] ?? getOperationalDefaultValue(key), updated_at:now });
  });

  const ledgerRows = [];
  Object.entries(data.sentLedger || {}).forEach(([ledgerKey, value]) => ledgerRows.push({ user_id:currentUser.id, ledger_key:String(ledgerKey), data:value || {}, updated_at:now }));

  const noteRows = [];
  Object.entries(data.leadCrm || {}).forEach(([leadId, value]) => noteRows.push({ user_id:currentUser.id, lead_id:String(leadId), data:value || {}, updated_at:now }));

  await insertRowsV51(DB_TABLES_V51.leads, leadRows);
  await insertRowsV51(DB_TABLES_V51.queueItems, queueRows);
  await insertRowsV51(DB_TABLES_V51.dispatchQueues, dispatchRows);
  await insertRowsV51(DB_TABLES_V51.settings, settingsRows);
  await insertRowsV51(DB_TABLES_V51.sentLedger, ledgerRows);
  await insertRowsV51(DB_TABLES_V51.notes, noteRows);
}
function insertWeeklyLeadsRowsV51(rows, weeklyLeads, now) {
  const days = weeklyLeads?.days || {};
  Object.entries(days).forEach(([day, items]) => {
    (Array.isArray(items) ? items : []).forEach((lead, index) => {
      const data = { ...(lead || {}), __weeklyDay:day };
      rows.push({ user_id:currentUser.id, lead_id:normalizeLeadIdV51(lead, `weekly_${day}_${index}`), source:'weekly', status:String(lead?.status || ''), data, updated_at:now });
    });
  });
}
async function loadOperationalSnapshotFromDatabaseV51() {
  const [leadsRes, queueRes, dispatchRes, settingsRes, ledgerRes, notesRes] = await Promise.all([
    sbClient.from(DB_TABLES_V51.leads).select('lead_id,source,status,data,updated_at').eq('user_id', currentUser.id).order('updated_at', { ascending:true }),
    sbClient.from(DB_TABLES_V51.queueItems).select('queue_type,bucket,lead_id,position,data').eq('user_id', currentUser.id).order('position', { ascending:true }),
    sbClient.from(DB_TABLES_V51.dispatchQueues).select('chip_id,lead_id,position,data').eq('user_id', currentUser.id).order('position', { ascending:true }),
    sbClient.from(DB_TABLES_V51.settings).select('key,value').eq('user_id', currentUser.id),
    sbClient.from(DB_TABLES_V51.sentLedger).select('ledger_key,data').eq('user_id', currentUser.id),
    sbClient.from(DB_TABLES_V51.notes).select('lead_id,data').eq('user_id', currentUser.id)
  ]);
  const firstError = [leadsRes, queueRes, dispatchRes, settingsRes, ledgerRes, notesRes].find(r => r.error)?.error;
  if (firstError) throw firstError;

  const data = {};
  Object.keys(OPERATIONAL_DATA_KEYS).forEach(name => { data[name] = getOperationalDefaultValue(name); });
  data.permanentLeads = [];
  data.weeklyLeads = data.weeklyLeads || { days:{} };
  (leadsRes.data || []).forEach(row => {
    const lead = row.data || {};
    if (row.source === 'weekly') {
      const day = lead.__weeklyDay || 'sem-dia';
      data.weeklyLeads.days = data.weeklyLeads.days || {};
      data.weeklyLeads.days[day] = data.weeklyLeads.days[day] || [];
      const clean = { ...lead }; delete clean.__weeklyDay;
      data.weeklyLeads.days[day].push(clean);
    } else {
      data.permanentLeads.push(lead);
    }
  });

  const queueMap = {
    validation:'validationQueue', assignment:'assignmentQueue', instagram_queue:'instagramQueue', instagram_week:'instagramWeek', instagram_schedule:'instagramSchedule',
    whatsapp_backlog:'whatsappBacklog', whatsapp_queue:'whatsappQueue', queue_campaigns:'queueCampaigns', queue_templates:'queueTemplates',
    whatsapp_chips_cache:'whatsappChips', chips_config:'chipsConfig', excluded_domains:'excludedDomains', branches:'branches', templates:'templatesConfig',
    branch_templates:'branchTemplates', instagram_templates:'instagramTemplates', evolution_responses:'evolutionResponses', whatsapp_outbox:'whatsappOutbox', weekly_history:'weeklyHistory'
  };
  (queueRes.data || []).forEach(row => {
    const key = queueMap[row.queue_type];
    if (!key) return;
    data[key] = data[key] || [];
    data[key].push(row.data || {});
  });
  data.whatsappDispatchQueues = {};
  (dispatchRes.data || []).forEach(row => {
    const chipId = String(row.chip_id || 'default');
    data.whatsappDispatchQueues[chipId] = data.whatsappDispatchQueues[chipId] || [];
    data.whatsappDispatchQueues[chipId].push(row.data || {});
  });
  (settingsRes.data || []).forEach(row => { data[row.key] = row.value; });
  data.sentLedger = {};
  (ledgerRes.data || []).forEach(row => { data.sentLedger[row.ledger_key] = row.data || {}; });
  data.leadCrm = {};
  (notesRes.data || []).forEach(row => { data.leadCrm[row.lead_id] = row.data || {}; });
  return { version:'v51-database-real', exportedAt:new Date().toISOString(), data };
}

let operationalSaveRunningV51 = false;
async function syncOperationalDataToSupabase({ silent = false } = {}) {
  if (operationalSaveRunningV51) return { skipped:true, reason:'save-running' };
  if (!isSupabaseOperationalReady()) {
    setPersistenceStatus('Supabase indisponível ou usuário não conectado.', 'warn');
    if (!silent) notify('Entre na conta antes de salvar.', 'warn');
    return;
  }
  const snapshot = getOperationalSnapshot();
  const dirtyAtBeforeSync = getOperationalDirtyAtV430();
  setPersistenceStatus('Salvando dados nas tabelas do banco...');
  operationalSaveRunningV51 = true;
  try {
    await saveOperationalSnapshotToDatabaseV51(snapshot);
    clearOperationalDataDirtyV430(dirtyAtBeforeSync);
    setPersistenceStatus('Dados salvos nas tabelas do banco.', 'ok');
    if (!silent) notify('Dados salvos no banco.');
    return { ok:true };
  } catch (err) {
    console.warn('[v51-db-save-error]', err);
    setPersistenceStatus('Falha ao salvar. Rode o SQL V51 no Supabase.\n\nErro: ' + (err?.message || 'erro desconhecido'), 'warn');
    return { error:err, pending:true };
  } finally {
    operationalSaveRunningV51 = false;
  }
}
async function loadOperationalDataFromSupabase() {
  if (!isSupabaseOperationalReady()) {
    setPersistenceStatus('Supabase indisponível ou usuário não conectado.', 'warn');
    notify('Entre na conta antes de carregar.', 'warn');
    return false;
  }
  setPersistenceStatus('Carregando dados das tabelas do banco...');
  try {
    const snapshot = await loadOperationalSnapshotFromDatabaseV51();
    clearOperationalDataDirtyV430();
    restoreOperationalSnapshot(snapshot);
    setPersistenceStatus('Dados carregados das tabelas do banco.', 'ok');
    notify('Dados carregados do banco.');
    return true;
  } catch (err) {
    console.warn('[v51-db-load-error]', err);
    setPersistenceStatus('Falha ao carregar. Rode o SQL V51 no Supabase.\n\nErro: ' + (err?.message || 'erro desconhecido'), 'warn');
    return false;
  }
}
function showPersistenceSchema() {
  const sql = window.V51_DATABASE_REAL_SQL || 'Arquivo SQL disponível em supabase-v51-database-real.sql';
  setPersistenceStatus(sql, 'warn');
  navigator.clipboard?.writeText(sql);
  notify('SQL V51 copiado.');
}
function scheduleOperationalSyncTimer({ delay = 1500 } = {}) {
  if (!isSupabaseOperationalReady()) return;
  const safeDelay = Math.max(0, Number(delay) || 0);
  const dueAt = Date.now() + safeDelay;
  if (window.__operationalSyncTimer && Number(window.__operationalSyncDueAt || 0) <= dueAt) return;
  clearTimeout(window.__operationalSyncTimer);
  window.__operationalSyncDueAt = dueAt;
  window.__operationalSyncTimer = setTimeout(() => {
    window.__operationalSyncTimer = null;
    window.__operationalSyncDueAt = 0;
    syncOperationalDataToSupabase({ silent:true });
  }, safeDelay);
}
function scheduleOperationalSync(options = {}) {
  const reason = options.reason || 'db-change';
  markOperationalDataDirtyV430(reason);
  const delay = reason === 'operational-change' ? Math.max(Number(options.delay || 0), 3000) : options.delay;
  scheduleOperationalSyncTimer({ ...options, delay });
}


/* ════════════════════════════
   FASE 6.6 — DESATIVAR LEGADO crm_* NO FRONTEND
   O banco novo usa leads, queue_items, dispatch_ledger, settings etc.
   Este arquivo mantém o estado em memória do CRM antigo e impede chamadas
   para tabelas removidas: crm_leads, crm_queue_items, crm_dispatch_queues,
   crm_settings e crm_sent_ledger.
════════════════════════════ */
async function syncOperationalDataToSupabase({ silent = false } = {}) {
  clearOperationalDataDirtyV430?.();
  setPersistenceStatus?.('Estado operacional legado mantido apenas em memória. Banco novo ativo.', 'ok');
  return { ok:true, skipped:true, reason:'legacy-crm-tables-disabled' };
}

async function loadOperationalDataFromSupabase() {
  window.__VS_OPERATIONAL_STATE_LOADED = true;
  setPersistenceStatus?.('Banco novo ativo. Carga das tabelas crm_* foi desativada.', 'ok');
  return true;
}

function scheduleOperationalSyncTimer({ delay = 1500 } = {}) {
  window.__operationalSyncTimer = null;
  window.__operationalSyncDueAt = 0;
  return false;
}

function scheduleOperationalSync(options = {}) {
  markOperationalDataDirtyV430?.(options.reason || 'memory-change');
  return false;
}

function showPersistenceSchema() {
  setPersistenceStatus?.('Schema novo ativo. Use as fases SQL do rebuild, não o SQL V51 legado.', 'warn');
  notify?.('Schema novo ativo. SQL V51 legado não é mais usado.', 'warn');
}
