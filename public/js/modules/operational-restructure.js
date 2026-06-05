/* ════════════════════════════════════════════════════════════════════
   V44 — Reestruturação operacional: Backlog como fonte, virada diária,
   preenchimento automático e runtime defensivo.
════════════════════════════════════════════════════════════════════ */
const DAILY_ROLLOVER_KEY_V44 = 'vs_daily_rollover_v44';

function opLogV44(tag, data = {}) {
  try { console.warn(tag, data); } catch(e) {}
}

function getDailyRolloverStateV44() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DAILY_ROLLOVER_KEY_V44) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveDailyRolloverStateV44(state = {}) {
  try { localStorage.setItem(DAILY_ROLLOVER_KEY_V44, JSON.stringify({ ...state, updatedAt:new Date().toISOString() })); } catch(e) {}
  try { scheduleLegacyOperationalSyncV36({ delay:0, reason:'daily-rollover-state-save' }); } catch(e) {}
}

function leadKeyV44(lead = {}) {
  const id = String(lead.id || lead.leadId || '').trim();
  if (id) return `id:${id}`;
  const phone = String(lead.whatsapp || lead.phone || lead.telefone || '').replace(/\D/g, '');
  if (phone) return `phone:${phone}`;
  const insta = String(lead.instagram || lead.instagramUrl || '').trim().toLowerCase();
  if (insta) return `insta:${insta}`;
  return `name:${String(lead.nome || lead.company_name || '').trim().toLowerCase()}`;
}

function isZapLeadSentV44(lead = {}) {
  if (typeof isLeadSentOrClosedV433 === 'function' && isLeadSentOrClosedV433(lead)) return true;
  const st = String(lead.status || lead.whatsappStatus || '').toLowerCase();
  return ['enviada','enviado','sent','respondida','respondido','fechada','fechado','concluído','concluido'].includes(st);
}
function isInstaLeadSentV44(lead = {}) {
  const st = String(lead.status || '').toLowerCase();
  return ['dm enviada','respondeu','não respondeu','nao respondeu','fechou','recusou','enviado','enviada','concluido','concluído'].includes(st);
}

function upsertBacklogListV44(list = [], lead = {}, extra = {}) {
  const arr = Array.isArray(list) ? list : [];
  const key = leadKeyV44(lead);
  const now = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);
  const normalized = {
    ...lead,
    ...extra,
    status: extra.status || lead.status || 'backlog',
    entradaBacklogEm: lead.entradaBacklogEm || extra.entradaBacklogEm || now,
    updatedBacklogAt: new Date().toISOString()
  };
  const idx = arr.findIndex(item => leadKeyV44(item) === key);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...normalized };
  else arr.push(normalized);
  return arr;
}

function dedupeBacklogV44(list = []) {
  const byKey = new Map();
  (Array.isArray(list) ? list : []).forEach(item => {
    if (!item) return;
    const key = leadKeyV44(item);
    if (!byKey.has(key)) byKey.set(key, item);
    else byKey.set(key, { ...byKey.get(key), ...item });
  });
  return [...byKey.values()].sort((a,b) => String(a.entradaBacklogEm || a.criadoEm || '').localeCompare(String(b.entradaBacklogEm || b.criadoEm || '')));
}

function saveZapBacklogDedupV44(list = []) {
  const clean = dedupeBacklogV44(list).filter(lead => !isZapLeadSentV44(lead));
  if (typeof saveZapBacklog === 'function') saveZapBacklog(clean);
  else localStorage.setItem('vin_zap_backlog', JSON.stringify(clean));
  return clean;
}
function saveInstaBacklogDedupV44(list = []) {
  const clean = dedupeBacklogV44(list).filter(lead => !isInstaLeadSentV44(lead));
  if (typeof saveInstaFila === 'function') saveInstaFila(clean);
  else localStorage.setItem(INSTA_KEY, JSON.stringify(clean));
  return clean;
}

