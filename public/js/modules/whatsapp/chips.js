/* ════════════════════════════
   CHIPS V29 — DISTRIBUIÇÃO
════════════════════════════ */
const WHATSAPP_CHIPS_V29_KEY = 'vs_whatsapp_chips_v29';
const CHIP_USAGE_DAY_KEY = 'vs_chip_usage_day_v29';
const WHATSAPP_CHIPS_DELETED_KEY_V47 = 'vs_whatsapp_chips_deleted_v47';
function getDeletedWhatsappChipIdsV47(){ window.__VS_DELETED_CHIPS_V49 = window.__VS_DELETED_CHIPS_V49 || new Set(); return window.__VS_DELETED_CHIPS_V49; }
function saveDeletedWhatsappChipIdsV47(set){ window.__VS_DELETED_CHIPS_V49 = new Set(set || []); }

/* Chips vêm do Supabase/whatsapp_instances e cache apenas em memória. */
function getCurrentUserIdV22(){
  try { return (typeof currentUser !== 'undefined' && currentUser?.id) ? String(currentUser.id) : ''; } catch { return ''; }
}

function getCurrentUserEmailV24(){
  try { return (typeof currentUser !== 'undefined' && currentUser?.email) ? String(currentUser.email).trim().toLowerCase() : ''; } catch { return ''; }
}

function getCurrentUserChipScopeV24(){
  const userId = getCurrentUserIdV22();
  const email = getCurrentUserEmailV24();
  return (userId && email) ? `${userId}:${email}` : 'anonymous';
}

function scopedWhatsappChipsKeyV22(){
  const scope = getCurrentUserChipScopeV24();
  return `${WHATSAPP_CHIPS_V29_KEY}:${scope}`;
}

function scopedChipUsageKeyV22(){
  const scope = getCurrentUserChipScopeV24();
  return `${CHIP_USAGE_DAY_KEY}:${scope}`;
}

function isSupabaseChipStoreReadyV22(){
  return !!(typeof sbClient !== 'undefined' && sbClient && getCurrentUserIdV22() && getCurrentUserEmailV24());
}

function isChipAllowedForCurrentUserV24(row = {}){
  const currentUserId = getCurrentUserIdV22();
  const currentUserEmail = getCurrentUserEmailV24();
  const chipUserId = String(row.user_id || '');
  const chipUserEmail = String(row.user_email || '').trim().toLowerCase();
  const allowed = !!(currentUserId && currentUserEmail && chipUserId === currentUserId && chipUserEmail === currentUserEmail);
  console.log('[user-isolation][chip-filter]', { currentUserId, currentUserEmail, chipUserId, chipUserEmail, allowed });
  return allowed;
}

function getDefaultWhatsappChipBlocksV426(){
  return [...WHATSAPP_CHIP_BLOCKS_V426];
}

