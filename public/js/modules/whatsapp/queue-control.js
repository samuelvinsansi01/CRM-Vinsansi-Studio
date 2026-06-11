/* ════════════════════════════
   CONTROLE DE FILA V28
════════════════════════════ */
const WHATSAPP_QUEUE_CONTROL_KEY = 'vs_whatsapp_queue_control_v28';

function getWhatsappQueueControl() {
  try {
    const control = JSON.parse(localStorage.getItem(WHATSAPP_QUEUE_CONTROL_KEY) || '{"paused":false}');
    return control && typeof control === 'object' && !Array.isArray(control) ? control : { paused:false };
  } catch {
    return { paused:false };
  }
}

function saveWhatsappQueueControl(control) {
  localStorage.setItem(WHATSAPP_QUEUE_CONTROL_KEY, JSON.stringify({
    paused: !!control.paused,
    updatedAt: new Date().toISOString()
  }));
}

function pauseWhatsappQueue() {
  saveWhatsappQueueControl({ paused:true });
  renderWhatsappQueuePanel();
  notify('Fila pausada.');
}

function resumeWhatsappQueue() {
  saveWhatsappQueueControl({ paused:false });
  renderWhatsappQueuePanel();
  notify('Fila retomada.');
}

function toggleWhatsappQueuePause() {
  const control = getWhatsappQueueControl();
  if (control.paused) resumeWhatsappQueue();
  else pauseWhatsappQueue();
}

function pickRandomQueueTemplate() {
  const templates = getQueueTemplates ? getQueueTemplates() : [];
  if (!templates.length) return null;
  return templates[Math.floor(Math.random() * templates.length)];
}

function prepareQueueTemplates() {
  const control = getWhatsappQueueControl();
  if (control.paused) {
    notify('Retome a fila antes de preparar templates.', 'warn');
    return;
  }

  const queue = getWhatsappQueueV27();
  let count = 0;

  queue.forEach(item => {
    if (item.status !== 'Pendente') return;
    const template = pickRandomQueueTemplate();
    if (!template) return;

    item.templateId = template.id;
    item.templateName = template.name;
    item.templateText = template.text;
    item.status = 'Pronto';
    item.updatedAt = new Date().toISOString();
    count++;

    if (item.leadId && typeof addLeadHistory === 'function') {
      addLeadHistory(item.leadId, `Template sorteado para fila: ${template.name}`, findLeadEverywhere(item.leadId) || {});
    }
  });

  saveWhatsappQueueV27(queue);
  renderWhatsappQueuePanel();
  notify(`${count} lead(s) preparado(s) com template sorteado.`);
}

function renderQueueControlBar() {
  const host = document.getElementById('queueControlBar');
  if (!host) return;

  const control = getWhatsappQueueControl();
  const queue = getWhatsappQueueV27 ? getWhatsappQueueV27() : [];
  const pending = queue.filter(i => i.status === 'Pendente').length;
  const ready = queue.filter(i => i.status === 'Pronto').length;
  const sent = queue.filter(i => i.status === 'Enviado').length;
  const errors = queue.filter(i => i.status === 'Erro').length;

  host.innerHTML = `
    <div class="queue-control-bar">
      <div class="queue-control-left">
        <div class="queue-control-icon">${control.paused ? '⏸️' : '▶️'}</div>
        <div>
          <div class="queue-control-title">
            Fila ${control.paused ? 'pausada' : 'ativa'}
            <span class="queue-state-pill ${control.paused ? 'paused' : 'running'}">${control.paused ? 'PAUSADA' : 'ATIVA'}</span>
          </div>
          <div class="queue-control-text">
            ${pending} pendente(s) · ${ready} pronto(s) · ${sent} enviado(s) · ${errors} erro(s)
          </div>
        </div>
      </div>
      <div class="queue-control-actions">
        <button class="btn btn-ghost" onclick="toggleWhatsappQueuePause()">${control.paused ? 'Retomar fila' : 'Pausar fila'}</button>
        <button class="btn btn-primary" onclick="prepareQueueTemplates()">Sortear templates</button>
      </div>
    </div>
  `;
}