function removeLeadFromAllZapQueueSourcesV44(leadId, source = '') {
  if (!leadId) return null;
  let found = null;
  try {
    const data = ensureWeekData();
    Object.keys(data.days || {}).forEach(day => {
      const kept = [];
      (data.days[day] || []).forEach(lead => {
        if (lead?.id === leadId && !isZapLeadSentV44(lead)) {
          found = found || { ...lead, sourceDay:day };
          return;
        }
        kept.push(lead);
      });
      data.days[day] = kept;
    });
    saveWeekData(data);
  } catch(e) {}

  try {
    Object.keys(filaDisparo || {}).forEach(chipId => {
      filaDisparo[chipId] = (filaDisparo[chipId] || []).filter(item => {
        if (item?.id === leadId && item.status !== 'enviado') {
          found = found || { ...item, sourceChipId:chipId };
          const slot = (typeof getChips === 'function' ? getChips() : []).findIndex(chip => chip.id === chipId);
          if (slot >= 0 && typeof removeDispatchItemFromRuntimeV439 === 'function') removeDispatchItemFromRuntimeV439(slot, leadId);
          return false;
        }
        return true;
      });
    });
    if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:'backlog-remove-from-queue' });
  } catch(e) {}

  return found;
}

function moveLeadToWhatsappBacklog(leadId, source = 'manual') {
  opLogV44('[backlog][move-start]', { leadId, source });
  let lead = removeLeadFromAllZapQueueSourcesV44(leadId, source);
  try {
    if (!lead) lead = (getAtribuicaoData() || []).find(item => item.id === leadId) || null;
    if (!lead && typeof findLeadEverywhere === 'function') lead = findLeadEverywhere(leadId) || null;
  } catch(e) {}
  if (!lead) { if (typeof notify === 'function') notify('// lead não encontrado para backlog', 'warn'); return false; }
  if (isZapLeadSentV44(lead)) { if (typeof notify === 'function') notify('// lead enviado não volta para backlog', 'warn'); return false; }

  const backlog = upsertBacklogListV44(getZapBacklog ? getZapBacklog() : [], lead, {
    canal:'zap',
    status:'backlog_whatsapp',
    backlogType:'whatsapp',
    backlogSource:source,
    removedFromQueueAt:new Date().toISOString()
  });
  saveZapBacklogDedupV44(backlog);

  try {
    const atrib = getAtribuicaoData();
    if (atrib.some(item => item.id === leadId)) saveAtribuicaoData(atrib.filter(item => item.id !== leadId));
  } catch(e) {}

  opLogV44('[backlog][saved]', { leadId, source, nextStatus:'backlog_whatsapp' });
  try { renderAtribuicao?.(); renderDisparoEmpresas?.(); renderFilaZap?.(); updateBadges?.(); } catch(e) {}
  if (typeof notify === 'function') notify(`↩ ${lead.nome || 'Lead'} → Backlog WhatsApp`);
  return true;
}

function moveLeadToInstagramBacklogV44(leadId, source = 'manual') {
  let lead = null;
  try {
    const week = getInstaWeek();
    Object.keys(week || {}).forEach(day => {
      const kept = [];
      (week[day] || []).forEach(item => {
        if (item?.id === leadId && !isInstaLeadSentV44(item)) {
          lead = lead || { ...item, sourceDay:day };
          return;
        }
        kept.push(item);
      });
      week[day] = kept;
    });
    saveInstaWeek(week);
  } catch(e) {}
  try {
    if (!lead) lead = (getInstaFila() || []).find(item => item.id === leadId) || null;
  } catch(e) {}
  if (!lead) return false;
  if (isInstaLeadSentV44(lead)) return false;
  const { status, atribuidoEm, dmEnviadaEm, ...base } = lead;
  const list = upsertBacklogListV44(getInstaFila ? getInstaFila() : [], {
    ...base,
    instagram: base.instagram || base.instagramUrl || '',
    canal:'insta'
  }, { status:'backlog_instagram', backlogType:'instagram', backlogSource:source, entradaBacklogEm:lead.entradaBacklogEm || todayStr() });
  saveInstaBacklogDedupV44(list);
  try { renderInstagram?.(); renderAtribInstaFila?.(); updateBadges?.(); } catch(e) {}
  return true;
}

