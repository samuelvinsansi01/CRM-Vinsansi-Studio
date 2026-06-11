
const DISPATCH_PERSIST_DEBUG_V413 = false;
function debugDispatchPersistV413(step, data = {}) {
  if (!DISPATCH_PERSIST_DEBUG_V413) return;
  try {
    console.groupCollapsed(`[dispatch][persist] ${step}`);
    console.log(data);
    console.groupEnd();
  } catch (e) {
    console.log(`[dispatch][persist] ${step}`, data);
  }
}
/* ─── Per-chip state (indexed 0 = Chip1, 1 = Chip2) ─── */
const chipSlotState = [
  { filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false },
  { filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false }
];

/* Limite diario = 120 por chip. */
function getDailyLimit() { return Math.max(1, getChips().length) * WHATSAPP_CHIP_DAILY_LIMIT_V426; }

/* ─── Helpers por slot ─── */
function getChipBySlot(slot) { return getChips()[slot] || null; }

function getChipDispatchRuntimeMapV432() {
  return (typeof v48StateGetObject === 'function') ? v48StateGetObject(CHIP_DISPATCH_RUNTIME_KEY_V432) : {};
}

function saveChipDispatchRuntimeV432(chipId, runtime = null) {
  if (!chipId) return;
  const map = getChipDispatchRuntimeMapV432();
  if (runtime) {
    map[chipId] = { ...runtime, updatedAt:new Date().toISOString() };
  } else {
    delete map[chipId];
  }
  if (typeof v48StateSet === 'function') v48StateSet(CHIP_DISPATCH_RUNTIME_KEY_V432, map, 'dispatch-runtime-save');
  debugDispatchPersistV413('runtime-save', { chipId, runtime:map[chipId] || null });
}

function getChipDispatchReloadLockV432(chipId) {
  const runtime = getChipDispatchRuntimeMapV432()[chipId];
  if (!runtime) return null;
  const waitUntil = Number(runtime.waitUntil || 0);
  if (waitUntil > Date.now()) return runtime;
  if (runtime.state === 'sending') return runtime;
  saveChipDispatchRuntimeV432(chipId, null);
  return null;
}

function getChipDispatchRuntimeAgeMsV434(runtime = {}) {
  const updatedAt = Date.parse(runtime.updatedAt || '');
  return Number.isFinite(updatedAt) ? Date.now() - updatedAt : Infinity;
}

function hydrateChipSlotStateFromRuntimeV439(slot, chip) {
  if (!chip) return null;
  const runtime = getChipDispatchRuntimeMapV432()[chip.id] || null;
  if (!runtime) return null;
  const st = chipSlotState[slot];
  if (!st) return runtime;
  const waitUntil = Number(runtime.waitUntil || 0);

  if (runtime.state === 'waiting-lot' && waitUntil > Date.now()) {
    st.disparoEmAndamento = false;
    st.aguardandoLote = true;
    st.loteAtual = Number(runtime.loteAtual || st.loteAtual || 0);
    st.lotesTotal = Number(runtime.lotesTotal || st.lotesTotal || 0);
    st.loteEsperaFim = waitUntil;
    st.pausado = false;
    st.runtimeWarning = '';
    return runtime;
  }

  if (runtime.state === 'sending' || runtime.state === 'waiting-message') {
    st.runtimeWarning = 'sending-uncertain';
    st.disparoEmAndamento = false;
    st.aguardandoLote = false;
    st.loteAtual = Number(runtime.loteAtual || st.loteAtual || 0);
    st.lotesTotal = Number(runtime.lotesTotal || st.lotesTotal || 0);
    return runtime;
  }

  return runtime;
}

function recoverStaleChipDispatchRuntimeV434(slot, chip, runtime) {
  if (!chip || !runtime || runtime.state !== 'sending') return false;
  const st = chipSlotState[slot] || {};
  if (st.disparoEmAndamento) return false;

  const filaHoje = getFilaChip(chip.id);
  const sendingItems = filaHoje.filter(item => item.status === 'enviando');
  const runtimeItem = runtime.itemId ? filaHoje.find(item => item.id === runtime.itemId) : null;
  const ageMs = getChipDispatchRuntimeAgeMsV434(runtime);

  const noActiveItem = sendingItems.length === 0;
  const runtimeItemSettled = runtimeItem && ['aguardando', 'enviado', 'erro'].includes(runtimeItem.status);
  const runtimeItemMissing = runtime.itemId && !runtimeItem;
  const staleStartupLock = !runtime.itemId && noActiveItem;

  if (staleStartupLock || (noActiveItem && (runtimeItemSettled || runtimeItemMissing))) {
    saveChipDispatchRuntimeV432(chip.id, null);
    notify(`// Chip ${slot + 1}: estado antigo limpo. Pode disparar novamente.`, 'warn');
    return true;
  }

  if (sendingItems.length && ageMs > 2 * 60 * 1000) {
    sendingItems.forEach(item => { item.status = 'erro'; });
    saveFilaDisparo({ delay:0, reason:'dispatch-chip-stale-sending-recovered' });
    saveChipDispatchRuntimeV432(chip.id, null);
    renderFilaSlot(slot, disparoDay);
    notify(`// Chip ${slot + 1}: envio antigo marcado como erro para liberar a fila.`, 'warn');
    return true;
  }

  return false;
}

function recoverStaleSendingItemsV434(slot, chip, maxAgeMs = 2 * 60 * 1000) {
  if (!chip) return 0;
  const runtime = getChipDispatchRuntimeMapV432()[chip.id] || null;
  const ageMs = runtime ? getChipDispatchRuntimeAgeMsV434(runtime) : Infinity;
  if (ageMs < maxAgeMs) return 0;

  const filaHoje = getFilaChip(chip.id);
  const staleItems = filaHoje.filter(item => item.status === 'enviando');
  if (!staleItems.length) return 0;

  staleItems.forEach(item => { item.status = 'erro'; });
  saveFilaDisparo({ delay:0, reason:'dispatch-chip-stale-sending-preflight-recovered' });
  saveChipDispatchRuntimeV432(chip.id, null);
  renderFilaSlot(slot, disparoDay);
  notify(`// Chip ${slot + 1}: envio antigo marcado como erro para liberar a fila.`, 'warn');
  return staleItems.length;
}

function blockChipDispatchReloadLockV432(slot, chip) {
  const runtime = getChipDispatchReloadLockV432(chip.id);
  if (!runtime) return false;
  if (runtime.state === 'sending') {
    const st = chipSlotState[slot] || {};
    const activeSendingItems = getFilaChip(chip.id).filter(item => item.status === 'enviando');
    if (!st.disparoEmAndamento && activeSendingItems.length === 0) {
      saveChipDispatchRuntimeV432(chip.id, null);
      notify(`// Chip ${slot + 1}: trava antiga removida. Disparo liberado.`, 'warn');
      return false;
    }
  }
  if (recoverStaleChipDispatchRuntimeV434(slot, chip, runtime)) return false;
  if (runtime.state === 'sending') {
    notify(`// Chip ${slot + 1}: envio interrompido em estado incerto. Confira a fila antes de reenviar.`, 'err');
    return true;
  }
  const remainingMinutes = Math.max(1, Math.ceil((Number(runtime.waitUntil) - Date.now()) / 60000));
  notify(`// Chip ${slot + 1}: aguarde ${remainingMinutes}min antes de retomar o disparo.`, 'warn');
  return true;
}

function toggleFilaItemSlot(slot, id) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.aberto = !item.aberto;
  renderFilaSlot(slot, disparoDay);
}

function atualizarMsgFilaSlot(slot, id, val, field = 'mensagem') {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  if (item) {
    item[field === 'mensagem2' ? 'mensagem2' : 'mensagem'] = val;
    saveFilaDisparo();
  }
}

function removerFilaSlot(slot, id) {
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const item = fila.find(f => f.id === id);
  abrirModalConfirm(
    `Remover <strong>${item ? escHtml(item.nome) : 'esta empresa'}</strong> da fila?`,
    () => {
      const f2 = getFilaChip(chip.id).filter(f => f.id !== id);
      filaDisparo[chip.id] = f2;
      removeDispatchItemFromRuntimeV439(slot, id);
      if (!f2.length) saveChipDispatchRuntimeV432(chip.id, null);
      const data = ensureWeekData();
      Object.keys(data.days).forEach(day => {
        const emp = (data.days[day]||[]).find(e => e.id === id);
        if (emp && emp.status === 'Em fila') { if (typeof clearChipLinkFromDayLeadV48 === 'function') clearChipLinkFromDayLeadV48(emp); else emp.status = 'Não enviada'; }
      });
      saveWeekData(data); saveFilaDisparo({ delay:0, reason:'dispatch-chip-assignment-remove' }); updateBadges();
      renderDisparoEmpresas(); renderFilaSlot(slot, disparoDay);
    }
  );
}

