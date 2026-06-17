/* ════════════════════════════
   CHIPS V29 — DISTRIBUIÇÃO
════════════════════════════ */
const WHATSAPP_CHIPS_V29_KEY = 'vs_whatsapp_chips_v29';
const CHIP_USAGE_DAY_KEY = 'vs_chip_usage_day_v29';

/* V22 — isolamento multiusuário dos chips
   O localStorage é apenas cache por usuário. A fonte persistente é public.whatsapp_instances. */
const WHATSAPP_CHIPS_DEBUG_V30 = false;
function debugWhatsappChipsV30(){ if (WHATSAPP_CHIPS_DEBUG_V30) console.log.apply(console, arguments); }
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
  // DB-first: o vínculo principal é user_id. user_email é compatibilidade antiga, não trava.
  const allowed = !!(currentUserId && chipUserId === currentUserId);
  debugWhatsappChipsV30('[user-isolation][chip-filter]', { currentUserId, currentUserEmail, chipUserId, chipUserEmail, allowed });
  return allowed;
}

function getDefaultWhatsappChipBlocksV426(){
  return [...WHATSAPP_CHIP_BLOCKS_V426];
}

function normalizeWhatsappChipOperationV426(chip = {}){
  const blocks = Array.isArray(chip.blocks) ? chip.blocks.map(String) : [];
  const hasLegacyDefaultBlocks = blocks.join(',') === '08:00,10:00,12:00,14:00';
  const dailyLimit = Number(chip.dailyLimit || chip.daily_limit || 0);

  return {
    ...chip,
    dailyLimit: !dailyLimit || dailyLimit === 120 ? WHATSAPP_CHIP_DAILY_LIMIT_V426 : dailyLimit,
    intervalSeconds: Number(chip.intervalSeconds || chip.interval_seconds || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
    blockSize: Number(chip.blockSize || chip.block_size || WHATSAPP_CHIP_BLOCK_SIZE_V426),
    blocks: !blocks.length || hasLegacyDefaultBlocks ? getDefaultWhatsappChipBlocksV426() : blocks
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
    key: row.api_key || row.key || row.apikey || row.apiKey || '',
    apiKey: row.api_key || row.key || row.apikey || row.apiKey || '',
    url: row.base_url || row.evolution_url || row.url || 'https://evolution.samuelvinsansi.com.br',
    dbId: row.id || null
  });
}

function mergeSupabaseWhatsappChipsWithLocalCacheV426(dbChips = []){
  // Supabase é a fonte da verdade. Não ressuscitar chips antigos do localStorage,
  // porque isso causava POST duplicado e erro 409 em whatsapp_instances.
  return (Array.isArray(dbChips) ? dbChips : []).map(chip => {
    const next = { ...chip };
    delete next._syncStatus;
    delete next._syncRevision;
    delete next._syncError;
    return next;
  });
}

function mergeWhatsappChipsIntoLegacyCacheV426(chips = []){
  if (typeof getChips !== 'function') return;
  const legacyChips = getChips();
  let changed = false;

  chips.forEach(chip => {
    const instance = String(chip.instance || '').trim();
    if (!instance) return;
    const existing = legacyChips.find(item => item.id === chip.id || item.instance === instance);
    const mapped = {
      id: existing?.id || chip.id,
      nome: chip.nome || chip.name || existing?.nome || instance,
      url: chip.url || chip.baseUrl || chip.evolutionUrl || existing?.url || '',
      instance,
      key: chip.key || chip.apiKey || existing?.key || '',
      status: chip.connectionState || existing?.status || 'salvo no banco'
    };
    if (existing) Object.assign(existing, mapped);
    else legacyChips.push(mapped);
    changed = true;
  });

  if (changed) localStorage.setItem(CHIPS_KEY, JSON.stringify(legacyChips));
}