/* Overrides de ações existentes */
(function patchBacklogActionsV44(){
  const originalMandarZap = window.mandarParaBacklogZap;
  window.mandarParaBacklogZap = function(id) { return moveLeadToWhatsappBacklog(id, 'atribuicao-whatsapp'); };
  window.moverParaBacklogZapDoDia = function(id, day) { return moveLeadToWhatsappBacklog(id, `dia-${day || ''}`); };

  const originalInstaVoltar = window.instaVoltarBacklog;
  window.instaVoltarBacklog = function(id, day) {
    const ok = moveLeadToInstagramBacklogV44(id, `dia-${day || ''}`);
    if (!ok && typeof originalInstaVoltar === 'function') return originalInstaVoltar(id, day);
    if (typeof notify === 'function') notify('↩ Lead voltou ao backlog Instagram');
  };

  const originalMandarInsta = window.mandarParaFilaInsta;
  window.mandarParaFilaInsta = function(id) {
    const atrib = getAtribuicaoData();
    const lead = atrib.find(a => a.id === id);
    if (!lead) return;
    const inputEl = document.getElementById(`atrib-insta-input-${id}`);
    if (inputEl) lead.instagram = inputEl.value.trim() || lead.instagram || '';
    const fila = upsertBacklogListV44(getInstaFila(), {
      id:lead.id,
      nome:lead.nome,
      instagram:lead.instagram || '',
      instagramUrl:lead.instagram || '',
      googleUrl:lead.googleUrl || '',
      whatsapp:lead.whatsapp || '',
      status:'backlog_instagram',
      canal:'insta',
      criadoEm:lead.criadoEm || todayStr(),
      entradaBacklogEm:todayStr()
    }, { backlogType:'instagram', backlogSource:'atribuicao-instagram' });
    saveInstaBacklogDedupV44(fila);
    saveAtribuicaoData(atrib.filter(a => a.id !== id));
    try { atribSelecionados.delete(id); } catch(e) {}
    try { renderAtribuicao(); renderAtribInstaFila(); updateBadges(); } catch(e) {}
    try { addLeadHistory(lead.id, 'Movido para Backlog Instagram', lead); } catch(e) {}
    if (typeof notify === 'function') notify(`✓ ${lead.nome} → Backlog Instagram`);
  };
})();

function returnUnsentWhatsappToBacklogV44(source = 'day-rollover') {
  let moved = 0;
  try {
    const data = ensureWeekData();
    let backlog = getZapBacklog();
    Object.keys(data.days || {}).forEach(day => {
      const keep = [];
      (data.days[day] || []).forEach(lead => {
        if (isZapLeadSentV44(lead)) { keep.push(lead); return; }
        backlog = upsertBacklogListV44(backlog, lead, { canal:'zap', status:'backlog_whatsapp', backlogType:'whatsapp', backlogSource:`${source}:${day}` });
        moved++;
      });
      data.days[day] = keep;
    });
    saveWeekData(data);
    saveZapBacklogDedupV44(backlog);
    Object.keys(filaDisparo || {}).forEach(chipId => {
      filaDisparo[chipId] = (filaDisparo[chipId] || []).filter(item => item.status === 'enviado');
    });
    if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:'day-rollover-unsent-to-backlog' });
  } catch(e) { opLogV44('[day-rollover][error]', { scope:'whatsapp', error:e?.message || e }); }
  return moved;
}

function returnUnsentInstagramToBacklogV44(source = 'day-rollover') {
  let moved = 0;
  try {
    const week = getInstaWeek();
    let fila = getInstaFila();
    Object.keys(week || {}).forEach(day => {
      const keep = [];
      (week[day] || []).forEach(lead => {
        if (isInstaLeadSentV44(lead)) { keep.push(lead); return; }
        const { status, atribuidoEm, dmEnviadaEm, ...base } = lead;
        fila = upsertBacklogListV44(fila, { ...base, instagram:base.instagram || base.instagramUrl || '', canal:'insta' }, { status:'backlog_instagram', backlogType:'instagram', backlogSource:`${source}:${day}` });
        moved++;
      });
      week[day] = keep;
    });
    saveInstaWeek(week);
    saveInstaBacklogDedupV44(fila);
  } catch(e) { opLogV44('[day-rollover][error]', { scope:'instagram', error:e?.message || e }); }
  return moved;
}

function distributeCountsBalancedV44(total, slots) {
  const n = Math.max(0, Number(slots || 0));
  if (!n) return [];
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length:n }, (_, i) => base + (i < extra ? 1 : 0));
}


