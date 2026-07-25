const STORAGE_KEYS = {
  approve: 'siteLeadsApproveText',
  invalidate: 'siteLeadsInvalidateText',
  activeTab: 'siteLeadsActiveTab'
};

const state = { activeTab: 'approve', busy: false };
const el = {
  tabs: [...document.querySelectorAll('[data-tab]')],
  panels: [...document.querySelectorAll('[data-panel]')],
  approveText: document.getElementById('approveText'),
  invalidateText: document.getElementById('invalidateText'),
  approveCounter: document.getElementById('approveCounter'),
  invalidateCounter: document.getElementById('invalidateCounter'),
  approveResult: document.getElementById('approveResult'),
  invalidateResult: document.getElementById('invalidateResult')
};

function textarea(action) { return action === 'approve' ? el.approveText : el.invalidateText; }
function counter(action) { return action === 'approve' ? el.approveCounter : el.invalidateCounter; }
function result(action) { return action === 'approve' ? el.approveResult : el.invalidateResult; }

function parseLinks(value) {
  const unique = new Set();
  String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean).forEach(value => unique.add(value));
  return [...unique];
}

function updateCounter(action) {
  const links = parseLinks(textarea(action).value);
  counter(action).textContent = `${links.length} ${links.length === 1 ? 'link' : 'links'}`;
}

async function persist(action) {
  await chrome.storage.local.set({ [STORAGE_KEYS[action]]: textarea(action).value });
}

function selectTab(action) {
  state.activeTab = action;
  el.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === action));
  el.panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === action));
  chrome.storage.local.set({ [STORAGE_KEYS.activeTab]: action });
}

function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('button').forEach(button => button.disabled = value);
}

function configurationError() {
  const cfg = globalThis.SITE_LEADS_CONFIG || SITE_LEADS_CONFIG;
  return !cfg.apiBaseUrl || cfg.apiBaseUrl.includes('SEU-DOMINIO') || !cfg.secret || cfg.secret.includes('COLOQUE-AQUI');
}

async function submit(action) {
  if (state.busy) return;
  const links = parseLinks(textarea(action).value);
  const output = result(action);
  output.className = 'result';
  if (!links.length) {
    output.classList.add('error');
    output.textContent = 'Cole pelo menos um link.';
    return;
  }
  if (configurationError()) {
    output.classList.add('error');
    output.textContent = 'Configure apiBaseUrl e secret no arquivo config.js da extensão.';
    return;
  }

  setBusy(true);
  output.textContent = action === 'approve' ? 'Aprovando leads...' : 'Invalidando leads...';
  try {
    const cfg = globalThis.SITE_LEADS_CONFIG || SITE_LEADS_CONFIG;
    const response = await fetch(`${cfg.apiBaseUrl.replace(/\/$/, '')}/api/site-leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-site-leads-extension-secret': cfg.secret
      },
      body: JSON.stringify({ action, links })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`);

    const lines = [
      `Recebidos: ${payload.received || 0}`,
      `${action === 'approve' ? 'Aprovados' : 'Invalidados'}: ${payload.changed || 0}`,
      `Já estavam assim: ${payload.already || 0}`,
      `Não encontrados: ${(payload.not_found || []).length}`,
      `Ambíguos: ${(payload.ambiguous || []).length}`
    ];
    if ((payload.errors || []).length) lines.push(`Erros: ${payload.errors.length}`);
    output.classList.add(payload.errors?.length ? 'error' : 'success');
    output.textContent = lines.join('\n');

    if (!payload.errors?.length) {
      textarea(action).value = '';
      await persist(action);
      updateCounter(action);
    }
  } catch (error) {
    output.classList.add('error');
    output.textContent = error instanceof Error ? error.message : 'Falha ao conectar com a plataforma.';
  } finally {
    setBusy(false);
  }
}

async function clearAction(action) {
  textarea(action).value = '';
  result(action).textContent = '';
  result(action).className = 'result';
  await persist(action);
  updateCounter(action);
}

el.tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
document.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => clearAction(button.dataset.clear)));
document.querySelectorAll('[data-submit]').forEach(button => button.addEventListener('click', () => submit(button.dataset.submit)));
['approve', 'invalidate'].forEach(action => {
  textarea(action).addEventListener('input', () => { updateCounter(action); persist(action); });
});

chrome.storage.local.get(Object.values(STORAGE_KEYS)).then(saved => {
  el.approveText.value = saved[STORAGE_KEYS.approve] || '';
  el.invalidateText.value = saved[STORAGE_KEYS.invalidate] || '';
  updateCounter('approve');
  updateCounter('invalidate');
  selectTab(saved[STORAGE_KEYS.activeTab] === 'invalidate' ? 'invalidate' : 'approve');
});