async function loadWhatsappChipsFromSupabaseV22(){
  if (!isSupabaseChipStoreReadyV22()) {
    debugWhatsappChipsV30('[user-isolation][chip-load]', { allowed:false, reason:'missing authenticated user/email' });
    return [];
  }
  const userId = getCurrentUserIdV22();
  const userEmail = getCurrentUserEmailV24();
  try {
    debugWhatsappChipsV30('[user-isolation][chip-load]', { currentUserId:userId, currentUserEmail:userEmail });
    const { data, error } = await sbClient
      .from('whatsapp_instances')
      .select('*')
      .eq('user_id', userId)
      .order('label', { ascending:true });

    if (error) throw error;

    const rows = (Array.isArray(data) ? data : [])
      .filter(isChipAllowedForCurrentUserV24)
      .filter(row => row.active !== false);
    const dbChips = rows.map(normalizeChipRowToLocalV22).filter(chip => chip.instance);
    const chips = mergeSupabaseWhatsappChipsWithLocalCacheV426(dbChips);

    storeWhatsappChipsCacheV426(chips);
    mergeWhatsappChipsIntoLegacyCacheV426(chips);
    if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
    // Remove caches legados/globais para impedir vazamento entre contas no mesmo navegador.
    localStorage.removeItem(WHATSAPP_CHIPS_V29_KEY);
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`${WHATSAPP_CHIPS_V29_KEY}:`) && key !== scopedWhatsappChipsKeyV22()) {
          localStorage.removeItem(key);
        }
      });
    } catch(e){}

    debugWhatsappChipsV30('[chips][db-load]', { userId, userEmail, count:chips.length });
    debugWhatsappChipsV30('[user-isolation][chip-cache]', { key:scopedWhatsappChipsKeyV22(), count:chips.length });
    updateChipsBadge();
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
      .select('id,chip_id,user_id,user_email,instance,api_key')
      .eq('user_id', userId);
    if (selectError) throw selectError;

    const allowedRows = (existingRows || []).filter(isChipAllowedForCurrentUserV24);
    const existingByChipId = new Map();
    allowedRows.forEach(row => {
      const chipKey = String(row.chip_id || row.instance || '').trim();
      const instKey = String(row.instance || '').trim();
      if (chipKey) existingByChipId.set(chipKey, row);
      if (instKey) existingByChipId.set(instKey, row);
    });
    const activeIds = new Set(chips.map(chip => String(chip.id || chip.instance || '')).filter(Boolean));

    for (const chip of chips) {
      const chipId = String(chip.id || chip.instance || '').trim();
      if (!chipId) continue;
      const instance = String(chip.instance || chip.name || chipId).trim();
      const apiKey = String(chip.key || chip.apiKey || chip.api_key || '').trim();
      const payload = {
        user_id: userId,
        user_email: userEmail,
        chip_id: chipId,
        label: chip.label || chip.name || instance,
        name: chip.name || chip.label || instance || 'WhatsApp',
        instance,
        base_url: chip.base_url || chip.baseUrl || chip.evolution_url || chip.evolutionUrl || chip.url || 'https://evolution.samuelvinsansi.com.br',
        evolution_url: chip.evolution_url || chip.evolutionUrl || chip.base_url || chip.baseUrl || chip.url || 'https://evolution.samuelvinsansi.com.br',
        url: chip.url || chip.base_url || chip.baseUrl || chip.evolution_url || chip.evolutionUrl || 'https://evolution.samuelvinsansi.com.br',
        api_key: apiKey,
        status: chip.connectionState || chip.status || 'saved',
        connection_state: chip.connectionState || chip.status || 'saved',
        active: chip.status !== 'disabled',
        daily_limit: Number(chip.dailyLimit || chip.daily_limit || WHATSAPP_CHIP_DAILY_LIMIT_V426),
        block_size: Number(chip.blockSize || chip.block_size || WHATSAPP_CHIP_BLOCK_SIZE_V426),
        interval_seconds: Number(chip.intervalSeconds || chip.interval_seconds || WHATSAPP_CHIP_INTERVAL_SECONDS_V426),
        blocks: chip.blocks || getDefaultWhatsappChipBlocksV426(),
        updated_at: new Date().toISOString()
      };
      if (!payload.instance) continue;

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
        const { error } = await sbClient
          .from('whatsapp_instances')
          .upsert(payload, { onConflict:'user_id,instance' });
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

    debugWhatsappChipsV30('[chips][db-save]', { userId, userEmail, count:chips.length });
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
  try {
    if (!getCurrentUserIdV22() || !getCurrentUserEmailV24()) return [];
    const key = scopedWhatsappChipsKeyV22();
    const data = JSON.parse(localStorage.getItem(key) || '[]');
    const chips = (Array.isArray(data) ? data : []).map(normalizeWhatsappChipOperationV426);
    if (JSON.stringify(chips) !== JSON.stringify(data)) localStorage.setItem(key, JSON.stringify(chips));
    debugWhatsappChipsV30('[user-isolation][chip-render]', { currentUserId:getCurrentUserIdV22(), currentUserEmail:getCurrentUserEmailV24(), source:'cache', key, count:chips.length });
    return chips;
  } catch { return []; }
}

