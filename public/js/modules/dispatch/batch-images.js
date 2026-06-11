// ── Configuração por lote (ramo — sem imagem aqui) ────────────────
const LOTE_CFG_KEY = 'vs_lote_cfg_v1';
function getLoteCfg() {
  try {
    const cfg = JSON.parse(localStorage.getItem(LOTE_CFG_KEY) || '{}');
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch(e) {
    return {};
  }
}
function saveLoteCfg(cfg) {
  try {
    localStorage.setItem(LOTE_CFG_KEY, JSON.stringify(cfg));
    uiSyncLogV426('optimistic-update', { entity:'dispatch-batch-config', action:'save-local-cache', count:Object.keys(cfg || {}).length });
    scheduleLegacyOperationalSyncV36({ delay:400, reason:'dispatch-batch-config-update' });
  } catch(e) {
    uiSyncLogV426('supabase-save-error', { entity:'dispatch-batch-config', action:'save-local-cache', error:e?.message || e });
  }
}
function getLoteCfgKey(chipId, loteNum) { return `chip-${chipId}-lote-${loteNum}`; }
function getLoteRamo(chipId, loteNum) {
  const cfg = getLoteCfg();
  return (cfg[getLoteCfgKey(chipId, loteNum)] || {}).ramoId || null;
}
function setLoteRamo(chipId, loteNum, ramoId) {
  const cfg = getLoteCfg();
  const k = getLoteCfgKey(chipId, loteNum);
  if (!cfg[k]) cfg[k] = {};
  cfg[k].ramoId = ramoId || null;
  saveLoteCfg(cfg);
}

// ── IndexedDB para imagens de lote (suporta arquivos grandes >5MB) ──
const IDB_NAME = 'vs_lote_imgs';
const IDB_STORE = 'imgs';
let _idb = null;
function abrirIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = e => rej(e.target.error);
  });
}
function idbSet(key, value) {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  }));
}
function idbGet(key) {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = e => res(e.target.result || null);
    req.onerror   = e => rej(e.target.error);
  }));
}
function idbDel(key) {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  }));
}
function idbGetAllKeys() {
  return abrirIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = e => res(e.target.result || []);
    req.onerror   = e => rej(e.target.error);
  }));
}

// Cache em memória para imagens já carregadas nesta sessão
const _imgCache = {};

function getLoteImgKey(chipId, loteNum) { return `chip-${chipId}-lote-${loteNum}`; }

// Retorna a imagem do cache síncrono (pode ser null enquanto ainda não carregou)
function getLoteImagem(chipId, loteNum) {
  return _imgCache[getLoteImgKey(chipId, loteNum)] || null;
}

// Carrega a imagem do IDB para o cache e re-renderiza o slot
function carregarImagensLote(chipId, loteNum, slot, isSlot) {
  const k = getLoteImgKey(chipId, loteNum);
  if (_imgCache[k] !== undefined) return; // já carregado
  idbGet(k).then(val => {
    _imgCache[k] = val || null;
    if (val) {
      // Atualiza apenas o elemento de preview sem re-renderizar tudo
      const previewEls = document.querySelectorAll(`[data-lote-img-key="${k}"]`);
      previewEls.forEach(el => {
        el.src = val;
        const wrapper = el.closest('.fila-img-area');
        if (wrapper) {
          wrapper.classList.add('has-img');
          // Garante que o label de placeholder não apareça
          const label = wrapper.querySelector('.fila-img-label');
          if (label) label.style.display = 'none';
          const ok = wrapper.querySelector('.fila-img-ok');
          if (ok) ok.style.display = '';
          const rmBtn = wrapper.querySelector('.fila-remove-btn');
          if (rmBtn) rmBtn.style.display = '';
        }
      });
    }
  }).catch(() => {});
}

function setLoteImagem(chipId, loteNum, base64, nome) {
  const k = getLoteImgKey(chipId, loteNum);
  _imgCache[k] = base64 || null;
  uiSyncLogV426('optimistic-update', { entity:'dispatch-batch-image', action:'save-local-idb', chipId, loteNum, nome:nome || '' });
  return idbSet(k, base64 || null);
}

function removerLoteImagem(chipId, loteNum) {
  const k = getLoteImgKey(chipId, loteNum);
  _imgCache[k] = null;
  return idbDel(k);
}

// Limpa imagens de lotes que já não existem em nenhum chip (limpeza automática)
function limparImagensOlfas() {
  const chips = getChips();
  idbGetAllKeys().then(keys => {
    keys.forEach(k => {
      const m = k.match(/^chip-(.+)-lote-(\d+)$/);
      if (!m) return;
      const chipId = m[1], loteNum = parseInt(m[2]);
      const chip = chips.find(c => c.id === chipId);
      if (!chip) { idbDel(k); delete _imgCache[k]; return; }
      const fila = getFilaChip(chipId);
      const LOTE_SIZE = getLoteSize();
      const maxLote = Math.ceil(fila.length / LOTE_SIZE);
      if (loteNum > maxLote) { idbDel(k); delete _imgCache[k]; }
    });
  }).catch(() => {});
}

function onLoteRamoChange(chipId, loteNum, ramoId, isSlot, slot) {
  setLoteRamo(chipId, loteNum, ramoId);
  const LOTE_SIZE = getLoteSize();
  // Usa fila filtrada pelo dia — mesmos itens e mesma ordem que o render
  const filaDia = getFilaChipNoDia(chipId, disparoDay);
  const loteIdx = loteNum - 1;
  const inicio = loteIdx * LOTE_SIZE;
  const fim = Math.min(inicio + LOTE_SIZE, filaDia.length);
  // Atualiza os itens por referência (eles existem também em filaDisparo[chipId])
  for (let i = inicio; i < fim; i++) {
    const item = filaDia[i];
    if (!item || item.status === 'enviado') continue;
    item.ramoId = ramoId || null;
    if (ramoId) {
      const { text, idx } = pickTemplate(item.nome, ramoId);
      item.mensagem = text; item.templateIdx = idx;
    } else {
      item.mensagem = ''; item.templateIdx = -1;
    }
  }
  saveFilaDisparo();
  if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
}

function onLoteImgChange(chipId, loteNum, input, isSlot, slot) {
  const file = input.files[0]; if (!file) return;
  // Feedback imediato: mostra "carregando..."
  const areaEl = input.previousElementSibling;
  if (areaEl && areaEl.classList.contains('fila-img-area')) {
    areaEl.innerHTML = `<span class="fila-img-label" style="color:var(--warning)">⏳ carregando imagem...</span>`;
  }
  const reader = new FileReader();
  reader.onload = e => {
    setLoteImagem(chipId, loteNum, e.target.result, file.name)
      .then(() => {
        notify('✓ Imagem do lote salva');
        if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
      })
      .catch(err => {
        notify('// erro ao salvar imagem: ' + (err && err.message ? err.message : err), 'err');
        // mesmo com erro tenta mostrar preview em memória
        if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
      });
  };
  reader.onerror = () => notify('// erro ao ler arquivo', 'err');
  reader.readAsDataURL(file);
}

function onLoteImgRemove(chipId, loteNum, isSlot, slot) {
  removerLoteImagem(chipId, loteNum).then(() => {
    if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
  }).catch(() => {
    if (isSlot) renderFilaSlot(slot, disparoDay); else renderFila();
  });
}

