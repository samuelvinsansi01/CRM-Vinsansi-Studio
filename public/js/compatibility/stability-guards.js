/* ════════════════════════════
   V41.6 — ESTABILIDADE FILAS / INSTAGRAM / CONFIG
════════════════════════════ */

function ensureWeekDataShapeV416(data) {
  const safe = data && typeof data === 'object' ? data : {};
  safe.days = safe.days && typeof safe.days === 'object' ? safe.days : {};
  safe.importados = Array.isArray(safe.importados) ? safe.importados : [];
  safe.validacao = Array.isArray(safe.validacao) ? safe.validacao : [];
  safe.atribuicao = Array.isArray(safe.atribuicao) ? safe.atribuicao : [];
  safe.instagram = safe.instagram && typeof safe.instagram === 'object' ? safe.instagram : {};
  safe.instagram.backlog = Array.isArray(safe.instagram.backlog) ? safe.instagram.backlog : [];
  safe.instagram.days = safe.instagram.days && typeof safe.instagram.days === 'object' ? safe.instagram.days : {};
  safe.whatsapp = safe.whatsapp && typeof safe.whatsapp === 'object' ? safe.whatsapp : {};
  safe.whatsapp.backlog = Array.isArray(safe.whatsapp.backlog) ? safe.whatsapp.backlog : [];
  safe.whatsapp.days = safe.whatsapp.days && typeof safe.whatsapp.days === 'object' ? safe.whatsapp.days : {};
  return safe;
}

if (typeof ensureWeekData === 'function') {
  const oldEnsureWeekDataV416 = ensureWeekData;
  ensureWeekData = function() {
    try {
      return ensureWeekDataShapeV416(oldEnsureWeekDataV416());
    } catch(e) {
      console.warn('ensureWeekData protegido:', e?.message || e);
      return ensureWeekDataShapeV416({});
    }
  };
}

function getDisparoConfigSafeV416() {
  const defaults = {
    delayMin: 120,
    delayMax: 120,
    loteTamanho: 30,
    loteEsperaMin: 60,
    loteAtivo: 1,
    horarioInicio: '08:00'
  };

  try {
    const cfg = typeof getDisparoConfig === 'function' ? getDisparoConfig() : {};
    return { ...defaults, ...(cfg || {}) };
  } catch {
    return defaults;
  }
}

function getQueueControlSafeV416() {
  try {
    const c = typeof getWhatsappQueueControl === 'function' ? getWhatsappQueueControl() : null;
    return c && typeof c === 'object' ? { paused: !!c.paused } : { paused:false };
  } catch {
    return { paused:false };
  }
}

