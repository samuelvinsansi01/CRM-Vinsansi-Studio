/* ════════════════════════════
   LEAD PRESENTATIONS V16.1 VISIBILITY FIX
════════════════════════════ */
function presentationLogV427(event, payload = {}) {
  try { console.log(`[lead-presentations][${event}]`, payload); } catch (_) {}
}

function ensureLeadPresentationsContainer() {
  if (document.getElementById('leadPresentationsList')) return true;

  const drawer = document.getElementById('leadDrawer');
  if (!drawer) return false;

  const target =
    document.getElementById('leadTimelineList') ||
    document.getElementById('leadNotesList') ||
    document.getElementById('leadHistoryList');

  const block = document.createElement('div');
  block.className = 'lead-presentations-block';
  block.innerHTML = `
    <div class="lead-presentation-title-label">Apresentações</div>
    <div class="lead-presentation-form">
      <input id="leadPresentationTitle" type="text" placeholder="Nome da apresentação. Ex: Site Institucional V1">
      <div class="lead-presentation-row">
        <input id="leadPresentationDeskUrl" type="url" placeholder="URL desktop">
        <input id="leadPresentationMobUrl" type="url" placeholder="URL mobile">
      </div>
      <button class="btn btn-primary" onclick="addLeadPresentation()">+ Vincular apresentação</button>
    </div>
    <div id="leadPresentationsList" class="lead-presentations-list"></div>
  `;

  if (target && target.parentElement) {
    target.parentElement.insertAdjacentElement('beforebegin', block);
  } else {
    drawer.appendChild(block);
  }

  return true;
}

/* ════════════════════════════
   LEAD PRESENTATIONS V16
════════════════════════════ */
function ensureLeadPresentations(id) {
  const crm = ensureLeadCrm(id, activeLeadDrawerData || {});
  crm.presentations = Array.isArray(crm.presentations) ? crm.presentations : [];
  saveLeadCrm(id, crm);
  return crm.presentations;
}

function presentationPublicUrl(presentation) {
  if (presentation.shortUrl) return presentation.shortUrl;
  if (presentation.alias) return `${window.location.origin}/r.html?a=${encodeURIComponent(presentation.alias)}`;
  return presentation.deskUrl || presentation.mobUrl || '';
}

