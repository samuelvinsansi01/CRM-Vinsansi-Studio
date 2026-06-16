/* ════════════════════════════
   FILA INSTAGRAM — RENDER
════════════════════════════ */
function renderFilaInsta() {
  const fila = getInstaFila();
  const tabs = ['pendente','enviado'];
  const counts = { pendente: fila.filter(f=>f.status==='pendente').length, enviado: fila.filter(f=>f.status==='enviado').length };

  document.getElementById('instaStatusTabs').innerHTML = tabs.map(t =>
    `<div class="status-tab${instaStatus===t?' active':''}" onclick="setInstaStatus('${t}')">
      ${t==='pendente'?'Pendentes':'Enviados'} <span class="st-count">${counts[t]}</span>
    </div>`
  ).join('');

  const filtered = fila.filter(f => f.status === instaStatus);
  const listEl = document.getElementById('instaFilaList');

  if (!filtered.length) {
    listEl.innerHTML = `<div class="fila-empty">Nenhuma empresa ${instaStatus==='pendente'?'pendente':'enviada'}.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const apresentacao = getTemplates()[0].replace(/\{EMPRESA\}/g, item.nome);
    return `<div class="insta-card" id="insta-card-${item.id}">
      <div class="insta-card-header">
        <div class="insta-nome">
          ${item.googleUrl?`<a href="${escHtml(item.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(item.nome)}</a>`:escHtml(item.nome)}
        </div>
        ${item.instagram?`<a href="${escHtml(item.instagram)}" target="_blank" class="q-badge insta" style="text-decoration:none">📸 ver perfil</a>`:''}
      </div>
      <div style="margin-bottom:10px">
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">LINK INSTAGRAM</div>
        <div style="display:flex;gap:6px">
          <input class="insta-link-input" id="insta-ig-${item.id}" type="url" placeholder="https://instagram.com/empresa" value="${escHtml(item.instagram||'')}"/>
          <button class="copy-small" onclick="salvarInstaLink('${item.id}')">salvar</button>
        </div>
      </div>
      <div class="insta-msg-blocks">
        <div class="insta-msg-block">
          <div class="insta-msg-block-label">① APRESENTAÇÃO</div>
          <div class="insta-msg-text">${escHtml(apresentacao)}</div>
          <div style="margin-top:6px;display:flex;gap:5px">
            <button class="copy-small" onclick="copiarTexto(${JSON.stringify(apresentacao)})">copiar</button>
          </div>
        </div>
        <div class="insta-msg-block">
          <div class="insta-msg-block-label">② LINK DO SITE</div>
          <div class="insta-msg-text">${escHtml(LINK_BICHOP)}</div>
          <div style="margin-top:6px"><button class="copy-small" onclick="copiarTexto('${LINK_BICHOP}')">copiar</button></div>
        </div>
        <div class="insta-msg-block">
          <div class="insta-msg-block-label">③ IMAGEM PERSONALIZADA</div>
          <div class="fila-img-area${item.imagemBase64?' has-img':''}" onclick="document.getElementById('insta-img-${item.id}').click()" style="min-height:50px">
            ${item.imagemBase64?`<img src="${item.imagemBase64}" alt="preview"/>`:''}
            <span class="fila-img-label">${item.imagemBase64?'':'📎 anexar imagem'}</span>
          </div>
          <input type="file" accept="image/*" class="fila-img-input" id="insta-img-${item.id}" onchange="onInstaImgChange('${item.id}',this)"/>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
        ${item.status==='pendente'
          ?`<button class="btn btn-insta" style="font-size:10px;padding:7px 14px" onclick="marcarInstaEnviado('${item.id}')">✓ Marcar enviado</button>`
          :`<span class="q-badge ok">✓ enviado</span>`
        }
        <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px;margin-right:4px" onclick="instaFilaVoltarAtribuicao('${item.id}')" title="Devolver para Atribuição">↩ Atribuição</button>
        <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="removerDaFilaInsta('${item.id}')">Remover</button>
      </div>
    </div>`;
  }).join('');
}


function instaFilaVoltarAtribuicao(id) {
  const fila = getInstaFila();
  const item = fila.find(f => f.id === id);
  if (!item) return;
  const atrib = getAtribuicaoData();
  if (!atrib.find(a => a.id === id)) {
    atrib.push({
      id: item.id, nome: item.nome, whatsapp: item.whatsapp || '',
      instagram: item.instagram || '', googleUrl: item.googleUrl || '',
      canal: 'insta', site: '',
      status: 'Não enviada', criadoEm: item.criadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    saveAtribuicaoData(atrib);
  }
  saveInstaFila(fila.filter(f => f.id !== id));
  renderFilaInsta(); updateBadges();
  notify(`↩ ${item.nome} → Atribuição`);
}
function setInstaStatus(s) { instaStatus = s; renderFilaInsta(); }

function salvarInstaLink(id) {
  const input = document.getElementById(`insta-ig-${id}`);
  if (!input) return;
  const fila = getInstaFila();
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.instagram = input.value.trim();
  saveInstaFila(fila); notify('✓ Link salvo');
}

function onInstaImgChange(id, input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const fila = getInstaFila();
    const item = fila.find(f => f.id === id);
    if (!item) return;
    item.imagemBase64 = e.target.result;
    saveInstaFila(fila); renderFilaInsta();
  };
  reader.readAsDataURL(file);
}

function marcarInstaEnviado(id) {
  const fila = getInstaFila();
  const item = fila.find(f => f.id === id);
  if (!item) return;
  item.status = 'enviado'; item.enviadoEm = todayStr();
  saveInstaFila(fila); renderFilaInsta(); updateBadges();
  notify('✓ Marcado como enviado');
}

function removerDaFilaInsta(id) {
  saveInstaFila(getInstaFila().filter(f => f.id !== id));
  renderFilaInsta(); updateBadges();
}

function limparFilaInsta() {
  if (!confirm('Remover todos os enviados?')) return;
  saveInstaFila(getInstaFila().filter(f => f.status !== 'enviado'));
  renderFilaInsta(); updateBadges(); notify('✓ Enviados removidos');
}

function copiarTexto(text) {
  navigator.clipboard.writeText(text).then(() => notify('✓ Copiado'));
}

