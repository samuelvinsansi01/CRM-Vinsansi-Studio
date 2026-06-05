/* ════════════════════════════
   FILA WHATSAPP V27 REAL
════════════════════════════ */
const WHATSAPP_QUEUE_V27_KEY = 'vs_whatsapp_queue_v27';
const QUEUE_CAMPAIGNS_V27_KEY = 'vs_queue_campaigns_v27';
const QUEUE_TEMPLATES_V27_KEY = 'vs_queue_templates_v27';

function getQueueCampaigns() {
  try {
    const data = (typeof v48StateGetArray === 'function') ? v48StateGetArray(QUEUE_CAMPAIGNS_V27_KEY) : null;
    return Array.isArray(data) && data.length ? data : ['Campanha Principal'];
  } catch {
    return ['Campanha Principal'];
  }
}

function saveQueueCampaigns(list) {
  if (typeof v48StateSet === 'function') v48StateSet(QUEUE_CAMPAIGNS_V27_KEY, list || [], 'queue-campaigns-save');
  try { scheduleLegacyOperationalSyncV36({ delay:400, reason:'queue-campaign-update' }); } catch(e){}
}

function getQueueTemplates() {
  try {
    const data = (typeof v48StateGetArray === 'function') ? v48StateGetArray(QUEUE_TEMPLATES_V27_KEY) : null;
    return Array.isArray(data) && data.length ? data : [
      { id:'tpl_default_1', name:'Template A', text:'Olá, tudo bem? Posso te enviar uma apresentação rápida?' },
      { id:'tpl_default_2', name:'Template B', text:'Oi! Vi sua empresa e acredito que posso ajudar com presença digital.' }
    ];
  } catch {
    return [];
  }
}

function saveQueueTemplates(list) {
  if (typeof v48StateSet === 'function') v48StateSet(QUEUE_TEMPLATES_V27_KEY, list || [], 'queue-templates-save');
  uiSyncLogV426('optimistic-update', { entity:'template', action:'save-queue-cache', count:Array.isArray(list) ? list.length : 0 });
  try { scheduleLegacyOperationalSyncV36({ delay:400, reason:'queue-template-update' }); } catch(e){}
}

function getWhatsappQueueV27() {
  try {
    const data = (typeof v48StateGetArray === 'function') ? v48StateGetArray(WHATSAPP_QUEUE_V27_KEY) : [];
    const list = Array.isArray(data) ? data : [];
    return typeof dedupeLeadArrayV31 === 'function' ? dedupeLeadArrayV31(list, 'getWhatsappQueueV27') : list;
  } catch {
    return [];
  }
}

function saveWhatsappQueueV27(list) {
  if (typeof dedupeLeadArrayV31 === 'function') list = dedupeLeadArrayV31(list || [], 'saveWhatsappQueueV27.beforeSave');
  if (typeof v48StateSet === 'function') v48StateSet(WHATSAPP_QUEUE_V27_KEY, list || [], 'whatsapp-queue-save');
  uiSyncLogV426('optimistic-update', { entity:'whatsapp-queue', action:'save-local-cache', count:Array.isArray(list) ? list.length : 0 });
  try { scheduleLegacyOperationalSyncV36({ delay:400, reason:'whatsapp-queue-update' }); } catch(e){}
  updateWhatsappQueueBadge();
  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
}

function addQueueCampaign() {
  const input = document.getElementById('queueCampaignName');
  const name = (input?.value || '').trim();
  if (!name) return;

  const campaigns = getQueueCampaigns();
  if (!campaigns.includes(name)) campaigns.push(name);
  saveQueueCampaigns(campaigns);

  if (input) input.value = '';
  renderWhatsappQueuePanel();
  notify('Campanha adicionada.');
}

function removeQueueCampaign(name) {
  const campaigns = getQueueCampaigns().filter(item => item !== name);
  saveQueueCampaigns(campaigns.length ? campaigns : ['Campanha Principal']);
  renderWhatsappQueuePanel();
}

