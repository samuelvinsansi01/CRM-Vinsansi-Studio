/* ════════════════════════════
   SUPABASE PRIMARY V15
════════════════════════════ */
const SYNC_STATE_KEY = 'vs_supabase_sync_state_v1';
function getSyncStateKeyV423(){
  try { return currentUser?.id ? `${SYNC_STATE_KEY}:${currentUser.id}` : `${SYNC_STATE_KEY}:anonymous`; } catch(e) { return `${SYNC_STATE_KEY}:anonymous`; }
}

function getSyncState() {
  window.__VS_SYNC_STATE_V49 = window.__VS_SYNC_STATE_V49 || {};
  return window.__VS_SYNC_STATE_V49;
}

function setSyncState(data = {}) {
  const prev = getSyncState();
  window.__VS_SYNC_STATE_V49 = {
    ...prev,
    ...data,
    updatedAt: new Date().toISOString()
  };
  renderSyncStatus();
}

function isSupabaseReady() {
  return !!(sbClient && currentUser?.id && currentUser?.email);
}

function renderSyncStatus() {
  const box = document.getElementById('authSyncStatus');
  if (!box) return;

  if (!currentUser) {
    box.className = 'sync-status warn';
    box.textContent = 'offline';
    return;
  }

  const state = getSyncState();
  const label = state.lastLoadedAt
    ? 'sincronizado'
    : 'conectado';

  box.className = 'sync-status ok';
  box.textContent = label;
}

function getLeadCrmPayloadForSupabaseSyncV428(lead = {}) {
  try {
    const id = String(lead?.id || '').trim();
    if (!id) return null;
    const store = typeof getLeadCrmStore === 'function' ? getLeadCrmStore() : {};
    const crm = store?.[id] || lead.crmData || lead.crm_data || lead.leadCrm || null;
    const phone = typeof getLeadSyncPhoneV432 === 'function' ? getLeadSyncPhoneV432(lead) : String(lead.whatsapp || lead.phone || lead.telefone || '').replace(/\D/g, '');
    const inferredWaStatus = lead.whatsappValidationStatus || (lead.numStatus === 'valido' ? 'valid' : lead.numStatus === 'invalido' ? 'invalid' : '');
    if ((!crm || typeof crm !== 'object') && !inferredWaStatus) return null;
    const clone = crm && typeof crm === 'object' ? JSON.parse(JSON.stringify(crm)) : {};
    delete clone.uiSyncStatus;
    delete clone.uiSyncError;
    if (inferredWaStatus && !clone.whatsappValidation) {
      clone.whatsappValidation = {
        status: inferredWaStatus,
        label: inferredWaStatus === 'valid' ? 'WhatsApp válido' : inferredWaStatus === 'invalid' ? 'WhatsApp não confirmado' : 'Não validado',
        number: phone,
        checkedAt: new Date().toISOString(),
        checkedAtLabel: typeof crmNowLabel === 'function' ? crmNowLabel() : ''
      };
    }
    return {
      ...clone,
      persistedAt: new Date().toISOString(),
      schema: clone.schema || 'lead_crm_v28'
    };
  } catch (error) {
    console.warn('[supabase][lead-crm-payload-error]', error?.message || error);
    return null;
  }
}

function getLeadSyncPhoneV432(lead = {}) {
  return typeof getLeadPhoneKeyV31 === 'function'
    ? getLeadPhoneKeyV31(lead)
    : String(lead.whatsapp || lead.phone || lead.telefone || '').replace(/\D/g, '');
}

async function getRemoteLeadPhoneMapV432() {
  const map = new Map();
  if (!isSupabaseReady()) return map;
  const { data, error } = await sbClient
    .from('leads')
    .select('id,phone')
    .eq('user_id', currentUser.id);
  if (error) {
    console.warn('[lead-sync][remote-index-error]', error.message);
    return map;
  }
  (data || []).forEach(row => {
    const phone = getLeadSyncPhoneV432(row);
    if (phone && !map.has(phone)) map.set(phone, row.id);
  });
  return map;
}

