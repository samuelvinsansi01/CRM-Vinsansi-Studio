
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
   DISPARO INICIAL V30
════════════════════════════ */
const DISPATCH_V30_LOG_KEY = 'vs_dispatch_v30_log';

function getDispatchLogsV30() {
  try {
    const data = JSON.parse(localStorage.getItem(DISPATCH_V30_LOG_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveDispatchLogsV30(list) {
  localStorage.setItem(DISPATCH_V30_LOG_KEY, JSON.stringify((list || []).slice(0, 200)));
}

function addDispatchLogV30(text) {
  const logs = getDispatchLogsV30();
  logs.unshift({
    at: crmNowLabel(),
    text
  });
  saveDispatchLogsV30(logs);
}

function getReadyDispatchItemsV30() {
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const chips = getWhatsappChipsV29 ? getWhatsappChipsV29() : [];
  const chipMap = new Map(chips.map(chip => [chip.id, chip]));

  return queue.filter(item => {
    if (item.status !== 'Pronto') return false;
    if (!item.chipId || !item.templateText) return false;

    const chip = chipMap.get(item.chipId);
    if (!chip) return false;
    if (chip.paused || chip.status === 'disabled') return false;

    return true;
  });
}

function renderDispatchV30Panel() {
  const host = document.getElementById('dispatchV30Panel');
  if (!host) return;

  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
  const ready = getReadyDispatchItemsV30();
  const logs = getDispatchLogsV30().slice(0, 8);

  host.innerHTML = `
    <div class="dispatch-v30-panel">
      <div class="dispatch-v30-head">
        <div>
          <div class="dispatch-v30-title">
            Disparo em massa
            <span class="dispatch-v30-pill">${ready.length} pronto(s)</span>
          </div>
          <div class="dispatch-v30-sub">
            180 mensagens por chip · 6 lotes de 30 · 120s entre envios · espera 1h
          </div>
        </div>
        <div class="dispatch-v30-actions">
          <button class="btn btn-ghost" onclick="previewDispatchV30()">Pré-visualizar</button>
          <button class="btn btn-primary" onclick="startDispatchV32()">Iniciar disparo</button><button class="btn btn-danger" onclick="stopDispatchV32()">Parar</button>
        </div>
      </div>
      <div class="dispatch-v30-log">
        ${logs.length ? logs.map(log => `${escHtml(log.at)} · ${escHtml(log.text)}`).join('<br>') : '// nenhum disparo iniciado ainda'}
      </div>
    </div>
  `;
}

function previewDispatchV30() {
  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };

  if (control.paused) {
    notify('A fila está pausada.', 'warn');
    addDispatchLogV30('Prévia bloqueada: fila pausada');
    renderDispatchV30Panel();
    return;
  }

  const ready = getReadyDispatchItemsV30();
  const byChip = {};

  ready.forEach(item => {
    byChip[item.chipName || 'Sem chip'] = (byChip[item.chipName || 'Sem chip'] || 0) + 1;
  });

  const summary = Object.entries(byChip)
    .map(([chip, count]) => `${chip}: ${count}`)
    .join(' · ');

  addDispatchLogV30(`Prévia: ${ready.length} lead(s) pronto(s). ${summary || 'Nenhum chip disponível.'}`);
  renderDispatchV30Panel();
  notify(`${ready.length} lead(s) pronto(s) para disparo.`);
}

async function startDispatchV30() {
  const control = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };

  if (control.paused) {
    notify('Retome a fila antes de disparar.', 'warn');
    addDispatchLogV30('Disparo bloqueado: fila pausada');
    renderDispatchV30Panel();
    return;
  }

  const settings = getEvolutionSettings ? getEvolutionSettings() : {};
  const chips = getWhatsappChipsV29 ? getWhatsappChipsV29() : [];
  const hasEvolutionConfig = chips.some(chip => {
    const config = typeof getEvolutionConfigForChipV405 === 'function'
      ? getEvolutionConfigForChipV405(chip)
      : chip;
    return !!(config.url && config.instance && (config.apiKey || config.key || config.apikey));
  }) || !!(settings.url && settings.instance && settings.apiKey);

  if (!hasEvolutionConfig) {
    notify('Configure a Evolution API antes do disparo.', 'warn');
    addDispatchLogV30('Disparo bloqueado: Evolution incompleta');
    renderDispatchV30Panel();
    return;
  }

  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const ready = getReadyDispatchItemsV30();

  if (!ready.length) {
    notify('Nenhum lead pronto para envio.', 'warn');
    addDispatchLogV30('Nenhum lead pronto para envio');
    renderDispatchV30Panel();
    return;
  }

  addDispatchLogV30(`Disparo iniciado: ${ready.length} lead(s).`);
  addDispatchLogV30('Ritmo V31 ativo: valida limite diário e bloco por chip.');

  let sent = 0;
  let failed = 0;

  for (const item of ready) {
    const currentControl = getWhatsappQueueControl ? getWhatsappQueueControl() : { paused:false };
    if (currentControl.paused) {
      addDispatchLogV30('Disparo interrompido: fila pausada');
      break;
    }

    const chip = (getWhatsappChipsV29 ? getWhatsappChipsV29() : []).find(c => c.id === item.chipId);
    if (!chip || chip.paused || chip.status === 'disabled') {
      item.status = 'Erro';
      item.error = 'Chip indisponível';
      failed++;
      continue;
    }

    const chipConfigV405 = typeof getEvolutionConfigForChipV405 === 'function'
      ? getEvolutionConfigForChipV405(chip)
      : settings;

    if (!chipConfigV405.url || !chipConfigV405.instance || !chipConfigV405.apiKey) {
      item.status = 'Erro';
      item.error = 'Evolution incompleta no chip';
      failed++;
      continue;
    }

    const phone = normalizePhoneForEvolution(item.telefone || '');
    const text = item.templateText || '';

    if (!phone || !text) {
      item.status = 'Erro';
      item.error = 'Telefone ou template ausente';
      failed++;
      continue;
    }

    try {
      const endpoint = `${chipConfigV405.url}/message/sendText/${encodeURIComponent(chipConfigV405.instance)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: (typeof getEvolutionHeadersV405 === 'function' ? getEvolutionHeadersV405(chipConfigV405) : getEvolutionHeaders(chipConfigV405)),
        body: JSON.stringify(buildEvolutionTextPayloadV4013(phone, text))
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        item.status = 'Erro';
        item.error = data?.message || data?.error || `HTTP ${res.status}`;
        failed++;
        addDispatchLogV30(`Erro: ${item.nome} · ${item.error}`);
        if (item.leadId) addLeadHistory(item.leadId, `Disparo WhatsApp com erro: ${item.error}`, findLeadEverywhere(item.leadId) || {});
      } else {
        item.status = 'Enviado';
        item.sentAt = new Date().toISOString();
        item.sentAtLabel = crmNowLabel();
        item.response = data;
        item.externalId = typeof getEvolutionWhatsappExternalIdV412 === 'function'
          ? getEvolutionWhatsappExternalIdV412(data, item.id)
          : item.id;
        debugDispatchPersistV413('persist-function-check', { file: 'dispatch-preview.js', available: typeof persistOutgoingWhatsappMessageV412 === 'function' });
      if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
          persistOutgoingWhatsappMessageV412({
            id: item.externalId,
            leadId: item.leadId || '',
            instance: chipConfigV405.instance,
            phone,
            text,
            occurredAt: item.sentAt
          }).catch(() => {});
        }
        sent++;
        addDispatchLogV30(`Enviado: ${item.nome} · ${chip.name} · bloco ${item.sentBlock || '--'}`);
        if (item.leadId) addLeadHistory(item.leadId, `Mensagem enviada em massa via ${chip.name} · Template: ${item.templateName}`, findLeadEverywhere(item.leadId) || {});
      }
    } catch (err) {
      item.status = 'Erro';
      item.error = err?.message || 'falha desconhecida';
      failed++;
      addDispatchLogV30(`Falha: ${item.nome} · ${item.error}`);
      if (item.leadId) addLeadHistory(item.leadId, `Disparo WhatsApp falhou: ${item.error}`, findLeadEverywhere(item.leadId) || {});
    }
  }

  saveWhatsappQueueV27(queue);
  addDispatchLogV30(`Disparo finalizado: ${sent} enviado(s), ${failed} erro(s).`);

  if (typeof renderWhatsappQueuePanel === 'function') renderWhatsappQueuePanel();
  if (typeof renderChipsPanel === 'function') renderChipsPanel();
  renderDispatchV30Panel();

  notify(`Disparo finalizado: ${sent} enviado(s), ${failed} erro(s).`);
}