function addQueueTemplate() {
  const nameEl = document.getElementById('queueTemplateName');
  const textEl = document.getElementById('queueTemplateText');

  const name = (nameEl?.value || '').trim();
  const text = (textEl?.value || '').trim();

  if (!name || !text) {
    notify('Informe nome e texto do template.', 'warn');
    return;
  }

  const templates = getQueueTemplates();
  templates.push({
    id: 'tpl_' + Date.now(),
    name,
    text
  });

  saveQueueTemplates(templates);

  if (nameEl) nameEl.value = '';
  if (textEl) textEl.value = '';

  renderWhatsappQueuePanel();
  notify('Template adicionado.');
}

function removeQueueTemplate(id) {
  saveQueueTemplates(getQueueTemplates().filter(tpl => tpl.id !== id));
  renderWhatsappQueuePanel();
}

function renderQueueCampaigns() {
  const box = document.getElementById('queueCampaignList');
  if (!box) return;

  const campaigns = getQueueCampaigns();

  box.innerHTML = campaigns.map(name => `
    <div class="queue-v27-item">
      <div>
        <div class="queue-v27-item-title">${escHtml(name)}</div>
        <div class="queue-v27-item-text">// campanha disponível</div>
      </div>
      <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeQueueCampaign('${escHtml(name)}')">Remover</button>
    </div>
  `).join('');
}

function renderQueueTemplates() {
  const box = document.getElementById('queueTemplateList');
  if (!box) return;

  const templates = getQueueTemplates();

  box.innerHTML = templates.map(tpl => `
    <div class="queue-v27-item">
      <div>
        <div class="queue-v27-item-title">${escHtml(tpl.name)}</div>
        <div class="queue-v27-item-text">${escHtml((tpl.text || '').slice(0, 120))}</div>
      </div>
      <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeQueueTemplate('${escHtml(tpl.id)}')">Remover</button>
    </div>
  `).join('');
}

function addActiveLeadToWhatsappQueue() {
  if (!activeLeadDrawerId || !activeLeadDrawerData) return;
  if (!isLeadWhatsappValidatedForQueue({ ...activeLeadDrawerData, id: activeLeadDrawerId })) {
    notify('Valide o WhatsApp antes de adicionar à fila.', 'warn');
    return;
  }

  const campaign = document.getElementById('leadQueueCampaign')?.value || 'Campanha Principal';
  const queue = getWhatsappQueueV27();

  const exists = queue.some(item => item.leadId === activeLeadDrawerId && !['Enviado','Erro'].includes(item.status));
  if (exists) {
    notify('Este lead já está na fila.', 'warn');
    return;
  }

  const phone = normalizePhoneForEvolution(activeLeadDrawerData.whatsapp || activeLeadDrawerData.phone || activeLeadDrawerData.telefone || '');

  const item = {
    id: 'queue_' + Date.now(),
    leadId: activeLeadDrawerId,
    nome: activeLeadDrawerData.nome || activeLeadDrawerData.companyName || 'Lead',
    telefone: phone,
    campaign,
    status: 'Pendente',
    templateId: '',
    templateName: '',
    createdAt: new Date().toISOString(),
    createdAtLabel: crmNowLabel()
  };

  queue.unshift(item);
  saveWhatsappQueueV27(queue);

  addLeadHistory(activeLeadDrawerId, `Adicionado à fila WhatsApp (${campaign})`, activeLeadDrawerData);
  renderLeadQueueBox();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Lead adicionado à fila.');
}

function removeLeadFromWhatsappQueue(leadId) {
  const queue = getWhatsappQueueV27().filter(item => item.leadId !== leadId || item.status === 'Enviado');
  saveWhatsappQueueV27(queue);

  if (activeLeadDrawerId === leadId) {
    addLeadHistory(leadId, 'Removido da fila WhatsApp', activeLeadDrawerData || {});
    renderLeadQueueBox();
    if (typeof renderLeadTimeline === 'function') renderLeadTimeline(leadId);
  }

  renderWhatsappQueuePanel();
}