async function upsertLeadToSupabase(lead = {}, options = {}) {
  if (!isSupabaseReady() || !lead.id) return { skipped: true, reason:'auth-or-lead-missing' };
  const inValidationQueue = (() => {
    try { return typeof getValData === 'function' && getValData().some(item => item.id === lead.id); } catch(e) { return false; }
  })();
  const persistenceSource = inValidationQueue ? 'Validação' : (lead.baseSource || lead.origem || '');
  if (typeof shouldSkipLeadCloudPersistenceV433 === 'function' && shouldSkipLeadCloudPersistenceV433(lead, persistenceSource)) {
    try { console.warn('[lead-import]', { action:'skip-supabase-upsert', id:lead.id, name:lead.nome || lead.companyName || '', stage:lead.stage || '', source:lead.baseSource || lead.origem || '' }); } catch(e) {}
    return { skipped:true, reason:'non-persistent-lead' };
  }
  try { requireCurrentAuthIdentityV25('upsertLeadToSupabase'); } catch(error) { return { skipped:true, error }; }
  const phoneKey = getLeadSyncPhoneV432(lead);
  const remotePhoneMap = options.remotePhoneMap || await getRemoteLeadPhoneMapV432();
  const canonicalId = phoneKey && remotePhoneMap.get(phoneKey);
  const leadToSave = canonicalId && canonicalId !== lead.id ? { ...lead, id:canonicalId } : lead;
  if (canonicalId && canonicalId !== lead.id) {
    console.warn('[lead-sync-dedupe]', { reason:'remote-phone-match', phone:phoneKey, discardedId:lead.id, canonicalId });
  }
  const crmData = getLeadCrmPayloadForSupabaseSyncV428(leadToSave);
  uiSyncLogV426('supabase-save-start', { entity:'lead', id:leadToSave.id, hasCrmData:!!crmData });

  const payload = {
    id: leadToSave.id,
    user_id: currentUser.id,
    user_email: String(currentUser.email || '').trim().toLowerCase(),
    company_name: lead.nome || lead.companyName || lead.title || 'Lead sem nome',
    phone: leadToSave.whatsapp || leadToSave.phone || leadToSave.telefone || '',
    instagram: leadToSave.instagram || leadToSave.instagramUrl || '',
    website: leadToSave.site || leadToSave.website || '',
    maps_url: leadToSave.googleUrl || leadToSave.mapsUrl || leadToSave.url || '',
    status: lead.status || 'Não enviada',
    pipeline_status: leadToSave.pipelineStatus || leadToSave.pipeline_status || crmData?.pipelineStatus || 'contato_enviado',
    updated_at: new Date().toISOString()
  };
  if (crmData) payload.crm_data = crmData;

  // V29: o sync global roda com snapshots locais antigos. Antes ele fazia upsert sem
  // crm_data/canais e podia apagar links, notas e pipeline já salvos no banco. Agora,
  // quando o payload local vier incompleto, preserva os valores não vazios já existentes.
  try {
    const { data: existing, error: existingError } = await sbClient
      .from('leads')
      .select('phone,instagram,website,maps_url,status,pipeline_status,crm_data')
      .eq('user_id', currentUser.id)
      .eq('id', payload.id)
      .maybeSingle();

    if (!existingError && existing) {
      ['phone', 'instagram', 'website', 'maps_url'].forEach(key => {
        if (!String(payload[key] || '').trim() && String(existing[key] || '').trim()) {
          payload[key] = existing[key];
        }
      });
      if (!payload.crm_data && existing.crm_data) payload.crm_data = existing.crm_data;
      if ((!payload.status || payload.status === 'Não enviada') && existing.status) payload.status = existing.status;
      if ((!payload.pipeline_status || payload.pipeline_status === 'contato_enviado') && existing.pipeline_status) {
        payload.pipeline_status = existing.pipeline_status;
      }
      uiSyncLogV426('supabase-preserve-existing', { entity:'lead', id:payload.id, hasCrmData:!!payload.crm_data });
    }
  } catch (mergeError) {
    console.warn('[supabase] preserve existing lead skipped:', mergeError?.message || mergeError);
  }

  const { error } = await sbClient.from('leads').upsert(payload, { onConflict:'id' });
  if (error) {
    uiSyncLogV426('supabase-save-error', { entity:'lead', id:payload.id, error:error.message, hasCrmData:!!payload.crm_data, payloadKeys:Object.keys(payload) });
    console.warn('[supabase] upsert lead:', error.message, payload);
    setSyncState({ lastError: error.message });
    return { error };
  }

  uiSyncLogV426('supabase-save-success', { entity:'lead', id:payload.id, hasCrmData:!!payload.crm_data });
  if (phoneKey) remotePhoneMap.set(phoneKey, payload.id);
  return { ok: true };
}