function getWhatsappQueueEntryForLeadV45(leadId, day = todayStr()) {
  if (!leadId) return null;
  const chips = typeof getChips === 'function' ? getChips() : [];
  const data = typeof ensureWeekData === 'function' ? ensureWeekData() : { days:{} };
  const idsNoDia = new Set(((data.days || {})[day] || []).map(item => item.id));
  for (let slot = 0; slot < chips.length; slot++) {
    const chip = chips[slot];
    if (!chip?.id || typeof getFilaChip !== 'function') continue;
    const item = getFilaChip(chip.id).find(q => q?.id === leadId && idsNoDia.has(q.id));
    if (item) return { item, chip, slot };
  }
  return null;
}

function getChipQueuedCountForDayV45(chipId, day = todayStr()) {
  try {
    if (!chipId || typeof getFilaChipNoDia !== 'function') return 0;
    return getFilaChipNoDia(chipId, day).filter(item => item && item.status !== 'enviado').length;
  } catch(e) { return 0; }
}

function getNextChipWithCapacityV45(chips = [], day = todayStr(), preferredChipId = '') {
  const limit = Number(typeof CHIP_LIMIT !== 'undefined' ? CHIP_LIMIT : (typeof WHATSAPP_CHIP_DAILY_LIMIT_V426 !== 'undefined' ? WHATSAPP_CHIP_DAILY_LIMIT_V426 : 180));
  const ordered = [];
  if (preferredChipId) {
    const preferred = chips.find(chip => chip?.id === preferredChipId);
    if (preferred) ordered.push(preferred);
  }
  chips.forEach(chip => { if (chip?.id && !ordered.some(c => c.id === chip.id)) ordered.push(chip); });
  return ordered.find(chip => getChipQueuedCountForDayV45(chip.id, day) < limit) || null;
}

function setLeadQueuedVisualStateV45(lead = {}, chip = {}, queueItem = {}, meta = {}) {
  const nowIso = new Date().toISOString();
  const day = meta.day || (typeof todayStr === 'function' ? todayStr() : '');
  const loteSize = Number(typeof getLoteSize === 'function' ? getLoteSize() : 30) || 30;
  const chipCount = getChipQueuedCountForDayV45(chip.id, day);
  const batchIndex = Math.max(1, Math.ceil(Math.max(1, chipCount) / loteSize));
  const batchId = queueItem.batchId || lead.batchId || `day-${day}-chip-${chip.id}-lote-${batchIndex}`;
  lead.status = 'Em fila';
  lead.queueStatus = queueItem.status || lead.queueStatus || 'aguardando';
  lead.chipId = chip.id;
  lead.assignedChipId = chip.id;
  lead.chipIdDestino = chip.id;
  lead.chipName = chip.nome || chip.name || chip.label || '';
  lead.chipLabel = chip.nome || chip.name || chip.label || '';
  lead.dayAssignedAt = lead.dayAssignedAt || lead.dailyFillAt || nowIso;
  lead.batchId = batchId;
  lead.lote = lead.lote || batchIndex;
  lead.diaDestino = day;
  if (queueItem && typeof queueItem === 'object') {
    queueItem.chipId = chip.id;
    queueItem.assignedChipId = chip.id;
    queueItem.chipName = lead.chipName;
    queueItem.chipLabel = lead.chipLabel;
    queueItem.queueStatus = queueItem.status || 'aguardando';
    queueItem.dayAssignedAt = queueItem.dayAssignedAt || lead.dayAssignedAt;
    queueItem.batchId = batchId;
    queueItem.lote = queueItem.lote || batchIndex;
  }
  return lead;
}