function setQueueItemStatus(id, status) {
  const queue = getWhatsappQueueV27();
  const item = queue.find(q => q.id === id);
  if (!item) return;

  item.status = status;
  item.updatedAt = new Date().toISOString();
  saveWhatsappQueueV27(queue);

  if (item.leadId) {
    addLeadHistory(item.leadId, `Fila WhatsApp: status alterado para ${status}`, findLeadEverywhere(item.leadId) || {});
  }

  renderWhatsappQueuePanel();
}

function renderWhatsappQueueList() {
  const box = document.getElementById('whatsappQueueList');
  if (!box) return;

  const queue = getWhatsappQueueV27();

  if (!queue.length) {
    box.innerHTML = '<div class="queue-v27-empty">// nenhum lead na fila WhatsApp</div>';
    return;
  }

  box.innerHTML = queue.map(item => {
    const cls = normalizeStr(item.status || 'pendente').replace(/[^a-z0-9]+/g,'');
    return `
      <div class="queue-v27-row">
        <div>
          <div class="queue-v27-name">${escHtml(item.nome || 'Lead')}</div>
          <div class="queue-v27-meta">${escHtml(item.telefone || 'sem telefone')}</div>
        </div>
        <div class="queue-v27-meta">${escHtml(item.campaign || 'Campanha Principal')}</div>
        <div class="queue-v27-meta">${item.templateName ? `<span class="queue-v28-template">${escHtml(item.templateName)}</span>` : 'template ainda não sorteado'}</div>
        <span class="queue-v27-status ${cls}">${escHtml(item.status || 'Pendente')}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="openLeadDrawer('${escHtml(item.leadId)}')">Ficha</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="setQueueItemStatus('${escHtml(item.id)}','Pronto')">Pronto</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeLeadFromWhatsappQueue('${escHtml(item.leadId)}')">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderWhatsappQueuePanel() {
  updateWhatsappQueueBadge();
}

function updateWhatsappQueueBadge() {
  const badge = document.getElementById('badge-whatsapp-queue');
  if (!badge) return;
  const pending = getWhatsappQueueV27().filter(item => ['Pendente','Pronto'].includes(item.status)).length;
  badge.textContent = pending;
}

function ensureLeadQueueContainer() {
  if (document.getElementById('leadQueueBox')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadMessageBox') ||
    document.getElementById('leadWhatsappValidationBox') ||
    document.getElementById('leadPresentationsList') ||
    document.getElementById('leadTimelineList');

  const block = document.createElement('div');
  block.id = 'leadQueueBox';

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('afterend', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

function renderLeadQueueBox() {
  ensureLeadQueueContainer();
  const box = document.getElementById('leadQueueBox');
  if (!box || !activeLeadDrawerId) return;

  const campaigns = getQueueCampaigns();
  const active = getWhatsappQueueV27().find(item => item.leadId === activeLeadDrawerId && !['Enviado','Erro'].includes(item.status));

  box.innerHTML = `
    <div class="lead-queue-block">
      <div class="lead-queue-title">Fila WhatsApp</div>
      <div class="lead-queue-form">
        <select id="leadQueueCampaign" ${active ? 'disabled' : ''}>
          ${campaigns.map(c => `<option value="${escHtml(c)}" ${active?.campaign === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
        ${active
          ? `<button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeLeadFromWhatsappQueue('${escHtml(activeLeadDrawerId)}')">Remover da fila</button>`
          : `<button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="addActiveLeadToWhatsappQueue()">Adicionar à fila</button>`
        }
      </div>
      <div class="lead-queue-status">
        ${active ? `Status: ${escHtml(active.status)} · Campanha: ${escHtml(active.campaign)}` : '// lead ainda não está na fila'}
      </div>
    </div>
  `;
}

function ensureLeadQueueContainerV436() {
  return false;
}

function renderLeadQueueBoxV436() {
  const box = document.getElementById('leadQueueBox');
  if (box) box.remove();
}

ensureLeadQueueContainer = ensureLeadQueueContainerV436;
renderLeadQueueBox = renderLeadQueueBoxV436;