async function syncAllLocalLeadsToSupabase() {
  if (!isSupabaseReady()) return;

  const permanentLeads = typeof reconcilePermanentLeadBase === 'function'
    ? reconcilePermanentLeadBase({ schedule:false })
    : (typeof getLeadBaseData === 'function' ? getLeadBaseData() : []);
  const data = ensureWeekData();
  const weekLeads = Object.values(data.days || {}).flat();

  const extras = [];
  try { extras.push(...getAtribuicaoData()); } catch {}
  try {
    const val = getValData();
    extras.push(...(typeof filterPersistentLeadsV433 === 'function' ? filterPersistentLeadsV433(val, 'Validação') : val));
  } catch {}
  try { extras.push(...getInstaFila()); } catch {}
  try { extras.push(...getZapBacklog()); } catch {}

  const all = [...permanentLeads, ...weekLeads, ...extras].filter(lead =>
    !(typeof shouldSkipLeadCloudPersistenceV433 === 'function' && shouldSkipLeadCloudPersistenceV433(lead, lead.baseSource || lead.origem || ''))
  );
  const unique = new Map();
  all.forEach(lead => {
    if (!lead?.id) return;
    const phone = getLeadSyncPhoneV432(lead);
    const key = phone ? `phone:${phone}` : `id:${lead.id}`;
    if (!unique.has(key)) {
      unique.set(key, lead);
      return;
    }
    const previous = unique.get(key);
    unique.set(key, typeof mergeLeadDedupeV31 === 'function' ? mergeLeadDedupeV31(previous, lead) : previous);
    console.warn('[lead-sync-dedupe]', { reason:'local-phone-match', phone, discardedId:lead.id, canonicalId:previous.id });
  });

  const remotePhoneMap = await getRemoteLeadPhoneMapV432();
  let ok = 0;
  for (const lead of unique.values()) {
    const result = await upsertLeadToSupabase(lead, { remotePhoneMap });
    if (result?.ok) ok++;
  }

  setSyncState({
    lastPushedAt: new Date().toISOString(),
    lastPushedCount: ok
  });

  console.log(`[supabase] Leads locais enviados: ${ok}`);
}

async function loadSupabaseAsPrimarySource(options = {}) {
  if (!isSupabaseReady()) return;

  await loadSupabaseLeadsToLocalState(options);

  if (options.syncLocal === true) {
    syncAllLocalLeadsToSupabase().catch(error => {
    console.warn('[supabase] reconciliação de leads em segundo plano:', error?.message || error);
  });
  }
  if (
    typeof scheduleOperationalSyncV36 === 'function' &&
    typeof getOperationalDirtyAtV430 === 'function' &&
    getOperationalDirtyAtV430()
  ) {
    scheduleOperationalSyncV36();
  }

  setSyncState({
    lastLoadedAt: new Date().toISOString()
  });

  renderSyncStatus();
}