function storeWhatsappChipsCacheV426(list = []){
  const chips = (Array.isArray(list) ? list : []).map(normalizeWhatsappChipOperationV426);
  localStorage.setItem(scopedWhatsappChipsKeyV22(), JSON.stringify(chips));
  localStorage.removeItem(WHATSAPP_CHIPS_V29_KEY);
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
  try { scheduleOperationalSyncV36(); } catch(e){}
  if (getCurrentUserIdV22() && getCurrentUserEmailV24()) {
    storeWhatsappChipsCacheV426(optimisticList);
    debugWhatsappChipsV30('[user-isolation][chip-cache]', { currentUserId:getCurrentUserIdV22(), currentUserEmail:getCurrentUserEmailV24(), key:scopedWhatsappChipsKeyV22(), count:optimisticList.length });
    uiSyncLogV426('optimistic-update', { entity:'chip', action:'save', count:optimisticList.length, revision });
    enqueueWhatsappChipsPersistV426(async () => {
      uiSyncLogV426('supabase-save-start', { entity:'chip', count:optimisticList.length, revision });
      await persistWhatsappChipsToSupabaseV22(optimisticList);
      updateWhatsappChipsSyncStateV426(revision);
      uiSyncLogV426('supabase-save-success', { entity:'chip', count:optimisticList.length, revision });
      try { renderChipsPanel(); } catch(e){}
    }).catch(error => {
      updateWhatsappChipsSyncStateV426(revision, 'pending', error?.message || error);
      uiSyncLogV426('supabase-save-error', { entity:'chip', count:optimisticList.length, revision, error:error?.message || error });
      try { renderChipsPanel(); } catch(e){}
      notify('Chip atualizado na tela. Salvamento no Supabase pendente.', 'warn');
    });
  } else {
    uiSyncLogV426('supabase-save-error', { entity:'chip', error:'sessao autenticada indisponivel' });
    notify('Aguarde a confirmacao da conta antes de salvar o chip.', 'warn');
  }
  updateChipsBadge();
}

function getChipUsageV29(){
  try {
    if (!getCurrentUserIdV22() || !getCurrentUserEmailV24()) return { day: todayUsageKeyV29(), chips:{} };
    const usage = JSON.parse(localStorage.getItem(scopedChipUsageKeyV22()) || '{}');
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return { day: todayUsageKeyV29(), chips:{} };
    if (usage.day !== todayUsageKeyV29()) return { day: todayUsageKeyV29(), chips:{} };
    return usage;
  } catch { return { day: todayUsageKeyV29(), chips:{} }; }
}

function saveChipUsageV29(usage){
  if (!getCurrentUserIdV22() || !getCurrentUserEmailV24()) return;
  localStorage.setItem(scopedChipUsageKeyV22(), JSON.stringify(usage));
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
  saveWhatsappChipsV29(getWhatsappChipsV29().filter(chip => chip.id !== id));
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
          <button type="button" class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="event.preventDefault();event.stopPropagation();removeWhatsappChip('${escHtml(chip.id)}');return false;">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderChipsPanel(){
  const cached = getWhatsappChipsV29();
  if (!cached.length && typeof loadWhatsappChipsFromSupabaseV22 === 'function' && isSupabaseChipStoreReadyV22()) {
    loadWhatsappChipsFromSupabaseV22().then(() => {
      renderChipsOperationSummary();
      renderChipsList();
      updateChipsBadge();
    }).catch(()=>{});
  }
  renderChipsOperationSummary();
  renderChipsList();
  updateChipsBadge();
}

function updateChipsBadge(){
  const badge = document.getElementById('badge-chips');
  if (badge) badge.textContent = getWhatsappChipsV29().length;
}
