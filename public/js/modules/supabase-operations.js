
/* ════════════════════════════
   SUPABASE-FIRST STATE CLEAN
   Fonte oficial única: operational_data.payload.data.
   Supabase é a fonte oficial dos dados operacionais.
════════════════════════════ */
window.__VS_OPERATIONAL_STATE = window.__VS_OPERATIONAL_STATE || {};
window.__VS_OPERATIONAL_STATE_LOADED = window.__VS_OPERATIONAL_STATE_LOADED || false;
window.__VS_OPERATIONAL_DIRTY_AT = window.__VS_OPERATIONAL_DIRTY_AT || '';

function getOperationalMemory() {
  window.__VS_OPERATIONAL_STATE = window.__VS_OPERATIONAL_STATE || {};
  return window.__VS_OPERATIONAL_STATE;
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
function parseJsonMaybe(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch(e) { return fallback; }
}
function readDisabledBrowserStorageOnce(storageKey) {
  // Sem migração/restauração de dados locais.
  // A base será reimportada quando necessário e o Supabase é a fonte oficial.
  return null;
}
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

/* ════════════════════════════
   PERSISTÊNCIA SUPABASE
════════════════════════════ */
const OPERATIONAL_SUPABASE_TABLE = 'operational_data';
const OPERATIONAL_DIRTY_AT_KEY_V430 = 'vs_operational_dirty_at_v430';

const OPERATIONAL_DATA_KEYS = {
  leadCrm: 'vs_lead_crm_v1',
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
  instagramTemplates: 'vs_insta_templates_v1',
  batchConfig: 'vs_lote_cfg_v1',
  whatsappQueue: 'vs_whatsapp_queue_v27',
  queueCampaigns: 'vs_queue_campaigns_v27',
  queueTemplates: 'vs_queue_templates_v27',
  whatsappChips: 'vs_whatsapp_chips_v29',
  chipUsage: 'vs_chip_usage_day_v29',
  queueControl: 'vs_whatsapp_queue_control_v28',
  dispatchLogs: 'vs_dispatch_v30_log',
  dispatchRuntime: 'vs_dispatch_runtime_v32',
  evolutionResponses: 'vs_evolution_responses_v34',
  whatsappOutbox: 'vs_whatsapp_outbox_v412',
  evolutionSettings: 'vs_evolution_settings_v1',
  sentLedger: 'vs_whatsapp_sent_ledger_v47'
};

function getOperationalDefaultValue(name = '') {
  const arrayNames = new Set([
    'leadCrmArrayPlaceholder', 'weeklyHistory', 'validationQueue', 'assignmentQueue',
    'instagramQueue', 'instagramWeek', 'instagramSchedule', 'whatsappBacklog',
    'chipsConfig', 'excludedDomains', 'branches', 'templatesConfig',
    'branchTemplates', 'instagramTemplates', 'whatsappQueue', 'queueCampaigns',
    'queueTemplates', 'whatsappChips', 'evolutionResponses', 'whatsappOutbox'
  ]);
  if (name === 'leadCrm' || name === 'permanentLeads' || name === 'weeklyLeads' ||
      name === 'monthlyTracking' || name === 'whatsappDispatchQueues' ||
      name === 'evolutionConfigOldFormat' || name === 'batchConfig' ||
      name === 'chipUsage' || name === 'queueControl' || name === 'dispatchLogs' ||
      name === 'dispatchRuntime' || name === 'evolutionSettings' ||
      name === 'sentLedger') {
    if (name === 'permanentLeads') return [];
    if (name === 'weeklyLeads') return null;
    if (name === 'whatsappDispatchQueues') return {};
    return {};
  }
  return arrayNames.has(name) ? [] : null;
}


function setPersistenceStatus(text, type = '') {
  const box = document.getElementById('persistenceStatus');
  if (!box) return;
  box.classList.remove('ok','warn');
  if (type) box.classList.add(type);
  box.textContent = text;
}

function getOperationalSnapshot() {
  const data = {};
  const mem = getOperationalMemory();
  Object.entries(OPERATIONAL_DATA_KEYS).forEach(([name, key]) => {
    if (Object.prototype.hasOwnProperty.call(mem, name)) {
      data[name] = mem[name];
      return;
    }
    data[name] = getOperationalDefaultValue(name);
  });

  if (typeof filterPersistentLeadsV433 === 'function' && Array.isArray(data.permanentLeads)) {
    data.permanentLeads = filterPersistentLeadsV433(data.permanentLeads, 'Base permanente');
  }
  if (typeof isTemporaryDispatchLeadV433 === 'function') {
    const tempIds = new Set();
    const rememberTemp = items => {
      (Array.isArray(items) ? items : []).forEach(item => {
        if (item?.id && isTemporaryDispatchLeadV433(item)) tempIds.add(item.id);
      });
    };
    rememberTemp(data.validationQueue);
    rememberTemp(data.assignmentQueue);
    rememberTemp(data.instagramQueue);
    rememberTemp(data.whatsappBacklog);
    rememberTemp(data.whatsappQueue);
    Object.values(data.weeklyLeads?.days || {}).forEach(rememberTemp);
    if (data.whatsappDispatchQueues && typeof data.whatsappDispatchQueues === 'object' && !Array.isArray(data.whatsappDispatchQueues)) {
      Object.values(data.whatsappDispatchQueues).forEach(rememberTemp);
    }
    const removeTemp = items => (Array.isArray(items) ? items.filter(item => !isTemporaryDispatchLeadV433(item)) : items);
    ['validationQueue','assignmentQueue','instagramQueue','whatsappBacklog','whatsappQueue'].forEach(name => {
      data[name] = removeTemp(data[name]);
    });
    if (data.weeklyLeads?.days) {
      Object.keys(data.weeklyLeads.days).forEach(day => {
        data.weeklyLeads.days[day] = removeTemp(data.weeklyLeads.days[day]);
      });
    }
    if (data.whatsappDispatchQueues && typeof data.whatsappDispatchQueues === 'object' && !Array.isArray(data.whatsappDispatchQueues)) {
      Object.keys(data.whatsappDispatchQueues).forEach(chipId => {
        data.whatsappDispatchQueues[chipId] = removeTemp(data.whatsappDispatchQueues[chipId]);
      });
    }
    if (data.leadCrm && typeof data.leadCrm === 'object' && !Array.isArray(data.leadCrm)) {
      tempIds.forEach(id => { delete data.leadCrm[id]; });
    }
  }

  const snapshot = {
    version: 'supabase-clean',
    exportedAt: new Date().toISOString(),
    data
  };

  return typeof dedupeOperationalSnapshotV31 === 'function'
    ? dedupeOperationalSnapshotV31(snapshot, 'getOperationalSnapshot')
    : snapshot;
}

function getOperationalDirtyKeyV430() {
  const userId = String(currentUser?.id || '').trim();
  const userEmail = String(currentUser?.email || '').trim().toLowerCase();
  return `${OPERATIONAL_DIRTY_AT_KEY_V430}:${userId || 'anonymous'}:${userEmail || 'anonymous'}`;
}

function getOperationalDirtyAtV430() {
  return window.__VS_OPERATIONAL_DIRTY_AT || '';
}

function markOperationalDataDirtyV430(reason = 'local-change') {
  if (!currentUser?.id || !currentUser?.email) return '';
  const dirtyAt = new Date().toISOString();
  window.__VS_OPERATIONAL_DIRTY_AT = dirtyAt;
  uiSyncLog('optimistic-update', { entity:'operational-data', action:'mark-dirty-memory', reason, dirtyAt });
  return dirtyAt;
}

function clearOperationalDataDirtyV430(expectedDirtyAt = '') {
  const currentDirtyAt = window.__VS_OPERATIONAL_DIRTY_AT || '';
  if (!expectedDirtyAt || currentDirtyAt === expectedDirtyAt) window.__VS_OPERATIONAL_DIRTY_AT = '';
}

function getOperationalRemoteUpdatedAtV430(row = {}) {
  return row?.payload?.exportedAt || row?.updated_at || '';
}

function shouldPreserveLocalOperationalDataV430(row = {}) {
  // V31: operational_data é snapshot Supabase-first, não pode vencer o Supabase.
  // A preservação automática recriava duplicados depois de apagar no banco.
  const dirtyAt = getOperationalDirtyAtV430();
  const remoteUpdatedAt = getOperationalRemoteUpdatedAtV430(row);
  if (dirtyAt) {
    uiSyncLog('operational-data-cache-preserve-disabled', { dirtyAt, remoteUpdatedAt });
  }
  return false;
}

function restoreOperationalSnapshot(snapshot = {}) {
  if (typeof dedupeOperationalSnapshotV31 === 'function') {
    snapshot = dedupeOperationalSnapshotV31(snapshot, 'restoreOperationalSnapshot');
  }
  const data = snapshot.data || {};
  const mem = getOperationalMemory();
  Object.entries(OPERATIONAL_DATA_KEYS).forEach(([name, key]) => {
    if (data[name] === undefined) return;
    if (data[name] === null) delete mem[name];
    else mem[name] = data[name];
  });
  window.__VS_OPERATIONAL_STATE_LOADED = true;
  if (data.chipsConfig !== undefined && snapshot.exportedAt) {
    window.__VS_CHIPS_UPDATED_AT = snapshot.exportedAt;
  }
  if (data.whatsappDispatchQueues !== undefined && snapshot.exportedAt) {
    window.__VS_FILA_DISPARO_UPDATED_AT = snapshot.exportedAt;
  }

  try { filaDisparo = v48StateGetObject(FILA_DISPARO_KEY); } catch {}
  if (typeof reconcilePermanentLeadBase === 'function') reconcilePermanentLeadBase({ schedule:false });
  if (typeof updateBadges === 'function') updateBadges();
  if (typeof updateWhatsappQueueBadge === 'function') updateWhatsappQueueBadge();
  if (typeof updateChipsBadge === 'function') updateChipsBadge();
  if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  if (typeof renderInicio === 'function') renderInicio();
  if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
  if (document.getElementById('panel-fila-zap')?.classList.contains('active') && typeof renderFilaZap === 'function') renderFilaZap();
}

function isSupabaseOperationalReady() {
  return !!(typeof sbClient !== 'undefined' && sbClient && currentUser?.id);
}

let operationalSaveRunningV31 = false;

async function syncOperationalDataToSupabase({ silent = false } = {}) {
  if (operationalSaveRunningV31) {
    uiSyncLog('operational-data-save-skipped', { reason:'save-already-running' });
    try { console.log('[operational-data-save]', { action:'skipped', reason:'save-already-running' }); } catch(e) {}
    return { skipped:true, reason:'save-running' };
  }
  if (!isSupabaseOperationalReady()) {
    setPersistenceStatus('Supabase indisponível ou usuário não conectado.', 'warn');
    if (!silent) notify('Entre na conta antes de sincronizar.', 'warn');
    return;
  }

  let snapshot = getOperationalSnapshot();
  if (typeof dedupeOperationalSnapshotV31 === 'function') {
    snapshot = dedupeOperationalSnapshotV31(snapshot, 'syncOperationalDataToSupabase.beforeSave');
  }
  const dirtyAtBeforeSync = getOperationalDirtyAtV430();

  setPersistenceStatus('Enviando dados operacionais para o Supabase...');
  uiSyncLog('supabase-save-start', { entity:'operational-data', dirtyAt:dirtyAtBeforeSync || null });
  try { console.log('[operational-data-save]', { action:'start', userId:currentUser.id, dirtyAt:dirtyAtBeforeSync || null }); } catch(e) {}

  operationalSaveRunningV31 = true;
  try {
    const payload = {
      user_id: currentUser.id,
      scope: 'crm_operational_v36',
      payload: snapshot,
      updated_at: new Date().toISOString()
    };

    const { error } = await sbClient
      .from(OPERATIONAL_SUPABASE_TABLE)
      .upsert(payload, { onConflict: 'user_id,scope' });

    if (error) throw error;

    clearOperationalDataDirtyV430(dirtyAtBeforeSync);
    setPersistenceStatus('Dados operacionais sincronizados com sucesso.', 'ok');
    uiSyncLog('supabase-save-success', { entity:'operational-data', dirtyAt:dirtyAtBeforeSync || null });
    try { console.log('[operational-data-save]', { action:'success', userId:currentUser.id, dirtyAt:dirtyAtBeforeSync || null }); } catch(e) {}
    if (!silent) notify('Dados operacionais enviados ao Supabase.');
    return { ok:true };
  } catch (err) {
    uiSyncLog('supabase-save-error', { entity:'operational-data', dirtyAt:dirtyAtBeforeSync || null, error:err?.message || err });
    try { console.warn('[operational-data-save]', { action:'error', userId:currentUser?.id || '', error:err?.message || err }); } catch(e) {}
    setPersistenceStatus(
      'Falha ao sincronizar. Verifique se a tabela operational_data existe.\n\n' +
      'Erro: ' + (err?.message || 'erro desconhecido'),
      'warn'
    );
    return { error:err, pending:true };
  } finally {
    operationalSaveRunningV31 = false;
  }
}

async function loadOperationalDataFromSupabase() {
  if (!isSupabaseOperationalReady()) {
    setPersistenceStatus('Supabase indisponível ou usuário não conectado.', 'warn');
    notify('Entre na conta antes de carregar.', 'warn');
    return false;
  }

  setPersistenceStatus('Carregando dados operacionais do Supabase...');
  try { console.log('[operational-data-load]', { action:'start', userId:currentUser.id }); } catch(e) {}

  try {
    const { data, error } = await sbClient
      .from(OPERATIONAL_SUPABASE_TABLE)
      .select('payload,updated_at')
      .eq('user_id', currentUser.id)
      .eq('scope', 'crm_operational_v36')
      .maybeSingle();

    if (error) throw error;

    if (!data?.payload) {
      // V31: se o snapshot remoto foi apagado/está vazio, não reenvia cache local antigo.
      clearOperationalDataDirtyV430();
      uiSyncLog('operational-data-remote-empty', { action:'do-not-preserve-local-cache' });
      try { console.log('[operational-data-load]', { action:'empty', userId:currentUser.id }); } catch(e) {}
      setPersistenceStatus('Nenhum dado operacional encontrado no Supabase. Cache local legado não será reenviado automaticamente.', 'warn');
      return false;
    }

    if (shouldPreserveLocalOperationalDataV430(data)) {
      try { filaDisparo = v48StateGetObject(FILA_DISPARO_KEY); } catch {}
      uiSyncLog('optimistic-update', {
        entity:'operational-data',
        action:'preserve-newer-local-cache',
        dirtyAt:getOperationalDirtyAtV430(),
        remoteUpdatedAt:getOperationalRemoteUpdatedAtV430(data)
      });
      scheduleOperationalSync({ delay:0 });
      setPersistenceStatus('Dados locais mais recentes preservados. Enviando ao Supabase...', 'warn');
      return true;
    }

    clearOperationalDataDirtyV430();
    restoreOperationalSnapshot(data.payload);
    try { console.log('[operational-data-load]', { action:'success', userId:currentUser.id, remoteUpdatedAt:data.updated_at || '' }); } catch(e) {}
    setPersistenceStatus('Dados carregados do Supabase e aplicados no CRM.', 'ok');
    notify('Dados operacionais carregados.');
    const restoredData = data.payload?.data || {};
    return Object.prototype.hasOwnProperty.call(restoredData, 'weeklyLeads')
      || Object.prototype.hasOwnProperty.call(restoredData, 'validationQueue')
      || Object.prototype.hasOwnProperty.call(restoredData, 'assignmentQueue')
      || Object.prototype.hasOwnProperty.call(restoredData, 'whatsappDispatchQueues');
  } catch (err) {
    try { console.warn('[operational-data-load]', { action:'error', userId:currentUser?.id || '', error:err?.message || err }); } catch(e) {}
    setPersistenceStatus(
      'Falha ao carregar. Verifique se a tabela operational_data existe.\n\n' +
      'Erro: ' + (err?.message || 'erro desconhecido'),
      'warn'
    );
    return false;
  }
}

function showPersistenceSchema() {
  const sql = `
create table if not exists public.operational_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, scope)
);

alter table public.operational_data enable row level security;

drop policy if exists "operational_data_select_own" on public.operational_data;
create policy "operational_data_select_own"
on public.operational_data for select
using (auth.uid() = user_id);

drop policy if exists "operational_data_insert_own" on public.operational_data;
create policy "operational_data_insert_own"
on public.operational_data for insert
with check (auth.uid() = user_id);

drop policy if exists "operational_data_update_own" on public.operational_data;
create policy "operational_data_update_own"
on public.operational_data for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  lead_id text,
  instance text not null,
  phone text,
  phone_normalized text,
  direction text not null check (direction in ('in', 'out')),
  message_type text not null default 'text',
  body text not null default '',
  status text,
  occurred_at timestamptz not null default now(),
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.whatsapp_messages add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.whatsapp_messages add column if not exists lead_id text;
alter table public.whatsapp_messages add column if not exists phone_normalized text;
alter table public.whatsapp_messages add column if not exists read_at timestamptz;
alter table public.whatsapp_messages add column if not exists updated_at timestamptz not null default now();

create unique index if not exists whatsapp_messages_instance_external_id
on public.whatsapp_messages(instance, external_id);

create index if not exists whatsapp_messages_user_occurred_at
on public.whatsapp_messages(user_id, occurred_at desc);

alter table public.whatsapp_messages enable row level security;

drop policy if exists "whatsapp_messages_select_own" on public.whatsapp_messages;
create policy "whatsapp_messages_select_own"
on public.whatsapp_messages for select
using (auth.uid() = user_id);

drop policy if exists "whatsapp_messages_insert_own" on public.whatsapp_messages;
create policy "whatsapp_messages_insert_own"
on public.whatsapp_messages for insert
with check (auth.uid() = user_id);

drop policy if exists "whatsapp_messages_update_own" on public.whatsapp_messages;
create policy "whatsapp_messages_update_own"
on public.whatsapp_messages for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
`;

  setPersistenceStatus(sql, 'warn');
  navigator.clipboard?.writeText(sql);
  notify('SQL das tabelas copiado.');
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
    syncOperationalDataToSupabase({ silent: true });
  }, safeDelay);
}

function scheduleOperationalSync(options = {}) {
  const reason = options.reason || 'operational-change';
  markOperationalDataDirtyV430(reason);
  const delay = reason === 'operational-change'
    ? Math.max(Number(options.delay || 0), 3000)
    : options.delay;
  scheduleOperationalSyncTimer({ ...options, delay });
}
