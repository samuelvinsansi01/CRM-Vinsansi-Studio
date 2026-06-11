/* ════════════════════════════
   CONFIGURAÇÕES
════════════════════════════ */
function renderConfiguracoes() {
  renderChipsConfig();
  renderRamosConfig();
  renderTemplatesConfig();
  renderInstaTemplatesConfig();
}

/* CHIPS */
function abrirModalNovoChip() {
  document.getElementById('chipNome').value = '';
  document.getElementById('chipUrl').value = '';
  document.getElementById('chipLegacyInstance').value = '';
  document.getElementById('chipKey').value = '';
  document.getElementById('chipModal').classList.add('open');
}
function fecharChipModal() { document.getElementById('chipModal').classList.remove('open'); }

function salvarChip() {
  const nome     = document.getElementById('chipNome').value.trim();
  const url      = document.getElementById('chipUrl').value.trim();
  const instance = document.getElementById('chipLegacyInstance').value.trim();
  const key      = document.getElementById('chipKey').value.trim();
  if (!nome || !url || !instance || !key) { notify('// preencha todos os campos','err'); return; }
  const chips = getChips();
  chips.push({ id: genId(), nome, url, instance, key, status: 'desconectado' });
  saveChips(chips);
  fecharChipModal(); renderConfiguracoes(); updateBadges();
  notify('✓ Chip salvo');
}

function renderChipsConfig() {
  const chips = getChips();
  const grid  = document.getElementById('chipGrid');
  if (!chips.length) {
    grid.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Nenhum chip configurado. Adicione os chips usados na operação.</div>';
    return;
  }
  grid.innerHTML = chips.map(c => `<div class="chip-card">
    <div class="chip-card-header">
      <div class="chip-dot ${c.status==='conectado'?'on':'off'}"></div>
      <div style="flex:1;min-width:0">
        <div class="chip-name" id="chipNameDisplay_${c.id}">${escHtml(c.nome)}</div>
        <div class="chip-instance">${escHtml(c.instance)}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost" style="font-size:10px;padding:6px 12px" onclick="verQRChip('${c.id}')">📱 QR Code</button>
      <button class="btn btn-ghost" style="font-size:10px;padding:6px 12px" onclick="iniciarRenomeioChip('${c.id}')">✏ Renomear</button>
      <button class="btn btn-danger chip-del" style="font-size:10px;padding:6px 12px" onclick="deletarChip('${c.id}')">✕ Remover</button>
    </div>
    <div id="renamePanel_${c.id}" style="display:none;margin-top:10px;display:none">
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" id="renameInput_${c.id}" value="${escHtml(c.nome)}" placeholder="Novo nome..." style="flex:1;font-size:11px;padding:7px 10px"/>
        <button class="btn btn-primary" style="font-size:10px;padding:6px 12px;white-space:nowrap" onclick="confirmarRenomeioCip('${c.id}')">✓ Salvar</button>
        <button class="btn btn-ghost" style="font-size:10px;padding:6px 10px" onclick="cancelarRenomeioChip('${c.id}')">✕</button>
      </div>
    </div>
  </div>`).join('');
}

async function verQRChip(id) {
  qrChipIdAtivo = id;
  const chip = getChipById(id);
  if (!chip) return;
  document.getElementById('qrChipNome').textContent = chip.nome;
  document.getElementById('qrModal').classList.add('open');
  await carregarQR(chip);
}

async function carregarQR(chip) {
  document.getElementById('qrWrap').innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Gerando QR Code...</div>';
  try {
    const res = await fetch(`${chip.url}/instance/connect/${chip.instance}`, { headers: { 'apikey': chip.key } });
    const data = await res.json();
    const qr = data.qrcode?.base64 || data.base64 || data.qr || '';
    if (qr) {
      document.getElementById('qrWrap').innerHTML = `<img src="${qr.startsWith('data:')?qr:'data:image/png;base64,'+qr}" alt="QR Code"/>`;
    } else {
      document.getElementById('qrWrap').innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--ok)">✓ Instância já conectada</div>';
    }
  } catch(e) {
    document.getElementById('qrWrap').innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--error)">✗ Erro ao gerar QR Code</div>';
  }
}

async function atualizarQR() {
  if (!qrChipIdAtivo) return;
  const chip = getChipById(qrChipIdAtivo);
  if (chip) await carregarQR(chip);
}

function deletarChip(id) {
  if (!confirm('Remover este chip?')) return;
  saveChips(getChips().filter(c => c.id !== id));
  if (disparoChipId === id) disparoChipId = null;
  if (activeChipId === id) activeChipId = null;
  renderConfiguracoes(); updateBadges(); notify('✓ Chip removido');
}