function renderLeadPresentations() {
  presentationLogV427('render', { leadId: activeLeadDrawerId });
  ensureLeadPresentationsContainer();
  const list = document.getElementById('leadPresentationsList');
  if (!list || !activeLeadDrawerId) return;

  const presentations = ensureLeadPresentations(activeLeadDrawerId);

  if (!presentations.length) {
    list.innerHTML = renderPresentationMetricsHeader() + '<div class="lead-presentation-empty">// nenhuma apresentação vinculada a este lead</div>';
    return;
  }

  list.innerHTML = renderPresentationMetricsHeader() + presentations.slice().reverse().map(p => {
    const url = presentationPublicUrl(p);
    return `
      <div class="lead-presentation-item">
        <div class="lead-presentation-title">${escHtml(p.title || 'Apresentação')}</div>
        <div class="lead-presentation-meta">
          <span>${escHtml(p.createdAtLabel || p.createdAt || '')}</span>
          ${p.alias ? `<span>alias: ${escHtml(p.alias)}</span>` : ''}
          ${p.views ? `<span>${p.views} visualizações</span>` : '<span>0 visualizações</span>'}${p.lastViewedAtLabel ? `<span>último acesso: ${escHtml(p.lastViewedAtLabel)}</span>` : ''}
        </div>
        ${url ? `<div class="lead-presentation-link">${escHtml(url)}</div>` : ''}
        <div class="lead-presentation-actions">
          ${url ? `<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" href="${escHtml(url)}" target="_blank" rel="noopener">Abrir</a>` : ''}
          ${url ? `<button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="copyLeadPresentationUrl('${escHtml(url)}')">Copiar link</button>` : ''}
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="markLeadPresentationViewed(\'${escHtml(p.id)}\')">Registrar visualização</button>\n          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removeLeadPresentation('${escHtml(p.id)}')">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

async function addLeadPresentation() {
  if (!activeLeadDrawerId) return;
  presentationLogV427('add-click', { leadId: activeLeadDrawerId });

  const titleEl = document.getElementById('leadPresentationTitle');
  const deskEl = document.getElementById('leadPresentationDeskUrl');
  const mobEl = document.getElementById('leadPresentationMobUrl');

  const title = (titleEl?.value || '').trim();
  const deskUrl = (deskEl?.value || '').trim();
  const mobUrl = (mobEl?.value || '').trim();

  if (!title) {
    notify('Informe um nome para a apresentação.', 'warn');
    return;
  }

  if (!deskUrl && !mobUrl) {
    notify('Informe pelo menos uma URL da apresentação.', 'warn');
    return;
  }

  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  crm.presentations = Array.isArray(crm.presentations) ? crm.presentations : [];

  const leadName = activeLeadDrawerData?.nome || title;
  const safeName = normalizeStr(`${leadName} ${title}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const alias = `${safeName || 'apresentacao'}-${Date.now().toString(36)}`;

  const presentation = {
    id: genId(),
    title,
    deskUrl,
    mobUrl,
    alias,
    views: 0,
    createdAt: new Date().toISOString(),
    createdAtLabel: crmNowLabel()
  };

  crm.presentations.push(presentation);
  saveLeadCrm(activeLeadDrawerId, crm);
  presentationLogV427('add-local-success', { leadId: activeLeadDrawerId, presentation });

  addLeadHistory(activeLeadDrawerId, `Apresentação vinculada: ${title}`, activeLeadDrawerData || {});

  // Tenta aproveitar API existente de encurtamento/redirect sem quebrar se não existir.
  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: alias,
        deskUrl: deskUrl || mobUrl,
        mobUrl: mobUrl || deskUrl
      })
    });

    if (res.ok) {
      const data = await res.json();
      presentationLogV427('shorten-success', { leadId: activeLeadDrawerId, data });
      const store = getLeadCrmStore();
      const current = store[activeLeadDrawerId];
      const found = current?.presentations?.find(p => p.id === presentation.id);
      if (found) {
        found.shortUrl = data.shortUrl || data.url || data.tinyUrl || found.shortUrl;
        found.redirectUrl = data.redirectUrl || found.redirectUrl;
      }
      saveLeadCrmStore(store);
      if (typeof scheduleLeadCrmCloudSyncV427 === 'function') scheduleLeadCrmCloudSyncV427(activeLeadDrawerId, 'presentation-short-url');
    }
  } catch (err) {
    presentationLogV427('shorten-error', { leadId: activeLeadDrawerId, error: err?.message || err });
    console.warn('[presentations] api shorten indisponível:', err?.message || err);
  }

  if (titleEl) titleEl.value = '';
  if (deskEl) deskEl.value = '';
  if (mobEl) mobEl.value = '';

  renderLeadPresentations();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Apresentação vinculada ao lead.');
}

function removeLeadPresentation(id) {
  if (!activeLeadDrawerId) return;
  presentationLogV427('remove-click', { leadId: activeLeadDrawerId, presentationId: id });
  const crm = ensureLeadCrm(activeLeadDrawerId, activeLeadDrawerData || {});
  const item = (crm.presentations || []).find(p => p.id === id);
  crm.presentations = (crm.presentations || []).filter(p => p.id !== id);
  saveLeadCrm(activeLeadDrawerId, crm);
  addLeadHistory(activeLeadDrawerId, `Apresentação removida${item?.title ? ': ' + item.title : ''}`, activeLeadDrawerData || {});
  renderLeadPresentations();
  if (typeof renderLeadTimeline === 'function') renderLeadTimeline(activeLeadDrawerId);
  notify('Apresentação removida.');
}

function copyLeadPresentationUrl(url) {
  presentationLogV427('copy-url', { leadId: activeLeadDrawerId, url });
  navigator.clipboard?.writeText(url);
  notify('Link copiado.');
}


