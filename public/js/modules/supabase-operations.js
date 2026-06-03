/* ════════════════════════════
   PERSISTÊNCIA SUPABASE V36
════════════════════════════ */
const OPERATIONAL_SUPABASE_TABLE_V36 = 'operational_data';
const OPERATIONAL_DIRTY_AT_KEY_V430 = 'vs_operational_dirty_at_v430';

const OPERATIONAL_DATA_KEYS_V36 = {
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
  legacyChips: CHIPS_KEY,
  legacyEvolutionSettings: EVO_KEY,
  excludedDomains: EXCLUDED_KEY,
  branches: RAMOS_KEY,
  legacyTemplates: TEMPLATES_KEY,
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
  evolutionSettings: 'vs_evolution_settings_v1'
};

function setPersistenceStatusV36(text, type = '') {
  const box = document.getElementById('persistenceV36Status');
  if (!box) return;
  box.classList.remove('ok','warn');
  if (type) box.classList.add(type);
  box.textContent = text;
}

function getOperationalSnapshotV36() {
  const data = {};
  Object.entries(OPERATIONAL_DATA_KEYS_V36).forEach(([name, key]) => {
    try {
      data[name] = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      data[name] = localStorage.getItem(key);
    }
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
    version: 'v36',
    exportedAt: new Date().toISOString(),
    data
  };

  return typeof dedupeOperationalSnapshotV31 === 'function'
    ? dedupeOperationalSnapshotV31(snapshot, 'getOperationalSnapshotV36')
    : snapshot;
}

function getOperationalDirtyKeyV430() {
  const userId = String(currentUser?.id || '').trim();
  const userEmail = String(currentUser?.email || '').trim().toLowerCase();
  return `${OPERATIONAL_DIRTY_AT_KEY_V430}:${userId || 'anonymous'}:${userEmail || 'anonymous'}`;
}

function getOperationalDirtyAtV430() {
  return localStorage.getItem(getOperationalDirtyKeyV430()) || '';
}

function markOperationalDataDirtyV430(reason = 'local-change') {
  if (!currentUser?.id || !currentUser?.email) return '';
  const dirtyAt = new Date().toISOString();
  localStorage.setItem(getOperationalDirtyKeyV430(), dirtyAt);
  uiSyncLogV426('optimistic-update', { entity:'operational-data', action:'mark-dirty', reason, dirtyAt });
  return dirtyAt;
}

function clearOperationalDataDirtyV430(expectedDirtyAt = '') {
  const key = getOperationalDirtyKeyV430();
  const currentDirtyAt = localStorage.getItem(key) || '';
  if (!expectedDirtyAt || currentDirtyAt === expectedDirtyAt) localStorage.removeItem(key);
}

function getOperationalRemoteUpdatedAtV430(row = {}) {
  return row?.payload?.exportedAt || row?.updated_at || '';
}

function shouldPreserveLocalOperationalDataV430(row = {}) {
  // V31: operational_data é snapshot legado/cache, não pode vencer o Supabase.
  // A preservação automática recriava duplicados depois de apagar no banco.
  const dirtyAt = getOperationalDirtyAtV430();
  const remoteUpdatedAt = getOperationalRemoteUpdatedAtV430(row);
  if (dirtyAt) {
    uiSyncLogV426('operational-data-cache-preserve-disabled', { dirtyAt, remoteUpdatedAt });
  }
  return false;
}

function restoreOperationalSnapshotV36(snapshot = {}) {
  if (typeof dedupeOperationalSnapshotV31 === 'function') {
    snapshot = dedupeOperationalSnapshotV31(snapshot, 'restoreOperationalSnapshotV36');
  }
  const data = snapshot.data || {};
  const localLegacyChipsUpdatedAt = Date.parse(localStorage.getItem(LEGACY_CHIPS_UPDATED_AT_KEY_V426) || '');
  const localDispatchQueueUpdatedAt = Date.parse(localStorage.getItem(FILA_DISPARO_UPDATED_AT_KEY_V431) || '');
  const remoteExportedAt = Date.parse(snapshot.exportedAt || '');
  const preserveLocalLegacyChips = !!(
    localStorage.getItem(CHIPS_KEY)
    && localLegacyChipsUpdatedAt
    && (!remoteExportedAt || localLegacyChipsUpdatedAt > remoteExportedAt)
  );
  const preserveLocalDispatchQueue = !!(
    localStorage.getItem(FILA_DISPARO_KEY)
    && localDispatchQueueUpdatedAt
    && (!remoteExportedAt || localDispatchQueueUpdatedAt > remoteExportedAt)
  );

  Object.entries(OPERATIONAL_DATA_KEYS_V36).forEach(([name, key]) => {
    if (name === 'legacyChips' && preserveLocalLegacyChips) return;
    if (name === 'whatsappDispatchQueues' && preserveLocalDispatchQueue) return;
    if (data[name] === undefined) return;
    if (data[name] === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(data[name]));
  });
  if (preserveLocalLegacyChips) {
    uiSyncLogV426('optimistic-update', { entity:'chip', action:'preserve-newer-legacy-cache' });
    scheduleOperationalSyncV36({ delay:0 });
  } else if (data.legacyChips !== undefined && snapshot.exportedAt) {
    localStorage.setItem(LEGACY_CHIPS_UPDATED_AT_KEY_V426, snapshot.exportedAt);
  }
  if (preserveLocalDispatchQueue) {
    uiSyncLogV426('optimistic-update', { entity:'dispatch-queue', action:'preserve-newer-local-cache' });
    scheduleOperationalSyncV36({ delay:0 });
  } else if (data.whatsappDispatchQueues !== undefined && snapshot.exportedAt) {
    localStorage.setItem(FILA_DISPARO_UPDATED_AT_KEY_V431, snapshot.exportedAt);
  }

  try { filaDisparo = JSON.parse(localStorage.getItem(FILA_DISPARO_KEY) || '{}') || {}; } catch {}
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

function isSupabaseOperationalReadyV36() {
  return !!(typeof sbClient !== 'undefined' && sbClient && currentUser?.id);
}

let operationalSaveRunningV31 = false;

async function syncOperationalDataToSupabaseV36({ silent = false } = {}) {
  if (operationalSaveRunningV31) {
    uiSyncLogV426('operational-data-save-skipped', { reason:'save-already-running' });
    try { console.log('[operational-data-save]', { action:'skipped', reason:'save-already-running' }); } catch(e) {}
    return { skipped:true, reason:'save-running' };
  }
  if (!isSupabaseOperationalReadyV36()) {
    setPersistenceStatusV36('Supabase indisponível ou usuário não conectado.', 'warn');
    if (!silent) notify('Entre na conta antes de sincronizar.', 'warn');
    return;
  }

  let snapshot = getOperationalSnapshotV36();
  if (typeof dedupeOperationalSnapshotV31 === 'function') {
    snapshot = dedupeOperationalSnapshotV31(snapshot, 'syncOperationalDataToSupabaseV36.beforeSave');
  }
  const dirtyAtBeforeSync = getOperationalDirtyAtV430();

  setPersistenceStatusV36('Enviando dados operacionais para o Supabase...');
  uiSyncLogV426('supabase-save-start', { entity:'operational-data', dirtyAt:dirtyAtBeforeSync || null });
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
      .from(OPERATIONAL_SUPABASE_TABLE_V36)
      .upsert(payload, { onConflict: 'user_id,scope' });

    if (error) throw error;

    clearOperationalDataDirtyV430(dirtyAtBeforeSync);
    setPersistenceStatusV36('Dados operacionais sincronizados com sucesso.', 'ok');
    uiSyncLogV426('supabase-save-success', { entity:'operational-data', dirtyAt:dirtyAtBeforeSync || null });
    try { console.log('[operational-data-save]', { action:'success', userId:currentUser.id, dirtyAt:dirtyAtBeforeSync || null }); } catch(e) {}
    if (!silent) notify('Dados operacionais enviados ao Supabase.');
    return { ok:true };
  } catch (err) {
    uiSyncLogV426('supabase-save-error', { entity:'operational-data', dirtyAt:dirtyAtBeforeSync || null, error:err?.message || err });
    try { console.warn('[operational-data-save]', { action:'error', userId:currentUser?.id || '', error:err?.message || err }); } catch(e) {}
    setPersistenceStatusV36(
      'Falha ao sincronizar. Verifique se a tabela operational_data existe.\n\n' +
      'Erro: ' + (err?.message || 'erro desconhecido'),
      'warn'
    );
    return { error:err, pending:true };
  } finally {
    operationalSaveRunningV31 = false;
  }
}

async function loadOperationalDataFromSupabaseV36() {
  if (!isSupabaseOperationalReadyV36()) {
    setPersistenceStatusV36('Supabase indisponível ou usuário não conectado.', 'warn');
    notify('Entre na conta antes de carregar.', 'warn');
    return false;
  }

  setPersistenceStatusV36('Carregando dados operacionais do Supabase...');
  try { console.log('[operational-data-load]', { action:'start', userId:currentUser.id }); } catch(e) {}

  try {
    const { data, error } = await sbClient
      .from(OPERATIONAL_SUPABASE_TABLE_V36)
      .select('payload,updated_at')
      .eq('user_id', currentUser.id)
      .eq('scope', 'crm_operational_v36')
      .maybeSingle();

    if (error) throw error;

    if (!data?.payload) {
      // V31: se o snapshot remoto foi apagado/está vazio, não reenvia cache local antigo.
      clearOperationalDataDirtyV430();
      uiSyncLogV426('operational-data-remote-empty', { action:'do-not-preserve-local-cache' });
      try { console.log('[operational-data-load]', { action:'empty', userId:currentUser.id }); } catch(e) {}
      setPersistenceStatusV36('Nenhum dado operacional encontrado no Supabase. Cache local legado não será reenviado automaticamente.', 'warn');
      return false;
    }

    if (shouldPreserveLocalOperationalDataV430(data)) {
      try { filaDisparo = JSON.parse(localStorage.getItem(FILA_DISPARO_KEY) || '{}') || {}; } catch {}
      uiSyncLogV426('optimistic-update', {
        entity:'operational-data',
        action:'preserve-newer-local-cache',
        dirtyAt:getOperationalDirtyAtV430(),
        remoteUpdatedAt:getOperationalRemoteUpdatedAtV430(data)
      });
      scheduleOperationalSyncV36({ delay:0 });
      setPersistenceStatusV36('Dados locais mais recentes preservados. Enviando ao Supabase...', 'warn');
      return true;
    }

    clearOperationalDataDirtyV430();
    restoreOperationalSnapshotV36(data.payload);
    try { console.log('[operational-data-load]', { action:'success', userId:currentUser.id, remoteUpdatedAt:data.updated_at || '' }); } catch(e) {}
    setPersistenceStatusV36('Dados carregados do Supabase e aplicados no CRM.', 'ok');
    notify('Dados operacionais carregados.');
    const restoredData = data.payload?.data || {};
    return Object.prototype.hasOwnProperty.call(restoredData, 'weeklyLeads')
      || Object.prototype.hasOwnProperty.call(restoredData, 'validationQueue')
      || Object.prototype.hasOwnProperty.call(restoredData, 'assignmentQueue')
      || Object.prototype.hasOwnProperty.call(restoredData, 'whatsappDispatchQueues');
  } catch (err) {
    try { console.warn('[operational-data-load]', { action:'error', userId:currentUser?.id || '', error:err?.message || err }); } catch(e) {}
    setPersistenceStatusV36(
      'Falha ao carregar. Verifique se a tabela operational_data existe.\n\n' +
      'Erro: ' + (err?.message || 'erro desconhecido'),
      'warn'
    );
    return false;
  }
}

function showPersistenceSchemaV36() {
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

  setPersistenceStatusV36(sql, 'warn');
  navigator.clipboard?.writeText(sql);
  notify('SQL das tabelas copiado.');
}

function scheduleOperationalSyncV36({ delay = 1500 } = {}) {
  if (!isSupabaseOperationalReadyV36()) return;
  const safeDelay = Math.max(0, Number(delay) || 0);
  const dueAt = Date.now() + safeDelay;
  if (window.__operationalSyncV36Timer && Number(window.__operationalSyncV36DueAt || 0) <= dueAt) return;
  clearTimeout(window.__operationalSyncV36Timer);
  window.__operationalSyncV36DueAt = dueAt;
  window.__operationalSyncV36Timer = setTimeout(() => {
    window.__operationalSyncV36Timer = null;
    window.__operationalSyncV36DueAt = 0;
    syncOperationalDataToSupabaseV36({ silent: true });
  }, safeDelay);
}

function scheduleLegacyOperationalSyncV36(options = {}) {
  const reason = options.reason || 'legacy-local-change';
  markOperationalDataDirtyV430(reason);
  const delay = reason === 'legacy-local-change'
    ? Math.max(Number(options.delay || 0), 3000)
    : options.delay;
  if (typeof scheduleOperationalSyncV36 === 'function') scheduleOperationalSyncV36({ ...options, delay });
}
