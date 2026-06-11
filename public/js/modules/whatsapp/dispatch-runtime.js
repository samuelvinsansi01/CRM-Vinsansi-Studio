
function debugDispatchPersistV413(step, data = {}) {
  try {
    console.groupCollapsed(`[dispatch][persist] ${step}`);
    console.log(data);
    console.groupEnd();
  } catch (e) {
    console.log(`[dispatch][persist] ${step}`, data);
  }
}
/* ════════════════════════════
   DISPARO TEMPORIZADO V32
════════════════════════════ */
let dispatchTimerV32 = null;
let dispatchRunningV32 = false;

function getDispatchRuntimeV32() {
  try {
    const runtime = JSON.parse(localStorage.getItem('vs_dispatch_runtime_v32') || '{}');
    return runtime && typeof runtime === 'object' && !Array.isArray(runtime) ? runtime : {};
  } catch {
    return {};
  }
}

function saveDispatchRuntimeV32(data = {}) {
  const prev = getDispatchRuntimeV32();
  localStorage.setItem('vs_dispatch_runtime_v32', JSON.stringify({
    ...prev,
    ...data,
    updatedAt: new Date().toISOString()
  }));
}

function getNextReadyDispatchItemV32() {
  const ready = getReadyDispatchItemsV30 ? getReadyDispatchItemsV30() : [];

  for (const item of ready) {
    const chip = (getWhatsappChipsV29 ? getWhatsappChipsV29() : []).find(c => c.id === item.chipId);
    if (!chip) continue;

    const rule = canSendByChipRulesV31 ? canSendByChipRulesV31(chip) : { ok:true };
    if (rule.ok) return { item, chip };
  }

  return null;
}

function getDispatchIntervalMsV32(chip) {
  const seconds = Number(chip?.intervalSeconds || 120);
  return Math.max(10, seconds) * 1000;
}

function stopDispatchV32(reason = 'Disparo parado') {
  dispatchRunningV32 = false;
  clearTimeout(dispatchTimerV32);
  dispatchTimerV32 = null;
  saveDispatchRuntimeV32({ running:false, reason });
  addDispatchLogV30(reason);
  if (typeof renderDispatchV30Panel === 'function') renderDispatchV30Panel();
  notify(reason);
}