function repairWhatsappDayQueueBindingsV45(day = todayStr(), source = 'repair') {
  let repaired = 0;
  try {
    const chips = (typeof getChips === 'function' ? getChips() : []).filter(chip => chip && chip.active !== false);
    if (!chips.length) return 0;
    const data = ensureWeekData();
    data.days[day] = data.days[day] || [];
    data.days[day].forEach(lead => {
      if (!lead?.id || isZapLeadSentV44(lead)) return;
      const existing = getWhatsappQueueEntryForLeadV45(lead.id, day);
      if (existing?.chip) {
        setLeadQueuedVisualStateV45(lead, existing.chip, existing.item, { day });
        repaired++;
        return;
      }
      const intendedChipId = lead.chipId || lead.assignedChipId || lead.chipIdDestino || '';
      const targetChip = getNextChipWithCapacityV45(chips, day, intendedChipId);
      if (!targetChip) {
        // Sem vaga: este lead permanece como Não enviada, pois ainda não entrou em fila real.
        lead.status = lead.status === 'Em fila' ? 'Não enviada' : (lead.status || 'Não enviada');
        lead.queueStatus = '';
        return;
      }
      const fila = typeof getFilaChip === 'function' ? getFilaChip(targetChip.id) : null;
      if (!Array.isArray(fila)) return;
      const queueItem = typeof createDispatchQueueItemV433 === 'function'
        ? createDispatchQueueItemV433(lead, { status:'aguardando' })
        : { ...lead, status:'aguardando' };
      setLeadQueuedVisualStateV45(lead, targetChip, queueItem, { day });
      if (!fila.some(item => item?.id === lead.id)) fila.push(queueItem);
      repaired++;
    });
    saveWeekData(data);
    if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:`day-queue-binding-repair:${source}` });
    opLogV44('[daily-schedule][queue-binding-repair]', { day, source, repaired });
  } catch(e) { opLogV44('[daily-schedule][queue-binding-repair][error]', { day, source, error:e?.message || e }); }
  return repaired;
}

function getWhatsappVisualStatusCountsV45(day = todayStr()) {
  try {
    const data = ensureWeekData();
    const counts = { 'Não enviada':0, 'Em fila':0, 'Enviada':0, 'Respondida':0, 'Não respondida':0, 'Recusada':0, 'Fechada':0 };
    (data.days?.[day] || []).forEach(lead => {
      const st = lead.status || 'Não enviada';
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  } catch(e) { return {}; }
}

function fillWhatsappTodayFromBacklogV44(source = 'daily-fill') {
  const chips = (typeof getChips === 'function' ? getChips() : []).filter(chip => chip && (chip.active !== false));
  if (!chips.length) return 0;
  const today = todayStr();
  const data = ensureWeekData();
  data.days[today] = data.days[today] || [];
  const existingTodayIds = new Set((data.days[today] || []).map(l => l.id));
  const hasPendingToday = (data.days[today] || []).some(l => !isZapLeadSentV44(l));
  if (hasPendingToday) {
    repairWhatsappDayQueueBindingsV45(today, `${source}:existing-pending`);
    return 0;
  }

  let backlog = dedupeBacklogV44(getZapBacklog()).filter(l => !isZapLeadSentV44(l));
  if (!backlog.length) return 0;
  const capacity = chips.reduce((sum, chip) => sum + Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426 || 180), 0);
  const total = Math.min(capacity, backlog.length);
  const counts = distributeCountsBalancedV44(total, chips.length);
  let cursor = 0;
  let added = 0;

  chips.forEach((chip, idx) => {
    const count = counts[idx] || 0;
    const selected = backlog.slice(cursor, cursor + count);
    cursor += count;
    selected.forEach((lead, order) => {
      if (!lead?.id || existingTodayIds.has(lead.id)) return;
      const dayLead = {
        ...lead,
        status:'Em fila',
        queueStatus:'aguardando',
        diaDestino:today,
        chipId:chip.id,
        chipIdDestino:chip.id,
        assignedChipId:chip.id,
        chipName:chip.nome || chip.name || chip.label || '',
        chipLabel:chip.nome || chip.name || chip.label || '',
        dayAssignedAt:new Date().toISOString(),
        dailyFillAt:new Date().toISOString(),
        dailyFillSource:source
      };
      data.days[today].push(dayLead);
      existingTodayIds.add(lead.id);
      const fila = getFilaChip(chip.id);
      if (!fila.some(item => item.id === lead.id)) {
        const queueItem = createDispatchQueueItemV433(dayLead, {
          status:'aguardando',
          queueStatus:'aguardando',
          chipId:chip.id,
          assignedChipId:chip.id,
          chipName:dayLead.chipName,
          chipLabel:dayLead.chipLabel,
          dayAssignedAt:dayLead.dayAssignedAt,
          dailyFillAt:dayLead.dailyFillAt
        });
        setLeadQueuedVisualStateV45(dayLead, chip, queueItem, { day:today });
        fila.push(queueItem);
      }
      added++;
    });
  });

  const usedIds = new Set(data.days[today].filter(l => l.dailyFillAt).map(l => l.id));
  backlog = backlog.filter(l => !usedIds.has(l.id));
  saveWeekData(data);
  saveZapBacklogDedupV44(backlog);
  if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:'daily-fill-whatsapp' });
  repairWhatsappDayQueueBindingsV45(today, `${source}:post-fill`);
  opLogV44('[day-fill]', { channel:'whatsapp', added, chips:chips.length, counts, statusCounts:getWhatsappVisualStatusCountsV45(today) });
  return added;
}

