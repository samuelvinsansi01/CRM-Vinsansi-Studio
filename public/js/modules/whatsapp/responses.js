/* ════════════════════════════
   WEBHOOK RESPOSTAS V34
════════════════════════════ */
const EVOLUTION_RESPONSES_V34_KEY = 'vs_evolution_responses_v34';

function getWhatsappResponsesScopedKeyV423(){
  try { return currentUser?.id ? `${EVOLUTION_RESPONSES_V34_KEY}:${currentUser.id}` : `${EVOLUTION_RESPONSES_V34_KEY}:anonymous`; } catch(e) { return `${EVOLUTION_RESPONSES_V34_KEY}:anonymous`; }
}

function getLocalResponsesV34() {
  try {
    const data = JSON.parse(localStorage.getItem(getWhatsappResponsesScopedKeyV423()) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveLocalResponsesV34(list) {
  try { scheduleOperationalSyncV36(); } catch(e){}
  localStorage.setItem(getWhatsappResponsesScopedKeyV423(), JSON.stringify((list || []).slice(0, 500)));
  try { localStorage.removeItem(EVOLUTION_RESPONSES_V34_KEY); } catch(e) {}
  updateResponsesBadgeV34();
}

function getWebhookUrlV34() {
  const userId = typeof currentUser !== 'undefined' ? currentUser?.id : '';
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  return `${window.location.origin}/api/webhook/evolution${query}`;
}

function renderWebhookUrlV34() {
  ['webhookUrlV34', 'webhookUrlEvolutionV412'].forEach(id => {
    const box = document.getElementById(id);
    if (box) box.textContent = getWebhookUrlV34();
  });
}

function copyWebhookUrlV34() {
  navigator.clipboard?.writeText(getWebhookUrlV34());
  notify('URL do webhook copiada.');
}

function normalizePhoneV34(value = '') {
  return String(value || '').replace(/\D/g,'');
}

function findLeadByPhoneV34(phone) {
  const target = normalizePhoneV34(phone);
  if (!target) return null;

  const data = ensureWeekData ? ensureWeekData() : { days:{} };
  const weeklyLeads = flattenWeekData ? flattenWeekData(data) : [];
  const permanentLeads = typeof getLeadBaseData === 'function' ? getLeadBaseData() : [];
  const leads = [...weeklyLeads, ...permanentLeads];

  for (const lead of leads) {
    const current = normalizePhoneV34(lead.whatsapp || lead.phone || lead.telefone || '');
    if (!current) continue;
    if (current.endsWith(target.slice(-8)) || target.endsWith(current.slice(-8))) return lead;
  }

  return null;
}

async function fetchEvolutionResponsesV34() {
  try {
    const res = await fetch('/api/webhook/evolution?limit=100');
    const data = await res.json();

    if (!res.ok || !data.success) {
      notify('Não foi possível buscar respostas.', 'err');
      return;
    }

    const local = getLocalResponsesV34();
    const map = new Map(local.map(item => [item.id, item]));

    (data.events || []).forEach(item => {
      map.set(item.id, item);
    });

    saveLocalResponsesV34(Array.from(map.values()).sort((a,b) => String(b.receivedAt).localeCompare(String(a.receivedAt))));
    renderResponsesV34();
    notify('Respostas atualizadas.');
  } catch (err) {
    notify('Erro ao buscar respostas do webhook.', 'err');
  }
}

function applyResponseToLeadV34(responseId) {
  const responses = getLocalResponsesV34();
  const response = responses.find(item => item.id === responseId);
  if (!response) return;

  const lead = findLeadByPhoneV34(response.phone);
  if (!lead) {
    notify('Lead não encontrado pelo telefone.', 'warn');
    return;
  }

  const leadId = lead.id;
  const crm = ensureLeadCrm(leadId, lead);

  crm.messages = Array.isArray(crm.messages) ? crm.messages : [];
  crm.messages.push({
    id: response.id,
    direction: 'in',
    text: response.text || '',
    phone: response.phone || '',
    at: response.receivedAt || new Date().toISOString(),
    atLabel: response.receivedAt ? new Date(response.receivedAt).toLocaleString('pt-BR') : crmNowLabel()
  });

  crm.pipelineStatus = crm.pipelineStatus === 'contato_enviado' ? 'respondeu' : crm.pipelineStatus;
  crm.lastResponseAt = response.receivedAt || new Date().toISOString();

  saveLeadCrm(leadId, crm);
  addLeadHistory(leadId, `Lead respondeu no WhatsApp: ${(response.text || '').slice(0, 120)}`, lead);

  response.applied = true;
  response.leadId = leadId;
  saveLocalResponsesV34(responses);

  renderResponsesV34();
  if (typeof renderKanban === 'function') renderKanban();
  notify('Resposta vinculada ao lead.');
}

function renderResponsesV34() {
  renderWebhookUrlV34();

  const list = document.getElementById('responsesListV34');
  if (!list) return;

  const responses = getLocalResponsesV34();

  if (!responses.length) {
    list.innerHTML = '<div class="response-v34-empty">// nenhuma resposta recebida ainda</div>';
    updateResponsesBadgeV34();
    return;
  }

  list.innerHTML = responses.map(item => {
    const date = item.receivedAt ? new Date(item.receivedAt).toLocaleString('pt-BR') : '';
    const lead = findLeadByPhoneV34(item.phone);
    return `
      <div class="response-v34-item">
        <div class="response-v34-top">
          <div>
            <div class="response-v34-phone">${escHtml(item.phone || 'sem telefone')}</div>
            <div class="response-v34-date">${escHtml(date)}</div>
          </div>
          <span class="queue-v27-status ${item.applied ? 'enviado' : 'pendente'}">${item.applied ? 'vinculada' : 'nova'}</span>
        </div>
        <div class="response-v34-text">${escHtml(item.text || '[mensagem sem texto]')}</div>
        <div class="response-v34-actions">
          ${lead ? `<button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="applyResponseToLeadV34('${escHtml(item.id)}')">${item.applied ? 'Atualizar lead' : 'Vincular ao lead'}</button>` : '<span class="queue-v27-status erro">lead não encontrado</span>'}
          ${lead ? `<button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="openLeadDrawer('${escHtml(lead.id)}')">Abrir ficha</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  updateResponsesBadgeV34();
}

function updateResponsesBadgeV34() {
  const badge = document.getElementById('badge-responses');
  if (!badge) return;
  const count = getLocalResponsesV34().filter(item => !item.applied).length;
  badge.textContent = count;
}

function renderResponsesPanelV34() {
  renderResponsesV34();
}