async function dispatchOneItemV32(item, chip) {
  const settings = getEvolutionSettings ? getEvolutionSettings() : {};
  const chipConfigV405 = getEvolutionConfigForChipV405 ? getEvolutionConfigForChipV405(chip) : settings;
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const queueItem = queue.find(q => q.id === item.id);

  if (!queueItem) return { ok:false, reason:'item não encontrado' };

  const phone = normalizePhoneForEvolution(queueItem.telefone || '');
  const text = queueItem.templateText || '';

  if (!chipConfigV405.url || !chipConfigV405.apiKey || !chipConfigV405.instance) {
    queueItem.status = 'Erro';
    queueItem.error = 'Evolution incompleta no chip';
    saveWhatsappQueueV27(queue);
    return { ok:false, reason:'Evolution incompleta' };
  }

  if (!phone || !text) {
    queueItem.status = 'Erro';
    queueItem.error = 'Telefone ou template ausente';
    saveWhatsappQueueV27(queue);
    return { ok:false, reason:'Telefone/template ausente' };
  }

  try {
    queueItem.status = 'Enviando';
    saveWhatsappQueueV27(queue);
    if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();

    const endpoint = `${chipConfigV405.url}/message/sendText/${encodeURIComponent(chipConfigV405.instance)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(chipConfigV405) : getEvolutionHeaders(chipConfigV405)),
      body: JSON.stringify(buildEvolutionTextPayloadV4013(phone, text))
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      queueItem.status = 'Erro';
      queueItem.error = data?.message || data?.error || `HTTP ${res.status}`;
      queueItem.updatedAt = new Date().toISOString();
      saveWhatsappQueueV27(queue);

      if (queueItem.leadId) {
        addLeadHistory(queueItem.leadId, `Disparo WhatsApp com erro: ${queueItem.error}`, findLeadEverywhere(queueItem.leadId) || {});
      }

      return { ok:false, reason:queueItem.error };
    }

    queueItem.status = 'Enviado';
    queueItem.sentAt = new Date().toISOString();
    queueItem.sentAtLabel = crmNowLabel();
    queueItem.sentBlock = registerChipSendV31 ? registerChipSendV31(chip) : '';
    queueItem.response = data;
    queueItem.externalId = typeof getEvolutionWhatsappExternalIdV412 === 'function'
      ? getEvolutionWhatsappExternalIdV412(data, queueItem.id)
      : queueItem.id;
    saveWhatsappQueueV27(queue);
    debugDispatchPersistV413('persist-function-check', { file: 'dispatch-runtime.js', available: typeof persistOutgoingWhatsappMessageV412 === 'function' });
      if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
      persistOutgoingWhatsappMessageV412({
        id: queueItem.externalId,
        leadId: queueItem.leadId || '',
        instance: chipConfigV405.instance,
        phone,
        text,
        occurredAt: queueItem.sentAt
      }).catch(() => {});
    }

    if (queueItem.leadId) {
      addLeadHistory(queueItem.leadId, `Mensagem enviada em massa via ${chip.name} · Template: ${queueItem.templateName}`, findLeadEverywhere(queueItem.leadId) || {});
    }

    return { ok:true, reason:'enviado' };
  } catch (err) {
    queueItem.status = 'Erro';
    queueItem.error = err?.message || 'falha desconhecida';
    queueItem.updatedAt = new Date().toISOString();
    saveWhatsappQueueV27(queue);

    if (queueItem.leadId) {
      addLeadHistory(queueItem.leadId, `Disparo WhatsApp falhou: ${queueItem.error}`, findLeadEverywhere(queueItem.leadId) || {});
    }

    return { ok:false, reason:queueItem.error };
  }
}

async function dispatchLoopV32() {
  if (!dispatchRunningV32) return;

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  if (control.paused) {
    stopDispatchV32('Disparo pausado: fila pausada');
    return;
  }

  const next = getNextReadyDispatchItemV32();

  if (!next) {
    stopDispatchV32('Disparo finalizado: nenhum item disponível');
    return;
  }

  const { item, chip } = next;
  addDispatchLogV30(`Enviando: ${item.nome} · ${chip.name}`);

  const result = await dispatchOneItemV32(item, chip);

  if (result.ok) {
    addDispatchLogV30(`Enviado: ${item.nome} · próximo em ${chip.intervalSeconds || 120}s`);
  } else {
    addDispatchLogV30(`Erro: ${item.nome} · ${result.reason}`);
  }

  if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  if (typeof renderDispatchV30Panel === 'function') renderDispatchV30Panel();

  if (!dispatchRunningV32) return;

  const interval = getDispatchIntervalMsV32(chip);
  saveDispatchRuntimeV32({
    running:true,
    lastSentAt:new Date().toISOString(),
    nextRunAt:new Date(Date.now() + interval).toISOString()
  });

  dispatchTimerV32 = setTimeout(dispatchLoopV32, interval);
}

function startDispatchV32() {
  if (dispatchRunningV32) {
    notify('Disparo já está em execução.', 'warn');
    return;
  }

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  if (control.paused) {
    notify('Retome a fila antes de iniciar.', 'warn');
    return;
  }

  const ready = getReadyDispatchItemsV30 ? getReadyDispatchItemsV30() : [];
  if (!ready.length) {
    notify('Nenhum lead pronto para disparo.', 'warn');
    return;
  }

  dispatchRunningV32 = true;
  saveDispatchRuntimeV32({ running:true, startedAt:new Date().toISOString(), reason:'' });
  addDispatchLogV30(`Disparo temporizado iniciado: ${ready.length} item(s).`);
  renderDispatchV30Panel();
  dispatchLoopV32();
}

function renderDispatchRuntimeV32() {
  const runtime = getDispatchRuntimeV32();
  const interruptedByReload = !dispatchRunningV32 && runtime.running;
  const cls = dispatchRunningV32 ? 'running' : '';
  const state = dispatchRunningV32
    ? 'em execução'
    : interruptedByReload
      ? 'interrompido ao recarregar'
      : 'parado';
  const next = dispatchRunningV32 && runtime.nextRunAt
    ? new Date(runtime.nextRunAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    : '--';

  return `
    <div class="dispatch-v32-runtime ${cls}">
      Estado: ${state}<br>
      Próximo envio: ${next}<br>
      Regra: 120s entre envios · 30 por bloco · 6 blocos · 180 por chip/dia
    </div>
  `;
}

