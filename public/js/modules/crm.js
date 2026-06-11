/* ════════════════════════════
   CRM — FICHA DO LEAD
   V1: drawer lateral com pipeline, notas e histórico.
   Salva somente metadados no localStorage, sem mexer no fluxo atual.
════════════════════════════ */
const PIPELINE_STEPS = [
  { id: 'contato_enviado', label: 'Contato enviado' },
  { id: 'respondeu', label: 'Respondeu' },
  { id: 'reuniao', label: 'Reunião' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'fechado', label: 'Fechado' },
  { id: 'perdido', label: 'Perdido' },
];
let activeLeadDrawerId = null;
let activeLeadDrawerData = null;


/* ════════════════════════════
   LEAD DRAWER CONSISTENCY + DEBUG V427
   - centraliza logs da ficha
   - mantém dados do lead atual sincronizados entre listas locais
   - agenda sync operacional para campos que ainda vivem em leadCrm
════════════════════════════ */
function leadDrawerLogV427(event, payload = {}) {
  try { console.log(`[lead-drawer][${event}]`, payload); } catch (_) {}
}

function normalizeChannelUrlV427(kind, value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (kind === 'whatsapp') {
    const phone = raw.replace(/\D/g, '');
    return phone ? `https://wa.me/${phone}` : '';
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (kind === 'instagram') return raw.replace(/^@/, '') ? `https://instagram.com/${raw.replace(/^@/, '')}` : '';
  if (kind === 'site' || kind === 'maps') return `https://${raw}`;
  return raw;
}

function patchLeadArrayV427(items, id, patch) {
  let changed = false;
  const next = (Array.isArray(items) ? items : []).map(item => {
    if (!item || item.id !== id) return item;
    changed = true;
    return { ...item, ...patch };
  });
  return { next, changed };
}

function patchWeekLeadV427(id, patch) {
  if (typeof ensureWeekData !== 'function' || typeof saveWeekData !== 'function') return false;
  const data = ensureWeekData();
  let changed = false;
  Object.keys(data.days || {}).forEach(day => {
    const result = patchLeadArrayV427(data.days[day], id, patch);
    if (result.changed) {
      data.days[day] = result.next;
      changed = true;
    }
  });
  if (changed) saveWeekData(data);
  return changed;
}

function updateLeadEverywhereV427(id, patch = {}, options = {}) {
  if (!id || !patch || typeof patch !== 'object') return { changed:false };
  const touched = [];

  if (patchWeekLeadV427(id, patch)) touched.push('weekly');

  const patchStorageArray = (name, getter, saver) => {
    if (typeof getter !== 'function' || typeof saver !== 'function') return;
    const result = patchLeadArrayV427(getter(), id, patch);
    if (result.changed) {
      saver(result.next);
      touched.push(name);
    }
  };

  patchStorageArray('validation', typeof getValData === 'function' ? getValData : null, typeof saveValData === 'function' ? saveValData : null);
  patchStorageArray('assignment', typeof getAtribuicaoData === 'function' ? getAtribuicaoData : null, typeof saveAtribuicaoData === 'function' ? saveAtribuicaoData : null);
  patchStorageArray('instagram', typeof getInstaFila === 'function' ? getInstaFila : null, typeof saveInstaFila === 'function' ? saveInstaFila : null);

  if (typeof getAcompData === 'function' && typeof saveAcompData === 'function') {
    const acomp = getAcompData();
    let changed = false;
    Object.keys(acomp || {}).forEach(month => {
      const result = patchLeadArrayV427(acomp[month], id, patch);
      if (result.changed) {
        acomp[month] = result.next;
        changed = true;
      }
    });
    if (changed) { saveAcompData(acomp); touched.push('tracking'); }
  }

  if (typeof filaDisparo !== 'undefined' && filaDisparo && typeof saveFilaDisparo === 'function') {
    let changed = false;
    Object.keys(filaDisparo || {}).forEach(key => {
      const result = patchLeadArrayV427(filaDisparo[key], id, patch);
      if (result.changed) {
        filaDisparo[key] = result.next;
        changed = true;
      }
    });
    if (changed) { saveFilaDisparo(); touched.push('dispatchQueue'); }
  }

  if (typeof getLeadBaseData === 'function' && typeof LEADS_BASE_KEY !== 'undefined') {
    const result = patchLeadArrayV427(getLeadBaseData(), id, patch);
    if (result.changed) {
      localStorage.setItem(LEADS_BASE_KEY, JSON.stringify(result.next));
      touched.push('permanentBase');
    }
  }

  if (activeLeadDrawerId === id && activeLeadDrawerData) {
    activeLeadDrawerData = normalizeLeadForDrawer({ ...activeLeadDrawerData, ...patch, id });
    touched.push('activeDrawer');
  }

  if (typeof scheduleLegacyOperationalSyncV36 === 'function') scheduleLegacyOperationalSyncV36();
  if (typeof updateBadges === 'function') updateBadges();
  if (options.render !== false && activeLeadDrawerId === id) {
    try { renderLeadDrawer(); } catch (_) {}
    try { renderLeadWhatsappValidation(); } catch (_) {}
    try { renderLeadMessageBox(); } catch (_) {}
  }
  leadDrawerLogV427('lead-patch', { id, patch, touched });
  return { changed: touched.length > 0, touched };
}

function editLeadChannelV427(kind) {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;
  const labels = { whatsapp:'WhatsApp', instagram:'Instagram', site:'Site', maps:'Maps' };
  const fieldMap = {
    whatsapp: ['whatsapp', 'phone', 'telefone'],
    instagram: ['instagram'],
    site: ['site', 'website'],
    maps: ['googleUrl', 'mapsUrl']
  };
  const fields = fieldMap[kind] || [kind];
  const current = fields.map(f => activeLeadDrawerData[f]).find(Boolean) || '';
  const value = prompt(`Atualizar ${labels[kind] || kind}:`, current);
  if (value === null) return;
  const clean = kind === 'whatsapp' ? String(value || '').replace(/\D/g, '') : String(value || '').trim();
  const patch = {};
  fields.forEach(f => { patch[f] = clean; });
  if (kind === 'whatsapp') {
    patch.numStatus = 'pendente';
    patch.whatsappValidationStatus = 'pending';
    const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
    crm.whatsappValidation = { status:'pending', label:'Não validado', number:clean, checkedAt:'', checkedAtLabel:'' };
    saveLeadCrm(activeLeadDrawerId, crm);
  }
  updateLeadEverywhereV427(activeLeadDrawerId, patch);
  if (typeof syncLeadToCloud === 'function') syncLeadToCloud(activeLeadDrawerId, { ...activeLeadDrawerData, ...patch });
  addLeadHistory(activeLeadDrawerId, `${labels[kind] || kind} atualizado`, { ...activeLeadDrawerData, ...patch });
  leadDrawerLogV427('channel-edit', { leadId:activeLeadDrawerId, kind, value:clean });
  notify(`${labels[kind] || 'Canal'} atualizado.`);
}



/* ════════════════════════════
   LEAD CRM DB-FIRST PERSISTENCE V27
   - persiste pipeline, validação, apresentações e metadados da ficha em leads.crm_data
   - mantém notes/history/followups nas tabelas próprias, mas usa crm_data como fallback completo
════════════════════════════ */
function cloneLeadCrmForCloudV427(crm = {}) {
  const copy = JSON.parse(JSON.stringify(crm || {}));
  // Evita gravar erros transitórios de UI como verdade permanente.
  delete copy.uiSyncStatus;
  delete copy.uiSyncError;
  return copy;
}

function getLeadCrmCloudPayloadV427(id, crm = null) {
  const currentCrm = crm || ensureLeadCrm(id, findLeadEverywhere(id) || {});
  return {
    ...cloneLeadCrmForCloudV427(currentCrm),
    persistedAt: new Date().toISOString(),
    schema: 'lead_crm_v27'
  };
}

let leadCrmCloudTimersV427 = {};
function scheduleLeadCrmCloudSyncV427(id, reason = 'crm-save', delay = 250) {
  if (!id) return;
  if (leadCrmCloudTimersV427[id]) clearTimeout(leadCrmCloudTimersV427[id]);
  leadCrmCloudTimersV427[id] = setTimeout(() => {
    delete leadCrmCloudTimersV427[id];
    syncLeadCrmMetaToCloudV427(id, reason).catch(error => {
      leadDrawerLogV427('crm-cloud-sync-error', { leadId:id, reason, error:error?.message || error });
    });
  }, delay);
}

async function syncLeadCrmMetaToCloudV427(id, reason = 'crm-meta') {
  if (!id || !supabaseDataAdapter || !currentUser?.id || !currentUser?.email) return { skipped:true };
  const raw = findLeadEverywhere(id) || activeLeadDrawerData || { id };
  const lead = normalizeLeadForDrawer({ ...raw, id });
  const crm = ensureLeadCrm(id, lead);
  const payloadLead = {
    ...lead,
    ...raw,
    id,
    pipelineStatus: crm.pipelineStatus || lead.pipelineStatus || 'contato_enviado',
    crmData: getLeadCrmCloudPayloadV427(id, crm)
  };
  uiSyncLogV426('supabase-save-start', { entity:'lead-crm-meta', id, reason });
  const result = await supabaseDataAdapter.saveLead(payloadLead);
  if (result?.error) {
    uiSyncLogV426('supabase-save-error', { entity:'lead-crm-meta', id, reason, error:result.error.message || result.error });
    return result;
  }
  uiSyncLogV426('supabase-save-success', { entity:'lead-crm-meta', id, reason });
  return result;
}

function mergeLeadCrmDataFromCloudV427(store, leadId, crmData) {
  if (!leadId || !crmData || typeof crmData !== 'object') return false;
  const existing = store[leadId] || {};
  const merged = {
    pipelineStatus: 'contato_enviado',
    notes: [],
    history: [],
    createdAt: new Date().toISOString(),
    ...existing,
    ...crmData,
    notes: Array.isArray(crmData.notes) ? crmData.notes : (Array.isArray(existing.notes) ? existing.notes : []),
    history: Array.isArray(crmData.history) ? crmData.history : (Array.isArray(existing.history) ? existing.history : []),
    presentations: Array.isArray(crmData.presentations) ? crmData.presentations : (Array.isArray(existing.presentations) ? existing.presentations : []),
    followUpDate: crmData.followUpDate || existing.followUpDate || '',
    followUpStatus: crmData.followUpStatus || existing.followUpStatus || '',
    pipelineStatus: crmData.pipelineStatus || existing.pipelineStatus || 'contato_enviado',
    updatedAt: crmData.updatedAt || existing.updatedAt || new Date().toISOString()
  };
  store[leadId] = merged;
  return true;
}

function getLeadCrmStore() {
  try { return LeadService.getLeadCrmStore(); }
  catch { return {}; }
}

function saveLeadCrmStore(store) {
  localStorage.setItem(LEAD_CRM_KEY, JSON.stringify(store || {}));
}

function crmNowLabel() {
  return new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function todayIsoDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatIsoDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function getFollowUpInfo(dateIso) {
  if (!dateIso) return { className: 'empty', label: '// sem follow-up agendado' };
  const today = todayIsoDate();
  if (dateIso === today) return { className: 'today', label: `Hoje · ${formatIsoDateBR(dateIso)}` };
  if (dateIso < today) return { className: 'late', label: `Atrasado · ${formatIsoDateBR(dateIso)}` };
  return { className: 'future', label: `Futuro · ${formatIsoDateBR(dateIso)}` };
}

function getFollowUpBucket(dateIso) {
  if (!dateIso) return 'none';
  const today = todayIsoDate();
  if (dateIso === today) return 'today';
  if (dateIso < today) return 'late';
  return 'upcoming';
}

function getAllFollowUps() {
  const store = getLeadCrmStore();
  return Object.entries(store)
    .filter(([, crm]) => crm && crm.followUpDate)
    .map(([id, crm]) => {
      const raw = findLeadEverywhere(id) || {};
      const lead = normalizeLeadForDrawer({ id, ...raw });
      const info = getFollowUpInfo(crm.followUpDate);
      return {
        id,
        date: crm.followUpDate,
        bucket: getFollowUpBucket(crm.followUpDate),
        label: info.label,
        className: info.className,
        lead,
        crm
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}


async function loadSupabaseLeadCrmToLocalState() {
  if (!sbClient || !currentUser) return;

  const [notesRes, historyRes, followupsRes] = await Promise.all([
    sbClient.from('lead_notes').select('*').eq('user_id', currentUser.id),
    sbClient.from('lead_history').select('*').eq('user_id', currentUser.id),
    sbClient.from('lead_followups').select('*').eq('user_id', currentUser.id)
  ]);

  if (notesRes.error) console.warn('[supabase] notes:', notesRes.error.message);
  if (historyRes.error) console.warn('[supabase] history:', historyRes.error.message);
  if (followupsRes.error) console.warn('[supabase] followups:', followupsRes.error.message);

  const store = getLeadCrmStore ? getLeadCrmStore() : {};

  (notesRes.data || []).forEach(note => {
    if (!store[note.lead_id]) {
      store[note.lead_id] = {
        pipelineStatus: 'contato_enviado',
        notes: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    store[note.lead_id].notes = Array.isArray(store[note.lead_id].notes) ? store[note.lead_id].notes : [];
    const at = note.created_at ? new Date(note.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : crmNowLabel();
    const exists = store[note.lead_id].notes.some(item => item.dbId === note.id || (!item.dbId && item.at === at && item.text === (note.note || '')));
    if (!exists) {
      store[note.lead_id].notes.push({
        dbId: note.id || '',
        at,
        text: note.note || ''
      });
    }
  });

  (historyRes.data || []).forEach(item => {
    if (!store[item.lead_id]) {
      store[item.lead_id] = {
        pipelineStatus: 'contato_enviado',
        notes: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    store[item.lead_id].history = Array.isArray(store[item.lead_id].history) ? store[item.lead_id].history : [];
    const at = item.created_at ? new Date(item.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : crmNowLabel();
    const exists = store[item.lead_id].history.some(event => event.dbId === item.id || (!event.dbId && event.at === at && event.text === (item.event || '')));
    if (!exists) {
      store[item.lead_id].history.push({
        dbId: item.id || '',
        at,
        text: item.event || ''
      });
    }
  });

  (followupsRes.data || []).forEach(fu => {
    if (!store[fu.lead_id]) {
      store[fu.lead_id] = {
        pipelineStatus: 'contato_enviado',
        notes: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    store[fu.lead_id].followUpDate = fu.followup_date || '';
    store[fu.lead_id].followUpStatus = fu.status || 'future';
  });

  saveLeadCrmStore(store);
  renderFollowUpsHome();
  console.log(`[supabase] CRM carregado: ${(notesRes.data || []).length} notas, ${(historyRes.data || []).length} eventos, ${(followupsRes.data || []).length} follow-ups`);
}

async function loadSupabaseLeadsToLocalState({ preserveWorkflow = false } = {}) {
  if (!sbClient || !currentUser) return;

  const { data, error } = await sbClient
    .from('leads')
    .select('*')
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('[supabase] load leads:', error);
    notify('Erro ao carregar leads do Supabase', 'err');
    return;
  }

  const today = todayStr();

  const leads = (data || []).map(item => ({
    id: item.id,
    nome: item.company_name || 'Lead sem nome',
    whatsapp: item.phone || '',
    phone: item.phone || '',
    instagram: item.instagram || '',
    site: item.website || '',
    website: item.website || '',
    googleUrl: item.maps_url || '',
    mapsUrl: item.maps_url || '',
    status: item.status || 'Não enviada',
    pipelineStatus: item.pipeline_status || 'contato_enviado',
    permanentCreatedAt: item.created_at || '',
    baseSource: 'Supabase',
    criadoEm: item.created_at
      ? new Date(item.created_at).toLocaleDateString('pt-BR')
      : today
  }));

  // Restaura metadados completos da ficha vindos do banco. Isso protege notas,
  // apresentações, pipeline, follow-up e validação contra perda após F5.
  const crmStoreFromLeads = getLeadCrmStore ? getLeadCrmStore() : {};
  let crmMergedFromLeadRows = 0;
  (data || []).forEach(item => {
    if (mergeLeadCrmDataFromCloudV427(crmStoreFromLeads, item.id, item.crm_data)) crmMergedFromLeadRows++;
  });
  if (crmMergedFromLeadRows) {
    saveLeadCrmStore(crmStoreFromLeads);
    leadDrawerLogV427('crm-data-loaded-from-leads', { count: crmMergedFromLeadRows });
  }

  if (typeof mergeLeadsIntoPermanentBase === 'function') {
    mergeLeadsIntoPermanentBase(leads, { source:'Supabase' }, { schedule:false });
  }
  renderInicio();
  updateBadges();
  renderCrmHomeDashboard();
  renderExecutiveDashboard();

  await loadSupabaseLeadCrmToLocalState();

  console.log(`[supabase] Leads carregados: ${leads.length}`);
}

function getTodayFollowUps() {
  return getAllFollowUps().filter(item => item.bucket === 'today');
}

function getLateFollowUps() {
  return getAllFollowUps().filter(item => item.bucket === 'late');
}

function getUpcomingFollowUps() {
  return getAllFollowUps().filter(item => item.bucket === 'upcoming');
}

function renderFollowUpsHome() {
  const box = document.getElementById('followUpsHomeCard');
  if (!box) return;

  const today = getTodayFollowUps();
  const late = getLateFollowUps();
  const upcoming = getUpcomingFollowUps();
  const priority = [...late, ...today, ...upcoming].slice(0, 8);

  const itemHtml = priority.length
    ? priority.map(item => `
      <button class="followup-mini-item ${item.bucket}" onclick="openLeadDrawer('${item.id}')">
        <span>
          <strong>${escHtml(item.lead.nome || 'Lead')}</strong>
          <small>${escHtml(item.lead.whatsapp || item.lead.instagram || item.lead.site || 'sem canal')}</small>
        </span>
        <em>${escHtml(formatIsoDateBR(item.date))}</em>
      </button>
    `).join('')
    : `<div class="followup-empty">// nenhum follow-up agendado</div>`;

  box.innerHTML = `
    <div class="followup-card-head">
      <div>
        <div class="card-title" style="margin-bottom:4px">Follow-ups</div>
        <div class="followup-sub">// próximos contatos agendados</div>
      </div>
      <div class="followup-summary">
        <span class="late">${late.length} atrasado${late.length!==1?'s':''}</span>
        <span class="today">${today.length} hoje</span>
      </div>
    </div>
    <div class="followup-stats-row">
      <div><strong>${today.length}</strong><small>Hoje</small></div>
      <div><strong>${late.length}</strong><small>Atrasados</small></div>
      <div><strong>${upcoming.length}</strong><small>Próximos</small></div>
    </div>
    <div class="followup-mini-list">${itemHtml}</div>
  `;
}



function ensureLeadCrm(id, baseLead = {}) {
  const store = getLeadCrmStore();
  if (!store[id]) {
    store[id] = {
      pipelineStatus: baseLead.pipelineStatus || 'contato_enviado',
      notes: [],
      history: [{ at: crmNowLabel(), text: 'Ficha do lead criada' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveLeadCrmStore(store);
  } else {
    store[id].notes = Array.isArray(store[id].notes) ? store[id].notes : [];
    store[id].history = Array.isArray(store[id].history) ? store[id].history : [];
    store[id].pipelineStatus = store[id].pipelineStatus || 'contato_enviado';
    store[id].followUpDate = store[id].followUpDate || '';
  }
  return store[id];
}

function saveLeadCrm(id, crm) {
  const store = getLeadCrmStore();
  store[id] = { ...crm, updatedAt: new Date().toISOString() };
  saveLeadCrmStore(store);
  if (typeof scheduleLegacyOperationalSyncV36 === 'function') scheduleLegacyOperationalSyncV36();
  scheduleLeadCrmCloudSyncV427(id, 'saveLeadCrm');
  leadDrawerLogV427('crm-save', { leadId:id, keys:Object.keys(store[id] || {}) });
}

function setLeadPersistenceStatusV426(id, status = '', error = '') {
  if (!id) return;
  const crm = ensureLeadCrm(id, findLeadEverywhere(id) || {});
  crm.uiSyncStatus = status;
  crm.uiSyncError = error ? String(error) : '';
  saveLeadCrm(id, crm);
  if (activeLeadDrawerId === id && activeLeadDrawerData) renderLeadDrawer();
}

function updateLeadNoteSyncStatusV426(id, syncId, status = '', error = '') {
  if (!id || !syncId) return;
  const crm = ensureLeadCrm(id, findLeadEverywhere(id) || {});
  const note = (crm.notes || []).find(item => item.syncId === syncId);
  if (!note) return;
  note.syncStatus = status;
  note.syncError = error ? String(error) : '';
  saveLeadCrm(id, crm);
  if (activeLeadDrawerId === id && activeLeadDrawerData) renderLeadDrawer();
}

function getSupabaseSaveErrorV426(result = {}) {
  return result?.error || null;
}

function getLeadForCloud(id, baseLead = {}) {
  const raw = findLeadEverywhere(id) || baseLead || {};
  const lead = normalizeLeadForDrawer({ ...raw, ...baseLead, id });
  const crm = ensureLeadCrm(id, lead);
  return {
    ...lead,
    id,
    pipelineStatus: crm.pipelineStatus || 'contato_enviado',
    crmData: getLeadCrmCloudPayloadV427(id, crm)
  };
}

async function syncLeadToCloud(id, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return { skipped:true };
  uiSyncLogV426('supabase-save-start', { entity:'lead', id });
  try {
    const result = await supabaseDataAdapter.saveLead(getLeadForCloud(id, baseLead));
    if (getSupabaseSaveErrorV426(result)) throw result.error;
    setLeadPersistenceStatusV426(id, 'saved');
    uiSyncLogV426('supabase-save-success', { entity:'lead', id });
    return { ok:true, result };
  } catch (error) {
    setLeadPersistenceStatusV426(id, 'pending', error?.message || error);
    uiSyncLogV426('supabase-save-error', { entity:'lead', id, error:error?.message || error });
    console.warn('[cloud] saveLead:', error);
    notify('Lead atualizado na tela. Salvamento no Supabase pendente.', 'warn');
    return { error, pending:true };
  }
}

function persistOptimisticLeadV426(lead = {}, action = 'save') {
  if (!lead?.id) return Promise.resolve({ skipped:true });
  uiSyncLogV426('optimistic-update', { entity:'lead', action, id:lead.id });
  return syncLeadToCloud(lead.id, lead);
}

async function syncLeadNoteToCloud(id, noteText, baseLead = {}, syncId = '') {
  if (!supabaseDataAdapter || !currentUser || !id) return { skipped:true };
  uiSyncLogV426('supabase-save-start', { entity:'note', leadId:id, syncId });
  try {
    const result = await supabaseDataAdapter.saveNote(getLeadForCloud(id, baseLead), noteText);
    if (getSupabaseSaveErrorV426(result)) throw result.error;
    updateLeadNoteSyncStatusV426(id, syncId, 'saved');
    uiSyncLogV426('supabase-save-success', { entity:'note', leadId:id, syncId });
    return { ok:true, result };
  } catch (error) {
    updateLeadNoteSyncStatusV426(id, syncId, 'pending', error?.message || error);
    uiSyncLogV426('supabase-save-error', { entity:'note', leadId:id, syncId, error:error?.message || error });
    console.warn('[cloud] saveNote:', error);
    notify('Nota exibida na tela. Salvamento no Supabase pendente.', 'warn');
    return { error, pending:true };
  }
}

async function syncLeadHistoryToCloud(id, eventText, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return { skipped:true };
  uiSyncLogV426('supabase-save-start', { entity:'history', leadId:id });
  try {
    const result = await supabaseDataAdapter.saveHistory(getLeadForCloud(id, baseLead), eventText);
    if (getSupabaseSaveErrorV426(result)) throw result.error;
    uiSyncLogV426('supabase-save-success', { entity:'history', leadId:id });
    return { ok:true, result };
  } catch (error) {
    uiSyncLogV426('supabase-save-error', { entity:'history', leadId:id, error:error?.message || error });
    console.warn('[cloud] saveHistory:', error);
    return { error, pending:true };
  }
}

async function syncLeadFollowUpToCloud(id, dateIso, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return { skipped:true };
  uiSyncLogV426('supabase-save-start', { entity:'followup', leadId:id });
  try {
    const result = await supabaseDataAdapter.saveFollowUp(getLeadForCloud(id, baseLead), dateIso);
    if (getSupabaseSaveErrorV426(result)) throw result.error;
    setLeadPersistenceStatusV426(id, 'saved');
    uiSyncLogV426('supabase-save-success', { entity:'followup', leadId:id });
    return { ok:true, result };
  } catch (error) {
    setLeadPersistenceStatusV426(id, 'pending', error?.message || error);
    uiSyncLogV426('supabase-save-error', { entity:'followup', leadId:id, error:error?.message || error });
    console.warn('[cloud] saveFollowUp:', error);
    notify('Follow-up atualizado na tela. Salvamento no Supabase pendente.', 'warn');
    return { error, pending:true };
  }
}

async function clearLeadFollowUpFromCloud(id, baseLead = {}) {
  if (!supabaseDataAdapter || !currentUser || !id) return { skipped:true };
  uiSyncLogV426('supabase-save-start', { entity:'followup', action:'clear', leadId:id });
  try {
    const result = await supabaseDataAdapter.clearFollowUp(getLeadForCloud(id, baseLead));
    if (getSupabaseSaveErrorV426(result)) throw result.error;
    setLeadPersistenceStatusV426(id, 'saved');
    uiSyncLogV426('supabase-save-success', { entity:'followup', action:'clear', leadId:id });
    return { ok:true, result };
  } catch (error) {
    setLeadPersistenceStatusV426(id, 'pending', error?.message || error);
    uiSyncLogV426('supabase-save-error', { entity:'followup', action:'clear', leadId:id, error:error?.message || error });
    console.warn('[cloud] clearFollowUp:', error);
    notify('Follow-up removido na tela. Salvamento no Supabase pendente.', 'warn');
    return { error, pending:true };
  }
}

function addLeadHistory(id, text, baseLead = {}) {
  const crm = ensureLeadCrm(id, baseLead);
  crm.history.push({
    at: crmNowLabel(),
    text
  });
  saveLeadCrm(id, crm);
  uiSyncLogV426('optimistic-update', { entity:'history', action:'create', leadId:id });
  syncLeadHistoryToCloud(id, text, baseLead);
}


function findLeadEverywhere(id) {
  const data = ensureWeekData();
  const weekLead = Object.values(data.days || {}).flat().find(e => e.id === id);
  if (weekLead) return weekLead;

  const atrib = getAtribuicaoData().find(e => e.id === id);
  if (atrib) return atrib;

  const val = getValData().find(e => e.id === id);
  if (val) return val;

  const insta = getInstaFila().find(e => e.id === id);
  if (insta) return insta;

  const mk = currentMonthKey();
  const acomp = getAcompData();
  const acompLead = (acomp[mk] || []).find(e => e.id === id);
  if (acompLead) return acompLead;

  for (const fila of Object.values(filaDisparo || {})) {
    const f = (fila || []).find(e => e.id === id);
    if (f) return f;
  }

  const permanent = typeof getLeadBaseData === 'function'
    ? getLeadBaseData().find(e => e.id === id)
    : null;
  if (permanent) return permanent;

  return null;
}

function normalizeLeadForDrawer(lead = {}) {
  return {
    id: lead.id,
    nome: lead.nome || lead.companyName || lead.title || 'Lead sem nome',
    categoria: lead.categoria || lead.categoryName || lead.ramo || lead.segmento || '',
    cidade: lead.cidade || lead.city || lead.address?.city || '',
    estado: lead.estado || lead.state || lead.address?.state || '',
    whatsapp: lead.whatsapp || lead.phone || lead.telefone || '',
    instagram: lead.instagram || lead.instagramUrl || '',
    site: lead.site || lead.website || '',
    googleUrl: lead.googleUrl || lead.mapsUrl || lead.url || '',
    status: lead.status || 'Não enviada',
    criadoEm: lead.criadoEm || lead.importadoEm || '',
  };
}

function leadDrawerLink(label, value, href, missingText = 'não informado', kind = '') {
  const safeKind = escHtml(kind || label.toLowerCase());
  if (!value) {
    return `<div class="lead-channel missing"><strong>${label}</strong><span>${missingText}</span><button type="button" class="lead-channel-edit" onclick="event.preventDefault();event.stopPropagation();editLeadChannelV427('${safeKind}')">Editar</button></div>`;
  }
  const url = href || normalizeChannelUrlV427(kind, value) || value;
  return `<div class="lead-channel"><strong>${label}</strong><span>${escHtml(value)}</span><div class="lead-channel-actions"><a href="${escHtml(url)}" target="_blank" rel="noopener">Abrir</a><button type="button" onclick="event.preventDefault();event.stopPropagation();editLeadChannelV427('${safeKind}')">Editar</button></div></div>`;
}

function renderLeadDrawer() {
  if (!activeLeadDrawerData) return;
  const lead = activeLeadDrawerData;
  const crm = ensureLeadCrm(lead.id, lead);

  const nameEl = document.getElementById('leadDrawerName');
  const metaEl = document.getElementById('leadDrawerMeta');
  const channelsEl = document.getElementById('leadDrawerChannels');
  const pipelineEl = document.getElementById('leadDrawerPipeline');
  const notesEl = document.getElementById('leadNotesList');
  const historyEl = document.getElementById('leadHistoryList');
  const followUpInput = document.getElementById('leadFollowUpDate');
  const followUpStatus = document.getElementById('leadFollowUpStatus');
  if (!nameEl || !metaEl || !channelsEl || !pipelineEl || !notesEl || !historyEl) return;

  const local = [lead.cidade, lead.estado].filter(Boolean).join(' - ');
  nameEl.textContent = lead.nome;
  const syncLabel = crm.uiSyncStatus === 'pending' ? 'Supabase: pendente' : '';
  metaEl.textContent = [lead.categoria, local, `Status: ${lead.status}`, syncLabel].filter(Boolean).join(' · ') || 'sem detalhes adicionais';

  const wa = String(lead.whatsapp || '').replace(/\D/g, '');
  channelsEl.innerHTML = [
    leadDrawerLink('WhatsApp', wa ? `+${wa}` : '', wa ? `https://wa.me/${wa}` : '', 'não informado', 'whatsapp'),
    leadDrawerLink('Instagram', lead.instagram, lead.instagram, 'não informado', 'instagram'),
    leadDrawerLink('Site', lead.site, lead.site, 'não informado', 'site'),
    leadDrawerLink('Maps', lead.googleUrl, lead.googleUrl, 'não informado', 'maps'),
  ].join('');

  pipelineEl.innerHTML = PIPELINE_STEPS.map(step => `
    <button class="lead-pipeline-step ${crm.pipelineStatus === step.id ? 'active' : ''}" onclick="updateLeadPipeline('${step.id}')">
      ${escHtml(step.label)}
    </button>
  `).join('');

  if (followUpInput) followUpInput.value = crm.followUpDate || '';
  if (followUpStatus) {
    const info = getFollowUpInfo(crm.followUpDate || '');
    followUpStatus.className = `lead-followup-status ${info.className}`;
    followUpStatus.textContent = info.label;
  }

  notesEl.innerHTML = crm.notes.length
    ? crm.notes.slice().reverse().map(note => `
      <div class="lead-note">
        <div class="lead-note-date">${escHtml(note.at)}</div>
        <div class="lead-note-text">${escHtml(note.text)}${note.syncStatus === 'saving' ? '<small> · salvando...</small>' : note.syncStatus === 'pending' ? '<small> · sync pendente</small>' : ''}</div>
      </div>
    `).join('')
    : '<div class="lead-note"><div class="lead-note-text" style="color:var(--muted)">// nenhuma nota ainda</div></div>';

  renderLeadTimeline(activeLeadDrawerId);

  renderLeadPresentations();

  historyEl.innerHTML = crm.history.length
    ? crm.history.slice().reverse().map(item => `
      <div class="lead-history-item">
        <div class="lead-history-date">${escHtml(item.at)}</div>
        <div class="lead-history-text">${escHtml(item.text)}</div>
      </div>
    `).join('')
    : '<div class="lead-history-item"><div class="lead-history-text" style="color:var(--muted)">// sem histórico</div></div>';
}

function openLeadDrawer(id) {
  const raw = findLeadEverywhere(id);
  if (!raw) {
    notify('Lead não encontrado para abrir a ficha.', 'warn');
    return;
  }
  activeLeadDrawerId = id;
  activeLeadDrawerData = normalizeLeadForDrawer(raw);
  leadDrawerLogV427('open', { id, raw, normalized: activeLeadDrawerData });
  ensureLeadCrm(id, activeLeadDrawerData);
  renderLeadDrawer();
  renderLeadWhatsappValidation();
  renderLeadMessageBox();
  const overlay = document.getElementById('leadDrawerOverlay');
  const drawer = document.getElementById('leadDrawer');
  if (overlay) overlay.classList.add('open');
  if (drawer) drawer.setAttribute('aria-hidden', 'false');
  renderLeadPresentations();
}

function closeLeadDrawer() {
  const overlay = document.getElementById('leadDrawerOverlay');
  const drawer = document.getElementById('leadDrawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.setAttribute('aria-hidden', 'true');
}

function addLeadNote() {
  if (!activeLeadDrawerId) return;
  leadDrawerLogV427('note-add-click', { leadId: activeLeadDrawerId });
  const input = document.getElementById('leadNoteInput');
  const text = (input?.value || '').trim();
  if (!text) { notify('Escreva uma nota antes de adicionar.', 'warn'); return; }
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const syncId = 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  crm.notes.push({ at: crmNowLabel(), text, syncId, syncStatus:'saving' });
  saveLeadCrm(activeLeadDrawerId, crm);

  uiSyncLogV426('optimistic-update', { entity:'note', action:'create', leadId:activeLeadDrawerId, syncId });
  syncLeadNoteToCloud(activeLeadDrawerId, text, activeLeadDrawerData || {}, syncId);
  addLeadHistory(activeLeadDrawerId, 'Nota adicionada', activeLeadDrawerData || {});
  if (input) input.value = '';
  renderLeadDrawer();
  notify('Nota adicionada ao lead.');
}

function updateLeadPipeline(status) {
  if (!activeLeadDrawerId) return;
  leadDrawerLogV427('pipeline-click', { leadId: activeLeadDrawerId, status });
  const step = PIPELINE_STEPS.find(s => s.id === status);
  if (!step) return;
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const old = PIPELINE_STEPS.find(s => s.id === crm.pipelineStatus)?.label || 'Sem status';
  crm.pipelineStatus = status;
  saveLeadCrm(activeLeadDrawerId, crm);
  updateLeadEverywhereV427(activeLeadDrawerId, { pipelineStatus: status }, { render:false });

  uiSyncLogV426('optimistic-update', { entity:'lead', action:'pipeline-update', id:activeLeadDrawerId, status });
  syncLeadToCloud(activeLeadDrawerId, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, `Pipeline alterado: ${old} → ${step.label}`, activeLeadDrawerData || {});
  renderLeadDrawer();
  notify(`Pipeline: ${step.label}`);
}

function saveLeadFollowUp() {
  if (!activeLeadDrawerId) return;
  leadDrawerLogV427('followup-save-click', { leadId: activeLeadDrawerId });
  const input = document.getElementById('leadFollowUpDate');
  const dateIso = (input?.value || '').trim();
  if (!dateIso) {
    notify('Selecione uma data para o follow-up.', 'warn');
    return;
  }

  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const oldDate = crm.followUpDate || '';
  crm.followUpDate = dateIso;
  saveLeadCrm(activeLeadDrawerId, crm);

  const message = oldDate
    ? `Follow-up reagendado: ${formatIsoDateBR(oldDate)} → ${formatIsoDateBR(dateIso)}`
    : `Follow-up agendado para ${formatIsoDateBR(dateIso)}`;

  uiSyncLogV426('optimistic-update', { entity:'followup', action:'save', leadId:activeLeadDrawerId, dateIso });
  syncLeadFollowUpToCloud(activeLeadDrawerId, dateIso, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, message, activeLeadDrawerData || {});
  renderLeadDrawer();
  renderFollowUpsHome();
  if (acompTab === 'lista') renderAcompLista();
  notify('Follow-up salvo.');
}

function clearLeadFollowUp() {
  if (!activeLeadDrawerId) return;
  leadDrawerLogV427('followup-clear-click', { leadId: activeLeadDrawerId });
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  if (!crm.followUpDate) {
    notify('Este lead não possui follow-up agendado.', 'warn');
    return;
  }

  const oldDate = crm.followUpDate;
  crm.followUpDate = '';
  saveLeadCrm(activeLeadDrawerId, crm);
  uiSyncLogV426('optimistic-update', { entity:'followup', action:'clear', leadId:activeLeadDrawerId });
  clearLeadFollowUpFromCloud(activeLeadDrawerId, activeLeadDrawerData || {});
  addLeadHistory(activeLeadDrawerId, `Follow-up removido: ${formatIsoDateBR(oldDate)}`, activeLeadDrawerData || {});
  renderLeadDrawer();
  renderFollowUpsHome();
  if (acompTab === 'lista') renderAcompLista();
  notify('Follow-up removido.');
}


function createDevTestLead() {
  const id = 'dev_test_' + Date.now();
  const lead = {
    id,
    nome: 'Lead Teste DEV',
    site: 'https://exemplo.com.br',
    whatsapp: '5511999999999',
    instagram: 'https://instagram.com/leadteste',
    googleUrl: 'https://maps.google.com',
    categoria: 'Teste / Validação',
    numStatus: 'pendente',
    status: 'Não enviada',
    criadoEm: todayStr(),
    ramoId: null
  };

  saveValData([...getValData(), lead]);
  ensureLeadCrm(id, lead);
  addLeadHistory(id, 'Lead teste criado no ambiente DEV', lead);
  persistOptimisticLeadV426(lead, 'create-dev-test');

  renderInicio();
  renderFollowUpsHome();
  updateBadges();
  notify('Lead teste criado em Validação.');

}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLeadDrawer();
});