function fillInstagramTodayFromBacklogV44(source = 'daily-fill') {
  const today = todayStr();
  const week = getInstaWeek();
  week[today] = week[today] || [];
  const hasPendingToday = (week[today] || []).some(l => !isInstaLeadSentV44(l));
  if (hasPendingToday) return 0;
  let backlog = dedupeBacklogV44(getInstaFila()).filter(l => !isInstaLeadSentV44(l) && !!(l.instagram || l.instagramUrl));
  const total = Math.min(Number(typeof INSTA_DIA_LIMIT !== 'undefined' ? INSTA_DIA_LIMIT : 60), backlog.length);
  const selected = backlog.slice(0, total);
  if (!selected.length) return 0;
  const existing = new Set((week[today] || []).map(l => l.id));
  selected.forEach(lead => {
    if (existing.has(lead.id)) return;
    week[today].push({ ...lead, status:'Não contatado', instagramUrl:lead.instagram || lead.instagramUrl || '', atribuidoEm:today, dailyFillAt:new Date().toISOString() });
  });
  const selectedIds = new Set(selected.map(l => l.id));
  backlog = backlog.filter(l => !selectedIds.has(l.id));
  saveInstaWeek(week);
  saveInstaBacklogDedupV44(backlog);
  opLogV44('[day-fill]', { channel:'instagram', added:selected.length });
  return selected.length;
}

function runDailyRolloverAndFillV44({ force = false, reason = 'startup' } = {}) {
  const today = todayStr();
  const state = getDailyRolloverStateV44();
  if (!force && state.lastDailyRollDate === today) {
    opLogV44('[day-rollover]', { skipped:true, reason, today });
    fillWhatsappTodayFromBacklogV44('ensure-not-empty');
    fillInstagramTodayFromBacklogV44('ensure-not-empty');
    return { skipped:true };
  }
  const movedZap = returnUnsentWhatsappToBacklogV44(reason);
  const movedInsta = returnUnsentInstagramToBacklogV44(reason);
  const addedZap = fillWhatsappTodayFromBacklogV44(reason);
  const addedInsta = fillInstagramTodayFromBacklogV44(reason);
  saveDailyRolloverStateV44({ ...state, lastDailyRollDate:today, lastRunAt:new Date().toISOString(), movedZap, movedInsta, addedZap, addedInsta });
  opLogV44('[day-rollover]', { skipped:false, reason, today, movedZap, movedInsta, addedZap, addedInsta });
  try { renderInicio?.(); renderDisparoEmpresas?.(); renderFilaZap?.(); renderInstagram?.(); updateBadges?.(); } catch(e) {}
  return { movedZap, movedInsta, addedZap, addedInsta };
}

function scheduleMidnightRolloverV44() {
  try {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 5, 0);
    const ms = Math.max(1000, next.getTime() - now.getTime());
    setTimeout(() => {
      runDailyRolloverAndFillV44({ reason:'midnight' });
      scheduleMidnightRolloverV44();
    }, ms);
  } catch(e) {}
}

window.moveLeadToWhatsappBacklog = moveLeadToWhatsappBacklog;
window.runDailyRolloverAndFillV44 = runDailyRolloverAndFillV44;
window.fillWhatsappTodayFromBacklogV44 = fillWhatsappTodayFromBacklogV44;
window.fillInstagramTodayFromBacklogV44 = fillInstagramTodayFromBacklogV44;
window.repairWhatsappDayQueueBindingsV45 = repairWhatsappDayQueueBindingsV45;
window.getWhatsappVisualStatusCountsV45 = getWhatsappVisualStatusCountsV45;

setTimeout(() => {
  try {
    runDailyRolloverAndFillV44({ reason:'startup' });
    scheduleMidnightRolloverV44();
  } catch(e) { opLogV44('[day-rollover][error]', { error:e?.message || e }); }
}, 1200);