function normalizeWhatsappChipOperationV426(chip = {}){
  const blocks = Array.isArray(chip.blocks) ? chip.blocks.map(String) : [];
  const hasOldDefaultBlocks = blocks.join(',') === '08:00,10:00,12:00,14:00';
  const dailyLimit = Number(chip.dailyLimit || chip.daily_limit || 0);
  const url = typeof normalizeChipEvolutionUrlForStorageV437 === 'function'
    ? normalizeChipEvolutionUrlForStorageV437(chip)
    : String(chip.url || chip.baseUrl || chip.evolutionUrl || '').replace(/\/+$/, '');
  const baseUrl = typeof normalizeEvolutionUrlForStorageV437 === 'function'
    ? normalizeEvolutionUrlForStorageV437(chip.baseUrl || chip.base_url || url)
    : (chip.baseUrl || chip.base_url || url);
  const evolutionUrl = typeof normalizeEvolutionUrlForStorageV437 === 'function'
    ? normalizeEvolutionUrlForStorageV437(chip.evolutionUrl || chip.evolution_url || url)
    : (chip.evolutionUrl || chip.evolution_url || url);

  return {
    ...chip,
    url,
    baseUrl,
    base_url: baseUrl,
    evolutionUrl,
    evolution_url: evolutionUrl,
    dailyLimit: !dailyLimit || dailyLimit === 180 ? WHATSAPP_CHIP_DAILY_LIMIT_V426 : dailyLimit,
    intervalSeconds: Number(chip.intervalSeconds || chip.interval_seconds || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
    blockSize: Number(chip.blockSize || chip.block_size || WHATSAPP_CHIP_BLOCK_SIZE_V426),
    blocks: !blocks.length || hasOldDefaultBlocks ? getDefaultWhatsappChipBlocksV426() : blocks
  };
}

function normalizeChipRowToLocalV22(row = {}){
  return normalizeWhatsappChipOperationV426({
    id: String(row.chip_id || row.id || row.instance || `chip_${Date.now()}`),
    name: row.name || row.label || row.instance || 'WhatsApp',
    instance: row.instance || row.name || '',
    status: row.active === false ? 'disabled' : 'active',
    paused: false,
    dailyLimit: Number(row.daily_limit || row.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426),
    intervalSeconds: Number(row.interval_seconds || row.intervalSeconds || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
    blockSize: Number(row.block_size || row.blockSize || WHATSAPP_CHIP_BLOCK_SIZE_V426),
    blocks: Array.isArray(row.blocks) ? row.blocks : getDefaultWhatsappChipBlocksV426(),
    connectionState: row.status || row.connection_state || 'salvo no banco',
    phone: row.phone || row.number || '',
    url: row.url || row.base_url || row.evolution_url || '',
    _hasPersistedEvolutionUrl: !!(row.url || row.base_url || row.evolution_url),
    dbId: row.id || null
  });
}

function mergeSupabaseWhatsappChipsWithLocalCacheV426(dbChips = []){
  const cachedChips = getWhatsappChipsV29();
  const cachedById = new Map(cachedChips.map(chip => [String(chip.id || chip.instance || ''), chip]));
  const mergedIds = new Set();
  const merged = dbChips.map(chip => {
    const chipId = String(chip.id || chip.instance || '');
    const cached = cachedById.get(chipId) || {};
    const persistedUrl = chip._hasPersistedEvolutionUrl
      ? (chip.url || chip.baseUrl || chip.evolutionUrl || '')
      : '';
    const preservedUrl = persistedUrl || cached.url || cached.baseUrl || cached.evolutionUrl || chip.url || '';
    const next = normalizeWhatsappChipOperationV426({
      ...cached,
      ...chip,
      url:preservedUrl,
      baseUrl:preservedUrl,
      evolutionUrl:preservedUrl
    });
    delete next._hasPersistedEvolutionUrl;
    delete next._syncStatus;
    delete next._syncRevision;
    delete next._syncError;
    mergedIds.add(chipId);
    return next;
  });

  cachedChips.forEach(chip => {
    const chipId = String(chip.id || chip.instance || '');
    if (!chipId || mergedIds.has(chipId)) return;
    merged.push({
      ...chip,
      _syncStatus:'pending',
      _syncError:chip._syncError || 'Aguardando persistencia no Supabase'
    });
  });

  return merged;
}

function mergeWhatsappChipsIntoOperationalState(chips = []){
  if (typeof getChips !== 'function') return;
  const chipsConfig = getChips();
  let changed = false;

  chips.forEach(chip => {
    const instance = String(chip.instance || '').trim();
    if (!instance) return;
    const existing = chipsConfig.find(item => item.id === chip.id || item.instance === instance);
    const mapped = {
      id: existing?.id || chip.id,
      nome: chip.nome || chip.name || existing?.nome || instance,
      url: typeof normalizeChipEvolutionUrlForStorageV437 === 'function'
        ? normalizeChipEvolutionUrlForStorageV437({ ...existing, ...chip }, existing?.url || '')
        : (chip.url || chip.baseUrl || chip.evolutionUrl || existing?.url || ''),
      instance,
      key: chip.key || chip.apiKey || existing?.key || '',
      status: chip.connectionState || existing?.status || 'salvo no banco'
    };
    if (existing) Object.assign(existing, mapped);
    else chipsConfig.push(mapped);
    changed = true;
  });

  if (changed) {
    const normalizedChips = typeof normalizeChipListForStorageV437 === 'function' ? normalizeChipListForStorageV437(chipsConfig) : chipsConfig;
    if (typeof saveOperationalKey === 'function') saveOperationalKey(CHIPS_KEY, normalizedChips, 'chips-supabase-load-cache'); 
  }
}

async function loadWhatsappChipsFromSupabaseV22(){
  if (!isSupabaseChipStoreReadyV22()) {
    console.log('[user-isolation][chip-load]', { allowed:false, reason:'missing authenticated user/email' });
    return [];
  }
  const userId = getCurrentUserIdV22();
  const userEmail = getCurrentUserEmailV24();
  try {
    console.log('[user-isolation][chip-load]', { currentUserId:userId, currentUserEmail:userEmail });
    const { data, error } = await sbClient
      .from('whatsapp_instances')
      .select('*')
      .eq('user_id', userId)
      .eq('user_email', userEmail)
      .order('created_at', { ascending:false });

    if (error) throw error;

    const rows = (Array.isArray(data) ? data : [])
      .filter(isChipAllowedForCurrentUserV24)
      .filter(row => row.active !== false)
      .filter(row => !getDeletedWhatsappChipIdsV47().has(String(row.chip_id || row.id || row.instance || '')));
    const dbChips = rows.map(normalizeChipRowToLocalV22).filter(chip => chip.instance);
    const chips = mergeSupabaseWhatsappChipsWithLocalCacheV426(dbChips);

    storeWhatsappChipsCacheV426(chips);
    mergeWhatsappChipsIntoOperationalState(chips);
    if (typeof renderChipsConfig === 'function') renderChipsConfig();
    if (typeof renderConfiguracoes === 'function') renderConfiguracoes();

    console.log('[chips][db-load]', { userId, userEmail, count:chips.length });
    console.log('[user-isolation][chip-cache]', { key:scopedWhatsappChipsKeyV22(), count:chips.length });
    updateChipsBadge();
    if(chips.some(chip => chip._syncStatus === 'pending')){
      uiSyncLog('optimistic-update', { entity:'chip', action:'restore-pending', count:chips.length });
      saveWhatsappChipsV29(chips);
    }
    return chips;
  } catch (err) {
    console.warn('[chips][db-load-error]', err?.message || err);
    return [];
  }
}

async function persistWhatsappChipsToSupabaseV22(list = []){
  if (!isSupabaseChipStoreReadyV22()) throw new Error('Sessao autenticada indisponivel para salvar chip.');
  const userId = getCurrentUserIdV22();
  const userEmail = getCurrentUserEmailV24();
  const chips = Array.isArray(list) ? list : [];
  try {
    const { data:existingRows, error:selectError } = await sbClient
      .from('whatsapp_instances')
      .select('id,chip_id,user_id,user_email')
      .eq('user_id', userId)
      .eq('user_email', userEmail);
    if (selectError) throw selectError;

    const allowedRows = (existingRows || []).filter(isChipAllowedForCurrentUserV24);
    const existingByChipId = new Map(allowedRows.map(row => [String(row.chip_id || ''), row]));
    const activeIds = new Set(chips.map(chip => String(chip.id || chip.instance || '')).filter(Boolean));

    for (const chip of chips) {
      const chipId = String(chip.id || chip.instance || '').trim();
      if (!chipId) continue;
      const payload = {
        user_id: userId,
        user_email: userEmail,
        chip_id: chipId,
        name: chip.name || chip.instance || 'WhatsApp',
        instance: chip.instance || chip.name || chipId,
        active: chip.status !== 'disabled',
        updated_at: new Date().toISOString()
      };

      const existing = existingByChipId.get(chipId);
      if (existing?.id) {
        const { error } = await sbClient
          .from('whatsapp_instances')
          .update(payload)
          .eq('id', existing.id)
          .eq('user_id', userId)
          .eq('user_email', userEmail);
        if (error) throw error;
      } else {
        const { error } = await sbClient.from('whatsapp_instances').insert(payload);
        if (error) throw error;
      }
    }

    for (const row of allowedRows) {
      const chipId = String(row.chip_id || '');
      if (chipId && !activeIds.has(chipId)) {
        const { error } = await sbClient
          .from('whatsapp_instances')
          .update({ active:false, updated_at:new Date().toISOString() })
          .eq('id', row.id)
          .eq('user_id', userId)
          .eq('user_email', userEmail);
        if (error) console.warn('[chips][db-deactivate-error]', error.message);
      }
    }

    console.log('[chips][db-save]', { userId, userEmail, count:chips.length });
    return { ok:true, count:chips.length };
  } catch (err) {
    console.warn('[chips][db-save-error]', err?.message || err);
    throw err;
  }
}

window.loadWhatsappChipsFromSupabaseV22 = loadWhatsappChipsFromSupabaseV22;
window.persistWhatsappChipsToSupabaseV22 = persistWhatsappChipsToSupabaseV22;

function todayUsageKeyV29(){ return new Date().toISOString().slice(0,10); }

function getWhatsappChipsV29(){
  const chips = (window.__VS_WHATSAPP_CHIPS_CACHE_V49 || []).map(normalizeWhatsappChipOperationV426);
  console.log('[user-isolation][chip-render]', { currentUserId:getCurrentUserIdV22(), currentUserEmail:getCurrentUserEmailV24(), source:'memory', count:chips.length });
  return chips;
}

function storeWhatsappChipsCacheV426(list = []){
  window.__VS_WHATSAPP_CHIPS_CACHE_V49 = (Array.isArray(list) ? list : []).map(normalizeWhatsappChipOperationV426);
}

let whatsappChipsPersistQueueV426 = Promise.resolve();

function enqueueWhatsappChipsPersistV426(task){
  whatsappChipsPersistQueueV426 = whatsappChipsPersistQueueV426.catch(() => {}).then(task);
  return whatsappChipsPersistQueueV426;
}

function updateWhatsappChipsSyncStateV426(revision, status = '', error = ''){
  const current = getWhatsappChipsV29();
  let touched = false;
  const next = current.map(chip => {
    if (chip._syncRevision !== revision) return chip;
    touched = true;
    const updated = { ...chip };
    if (status) updated._syncStatus = status;
    else delete updated._syncStatus;
    if (error) updated._syncError = String(error);
    else delete updated._syncError;
    if (!status) delete updated._syncRevision;
    return updated;
  });
  if (touched) storeWhatsappChipsCacheV426(next);
}

function saveWhatsappChipsV29(list){
  const safeList = Array.isArray(list) ? list : [];
  const revision = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const optimisticList = safeList.map(chip => ({ ...chip, _syncStatus:'saving', _syncRevision:revision }));
  try { scheduleOperationalSync(); } catch(e){}
  if (getCurrentUserIdV22() && getCurrentUserEmailV24()) {
    storeWhatsappChipsCacheV426(optimisticList);
    console.log('[user-isolation][chip-cache]', { currentUserId:getCurrentUserIdV22(), currentUserEmail:getCurrentUserEmailV24(), key:scopedWhatsappChipsKeyV22(), count:optimisticList.length });
    uiSyncLog('optimistic-update', { entity:'chip', action:'save', count:optimisticList.length, revision });
    enqueueWhatsappChipsPersistV426(async () => {
      uiSyncLog('supabase-save-start', { entity:'chip', count:optimisticList.length, revision });
      await persistWhatsappChipsToSupabaseV22(optimisticList);
      updateWhatsappChipsSyncStateV426(revision);
      uiSyncLog('supabase-save-success', { entity:'chip', count:optimisticList.length, revision });
      try { renderChipsPanel(); } catch(e){}
    }).catch(error => {
      updateWhatsappChipsSyncStateV426(revision, 'pending', error?.message || error);
      uiSyncLog('supabase-save-error', { entity:'chip', count:optimisticList.length, revision, error:error?.message || error });
      try { renderChipsPanel(); } catch(e){}
      notify('Chip atualizado na tela. Salvamento no Supabase pendente.', 'warn');
    });
  } else {
    uiSyncLog('supabase-save-error', { entity:'chip', error:'sessao autenticada indisponivel' });
    notify('Aguarde a confirmacao da conta antes de salvar o chip.', 'warn');
  }
  updateChipsBadge();
}

function getChipUsageV29(){
  const usage = window.__VS_CHIP_USAGE_V49 || { day: todayUsageKeyV29(), chips:{} };
  if (usage.day !== todayUsageKeyV29()) return { day: todayUsageKeyV29(), chips:{} };
  return usage;
}

function saveChipUsageV29(usage){
  window.__VS_CHIP_USAGE_V49 = usage || { day: todayUsageKeyV29(), chips:{} };
}

function getChipUsedToday(chipId){
  const usage = getChipUsageV29();
  return Number(usage.chips?.[chipId] || 0);
}

function setChipUsedToday(chipId, count){
  const usage = getChipUsageV29();
  usage.chips = usage.chips || {};
  usage.chips[chipId] = Number(count || 0);
  saveChipUsageV29(usage);
}

function addWhatsappChip(){
  return saveChipWithConnectionTestV406();
}

function removeWhatsappChip(id){
  const deleted = getDeletedWhatsappChipIdsV47();
  deleted.add(String(id));
  const chip = getWhatsappChipsV29().find(c => String(c.id) === String(id));
  if (chip?.instance) deleted.add(String(chip.instance));
  saveDeletedWhatsappChipIdsV47(deleted);
  saveWhatsappChipsV29(getWhatsappChipsV29().filter(chip => String(chip.id) !== String(id) && String(chip.instance) !== String(id)));
  try {
    if (sbClient && currentUser?.id) {
      sbClient.from('whatsapp_instances')
        .update({ active:false, updated_at:new Date().toISOString() })
        .eq('user_id', currentUser.id)
        .or(`chip_id.eq.${id},instance.eq.${chip?.instance || id}`)
        .then(({ error }) => { if (error) console.warn('[chips][remove-persist-error]', error.message); });
    }
  } catch(e) {}
  renderChipsPanel();
}

function toggleChipPause(id){
  const chips = getWhatsappChipsV29();
  const chip = chips.find(c => c.id === id);
  if (!chip) return;
  chip.paused = !chip.paused;
  saveWhatsappChipsV29(chips);
  renderChipsPanel();
}

function toggleChipEnabled(id){
  const chips = getWhatsappChipsV29();
  const chip = chips.find(c => c.id === id);
  if (!chip) return;
  chip.status = chip.status === 'disabled' ? 'active' : 'disabled';
  saveWhatsappChipsV29(chips);
  renderChipsPanel();
}

function resetDailyChipUsage(){
  saveChipUsageV29({ day: todayUsageKeyV29(), chips:{} });
  renderChipsPanel();
  notify('Contadores do dia zerados.');
}

function getAvailableChipsV29(){
  return getWhatsappChipsV29().filter(chip => {
    if (chip.status === 'disabled' || chip.paused) return false;
    return getChipUsedToday(chip.id) < Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426);
  });
}

function assignChipsToReadyQueue(){
  const chips = getAvailableChipsV29();
  if (!chips.length) {
    notify('Nenhum chip disponível.', 'warn');
    return;
  }

  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const ready = queue.filter(item => item.status === 'Pronto' && !item.chipId);

  if (!ready.length) {
    notify('Nenhum lead pronto sem chip.', 'warn');
    return;
  }

  let assigned = 0;
  let chipIndex = 0;

  ready.forEach(item => {
    let tries = 0;
    let selected = null;

    while (tries < chips.length) {
      const chip = chips[chipIndex % chips.length];
      chipIndex++;
      tries++;

      const used = getChipUsedToday(chip.id);
      if (used < Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426)) {
        selected = chip;
        break;
      }
    }

    if (!selected) return;

    item.chipId = selected.id;
    item.chipName = selected.name;
    item.chipInstance = selected.instance;
    item.intervalSeconds = Number(selected.intervalSeconds || WHATSAPP_CHIP_INTERVAL_SECONDS_V426);
    item.blockSize = Number(selected.blockSize || WHATSAPP_CHIP_BLOCK_SIZE_V426);
    item.blocks = selected.blocks || getDefaultWhatsappChipBlocksV426();
    item.updatedAt = new Date().toISOString();

    setChipUsedToday(selected.id, getChipUsedToday(selected.id) + 1);
    assigned++;

    if (item.leadId && typeof addLeadHistory === 'function') {
      addLeadHistory(item.leadId, `Chip atribuído para disparo: ${selected.name}`, findLeadEverywhere(item.leadId) || {});
    }
  });

  saveWhatsappQueueV27(queue);
  renderChipsPanel();
  if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();
  notify(`${assigned} lead(s) receberam chip.`);
}