function limparFilaChip(slot) {
  const st = chipSlotState[slot];
  if (st.disparoEmAndamento || st.aguardandoLote) { notify('// disparo em andamento','warn'); return; }
  const chip = getChipBySlot(slot); if (!chip) return;
  const fila = getFilaChip(chip.id);
  const data = ensureWeekData();
  fila.forEach(f => {
    Object.keys(data.days).forEach(day => {
      const emp = (data.days[day]||[]).find(e => e.id === f.id);
      if (emp && emp.status === 'Em fila') { if (typeof clearChipLinkFromDayLeadV48 === 'function') clearChipLinkFromDayLeadV48(emp); else emp.status = 'Não enviada'; }
    });
  });
  saveWeekData(data);
  filaDisparo[chip.id] = [];
  st.loteHistorico = [];
  st.retryItems = [];
  st.retryDisparado = false;
  st.ultimoLoteFimTs = null;
  saveChipDispatchRuntimeV432(chip.id, null);
  saveFilaDisparo({ delay:0, reason:'dispatch-chip-queue-clear' });
  updateBadges(); renderDisparoEmpresas(); renderFilaSlot(slot, disparoDay);
}

function normalizeDispatchPhoneV432(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('55') ? digits : '55' + digits;
}

function getLiveDispatchItemV439(chipId, id) {
  if (!chipId || !id) return null;
  return getFilaChip(chipId).find(item => item?.id === id) || null;
}

function removeDispatchItemFromRuntimeV439(slot, id) {
  const st = chipSlotState[slot];
  if (!st || !id) return;
  st.filaLotes = (st.filaLotes || [])
    .map(lote => (lote || []).filter(item => item?.id !== id))
    .filter(lote => lote.length);
  st.retryItems = (st.retryItems || []).filter(item => item?.id !== id);
}

function isDispatchItemRemovedV439(chipId, item = {}) {
  return !!(item?.id && !getLiveDispatchItemV439(chipId, item.id));
}

function shouldSkipDispatchItemV439(chipId, item = {}) {
  const live = getLiveDispatchItemV439(chipId, item?.id);
  if (!live) return { skip:true, reason:'removed', item:null };
  if (live.status === 'enviado' || isDispatchItemFullyDeliveredV438(live)) {
    return { skip:true, reason:'already-sent', item:live };
  }
  return { skip:false, reason:'active', item:live };
}

function assertDispatchItemStillQueuedV439(chipId, item = {}, phase = '') {
  const live = getLiveDispatchItemV439(chipId, item?.id);
  if (!live) {
    const err = new Error(`Lead removido da fila antes de ${phase || 'continuar envio'}.`);
    err.code = 'DISPATCH_ITEM_REMOVED';
    throw err;
  }
  return live;
}


async function updateDispatchCheckpointV635(item = {}, patch = {}) {
  try {
    if (typeof isTemporaryDispatchLeadV433 === 'function' && isTemporaryDispatchLeadV433(item)) {
      return { ok:false, skipped:true, reason:'temporary-dispatch-lead' };
    }
    const queueId = String(item.queueItemId || item.todayRowId || item.queue_item_id || '').trim();
    const leadId = String(item.leadId || item.id || '').trim();
    const userId = typeof getCurrentSupabaseUserIdV412 === 'function'
      ? await getCurrentSupabaseUserIdV412()
      : (typeof getCurrentUserId === 'function' ? await getCurrentUserId() : (window.currentUser?.id || ''));
    if (!userId || !sbClient) return { ok:false, skipped:true, reason:'no-supabase-client' };

    const payload = { ...patch, updated_at: new Date().toISOString(), last_checkpoint_at: new Date().toISOString() };
    let query = sbClient.from('queue_items').update(payload).eq('user_id', userId);
    if (queueId) query = query.eq('id', queueId);
    else if (leadId) query = query.eq('lead_id', leadId).eq('scheduled_for', todayStr()).eq('channel', 'whatsapp');
    else return { ok:false, skipped:true, reason:'no-id' };

    const { error } = await query;
    if (error) {
      console.warn('[dispatch-checkpoint][queue_items]', error.message || error, payload);
      return { ok:false, error };
    }
    return { ok:true };
  } catch (error) {
    console.warn('[dispatch-checkpoint][queue_items]', error?.message || error);
    return { ok:false, error };
  }
}

async function persistOutgoingWhatsappMediaV635({ chip = {}, item = {}, phone = '', loteNum = null, response = null } = {}) {
  try {
    if (typeof persistOutgoingWhatsappMessageV412 !== 'function') return { ok:false, skipped:true };
    const leadId = (typeof isTemporaryDispatchLeadV433 === 'function' && isTemporaryDispatchLeadV433(item))
      ? ''
      : (item.leadId || item.id || '');
    const externalId = typeof getEvolutionWhatsappExternalIdV412 === 'function'
      ? getEvolutionWhatsappExternalIdV412(response, item.id)
      : '';
    return await persistOutgoingWhatsappMessageV412({
      id: externalId || `out_media_${item.id || 'lead'}_${Date.now()}`,
      leadId,
      instance: chip.instance,
      phone,
      text: `[imagem do lote ${loteNum || ''}]`,
      occurredAt: new Date().toISOString(),
      response: { ...(response || {}), message_type:'image', loteNum }
    }, { queueOnFailure:true });
  } catch (error) {
    console.warn('[whatsapp_messages] imagem enviada pendente:', error?.message || error);
    return { ok:false, pending:true, error };
  }
}


async function protectLeadAfterDispatchV639(item = {}, chip = {}, phone = '', meta = {}) {
  try {
    const client = (typeof sbClient !== 'undefined' && sbClient?.rpc)
      ? sbClient
      : (window.supabaseClient?.rpc ? window.supabaseClient : (window.crmSupabase?.rpc ? window.crmSupabase : null));
    const userId = typeof getCurrentSupabaseUserIdV412 === 'function'
      ? await getCurrentSupabaseUserIdV412()
      : (typeof getCurrentUserId === 'function' ? await getCurrentUserId() : (window.currentUser?.id || ''));
    if (!client?.rpc || !userId) return { ok:false, skipped:true, reason:'no-client-or-user' };

    const normalizedPhone = normalizeDispatchPhoneV432(phone || item.normalized_phone || item.whatsapp || item.phone || item.telefone || '');
    const companyName = item.company_name || item.nome || item.empresa || item.name || '';
    const temporaryLead = typeof isTemporaryDispatchLeadV433 === 'function' && isTemporaryDispatchLeadV433(item);
    const payload = {
      block_type:'already_sent',
      list_type:'already_sent',
      lead_id:temporaryLead ? null : (item.leadId || item.lead_id || item.id || null),
      company_name:companyName,
      contact_name:companyName,
      phone:item.phone || item.whatsapp || item.telefone || normalizedPhone,
      normalized_phone:normalizedPhone,
      instagram_url:item.instagram_url || item.instagram || '',
      instagram_username:item.instagram_username || '',
      website:item.website || item.site || '',
      reason:'disparo_realizado',
      note:`Inserido automaticamente após disparo concluído${chip?.instance ? ` pela instância ${chip.instance}` : ''}.`,
      source:'dispatch_auto',
      chip_id:chip?.id || '',
      instance:chip?.instance || '',
      sent_at:new Date().toISOString(),
      ...meta
    };

    const { data, error } = await client.rpc('rpc_lead_block_upsert', {
      p_user_id:userId,
      p_entry:payload
    });
    if (error) throw error;

    try {
      if (Array.isArray(window.contactSuppressionEntriesV629)) {
        window.contactSuppressionEntriesV629.unshift({
          ...payload,
          id:data?.id || `auto_${payload.lead_id || normalizedPhone}_${Date.now()}`,
          active:true,
          created_at:new Date().toISOString(),
          block_type:'already_sent',
          list_type:'already_sent'
        });
      }
    } catch (_) {}
    return { ok:true, data };
  } catch (error) {
    console.warn('[dispatch-protection] falha ao proteger lead enviado:', error?.message || error, { item, phone });
    return { ok:false, error };
  }
}

function getEvolutionUrlReachabilityErrorV435(chip) {
  const baseUrl = typeof getEvolutionBaseUrl === 'function' ? getEvolutionBaseUrl(chip) : String(chip?.url || '').replace(/\/+$/, '');
  if (!baseUrl) return 'Evolution URL ausente. Configure a URL publica HTTPS no chip.';
  if (typeof isLoopbackEvolutionBaseUrlV436 === 'function' && !isLocalPanelHostV436() && isLoopbackEvolutionBaseUrlV436(baseUrl)) {
    return `Chip configurado com ${baseUrl}. No painel publicado, localhost/127.0.0.1 nao e acessivel. Use uma URL publica HTTPS da Evolution (VPS, dominio, ngrok ou Cloudflare Tunnel).`;
  }
  return '';
}