function getWhatsappQueueSafeV416() {
  try {
    const q = typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

/* Corrige Object.values(null) em sincronização da fila */
if (typeof sincronizarFilaComEnviados === 'function') {
  const oldSincronizarFilaComEnviadosV416 = sincronizarFilaComEnviados;
  sincronizarFilaComEnviados = function() {
    try {
      const data = ensureWeekDataShapeV416(typeof ensureWeekData === 'function' ? ensureWeekData() : {});
      return oldSincronizarFilaComEnviadosV416(data);
    } catch(e) {
      console.warn('sincronizarFilaComEnviados protegido:', e?.message || e);
      return [];
    }
  };
}

/* Corrige fila WhatsApp quebrando se estado operacional vem nulo */
const renderFilaZapOriginalV416 = typeof renderFilaZap === 'function' ? renderFilaZap : null;
if (renderFilaZapOriginalV416) {
  renderFilaZap = function() {
    try {
      return renderFilaZapOriginalV416();
    } catch(e) {
      console.warn('renderFilaZap protegido:', e?.message || e);
      if (typeof renderFilaZapSafeV4110 === 'function') return renderFilaZapSafeV4110();
    }
  };
}

/* Corrige Instagram quando days/backlog vem null */
function instaCountForDay(dayKey) {
  try {
    const data = ensureWeekDataShapeV416(typeof ensureWeekData === 'function' ? ensureWeekData() : {});
    const instagram = data.instagram || {};
    const days = instagram.days || {};
    const list = days[dayKey] || [];
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

if (typeof renderInstagram === 'function') {
  const oldRenderInstagramV416 = renderInstagram;
  renderInstagram = function() {
    try {
      return oldRenderInstagramV416();
    } catch(e) {
      console.warn('renderInstagram protegido:', e?.message || e);
      const panel = document.getElementById('panel-instagram');
      if (panel) {
        panel.innerHTML = `
          <div class="page-header">
            <div class="page-title">Instagram <span>Fila.</span></div>
            <div class="page-sub">// backlog · dados protegidos</div>
          </div>
          <div class="stretch-card">
            <div class="audit-v35-empty">
              // Nenhum lead de Instagram disponível ou dados de dias ainda não inicializados.
            </div>
          </div>
        `;
      }
    }
  };
}

/* updateBadges sem Object.values(null) */
function updateBadges() {
  try {
    const data = ensureWeekDataShapeV416(typeof ensureWeekData === 'function' ? ensureWeekData() : {});
    const leads = typeof flattenWeekData === 'function' ? (flattenWeekData(data) || []) : [];

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set('badge-inicio', leads.length || 0);
    set('badge-importar', data.importados.length || 0);
    set('badge-import', data.importados.length || 0);
    set('badge-validacao', data.validacao.length || leads.filter(l => l.status === 'validacao').length || 0);
    set('badge-atribuicao', data.atribuicao.length || leads.filter(l => l.status === 'atribuicao').length || 0);
    set('badge-fila-zap', getWhatsappQueueSafeV416().length);
    set('badge-whatsapp-queue', getWhatsappQueueSafeV416().length);
    set('badge-instagram', (data.instagram.backlog || []).length);
    set('badge-followups', 0);
    set('badge-acompanhamento', 0);

    if (typeof updateInboxBadgeV41 === 'function') updateInboxBadgeV41();
    if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  } catch(e) {
    console.warn('updateBadges protegido:', e?.message || e);
  }
}

/* Captura global para evitar tela morrer por dados nulos */
window.addEventListener('error', function(e){
  const msg = String(e.message || '');
  if (
    msg.includes("Cannot convert undefined or null to object") ||
    msg.includes("Cannot read properties of null") ||
    msg.includes("Cannot set properties of null")
  ) {
    console.warn('Erro nulo protegido V41.6:', msg);
    e.preventDefault?.();
  }
});





/* ════════════════════════════
   V41.8 — WHATSAPP FILA FINAL SAFE
════════════════════════════ */
function getSafeWhatsappQueueV418() {
  try {
    const q = typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function sincronizarFilaComEnviados() {
  try {
    const data = typeof ensureWeekData === 'function' ? ensureWeekData() : {};
    const safe = data && typeof data === 'object' ? data : {};
    const days = safe.days && typeof safe.days === 'object' ? safe.days : {};
    const enviados = [];

    Object.values(days).forEach(list => {
      if (!Array.isArray(list)) return;
      list.forEach(lead => {
        if (lead && (lead.status === 'enviado' || lead.whatsappStatus === 'sent')) enviados.push(lead);
      });
    });

    return { fila: getSafeWhatsappQueueV418(), enviados };
  } catch(e) {
    console.warn('sincronizarFilaComEnviados protegido V41.8:', e?.message || e);
    return { fila: getSafeWhatsappQueueV418(), enviados: [] };
  }
}

function renderFilaZapSafeV418() {
  const panel = document.getElementById('panel-fila-zap') || document.getElementById('panel-whatsappQueue');
  if (!panel) return;

  const queue = getSafeWhatsappQueueV418();
  const config = getDisparoConfigSafeV418();

  panel.innerHTML = `
    <div class="page-header">
      <div class="page-title">WhatsApp <span>Fila.</span></div>
      <div class="page-sub">// disparos · ${queue.length} lead(s) na fila</div>
    </div>

    <div class="stretch-card">
      <div class="audit-v35-toolbar">
        <div>
          <div class="card-title">Fila de disparo</div>
          <div class="page-sub">${(config ?? getDisparoConfigSafeV418()).delayMin}s entre mensagens · ${(config ?? getDisparoConfigSafeV418()).loteTamanho} por lote · pausa ${(config ?? getDisparoConfigSafeV418()).loteEsperaMin}min</div>
        </div>
        <button class="btn btn-ghost" onclick="renderFilaZapSafeV418()">Atualizar</button>
      </div>

      ${queue.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Telefone</th>
                <th>Status</th>
                <th>Chip</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${queue.map(item => `
                <tr>
                  <td>${escHtml(item.nome || item.name || item.leadName || 'Lead')}</td>
                  <td>${escHtml(item.phone || item.whatsapp || item.telefone || '')}</td>
                  <td>${escHtml(item.status || 'Pendente')}</td>
                  <td>${escHtml(item.chipName || item.chip || '')}</td>
                  <td><button class="btn btn-ghost" onclick="removeLeadFromWhatsappQueue('${escHtml(item.leadId || item.id || '')}')">Remover</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="audit-v35-empty">// fila vazia</div>`}
    </div>
  `;

  try { updateBadges(); } catch(e) {}
}

function renderFilaZapFallbackV418() {
  return renderFilaZapSafeV418();
}

window.addEventListener('error', function(e){
  const msg = String(e.message || '');
  if (msg.includes('delayMin') || msg.includes('Cannot convert undefined or null to object')) {
    console.warn('Erro WhatsApp/Fila protegido V41.8:', msg);
    e.preventDefault?.();
    setTimeout(() => { try { renderFilaZap(); } catch(err){} }, 30);
  }
});


/* ════════════════════════════
   V41.10 — FILA WHATSAPP ESTÁVEL
════════════════════════════ */
function getFilaWhatsappConfigV4110(){
  const defaults = {
    horarioInicio:'08:00',
    delayMin:120,
    delayMax:120,
    loteTamanho:30,
    loteEsperaMin:60,
    loteAtivo:1
  };
  try {
    const cfg = typeof loadEvoConfig === 'function' ? loadEvoConfig() : null;
    return cfg && typeof cfg === 'object' ? { ...defaults, ...cfg } : defaults;
  } catch {
    return defaults;
  }
}

function getFilaWhatsappItemsV4110(){
  try {
    const q = typeof getWhatsappQueueV27 === 'function' ? getWhatsappQueueV27() : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function renderFilaZapSafeV4110(){
  const panel = document.getElementById('panel-fila-zap') || document.getElementById('panel-whatsappQueue');
  if (!panel) return;

  const queue = getFilaWhatsappItemsV4110();
  const cfg = getFilaWhatsappConfigV4110();
  const byStatus = (status) => queue.filter(i => String(i.status || '').toLowerCase() === status).length;

  panel.innerHTML = `
    <div class="page-header">
      <div class="page-title">WhatsApp <span>Fila.</span></div>
      <div class="page-sub">// fila de disparo · ${queue.length} lead(s)</div>
    </div>

    <div class="inbox-v41-grid">
      <div class="inbox-v41-card"><div class="inbox-v41-label">Na fila</div><div class="inbox-v41-value">${queue.length}</div></div>
      <div class="inbox-v41-card"><div class="inbox-v41-label">Prontos</div><div class="inbox-v41-value">${byStatus('pronto')}</div></div>
      <div class="inbox-v41-card"><div class="inbox-v41-label">Enviados</div><div class="inbox-v41-value">${byStatus('enviado')}</div></div>
    </div>

    <div class="stretch-card">
      <div class="audit-v35-toolbar">
        <div>
          <div class="card-title">Fila de disparo</div>
          <div class="page-sub">${cfg.delayMin}s entre mensagens · ${cfg.loteTamanho} por lote · pausa ${cfg.loteEsperaMin}min · início ${cfg.horarioInicio}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="renderFilaZapSafeV4110()">Atualizar</button>
          ${typeof prepareQueueTemplates === 'function' ? `<button class="btn btn-primary" onclick="prepareQueueTemplates()">Sortear templates</button>` : ''}
        </div>
      </div>

      ${queue.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Lead</th><th>Telefone</th><th>Status</th><th>Chip</th><th>Ações</th></tr></thead>
            <tbody>
              ${queue.map(item => `
                <tr>
                  <td>${escHtml(item.nome || item.name || item.leadName || item.companyName || 'Lead')}</td>
                  <td>${escHtml(item.phone || item.whatsapp || item.telefone || '')}</td>
                  <td>${escHtml(item.status || 'Pendente')}</td>
                  <td>${escHtml(item.chipName || item.chip || item.chipId || '')}</td>
                  <td><button class="btn btn-ghost" onclick="removeLeadFromWhatsappQueue('${escHtml(item.leadId || item.id || '')}')">Remover</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="audit-v35-empty">// fila vazia</div>`}
    </div>
  `;

  try { updateBadges(); } catch(e) {}
}

function renderFilaZapFallbackV4110(){
  return renderFilaZapSafeV4110();
}

window.addEventListener('error', function(e){
  const msg = String(e.message || '');
  if (msg.includes('delayMin') || msg.includes('delayMax') || msg.includes('loteTamanho')) {
    console.warn('Config da fila protegida V41.10:', msg);
    e.preventDefault?.();
    setTimeout(() => { try { renderFilaZap(); } catch(err){} }, 50);
  }
}, true);
