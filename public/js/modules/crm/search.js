/* ════════════════════════════
   GLOBAL SEARCH
════════════════════════════ */
function getAllSearchableLeads() {
  const byId = new Map();

  const add = (lead, source) => {
    if (!lead || !lead.id || byId.has(lead.id)) return;
    byId.set(lead.id, { ...normalizeLeadForDrawer(lead), source });
  };

  try {
    const data = ensureWeekData();
    Object.values(data.days || {}).flat().forEach(lead => add(lead, 'Semana'));
  } catch {}

  try { getAtribuicaoData().forEach(lead => add(lead, 'Atribuição')); } catch {}
  try { getValData().forEach(lead => add(lead, 'Validação')); } catch {}
  try { getInstaFila().forEach(lead => add(lead, 'Instagram')); } catch {}
  try { getZapBacklog().forEach(lead => add(lead, 'Fila WhatsApp')); } catch {}

  try {
    const acomp = getAcompData();
    Object.values(acomp || {}).flat().forEach(lead => add(lead, 'Acompanhamento'));
  } catch {}

  try {
    Object.values(filaDisparo || {}).flat().forEach(lead => add(lead, 'Fila WhatsApp'));
  } catch {}

  try { getLeadBaseData().forEach(lead => add(lead, 'Base permanente')); } catch {}

  return [...byId.values()];
}

function openGlobalSearch() {
  const overlay = document.getElementById('globalSearchOverlay');
  const input = document.getElementById('globalSearchInput');
  if (!overlay || !input) return;
  overlay.classList.add('open');
  input.value = '';
  renderGlobalSearchResults();
  setTimeout(() => input.focus(), 50);
}

function closeGlobalSearch(event) {
  if (event && event.target && event.target.id !== 'globalSearchOverlay') return;
  const overlay = document.getElementById('globalSearchOverlay');
  if (overlay) overlay.classList.remove('open');
}

function renderGlobalSearchResults() {
  const input = document.getElementById('globalSearchInput');
  const box = document.getElementById('globalSearchResults');
  if (!input || !box) return;

  const q = normalizeStr(input.value || '');
  if (!q) {
    box.innerHTML = '<div class="global-search-empty">// comece a digitar para pesquisar</div>';
    return;
  }

  const leads = getAllSearchableLeads();
  const results = leads.filter(lead => {
    const haystack = normalizeStr([
      lead.nome,
      lead.categoria,
      lead.cidade,
      lead.estado,
      lead.whatsapp,
      lead.instagram,
      lead.site,
      lead.googleUrl,
      lead.status,
      lead.source
    ].filter(Boolean).join(' '));
    return haystack.includes(q);
  }).slice(0, 30);

  if (!results.length) {
    box.innerHTML = `<div class="global-search-empty">// nenhum resultado para "${escHtml(input.value)}"</div>`;
    return;
  }

  box.innerHTML = results.map(lead => `
    <button class="global-search-result" onclick="openLeadFromGlobalSearch('${escHtml(lead.id)}')">
      <div class="global-search-result-main">
        <div class="global-search-result-name">${escHtml(lead.nome)}</div>
        <div class="global-search-result-meta">
          ${lead.whatsapp ? `<span>📱 ${escHtml(lead.whatsapp)}</span>` : ''}
          ${lead.instagram ? `<span>📸 ${escHtml(lead.instagram)}</span>` : ''}
          ${lead.site ? `<span>🌐 ${escHtml(lead.site)}</span>` : ''}
          ${lead.source ? `<span>${escHtml(lead.source)}</span>` : ''}
        </div>
      </div>
      <span class="global-search-result-status">${escHtml(lead.status || 'sem status')}</span>
    </button>
  `).join('');
}

function openLeadFromGlobalSearch(id) {
  closeGlobalSearch();
  openLeadDrawer(id);
}

document.addEventListener('keydown', (event) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const cmdK = (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k';

  if (cmdK) {
    event.preventDefault();
    openGlobalSearch();
    return;
  }

  if (event.key === 'Escape') {
    const searchOverlay = document.getElementById('globalSearchOverlay');
    if (searchOverlay?.classList.contains('open')) {
      closeGlobalSearch();
    }
  }
});