function getWhatsappPartLogPayloadV436({ chip = {}, item = {}, phone = '', baseUrl = '', part = '', hasImage = false } = {}) {
  return {
    leadId: item.leadId || item.id || '',
    phone,
    instance: chip.instance || '',
    baseUrl,
    part,
    hasMessage1: !!String(item.mensagem || '').trim(),
    hasMessage2: !!String(item.mensagem2 || '').trim(),
    hasImage: !!hasImage
  };
}

async function sendWhatsappTextPartV436({ chip, item, phone, text, part, baseUrl, hasImage }) {
  const payload = getWhatsappPartLogPayloadV436({ chip, item, phone, baseUrl, part, hasImage });
  whatsappSendLogV436(`${part}-start`, payload);
  const sendLock = typeof acquireWhatsappSendLockV31 === 'function'
    ? acquireWhatsappSendLockV31({
        leadId:item.leadId || item.id || '',
        phone,
        text:text || '',
        content:text || '',
        instance:chip.instance,
        part
      }, 30000)
    : { ok:true, key:'' };
  if (!sendLock.ok) throw new Error('Envio duplicado bloqueado por seguranca.');

  try {
    const res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(chip.instance)}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:chip.key },
      body: JSON.stringify({ number:phone, options:{ delay:1000 }, textMessage:{ text:String(text || '') } })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = (data && (data.message || data.error)) || `sendText HTTP ${res.status}`;
      whatsappSendLogV436(`${part}-error`, { ...payload, status:res.status, error });
      throw new Error(error);
    }
    whatsappSendLogV436(`${part}-success`, { ...payload, status:res.status });
    return data;
  } catch (error) {
    whatsappSendLogV436(`${part}-error`, { ...payload, error:error?.message || error });
    throw error;
  } finally {
    if (typeof releaseWhatsappSendLockV31 === 'function') releaseWhatsappSendLockV31(sendLock.key);
  }
}

async function sendWhatsappImagePartV436({ chip, item, phone, imageBase64, loteNum, baseUrl }) {
  const payload = getWhatsappPartLogPayloadV436({ chip, item, phone, baseUrl, part:'image', hasImage:!!imageBase64 });
  whatsappSendLogV436('image-start', payload);
  const b64 = String(imageBase64 || '').split(',')[1];
  const mimetype = String(imageBase64 || '').split(';')[0].split(':')[1] || 'image/jpeg';
  if (!b64) {
    const error = 'Imagem do lote invalida';
    whatsappSendLogV436('image-error', { ...payload, error });
    throw new Error(error);
  }

  const sendLock = typeof acquireWhatsappSendLockV31 === 'function'
    ? acquireWhatsappSendLockV31({
        leadId:item.leadId || item.id || '',
        phone,
        content:b64.slice(0, 500),
        instance:chip.instance,
        part:'image'
      }, 30000)
    : { ok:true, key:'' };
  if (!sendLock.ok) throw new Error('Envio duplicado bloqueado por seguranca.');

  try {
    const res = await fetch(`${baseUrl}/message/sendMedia/${encodeURIComponent(chip.instance)}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:chip.key },
      body: JSON.stringify({
        number:phone,
        options:{ delay:1000 },
        mediaMessage:{ mediatype:'image', media:b64, mimetype, fileName:`lote-${loteNum}.jpg`, caption:'' }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = (data && (data.message || data.error)) || `sendMedia HTTP ${res.status}`;
      whatsappSendLogV436('image-error', { ...payload, status:res.status, error });
      throw new Error(error);
    }
    whatsappSendLogV436('image-success', { ...payload, status:res.status });
    return data;
  } catch (error) {
    whatsappSendLogV436('image-error', { ...payload, error:error?.message || error });
    throw error;
  } finally {
    if (typeof releaseWhatsappSendLockV31 === 'function') releaseWhatsappSendLockV31(sendLock.key);
  }
}

function getDuplicateDispatchItemsV432() {
  const today = todayStr();
  const byLead = new Map();
  const byPhone = new Map();

  getChips().forEach((chip, slot) => {
    getFilaChipNoDia(chip.id, today)
      .filter(item => item.status === 'aguardando')
      .forEach(item => {
        const leadKey = String(item.id || '').trim();
        const phoneKey = normalizeDispatchPhoneV432(item.whatsapp);
        if (leadKey) {
          if (!byLead.has(leadKey)) byLead.set(leadKey, []);
          byLead.get(leadKey).push(slot);
        }
        if (phoneKey) {
          if (!byPhone.has(phoneKey)) byPhone.set(phoneKey, []);
          byPhone.get(phoneKey).push({ id:item.id, slot });
        }
      });
  });

  return {
    leadIds: [...byLead.entries()].filter(([, slots]) => slots.length > 1).map(([id]) => id),
    phones: [...byPhone.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([phone]) => phone)
  };
}

async function validateDispatchPreflightV432(slot, items = []) {
  const chip = getChipBySlot(slot);
  const baseUrl = typeof getEvolutionBaseUrl === 'function' ? getEvolutionBaseUrl(chip) : String(chip?.url || '').replace(/\/+$/, '');
  if (!chip) return { ok:false, error:`Chip ${slot + 1} não configurado` };

  const missing = [];
  if (!baseUrl) missing.push('URL');
  if (!String(chip.instance || '').trim()) missing.push('instância');
  if (!String(chip.key || '').trim()) missing.push('API key');
  if (missing.length) {
    const error = `Chip ${slot + 1} incompleto: ${missing.join(', ')}`;
    debugDispatchPersistV413('preflight-error', { slot, error });
    notify(`// ${error}`, 'err');
    return { ok:false, error };
  }

  const unreachableUrlError = getEvolutionUrlReachabilityErrorV435(chip);
  if (unreachableUrlError) {
    debugDispatchPersistV413('preflight-error', { slot, error:unreachableUrlError, baseUrl });
    notify(`// ${unreachableUrlError}`, 'err');
    return { ok:false, error:unreachableUrlError };
  }
  try { assertEvolutionBaseUrlV436(baseUrl); } catch(error) {
    notify(`// ${error.message}`, 'err');
    return { ok:false, error:error.message };
  }
  whatsappSendLogV436('base-url', {
    leadId:'',
    phone:'',
    instance:chip.instance,
    baseUrl,
    part:'preflight',
    hasMessage1:items.some(item => !!String(item.mensagem || '').trim()),
    hasMessage2:items.some(item => !!String(item.mensagem2 || '').trim()),
    hasImage:false
  });

  recoverStaleSendingItemsV434(slot, chip);
  const uncertain = getFilaChipNoDia(chip.id, todayStr()).filter(item => item.status === 'enviando');
  if (uncertain.length) {
    const error = `${uncertain.length} envio(s) em estado incerto. Confira antes de reenviar.`;
    debugDispatchPersistV413('preflight-error', { slot, error, ids:uncertain.map(item => item.id) });
    notify(`// ${error}`, 'err');
    return { ok:false, error };
  }

  const withoutMessage = items.filter(item =>
    (!item.textSent && !String(item.mensagem || '').trim()) ||
    (!item.text2Sent && !String(item.mensagem2 || '').trim())
  );
  if (withoutMessage.length) {
    const error = `${withoutMessage.length} lead(s) sem mensagem. Selecione o ramo do lote antes de disparar.`;
    debugDispatchPersistV413('preflight-error', { slot, error, ids:withoutMessage.map(item => item.id) });
    notify(`// ${error}`, 'err');
    return { ok:false, error };
  }

  const invalidPhones = items.filter(item => {
    const phone = normalizeDispatchPhoneV432(item.whatsapp);
    return phone.length < 12 || phone.length > 13;
  });
  if (invalidPhones.length) {
    const error = `${invalidPhones.length} lead(s) com telefone inválido.`;
    debugDispatchPersistV413('preflight-error', { slot, error, ids:invalidPhones.map(item => item.id) });
    notify(`// ${error}`, 'err');
    return { ok:false, error };
  }

  const duplicates = getDuplicateDispatchItemsV432();
  if (duplicates.leadIds.length || duplicates.phones.length) {
    const error = `Duplicidade na fila: ${duplicates.leadIds.length} lead(s) e ${duplicates.phones.length} telefone(s).`;
    debugDispatchPersistV413('preflight-error', { slot, error, duplicates });
    notify(`// ${error}`, 'err');
    return { ok:false, error };
  }

  const endpoint = `${baseUrl}/instance/connectionState/${encodeURIComponent(chip.instance)}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), 8000);

  try {
    const response = await fetch(endpoint, { method:'GET', headers:{ apikey:chip.key }, signal:controller?.signal });
    const data = await response.json().catch(() => ({}));
    const state = String(data?.instance?.state || data?.state || '').toLowerCase();
    if (!response.ok || !['open', 'connected'].includes(state)) {
      const error = `Chip ${slot + 1} não conectado (${state || `HTTP ${response.status}`}).`;
      debugDispatchPersistV413('preflight-error', { slot, error, endpoint, status:response.status, state });
      notify(`// ${error}`, 'err');
      return { ok:false, error };
    }
    debugDispatchPersistV413('preflight-success', { slot, chipId:chip.id, state, count:items.length });
    return { ok:true, state };
  } catch (err) {
    const error = `Falha ao confirmar conexão do Chip ${slot + 1}: ${err?.message || err}`;
    debugDispatchPersistV413('preflight-error', { slot, error, endpoint });
    notify(`// ${error}`, 'err');
    return { ok:false, error };
  } finally {
    clearTimeout(timeout);
  }
}

