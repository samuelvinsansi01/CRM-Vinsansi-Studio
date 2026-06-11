/* ════════════════════════════
   SUPABASE PRIMARY V15
════════════════════════════ */
const SYNC_STATE_KEY = 'vs_supabase_sync_state_v1';
function getSyncStateKeyV423(){
  try { return currentUser?.id ? `${SYNC_STATE_KEY}:${currentUser.id}` : `${SYNC_STATE_KEY}:anonymous`; } catch(e) { return `${SYNC_STATE_KEY}:anonymous`; }
}

function getSyncState() {
  try {
    const state = JSON.parse(localStorage.getItem(getSyncStateKeyV423()) || '{}' );
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  } catch {
    return {};
  }
}

function setSyncState(data = {}) {
  const prev = getSyncState();
  localStorage.setItem(getSyncStateKeyV423(), JSON.stringify({
    ...prev,
    ...data,
    updatedAt: new Date().toISOString()
  }));
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
    if (!crm || typeof crm !== 'object') return null;
    const clone = JSON.parse(JSON.stringify(crm));
    delete clone.uiSyncStatus;
    delete clone.uiSyncError;
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

async function upsertLeadToSupabase(lead = {}) {
  if (!isSupabaseReady() || !lead.id) return { skipped: true, reason:'auth-or-lead-missing' };
  try { requireCurrentAuthIdentityV25('upsertLeadToSupabase'); } catch(error) { return { skipped:true, error }; }
  const crmData = getLeadCrmPayloadForSupabaseSyncV428(lead);
  uiSyncLogV426('supabase-save-start', { entity:'lead', id:lead.id, hasCrmData:!!crmData });

  const payload = {
    id: lead.id,
    user_id: currentUser.id,
    user_email: String(currentUser.email || '').trim().toLowerCase(),
    company_name: lead.nome || lead.companyName || lead.title || 'Lead sem nome',
    phone: lead.whatsapp || lead.phone || lead.telefone || '',
    instagram: lead.instagram || lead.instagramUrl || '',
    website: lead.site || lead.website || '',
    maps_url: lead.googleUrl || lead.mapsUrl || lead.url || '',
    status: lead.status || 'Não enviada',
    pipeline_status: lead.pipelineStatus || lead.pipeline_status || crmData?.pipelineStatus || 'contato_enviado',
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
      uiSyncLogV426('supabase-preserve-existing', { entity:'lead', id:lead.id, hasCrmData:!!payload.crm_data });
    }
  } catch (mergeError) {
    console.warn('[supabase] preserve existing lead skipped:', mergeError?.message || mergeError);
  }

  const { error } = await sbClient.from('leads').upsert(payload, { onConflict:'id' });
  if (error) {
    uiSyncLogV426('supabase-save-error', { entity:'lead', id:lead.id, error:error.message, hasCrmData:!!payload.crm_data, payloadKeys:Object.keys(payload) });
    console.warn('[supabase] upsert lead:', error.message, payload);
    setSyncState({ lastError: error.message });
    return { error };
  }

  uiSyncLogV426('supabase-save-success', { entity:'lead', id:lead.id, hasCrmData:!!payload.crm_data });
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
  try { extras.push(...getValData()); } catch {}
  try { extras.push(...getInstaFila()); } catch {}
  try { extras.push(...getZapBacklog()); } catch {}

  const all = [...permanentLeads, ...weekLeads, ...extras];
  const unique = new Map();
  all.forEach(lead => {
    if (lead?.id) unique.set(lead.id, lead);
  });

  let ok = 0;
  for (const lead of unique.values()) {
    const result = await upsertLeadToSupabase(lead);
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

  syncAllLocalLeadsToSupabase().catch(error => {
    console.warn('[supabase] reconciliação de leads em segundo plano:', error?.message || error);
  });
  if (typeof scheduleOperationalSyncV36 === 'function') scheduleOperationalSyncV36();

  setSyncState({
    lastLoadedAt: new Date().toISOString()
  });

  renderSyncStatus();
}