function iniciarRenomeioChip(id) {
  const panel = document.getElementById('renamePanel_' + id);
  if (!panel) return;
  panel.style.display = 'block';
  const inp = document.getElementById('renameInput_' + id);
  if (inp) { inp.focus(); inp.select(); }
}
function cancelarRenomeioChip(id) {
  const panel = document.getElementById('renamePanel_' + id);
  if (panel) panel.style.display = 'none';
}
function confirmarRenomeioCip(id) {
  const inp = document.getElementById('renameInput_' + id);
  if (!inp) return;
  const novoNome = inp.value.trim();
  if (!novoNome) { notify('// informe um nome','err'); return; }
  const chips = getChips();
  const chip = chips.find(c => c.id === id);
  if (!chip) return;
  chip.nome = novoNome;
  saveChips(chips);
  renderConfiguracoes(); updateBadges();
  notify('✓ Chip renomeado');
}

/* RAMOS */
function renderRamosConfig() {
  const ramos = getRamos();
  document.getElementById('ramosConfigList').innerHTML = ramos.map(r => `<div style="background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-weight:700;font-size:13px;flex:1">${escHtml(r.nome)}</span>
      <button class="del-btn" onclick="deletarRamo('${r.id}')">✕</button>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      ${r.keywords.map(k=>`<span style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:2px 7px;border-radius:100px">${escHtml(k)}</span>`).join('')}
    </div>
  </div>`).join('');
}

function adicionarRamo() {
  const input = document.getElementById('novoRamoInput');
  const nome = input.value.trim();
  if (!nome) return;
  const ramos = getRamos();
  ramos.push({ id: genId(), nome, keywords: [normalizeStr(nome)] });
  saveRamos(ramos); renderRamosConfig(); renderRamoSelect();
  input.value = ''; notify('✓ Ramo adicionado');
}

function deletarRamo(id) {
  if (!confirm('Remover ramo?')) return;
  saveRamos(getRamos().filter(r => r.id !== id));
  renderRamosConfig(); renderRamoSelect();
  if (activeRamoId === id) { activeRamoId = null; onRamoChange(); }
  notify('✓ Ramo removido');
}

/* TEMPLATES */
function renderTemplatesConfig() {
  const ramos = getRamos();
  const el = document.getElementById('templatesList');

  // Seletor de ramo apenas (sem abas de tipo)
  const ramoSel = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
    <select id="tplRamoSel" onchange="onTplRamoChange()" style="flex:1;min-width:140px;font-size:11px;padding:8px 12px">
      <option value="">— Selecione um ramo —</option>
      ${ramos.map(r => `<option value="${r.id}"${tplRamoId===r.id?' selected':''}>${escHtml(r.nome)}</option>`).join('')}
    </select>
  </div>`;

  let tpls, isRamo;
  if (tplRamoId) {
    tpls = getTemplatesForRamoTipo(tplRamoId, 'com-site');
    isRamo = true;
  } else {
    // Sem ramo selecionado — não exibe nada
    el.innerHTML = ramoSel + `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:16px 0">// Selecione um ramo para ver e editar os templates.</div>`;
    return;
  }

  const maxTpl = 10;
  const limitLabel = tplRamoId
    ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${tpls.length}/${maxTpl} templates</span>`
    : '';

  const tplsHtml = tpls.map((t, i) => `<div style="background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-bottom:8px;position:relative">
    <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:8px">TEMPLATE ${i+1}</div>
    <textarea style="min-height:80px;font-size:10px;line-height:1.6" oninput="${isRamo?`saveRamoTemplate('${tplRamoId}','com-site',${i},this.value)`:`saveTemplate(${i},this.value)`}">${escHtml(t)}</textarea>
    ${tpls.length>1?`<button class="del-btn" style="position:absolute;top:8px;right:8px" onclick="${isRamo?`removerRamoTemplate('${tplRamoId}','com-site',${i})`:`removerTemplate(${i})`}">✕</button>`:''}
  </div>`).join('');

  const addBtn = `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
    ${limitLabel}
    <button class="btn btn-ghost" onclick="${isRamo?`adicionarRamoTemplate('${tplRamoId}','com-site')`:`adicionarTemplate()`}" ${tpls.length>=maxTpl?'disabled':''}>+ Novo template</button>
  </div>`;

  el.innerHTML = ramoSel + tplsHtml + addBtn;
}

function onTplRamoChange() {
  tplRamoId = document.getElementById('tplRamoSel').value || null;
  renderTemplatesConfig();
}
function setTplTipo(tipo) {
  tplTipo = tipo;
  renderTemplatesConfig();
}

function saveTemplate(idx, val) {
  const tpls = getTemplates(); tpls[idx] = val; saveTemplates(tpls);
}
function adicionarTemplate() {
  const tpls = getTemplates();
  tpls.push('Olá, me chamo Samuel. Tudo bem?\n\nVi o site da {EMPRESA}...\n\nFaz sentido conversarmos?');
  saveTemplates(tpls); renderTemplatesConfig(); notify('✓ Template adicionado');
}
function removerTemplate(idx) {
  const tpls = getTemplates(); tpls.splice(idx, 1); saveTemplates(tpls); renderTemplatesConfig();
}