/* ─── Iniciar disparo por slot ─── */

function dispatchDateToISOV697(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) return raw.slice(0, 10);
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function isTemporaryQueueItemForTodayV697(item = {}) {
  if (!(item.isTestLead || item.testDispatchLead || item.isTemporaryDispatchLead || item.temporaryLead)) return false;
  const todayISO = typeof localDateISO === 'function'
    ? localDateISO()
    : new Date().toISOString().slice(0, 10);
  const itemISO = dispatchDateToISOV697(item.scheduledFor || item.scheduled_for || item.created_at || todayISO);
  return !itemISO || itemISO === todayISO;
}

function getDirectTemporaryFilaForChipV697(chip = {}) {
  try {
    const ids = [chip.id, chip.chip_id, chip.instance, chip.name, chip.nome, chip.label]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const seen = new Set();
    const rows = [];
    ids.forEach((id) => {
      const list = (typeof filaDisparo !== 'undefined' && filaDisparo && Array.isArray(filaDisparo[id])) ? filaDisparo[id] : [];
      list.forEach((item) => {
        const key = String(item.id || item.leadId || item.phone || item.whatsapp || '');
        if (!key || seen.has(key)) return;
        if (String(item.status || '').toLowerCase() === 'enviado') return;
        if (!isTemporaryQueueItemForTodayV697(item)) return;
        seen.add(key);
        rows.push({
          ...item,
          status: item.status === 'enviado' ? item.status : 'aguardando',
          numStatus: item.numStatus || 'valido',
          whatsappValidationStatus: item.whatsappValidationStatus || 'valid',
          whatsapp_status: item.whatsapp_status || 'valid',
          isTemporaryDispatchLead: true,
          temporaryLead: true
        });
      });
    });
    return rows;
  } catch (error) {
    console.warn('[dispatch-direct-temp-v697] erro:', error);
    return [];
  }
}

async function iniciarDisparoChip(slot) {
  const devolvidos = devolverZapNaoValidadoParaValidacao();
  if (devolvidos) {
    notify(`↩ ${devolvidos} lead(s) sem WhatsApp validado voltaram para Validação`, 'warn');
    renderFilaZap();
    return;
  }
  const st = chipSlotState[slot];
  if (st.disparoEmAndamento || st.aguardandoLote || st.preflightEmAndamento) {
    try { console.warn('[whatsapp-send-blocked]', { reason:'chip-lot-already-starting', slot }); } catch(e) {}
    return;
  }
  st.preflightEmAndamento = true;
  try { console.log('[whatsapp-send]', { action:'chip-lot-lock-start', slot }); } catch(e) {}
  try {
  const chip = getChipBySlot(slot);
  if (!chip) { notify('// chip ' + (slot+1) + ' não configurado','err'); return; }
  if (blockChipDispatchReloadLockV432(slot, chip)) return;
  let fila = getFilaChipNoDia(chip.id, todayStr()).filter(f => f.status !== 'enviado');
  if (!fila.length && typeof window.bridgeTestRowsToLegacyQueueV692 === 'function') {
    try {
      window.bridgeTestRowsToLegacyQueueV692(slot, chip);
      fila = getFilaChipNoDia(chip.id, todayStr()).filter(f => f.status !== 'enviado');
    } catch (error) {
      console.warn('[test-dispatch-bridge-v692] fallback falhou:', error);
    }
  }
  if (!fila.length) {
    const directTempFila = getDirectTemporaryFilaForChipV697(chip);
    if (directTempFila.length) {
      fila = directTempFila;
      try {
        console.warn('[dispatch-direct-temp-v697]', {
          slot,
          chipId: chip.id,
          chipInstance: chip.instance,
          rows: fila.length,
          ids: fila.map((item) => item.id).slice(0, 10)
        });
      } catch (_) {}
    }
  }

  if (!fila.length) {
    try {
      console.warn('[dispatch-empty-v697]', {
        slot,
        chipId: chip.id,
        chipInstance: chip.instance,
        day: todayStr(),
        todayISO: typeof localDateISO === 'function' ? localDateISO() : '',
        filaKeys: Object.keys(typeof filaDisparo !== 'undefined' ? (filaDisparo || {}) : {}),
        chipFilaTotal: (typeof getFilaChip === 'function' ? getFilaChip(chip.id) : []).length,
        directTempTotal: getDirectTemporaryFilaForChipV697(chip).length,
        dayIds: ((typeof ensureWeekData === 'function' ? ensureWeekData() : {}).days?.[todayStr()] || []).map(x => x.id).slice(0, 10)
      });
    } catch (_) {}
    notify('// fila vazia','warn'); return;
  }

  // Congela o lote — snapshot dos itens aguardando
  const LOTE_SIZE = getLoteSize();
  let filaCompleta = getFilaChipNoDia(chip.id, todayStr());

  if (!filaCompleta.length && Array.isArray(fila) && fila.length) {
    filaCompleta = fila;
  }

  let pendentes = filaCompleta.filter(f => f.status === 'aguardando');

  // 6.98: Lead Teste/temporário pode chegar do fallback direto com status do rebuild.
  // Para teste, qualquer item não enviado/concluído deve virar aguardando.
  if (!pendentes.length) {
    const directTempPendentes = (Array.isArray(filaCompleta) ? filaCompleta : [])
      .filter((item) => item?.isTestLead || item?.testDispatchLead || item?.isTemporaryDispatchLead || item?.temporaryLead)
      .filter((item) => !['enviado','sent','completed','batch_completed'].includes(String(item.status || item.statusRaw || '').toLowerCase()))
      .map((item) => ({
        ...item,
        status: 'aguardando',
        numStatus: item.numStatus || 'valido',
        whatsappValidationStatus: item.whatsappValidationStatus || 'valid',
        whatsapp_status: item.whatsapp_status || 'valid'
      }));

    if (directTempPendentes.length) {
      pendentes = directTempPendentes;
      try {
        console.warn('[dispatch-pendentes-temp-v698]', {
          slot,
          chipId: chip.id,
          rows: pendentes.length,
          ids: pendentes.map((item) => item.id).slice(0, 10)
        });
      } catch (_) {}
    }
  }

  if (!pendentes.length) { notify('// nenhum item aguardando — todos já enviados','warn'); return; }

  try {
    console.warn('[dispatch-pendentes-v700]', {
      slot,
      chipId: chip.id,
      total: pendentes.length,
      items: pendentes.map((item) => ({
        id: item.id,
        nome: item.nome,
        status: item.status,
        phone: item.whatsapp || item.phone || item.normalized_phone || item.telefone || '',
        hasMsg1: !!String(item.mensagem || item.template_part1 || '').trim(),
        hasMsg2: !!String(item.mensagem2 || item.template_part2 || '').trim(),
        isTestLead: !!(item.isTestLead || item.testDispatchLead || item.isTemporaryDispatchLead || item.temporaryLead)
      }))
    });
  } catch (_) {}

  const preflight = await validateDispatchPreflightV432(slot, pendentes);
  if (!preflight.ok) {
    try { console.warn('[dispatch-preflight-fail-v700]', { slot, chipId: chip.id, preflight }); } catch (_) {}
    return;
  }
  pendentes.forEach((item, index) => {
    item.mediaLoteNum = Math.floor(index / LOTE_SIZE) + 1;
  });
  saveFilaDisparo({ delay:0, reason:'dispatch-chip-preflight-ready' });

  // ── Validação: todos os lotes com pendentes devem ter imagem ──
  // Itera apenas sobre itens aguardando, que é como os lotes são
  // numerados visualmente e como as imagens são salvas pelo usuário
  const lotesComPendentes = [];
  for (let i = 0; i < pendentes.length; i += LOTE_SIZE) {
    const loteNum = Math.floor(i / LOTE_SIZE) + 1;
    lotesComPendentes.push(loteNum);
  }

  // Garante que o cache está populado para cada lote antes de validar
  await Promise.all(lotesComPendentes.map(async loteNum => {
    const k = getLoteImgKey(chip.id, loteNum);
    if (_imgCache[k] === undefined) {
      try { _imgCache[k] = (await idbGet(k)) || null; } catch { _imgCache[k] = null; }
    }
  }));

  const lotesSemImagem = lotesComPendentes.filter(n => !getLoteImagem(chip.id, n));
  if (lotesSemImagem.length) {
    try {
      console.warn('[dispatch-missing-image-v700]', {
        slot,
        chipId: chip.id,
        chipInstance: chip.instance,
        lotesSemImagem,
        lotesComPendentes,
        imgKeys: lotesComPendentes.map(n => typeof getLoteImgKey === 'function' ? getLoteImgKey(chip.id, n) : `${chip.id}:${n}`)
      });
    } catch (_) {}
    notify(`// Lote${lotesSemImagem.length>1?'s':''} ${lotesSemImagem.join(', ')} sem imagem — insira a imagem antes de disparar`, 'err');
    return;
  }

  st.filaLotes = [];
  st.loteAtual = 0;
  st.loteHistorico = st.loteHistorico || [];
  for (let i = 0; i < pendentes.length; i += LOTE_SIZE) {
    st.filaLotes.push(pendentes.slice(i, i + LOTE_SIZE));
  }
  st.lotesTotal = st.filaLotes.length;
  const logEl = document.getElementById(`disparoLog${slot}`);
  if (logEl) { logEl.innerHTML = ''; logEl.style.display = 'block'; }
  await dispararLoteChip(slot);
  } finally {
    st.preflightEmAndamento = false;
    try { console.log('[whatsapp-send]', { action:'chip-lot-lock-release', slot }); } catch(e) {}
  }
}