function renderChipsOperationSummary(){
  const box = document.getElementById('chipsOperationSummary');
  if (!box) return;

  const chips = getWhatsappChipsV29();
  const active = chips.filter(c => c.status !== 'disabled' && !c.paused);
  const totalCapacity = active.reduce((sum, chip) => sum + Math.max(0, Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426) - getChipUsedToday(chip.id)), 0);
  const totalDaily = chips.reduce((sum, chip) => sum + Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426), 0);

  box.innerHTML = `
    Chips cadastrados: ${chips.length}<br>
    Chips ativos: ${active.length}<br>
    Capacidade diária total: ${totalDaily}<br>
    Capacidade restante hoje: ${totalCapacity}<br>
    Padrão recomendado: 120 por chip · 4 blocos de 30 · 120s · espera 1h entre blocos
  `;
}

function renderChipsList(){
  const box = document.getElementById('chipsList');
  if (!box) return;

  const chips = getWhatsappChipsV29();

  if (!chips.length) {
    box.innerHTML = '<div class="queue-v27-empty">// nenhum chip cadastrado ainda</div>';
    return;
  }

  box.innerHTML = chips.map(chip => {
    const used = getChipUsedToday(chip.id);
    const limit = Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426);
    const pct = Math.min(100, Math.round((used / Math.max(limit,1)) * 100));
    const disabled = chip.status === 'disabled';
    const paused = !!chip.paused;
    const stateClass = disabled ? 'disabled' : paused ? 'paused' : '';
    const pill = disabled
      ? '<span class="chip-pill err">desativado</span>'
      : paused
        ? '<span class="chip-pill warn">pausado</span>'
        : '<span class="chip-pill ok">ativo</span>';
    const syncPill = chip._syncStatus === 'saving'
      ? '<span class="chip-pill warn">salvando...</span>'
      : chip._syncStatus === 'pending'
        ? '<span class="chip-pill warn">sync pendente</span>'
        : '';

    return `
      <div class="chip-card ${stateClass}">
        <div class="chip-card-top">
          <div>
            <div class="chip-card-name">${escHtml(chip.name)}</div>
            <div class="chip-card-meta">
              URL: ${escHtml(chip.url || chip.baseUrl || chip.evolutionUrl || 'sem URL')}<br>Instância: ${escHtml(chip.instance)}<br>Estado: ${escHtml(chip.connectionState || 'não testado')}<br>
              Blocos: ${escHtml((chip.blocks || []).join(', '))}<br>
              Intervalo: ${escHtml(String(chip.intervalSeconds || WHATSAPP_CHIP_INTERVAL_SECONDS_V426))}s
            </div>
          </div>
          <div>${pill}${syncPill}</div>
        </div>
        <div class="chip-card-meta">${used} / ${limit} envios hoje</div>
        <div class="chip-progress"><div class="chip-progress-fill" style="width:${pct}%"></div></div>
        <div class="chip-card-actions">
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="toggleChipPause('${escHtml(chip.id)}')">${paused ? 'Retomar' : 'Pausar'}</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="toggleChipEnabled('${escHtml(chip.id)}')">${disabled ? 'Ativar' : 'Desativar'}</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeWhatsappChip('${escHtml(chip.id)}')">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderChipsPanel(){
  renderChipsOperationSummary();
  renderChipsList();
  updateChipsBadge();
}

function updateChipsBadge(){
  const badge = document.getElementById('badge-chips');
  if (badge) badge.textContent = getWhatsappChipsV29().length;
}