/* ─── Disparo de um lote por slot ─── */
async function dispararLoteChip(slot) {
  const st = chipSlotState[slot];
  const chip = getChipBySlot(slot);
  if (!chip) return;
  const baseUrl = assertEvolutionBaseUrlV436(getEvolutionBaseUrl(chip));
  st.loteAtual++;
  const lote = st.filaLotes.shift();
  const esperaMin = Math.max(60, parseInt(document.getElementById('loteEsperaMin')?.value)||60);
  const delayMin  = parseInt(document.getElementById('delayMin')?.value)||120;
  const delayMax  = parseInt(document.getElementById('delayMax')?.value)||120;
  const MSG_DELAY = 6000;
  const chipCor   = slot === 0 ? 'var(--accent)' : '#5bb8f5';

  st.disparoEmAndamento = true;
  saveChipDispatchRuntimeV432(chip.id, {
    state:'sending',
    slot,
    loteAtual:st.loteAtual,
    lotesTotal:st.lotesTotal
  });
  const btnEl  = document.getElementById(`btnDisparar${slot}`);
  const spinEl = document.getElementById(`spinner${slot}`);
  const btnTxt = document.getElementById(`disparoBtn${slot}`);
  if (btnEl)  btnEl.disabled = true;
  if (spinEl) spinEl.style.display = 'block';
  if (btnTxt) btnTxt.textContent = `Lote ${st.loteAtual}/${st.lotesTotal}...`;
  _atualizarBotaoPausa(slot);

  const logEl = document.getElementById(`disparoLog${slot}`);
  if (logEl) logEl.style.display = 'block';
  function log(msg) {
    if (!logEl) return;
    const l = document.createElement('div');
    l.style.marginBottom = '3px';
    l.innerHTML = `<span style="color:var(--muted)">[${timeStr()}]</span> ${msg}`;
    logEl.appendChild(l); logEl.scrollTop = logEl.scrollHeight;
  }
  log(`<span style="color:${chipCor}">━━ LOTE ${st.loteAtual}/${st.lotesTotal} · ${lote.length} empresa${lote.length>1?'s':''} ━━</span>`);

  // Atualiza status visual de cada item do lote
  const loteSnapshot = lote.map(i => ({ ...i }));

  for (let i = 0; i < lote.length; i++) {
    let item = lote[i];
    const initialState = shouldSkipDispatchItemV439(chip.id, item);
    if (initialState.skip) {
      if (initialState.reason === 'already-sent' && initialState.item) {
        initialState.item.status = 'enviado';
        atualizarStatusEmpresa(initialState.item.id, 'Enviada', { phone:initialState.item.whatsapp || initialState.item.phone || '' });
      }
      log(`<span style="color:var(--muted)">↷ ${escHtml(item.nome || 'Lead')} ignorado (${initialState.reason === 'removed' ? 'removido da fila' : 'ja enviado'})</span>`);
      continue;
    }
    item = initialState.item;

    // ── Verificar pausa ──
    if (st.pausado) {
      log(`<span style="color:var(--warning)">⏸ Pausado após ${i} envio${i!==1?'s':''} — aguardando retomada...</span>`);
      const btnTxtP = document.getElementById(`disparoBtn${slot}`);
      if (btnTxtP) btnTxtP.textContent = `⏸ Pausado (${i}/${lote.length})`;
      await updateDispatchCheckpointV635(item, { dispatch_status:'paused', paused_at:new Date().toISOString(), current_part:'paused' });
      while (st.pausado) {
        await new Promise(r => setTimeout(r, 500));
      }
      log(`<span style="color:var(--ok)">▶ Retomado</span>`);
      await updateDispatchCheckpointV635(item, { dispatch_status:'sending', current_part:'resumed' });
      if (btnTxtP) btnTxtP.textContent = `Lote ${st.loteAtual}/${st.lotesTotal}...`;
    }

    const resumedState = shouldSkipDispatchItemV439(chip.id, item);
    if (resumedState.skip) {
      log(`<span style="color:var(--muted)">↷ ${escHtml(item.nome || 'Lead')} ignorado apos pausa (${resumedState.reason === 'removed' ? 'removido da fila' : 'ja enviado'})</span>`);
      continue;
    }
    item = resumedState.item;

    item.status = 'enviando';
    await updateDispatchCheckpointV635(item, {
      dispatch_status:'sending',
      dispatch_started_at: item.dispatchStartedAt || new Date().toISOString(),
      current_part:'start',
      error_message:null
    });
    item.dispatchStartedAt = item.dispatchStartedAt || new Date().toISOString();
    saveChipDispatchRuntimeV432(chip.id, {
      state:'sending',
      slot,
      loteAtual:st.loteAtual,
      lotesTotal:st.lotesTotal,
      itemId:item.id
    });
    saveFilaDisparo({ delay:0, reason:'dispatch-chip-item-sending' });
    atualizarStatusFilaSlot(slot, item.id, 'enviando');
    log(`Enviando para <span style="color:var(--text)">${escHtml(item.nome)}</span>...`);
    try {
      const rawPhoneV699 = item.whatsapp || item.phone || item.normalized_phone || item.telefone || item.wa_phone || '';
      const waNum = String(rawPhoneV699 || '').replace(/\D/g,'');
      if (!waNum) {
        try {
          console.warn('[dispatch-item-phone-empty-v699]', {
            itemId: item.id,
            leadId: item.leadId,
            nome: item.nome,
            keys: Object.keys(item || {}),
            item
          });
        } catch (_) {}
        throw new Error('Lead sem WhatsApp/telefone para envio.');
      }
      const numero = waNum.startsWith('55') ? waNum : '55' + waNum;
      item.whatsapp = numero;
      item.phone = numero;
      item.telefone = numero;
      item.normalized_phone = numero;
      try {
        console.warn('[dispatch-item-phone-v699]', {
          itemId: item.id,
          leadId: item.leadId,
          nome: item.nome,
          phone: numero,
          chipId: chip.id,
          instance: chip.instance
        });
      } catch (_) {}
      if (!item.mediaLoteNum) item.mediaLoteNum = st.loteAtual;

      // MSG 1 — Apresentação
      item = assertDispatchItemStillQueuedV439(chip.id, item, 'mensagem 1');
      if (!item.textSent) {
        const data1 = await sendWhatsappTextPartV436({
          chip,
          item,
          phone:numero,
          text:item.mensagem,
          part:'part-1',
          baseUrl,
          hasImage:!!getLoteImagem(chip.id, item.mediaLoteNum || st.loteAtual)
        });
        item.textSent = true;
        item.text1SentAt = new Date().toISOString();
        await updateDispatchCheckpointV635(item, {
          dispatch_status:'sending',
          current_part:'part-2',
          text1_sent_at:item.text1SentAt,
          template_part1:item.mensagem || ''
        });
        saveFilaDisparo({ delay:0, reason:'dispatch-chip-text-sent' });
        log(`  ① apresentação enviada`);

        // Persistir o envio inicial no histórico de conversas somente após sucesso na Evolution.
        debugDispatchPersistV413('persist-function-check', { file: 'chip-slots.js', available: typeof persistOutgoingWhatsappMessageV412 === 'function' });
        if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
          const persistence = await persistOutgoingWhatsappMessageV412({
            id: typeof getEvolutionWhatsappExternalIdV412 === 'function'
              ? getEvolutionWhatsappExternalIdV412(data1, item.id)
              : '',
            leadId: item.leadId || item.id || '',
            instance: chip.instance,
            phone: numero,
            text: item.mensagem || '',
            occurredAt: new Date().toISOString(),
            response: data1
          }, { queueOnFailure: true }).catch(error => {
            uiSyncLog('supabase-save-error', { entity:'message', leadId:item.leadId || item.id || '', part:'part-1', error:error?.message || error });
            return { ok:false, pending:true, error };
          });
          if (persistence?.ok) log(`  ↳ conversa salva no banco`);
          else log(`  ↳ <span style="color:var(--warning)">conversa pendente de sincronização</span>`);
        }
        await new Promise(r => setTimeout(r, MSG_DELAY));
      } else {
        log(`  ① apresentação já enviada — retomando imagem pendente`);
      }

      // MSG 2 — Imagem do lote
      item = assertDispatchItemStillQueuedV439(chip.id, item, 'mensagem 2');
      if (!item.text2Sent) {
        const data2 = await sendWhatsappTextPartV436({
          chip,
          item,
          phone:numero,
          text:item.mensagem2,
          part:'part-2',
          baseUrl,
          hasImage:!!getLoteImagem(chip.id, item.mediaLoteNum || st.loteAtual)
        });
        item.text2Sent = true;
        item.text2SentAt = new Date().toISOString();
        await updateDispatchCheckpointV635(item, {
          dispatch_status:'sending',
          current_part:'media',
          text2_sent_at:item.text2SentAt,
          template_part2:item.mensagem2 || ''
        });
        saveFilaDisparo({ delay:0, reason:'dispatch-chip-text2-sent' });
        log(`  complemento enviado`);

        if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
          const persistence2 = await persistOutgoingWhatsappMessageV412({
            id: typeof getEvolutionWhatsappExternalIdV412 === 'function'
              ? getEvolutionWhatsappExternalIdV412(data2, item.id)
              : '',
            leadId: item.leadId || item.id || '',
            instance: chip.instance,
            phone: numero,
            text: item.mensagem2 || '',
            occurredAt: new Date().toISOString(),
            response: data2
          }, { queueOnFailure: true }).catch(error => {
            uiSyncLog('supabase-save-error', { entity:'message', leadId:item.leadId || item.id || '', part:'part-2', error:error?.message || error });
            return { ok:false, pending:true, error };
          });
          if (persistence2?.ok) log(`  complemento salvo no banco`);
          else log(`  <span style="color:var(--warning)">complemento pendente de sincronizacao</span>`);
        }
        await new Promise(r => setTimeout(r, MSG_DELAY));
      } else {
        log(`  complemento ja enviado - retomando imagem pendente`);
      }

      item = assertDispatchItemStillQueuedV439(chip.id, item, 'imagem');
      const loteNum = item.mediaLoteNum || st.loteAtual;
      const imgRedesign = getLoteImagem(chip.id, loteNum);
      if (!imgRedesign && !item.mediaSent) throw new Error(`Imagem do lote ${loteNum} indisponível`);
      if (imgRedesign && !item.mediaSent) {
        const b2 = imgRedesign.split(',')[1], m2 = imgRedesign.split(';')[0].split(':')[1] || 'image/jpeg';
        if (!b2) throw new Error('Imagem do lote inválida');
        const payload3 = { number: numero, options: { delay: 1000 }, mediaMessage: { mediatype: 'image', media: b2, mimetype: m2, fileName: `lote-${loteNum}.jpg`, caption: '' } };
        debugDispatchPersistV413('evolution-media-start', { file:'chip-slots.js', chipId:chip.id, loteNum, itemId:item.id, mimetype:m2 });
        const imageLock = typeof acquireWhatsappSendLockV31 === 'function'
          ? acquireWhatsappSendLockV31({ leadId:item.leadId || item.id || '', phone:numero, content:b2.slice(0, 500), instance:chip.instance, part:'image' }, 30000)
          : { ok:true, key:'' };
        if (!imageLock.ok) throw new Error('Envio duplicado bloqueado por seguranca.');
        whatsappSendLogV436('image-start', getWhatsappPartLogPayloadV436({ chip, item, phone:numero, baseUrl, part:'image', hasImage:true }));
        let res3;
        try {
          res3 = await fetch(`${baseUrl}/message/sendMedia/${encodeURIComponent(chip.instance)}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload3) });
        } catch (error) {
          whatsappSendLogV436('image-error', { ...getWhatsappPartLogPayloadV436({ chip, item, phone:numero, baseUrl, part:'image', hasImage:true }), error:error?.message || error });
          if (typeof releaseWhatsappSendLockV31 === 'function') releaseWhatsappSendLockV31(imageLock.key);
          throw error;
        }
        const data3 = await res3.json().catch(() => ({}));
        if (!res3.ok) {
          debugDispatchPersistV413('evolution-media-error', { file:'chip-slots.js', chipId:chip.id, loteNum, itemId:item.id, status:res3.status, response:data3 });
          const imageError = (data3 && (data3.message || data3.error)) || `sendMedia HTTP ${res3.status}`;
          whatsappSendLogV436('image-error', { ...getWhatsappPartLogPayloadV436({ chip, item, phone:numero, baseUrl, part:'image', hasImage:true }), status:res3.status, error:imageError });
          if (typeof releaseWhatsappSendLockV31 === 'function') releaseWhatsappSendLockV31(imageLock.key);
          throw new Error(imageError);
        }
        item.mediaSent = true;
        item.mediaSentAt = new Date().toISOString();
        await persistOutgoingWhatsappMediaV635({ chip, item, phone:numero, loteNum, response:data3 });
        await updateDispatchCheckpointV635(item, {
          dispatch_status:'sending',
          current_part:'complete',
          media_sent_at:item.mediaSentAt
        });
        saveFilaDisparo({ delay:0, reason:'dispatch-chip-media-sent' });
        whatsappSendLogV436('image-success', { ...getWhatsappPartLogPayloadV436({ chip, item, phone:numero, baseUrl, part:'image', hasImage:true }), status:res3.status });
        if (typeof releaseWhatsappSendLockV31 === 'function') releaseWhatsappSendLockV31(imageLock.key);
        debugDispatchPersistV413('evolution-media-success', { file:'chip-slots.js', chipId:chip.id, loteNum, itemId:item.id });
        log(`  ② imagem enviada`);
      }

      item.status = 'enviado';
      item.completedAt = new Date().toISOString();
      await updateDispatchCheckpointV635(item, {
        dispatch_status:'completed',
        status:'sent',
        current_part:'complete',
        completed_at:item.completedAt,
        error_message:null
      });
      if (typeof markLeadAsDispatchedEverV47 === 'function') markLeadAsDispatchedEverV47(item, { source:'dispatch-success', chipId:chip.id || chip.instance || '', instance:chip.instance || '' });
      const protectionResultV639 = await protectLeadAfterDispatchV639(item, chip, numero, { status:'sent', source_reason:'dispatch-success' });
      if (protectionResultV639?.ok) log(`  ↳ protegido em Já Enviados`);
      else log(`  ↳ <span style="color:var(--warning)">proteção pendente: confira aba Proteção</span>`);
      atualizarStatusFilaSlot(slot, item.id, 'enviado');
      try {
        atualizarStatusEmpresa(item.id, 'Enviada', { phone:numero, sentAt:new Date().toISOString() });
      } catch(statusError) {
        console.warn('[whatsapp-send][status-update-error]', { itemId:item.id, error:statusError?.message || statusError });
      }
      whatsappSendLogV436('lead-complete', getWhatsappPartLogPayloadV436({ chip, item, phone:numero, baseUrl, part:'complete', hasImage:!!imgRedesign }));
      log(`<span style="color:${chipCor}">✓ ${escHtml(item.nome)}</span>`);
    } catch(e) {
      if (e?.code === 'DISPATCH_ITEM_REMOVED') {
        log(`<span style="color:var(--muted)">↷ ${escHtml(item.nome || 'Lead')} interrompido porque foi removido da fila</span>`);
        continue;
      }
      if (isDispatchItemFullyDeliveredV438(item)) {
        item.status = 'enviado';
        if (typeof markLeadAsDispatchedEverV47 === 'function') markLeadAsDispatchedEverV47(item, { source:'dispatch-repair' });
        await protectLeadAfterDispatchV639(item, chip, normalizeDispatchPhoneV432(item.whatsapp || item.phone || ''), { status:'sent', source_reason:'dispatch-repair' });
        saveFilaDisparo({ delay:0, reason:'dispatch-chip-delivered-after-error-repair' });
        atualizarStatusFilaSlot(slot, item.id, 'enviado');
        atualizarStatusEmpresa(item.id, 'Enviada', { phone:item.whatsapp || item.phone || '', sentAt:new Date().toISOString() });
        whatsappSendLogV436('lead-complete', getWhatsappPartLogPayloadV436({ chip, item, phone:normalizeDispatchPhoneV432(item.whatsapp), baseUrl, part:'complete-repaired', hasImage:true }));
        log(`<span style="color:${chipCor}">✓ ${escHtml(item.nome)} entregue e reparado</span>`);
        continue;
      }
      try { console.warn('[whatsapp-send]', { action:'error', slot, itemId:item.id, error:e?.message || e }); } catch(logError) {}
      whatsappSendLogV436('lead-error', { ...getWhatsappPartLogPayloadV436({ chip, item, phone:normalizeDispatchPhoneV432(item.whatsapp), baseUrl, part:'lead', hasImage:false }), error:e?.message || e });
      item.status = 'erro';
      await updateDispatchCheckpointV635(item, {
        dispatch_status:'error',
        status:'error',
        current_part:'error',
        error_message:e?.message || String(e || 'Erro no envio')
      });
      saveFilaDisparo({ delay:0, reason:'dispatch-chip-item-error' });
      atualizarStatusFilaSlot(slot, item.id, 'erro');
      log(`<span style="color:var(--error)">✗ Erro — ${e.message}</span>`);
      notify(`Erro no envio para ${item.nome}: ${e.message}`, 'err');
    }
    if (i < lote.length - 1) {
      const delay = (delayMin + Math.random()*(delayMax-delayMin))*1000;
      saveChipDispatchRuntimeV432(chip.id, {
        state:'waiting-message',
        slot,
        loteAtual:st.loteAtual,
        lotesTotal:st.lotesTotal,
        waitUntil:Date.now() + delay
      });
      log(`Aguardando ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Finalizar lote: mover enviados para histórico compacto, manter erros na fila
  const env   = lote.filter(f => f.status === 'enviado').length;
  const erros = lote.filter(f => f.status === 'erro').length;
  log(`<span style="color:${chipCor}">✓ Lote ${st.loteAtual} concluído! ${env} enviado${env>1?'s':''} · ${erros} erro${erros>1?'s':''}</span>`);

  // Adiciona lote ao histórico
  st.loteHistorico.push({
    num: st.loteAtual,
    total: st.lotesTotal,
    items: lote.map(f => ({ id: f.id, nome: f.nome, whatsapp: f.whatsapp, status: f.status })),
    env, erros,
    fimTs: Date.now()
  });

  // Remove enviados da fila ativa (mantém erros para retry)
  const enviados = lote.filter(f => f.status === 'enviado').map(f => f.id);
  if (enviados.length) {
    filaDisparo[chip.id] = filaDisparo[chip.id].filter(f => !enviados.includes(f.id));
    saveFilaDisparo({ delay:0, reason:'dispatch-chip-sent-items-remove' });
  }

  st.ultimoLoteFimTs = Date.now();
  st.disparoEmAndamento = false;
  if (spinEl) spinEl.style.display = 'none';
  renderFilaSlot(slot, disparoDay);
  renderInicio();

  if (st.filaLotes.length > 0) {
    // Ainda tem lotes — aguardar delay
    const esperaMs = esperaMin * 60 * 1000;
    st.loteEsperaFim = Date.now() + esperaMs;
    st.aguardandoLote = true;
    saveChipDispatchRuntimeV432(chip.id, {
      state:'waiting-lot',
      slot,
      loteAtual:st.loteAtual,
      lotesTotal:st.lotesTotal,
      waitUntil:st.loteEsperaFim
    });
    if (btnEl)  btnEl.disabled = true;
    if (btnTxt) btnTxt.textContent = `🟡 Aguardando lote ${st.loteAtual+1}/${st.lotesTotal}`;
    const panel = document.getElementById(`loteEsperaPanel${slot}`);
    if (panel) panel.style.display = 'block';
    const titleEl = document.getElementById(`loteEsperaTitle${slot}`);
    if (titleEl) titleEl.textContent = `⏱ Aguardando lote ${st.loteAtual+1}/${st.lotesTotal}...`;
    const proxBtn = document.getElementById(`btnProximoLote${slot}`);
    if (proxBtn) { proxBtn.disabled = true; proxBtn.style.background = 'var(--surface3)'; }
    const barEl = document.getElementById(`loteProgressBar${slot}`);
    if (barEl) barEl.style.width = '0%';
    notify(`✓ Lote ${st.loteAtual} concluído · próximo em ${esperaMin}min`);
    iniciarCountdownLoteChip(slot, esperaMs);
    _atualizarBotaoPausa(slot);
  } else {
    // Todos os lotes concluídos
    st.aguardandoLote = false;
    st.pausado = false;
    saveChipDispatchRuntimeV432(chip.id, null);
    if (btnEl)  btnEl.disabled = false;
    if (btnTxt) btnTxt.textContent = slot === 0 ? '🟢 Disparar' : '🔵 Disparar';
    _atualizarBotaoPausa(slot);

    // Coletar erros para retry
    const erroItems = getFilaChip(chip.id).filter(f => f.status === 'erro');
    if (erroItems.length && !st.retryDisparado) {
      st.retryItems = erroItems;
      // Calcular horário sugerido: ultimoLoteFimTs + esperaMin + 30min de margem
      const retryTs = st.ultimoLoteFimTs + (esperaMin + 30) * 60 * 1000;
      const retryDate = new Date(retryTs);
      const hh = String(retryDate.getHours()).padStart(2,'0');
      const mm = String(retryDate.getMinutes()).padStart(2,'0');
      const horarioSugerido = `${hh}:${mm}`;
      // Exibir painel de retry
      exibirRetryPanel(slot, erroItems.length, horarioSugerido);
      notify(`⚠ ${erroItems.length} erro${erroItems.length>1?'s':''} — Lote Retry disponível`, 'warn');
    } else {
      const totalEnv = st.loteHistorico.reduce((s,l)=>s+l.env,0);
      const totalErr = st.loteHistorico.reduce((s,l)=>s+l.erros,0);
      notify(`✓ ${st.lotesTotal} lote${st.lotesTotal>1?'s':''} concluído${st.lotesTotal>1?'s':''} · ${totalEnv} enviados · ${totalErr} erros`);
    }
  }
}

function exibirRetryPanel(slot, count, horario) {
  const itensEl = document.getElementById(`filaItens${slot}`);
  if (!itensEl) return;
  const cor = 'var(--warning)';
  const retryHtml = `<div id="retryPanel${slot}" style="margin:8px 0;padding:12px 14px;border-radius:10px;background:rgba(240,164,41,0.06);border:1px solid rgba(240,164,41,0.3)">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="flex:1">
        <div style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;color:var(--warning);margin-bottom:3px">⚠ LOTE RETRY — ${count} empresa${count>1?'s':''} com erro</div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">Horário sugerido: <span style="color:var(--text2)">${horario}</span> · disparo manual</div>
      </div>
      <button onclick="iniciarRetryChip(${slot})" style="background:var(--warning);color:#0a0a0d;border:none;border-radius:7px;font-family:'Syne',sans-serif;font-weight:700;font-size:10px;padding:7px 14px;cursor:pointer;white-space:nowrap">↻ Disparar Retry</button>
    </div>
  </div>`;
  // Inserir antes dos itens da fila
  const existing = document.getElementById(`retryPanel${slot}`);
  if (existing) existing.outerHTML = retryHtml;
  else itensEl.insertAdjacentHTML('beforebegin', retryHtml);
}

async function iniciarRetryChip(slot) {
  const st = chipSlotState[slot];
  if (st.disparoEmAndamento || st.aguardandoLote) return;
  repairCompletedDispatchQueueItemsV438('retry-before-start');
  st.retryItems = (st.retryItems || []).filter(item => !isDispatchItemFullyDeliveredV438(item));
  if (!st.retryItems || !st.retryItems.length) { notify('// nenhum item para retry','warn'); return; }
  const chip = getChipBySlot(slot); if (!chip) return;
  if (blockChipDispatchReloadLockV432(slot, chip)) return;

  st.retryDisparado = true;
  // Remove painel de retry
  const rp = document.getElementById(`retryPanel${slot}`);
  if (rp) rp.remove();

  // Marcar retry items como aguardando novamente
  st.retryItems.forEach(item => { item.status = 'aguardando'; item._isRetry = true; });

  // Dispara como lote único
  st.filaLotes = [[...st.retryItems]];
  st.loteAtual = st.lotesTotal; // continua numeração
  st.lotesTotal = st.lotesTotal + 1;
  const logEl = document.getElementById(`disparoLog${slot}`);
  if (logEl) { logEl.style.display = 'block'; }
  await dispararLoteChip(slot);
}

function iniciarCountdownLoteChip(slot, duracaoMs) {
  const st = chipSlotState[slot];
  const proxBtn = document.getElementById(`btnProximoLote${slot}`);
  const countEl = document.getElementById(`loteCountdown${slot}`);
  const barEl   = document.getElementById(`loteProgressBar${slot}`);
  if (st.loteCountdownInt) clearInterval(st.loteCountdownInt);
  function tick() {
    const restante = st.loteEsperaFim - Date.now();
    if (restante <= 0) {
      clearInterval(st.loteCountdownInt); st.loteCountdownInt = null;
      if (countEl) countEl.textContent = '00:00';
      if (barEl)   barEl.style.width = '100%';
      if (proxBtn) { proxBtn.disabled = false; proxBtn.style.background = slot===0?'var(--accent)':'#5bb8f5'; }
      notify('✓ Lote liberado!');
      return;
    }
    const min = Math.floor(restante/60000), seg = Math.floor((restante%60000)/1000);
    if (countEl) countEl.textContent = `${String(min).padStart(2,'0')}:${String(seg).padStart(2,'0')}`;
    if (barEl)   barEl.style.width = Math.min(100, ((duracaoMs-restante)/duracaoMs)*100) + '%';
  }
  tick(); st.loteCountdownInt = setInterval(tick, 500);
}

function cancelarLotesChip(slot) {
  const st = chipSlotState[slot];
  if (st.loteEsperaTimer)  { clearTimeout(st.loteEsperaTimer);  st.loteEsperaTimer = null; }
  if (st.loteCountdownInt) { clearInterval(st.loteCountdownInt); st.loteCountdownInt = null; }
  st.filaLotes = []; st.loteAtual = 0; st.lotesTotal = 0;
  st.aguardandoLote = false; st.loteEsperaFim = null;
  const chip = getChipBySlot(slot);
  if (chip) saveChipDispatchRuntimeV432(chip.id, null);
  st.pausado = false;
  const panel = document.getElementById(`loteEsperaPanel${slot}`);
  if (panel) panel.style.display = 'none';
  const btnEl  = document.getElementById(`btnDisparar${slot}`);
  const btnTxt = document.getElementById(`disparoBtn${slot}`);
  if (btnEl)  btnEl.disabled = false;
  if (btnTxt) btnTxt.textContent = slot===0 ? '🟢 Disparar' : '🔵 Disparar';
  notify('// fila cancelada','warn');
  _atualizarBotaoPausa(slot);
}

function togglePausaChip(slot) {
  const st = chipSlotState[slot];
  if (!st.disparoEmAndamento && !st.aguardandoLote) return; // só age se estiver rodando
  st.pausado = !st.pausado;
  _atualizarBotaoPausa(slot);
  if (st.pausado) {
    notify(`⏸ Chip ${slot+1} pausado — aguardando término do envio atual`, 'warn');
  } else {
    notify(`▶ Chip ${slot+1} retomado`);
  }
}

function _atualizarBotaoPausa(slot) {
  const st = chipSlotState[slot];
  const btn = document.getElementById(`btnPausa${slot}`);
  if (!btn) return;
  const ativo = st.disparoEmAndamento || st.aguardandoLote;
  btn.style.display = ativo ? 'inline-flex' : 'none';
  if (st.pausado) {
    btn.textContent = '▶ Retomar';
    btn.style.borderColor = 'var(--ok)';
    btn.style.color = 'var(--ok)';
  } else {
    btn.textContent = '⏸ Pausar';
    btn.style.borderColor = 'var(--warning)';
    btn.style.color = 'var(--warning)';
  }
}

function atualizarStatusEmpresa(id, status = 'Enviada', meta = {}) {
  if (!id) return false;
  const nowIso = meta.sentAt || new Date().toISOString();
  const sentDay = typeof todayStr === 'function' ? todayStr() : nowIso.slice(0, 10);
  let changed = false;

  try {
    if (typeof ensureWeekData === 'function' && typeof saveWeekData === 'function') {
      const data = ensureWeekData();
      Object.keys(data.days || {}).forEach(day => {
        const emp = (data.days[day] || []).find(item => item?.id === id);
        if (!emp) return;
        emp.status = status;
        if (status === 'Enviada') {
          emp.enviadoEm = sentDay;
          emp.sentAt = nowIso;
          emp.whatsappStatus = 'sent';
        }
        changed = true;
      });
      if (changed) saveWeekData(data);
    }
  } catch (error) {
    console.warn('[whatsapp-send][status-update-error]', { id, scope:'week', error:error?.message || error });
  }

  try {
    if (typeof getLeadBaseData === 'function' && typeof LEADS_BASE_KEY !== 'undefined') {
      const base = getLeadBaseData();
      const lead = base.find(item => item?.id === id);
      if (lead) {
        lead.status = status;
        if (status === 'Enviada') {
          lead.enviadoEm = sentDay;
          lead.sentAt = nowIso;
          lead.whatsappStatus = 'sent';
        }
        if (typeof saveOperationalKey === 'function') saveOperationalKey(LEADS_BASE_KEY, base, 'dispatch-status-base-save'); 
        changed = true;
      }
    }
  } catch (error) {
    console.warn('[whatsapp-send][status-update-error]', { id, scope:'base', error:error?.message || error });
  }

  try { if (changed && typeof updateBadges === 'function') updateBadges(); } catch(e) {}
  return changed;
}

function isDispatchItemFullyDeliveredV438(item = {}) {
  return !!(item && item.textSent === true && item.text2Sent === true && item.mediaSent === true);
}

function repairCompletedDispatchQueueItemsV438(source = 'dispatch-repair') {
  let repaired = 0;
  try {
    Object.keys(filaDisparo || {}).forEach(chipId => {
      (filaDisparo[chipId] || []).forEach(item => {
        if (!item || item.status === 'enviado' || !isDispatchItemFullyDeliveredV438(item)) return;
        item.status = 'enviado';
        item.error = '';
        item.repairedAfterSendAt = new Date().toISOString();
        atualizarStatusEmpresa(item.id, 'Enviada', { phone:item.whatsapp || item.phone || '', sentAt:item.repairedAfterSendAt });
        repaired++;
      });
    });
    if (repaired) {
      if (typeof v48StateSet === 'function') v48StateSet(FILA_DISPARO_KEY, filaDisparo, 'repair-completed-send'); 
      window.__VS_FILA_DISPARO_UPDATED_AT = new Date().toISOString();
      uiSyncLog('optimistic-update', { entity:'dispatch-queue', action:'repair-completed-send', source, count:repaired });
      try { console.warn('[whatsapp-send][status-repaired]', { source, count:repaired }); } catch(e) {}
    }
  } catch(error) {
    console.warn('[whatsapp-send][status-repair-error]', { source, error:error?.message || error });
  }
  return repaired;
}

async function confirmarProximoLoteChip(slot) {
  const st = chipSlotState[slot];
  if (!st.filaLotes.length) return;
  const proxBtn = document.getElementById(`btnProximoLote${slot}`);
  if (proxBtn) proxBtn.disabled = true;
  const panel = document.getElementById(`loteEsperaPanel${slot}`);
  if (panel) panel.style.display = 'none';
  if (st.loteCountdownInt) { clearInterval(st.loteCountdownInt); st.loteCountdownInt = null; }
  if (st.loteEsperaTimer)  { clearTimeout(st.loteEsperaTimer);   st.loteEsperaTimer = null; }
  st.aguardandoLote = false;
  const chip = getChipBySlot(slot);
  if (chip) saveChipDispatchRuntimeV432(chip.id, null);
  await dispararLoteChip(slot);
}

function atualizarStatusFilaSlot(slot, id, status) {
  const el = document.getElementById(`fila-item-${slot}-${id}`); if (!el) return;
  el.className = `fila-item ${status}`;
  const st = el.querySelector('.fila-item-status'); if (!st) return;
  const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
  st.className = `fila-item-status ${status}`; st.textContent = labels[status]||status;
}
