/* ════════════════════════════
   INSTAGRAM — PAINEL PRINCIPAL
════════════════════════════ */

/* ── MODAL LEAD MANUAL INSTAGRAM ── */
function abrirModalInstaLead() {
  ['ilNome','ilWhatsapp','ilGoogleUrl','ilInstagram','ilCategoria'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('instaLeadModal').classList.add('open');
}
function salvarInstaLead() {
  const nome = (document.getElementById('ilNome').value||'').trim();
  if (!nome) { notify('// informe o nome da empresa','err'); return; }
  const whatsapp   = (document.getElementById('ilWhatsapp')?.value||'').trim();
  const googleUrl  = (document.getElementById('ilGoogleUrl').value||'').trim();
  const instagram  = (document.getElementById('ilInstagram').value||'').trim();
  const categoria  = (document.getElementById('ilCategoria').value||'').trim();
  const fila = getInstaFila();
  const lead = { id: genId(), nome, whatsapp, googleUrl, instagram, categoria, criadoEm: todayStr() };
  fila.push(lead);
  saveInstaFila(fila);
  document.getElementById('instaLeadModal').classList.remove('open');
  renderInstagram(); renderAtribInstaFila(); updateBadges();
  persistOptimisticLeadV426(lead, 'create-instagram');
  notify('✓ Lead adicionado à fila Instagram');
}

function salvarInstaLeadInline() {
  const nome      = (document.getElementById('instaLeadNome')?.value||'').trim();
  const instagram = (document.getElementById('instaLeadLink')?.value||'').trim();
  if (!nome) { notify('// informe o nome da empresa','err'); return; }
  const fila = getInstaFila();
  const lead = { id: genId(), nome: capitalizeName(nome), whatsapp: '', googleUrl: '', instagram, categoria: '', criadoEm: todayStr() };
  fila.push(lead);
  saveInstaFila(fila);
  // Limpar campos
  const nEl = document.getElementById('instaLeadNome'); if (nEl) nEl.value = '';
  const lEl = document.getElementById('instaLeadLink'); if (lEl) lEl.value = '';
  document.getElementById('instaLeadNome')?.focus();
  toggleAtribForm('insta'); // fecha o form
  renderInstagram(); renderAtribInstaFila(); updateBadges();
  persistOptimisticLeadV426(lead, 'create-instagram-inline');
  notify(`✓ ${capitalizeName(nome)} → Fila Instagram`);
}

/* ════════════════════════════
   BASE DE ATRIBUIÇÃO — ABAS
════════════════════════════ */
let atribActiveTab = 'zap'; // 'zap' | 'insta'

function salvarZapLeadManual() {
  const nome     = (document.getElementById('zapLeadNome')?.value||'').trim();
  const whatsapp = (document.getElementById('zapLeadWpp')?.value||'').trim();
  if (!nome) { notify('// nome da empresa é obrigatório','err'); return; }

  const atrib = getAtribuicaoData();
  const lead = {
    id: genId(),
    nome: capitalizeName(nome),
    site: '',
    whatsapp: whatsapp || '',
    instagram: '',
    googleUrl: '',
    canal: 'zap',
    status: 'Não enviada',
    criadoEm: todayStr(),
    diaDestino: null,
  };
  atrib.push(lead);
  saveAtribuicaoData(atrib);
  // Limpar campos
  ['zapLeadNome','zapLeadWpp'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('zapLeadNome')?.focus();
  toggleAtribForm('zap'); // fecha o form
  renderAtribuicao(); updateBadges(); updateAtribTabCounts();
  persistOptimisticLeadV426(lead, 'create-whatsapp-manual');
  notify(`✓ ${capitalizeName(nome)} → Base de Atribuição (ZAP)`);
}

function setAtribTab(tab) {
  atribActiveTab = tab;
  const tabZap   = document.getElementById('atribTabZap');
  const tabInsta = document.getElementById('atribTabInsta');
  const panelZap   = document.getElementById('atribPanelZap');
  const panelInsta = document.getElementById('atribPanelInsta');

  if (tab === 'zap') {
    tabZap.style.borderBottomColor   = 'var(--accent)';
    tabZap.style.color               = 'var(--accent)';
    tabInsta.style.borderBottomColor = 'transparent';
    tabInsta.style.color             = 'var(--muted)';
    panelZap.style.display   = 'flex';
    panelInsta.style.display = 'none';
    renderAtribuicao();
  } else {
    tabInsta.style.borderBottomColor = 'var(--insta)';
    tabInsta.style.color             = 'var(--insta)';
    tabZap.style.borderBottomColor   = 'transparent';
    tabZap.style.color               = 'var(--muted)';
    panelInsta.style.display = 'flex';
    panelZap.style.display   = 'none';
    renderAtribInstaFila();
    updateAtribInstaCorteInfo();
    setTimeout(() => document.getElementById('instaLeadNome')?.focus(), 60);
  }
  updateAtribTabCounts();
}

function updateAtribTabCounts() {
  const zapCount   = getAtribuicaoData().length;
  const instaCount = getInstaFila().length;
  const elZ = document.getElementById('atribTabZapCount');
  const elI = document.getElementById('atribTabInstaCount');
  if (elZ) elZ.textContent = zapCount ? `(${zapCount})` : '';
  if (elI) elI.textContent = instaCount ? `(${instaCount})` : '';
}

/* ── Info de corte horário ── */
function updateAtribInstaCorteInfo() {
  // aviso removido — sem exibição de info de horário
}

function toggleAtribForm(aba) {
  const formId = aba === 'zap' ? 'zapLeadForm' : 'instaLeadForm';
  const btnId  = aba === 'zap' ? 'btnToggleZapForm' : 'btnToggleInstaForm';
  const form   = document.getElementById(formId);
  const btn    = document.getElementById(btnId);
  if (!form) return;
  const open = form.style.display !== 'none';
  form.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '+ Novo lead' : '✕ Fechar';
  if (!open) {
    // foca no primeiro input ao abrir
    const first = form.querySelector('input');
    if (first) setTimeout(() => first.focus(), 50);
  }
}

/* ── Qual dia o lead deve entrar (regra de corte 19h + limite 60/dia) ── */
function instaDeterminarDiaDestino() {
  const now   = new Date();
  const hora  = now.getHours();
  const week  = getInstaWeek();
  const days  = instaWeekDays();

  const todayKey = todayStr();
  const todayIdx = days.indexOf(todayKey);
  // Nunca começa antes de hoje — ignora dias passados da semana
  let startIdx = todayIdx >= 0 ? todayIdx : 0;
  if (hora >= INSTA_CUTOFF_HOUR) startIdx = Math.min(startIdx + 1, days.length - 1);

  for (let i = startIdx; i < days.length; i++) {
    const d = days[i];
    if ((week[d]||[]).length < INSTA_DIA_LIMIT) return d;
  }
  return days[days.length - 1]; // fallback: último dia da semana
}

/* ── RENDER DA FILA INSTAGRAM NA BASE DE ATRIBUIÇÃO ── */
let atribInstaPage = 0;
const ATRIB_INSTA_PG = 30;

function renderAtribInstaFila() {
  const listEl = document.getElementById('atribInstaList');
  if (!listEl) return;

  // Atribuição exibe apenas leads que ainda NÃO têm link do Instagram
  const filaAll = getInstaFila().filter(e => !e.instagram);
  const buscaEl = document.getElementById('atribInstaBusca');
  const buscaQ  = buscaEl ? normalizeStr(buscaEl.value) : '';
  const fila = buscaQ
    ? filaAll.filter(e => normalizeStr(e.nome||'').includes(buscaQ) || (e.whatsapp||'').includes(buscaQ))
    : filaAll;

  const totalEl = document.getElementById('atribInstaFilaTotalBadge');
  if (totalEl) totalEl.textContent = fila.length ? `· ${fila.length} empresa${fila.length>1?'s':''}` : '';

  // Tab counts
  updateAtribTabCounts();

  if (!fila.length) {
    listEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead aguardando atribuição</div>';
    document.getElementById('atribInstaPagination').innerHTML = '';
    return;
  }

  const totalPags = Math.max(1, Math.ceil(fila.length / ATRIB_INSTA_PG));
  if (atribInstaPage >= totalPags) atribInstaPage = totalPags - 1;
  const page = fila.slice(atribInstaPage * ATRIB_INSTA_PG, (atribInstaPage + 1) * ATRIB_INSTA_PG);

  listEl.innerHTML = page.map(e => {
    const stars   = e.totalScore   ? `⭐ ${Number(e.totalScore).toFixed(1)}` : '';
    const reviews = e.reviewsCount ? `(${e.reviewsCount} av.)` : '';
    const temInstaPreview = !!(e.instagram);
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)" id="atrib-insta-row-${e.id}">
      <!-- info empresa -->
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${e.googleUrl
            ? `<a href="${escHtml(e.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--insta)'" onmouseout="this.style.color='var(--text)'">${escHtml(e.nome||'—')}</a>`
            : escHtml(e.nome||'—')}
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          ${stars?`<span style="color:var(--ok)">${stars} ${reviews}</span>`:''}
          ${e.categoria?`<span style="color:var(--muted)">${escHtml(e.categoria)}</span>`:''}
        </div>
        <!-- Campo de link Instagram inline -->
        <div style="display:flex;gap:6px;margin-top:7px;align-items:center">
          <a href="https://www.google.com/search?q=site:instagram.com+${encodeURIComponent('"'+e.nome+'"')}" target="_blank"
            title="Buscar Instagram no Google"
            style="background:none;border:1px solid rgba(225,48,108,0.25);color:var(--insta);border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer;flex-shrink:0;text-decoration:none;line-height:1;display:flex;align-items:center;transition:all 0.18s"
            onmouseover="this.style.background='rgba(225,48,108,0.1)'" onmouseout="this.style.background='none'">🔍</a>
          <input id="atrib-insta-link-${e.id}" type="text"
            value="${escHtml(e.instagram||'')}"
            placeholder="Cole o link do Instagram..."
            style="flex:1;background:rgba(225,48,108,0.06);border:1px solid rgba(225,48,108,0.25);border-radius:6px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:5px 9px;outline:none;transition:border-color 0.18s"
            onfocus="this.style.borderColor='var(--insta)'" onblur="this.style.borderColor='rgba(225,48,108,0.25)'"
            onpaste="setTimeout(()=>atribInstaConfirmarLink('${e.id}'),0)"
            onkeydown="if(event.key==='Enter') atribInstaConfirmarLink('${e.id}')"/>
          <button onclick="atribInstaExcluir('${e.id}')"
            style="background:none;border:1px solid transparent;color:var(--muted);border-radius:6px;font-size:10px;padding:4px 7px;cursor:pointer;transition:all 0.18s;flex-shrink:0"
            onmouseover="this.style.borderColor='var(--error)';this.style.color='var(--error)';this.style.background='rgba(255,92,92,0.06)'"
            onmouseout="this.style.borderColor='transparent';this.style.color='var(--muted)';this.style.background='none'">✕</button>
        </div>
      </div>
    </div>`; }).join('');

  // Paginação
  const pEl = document.getElementById('atribInstaPagination');
  if (pEl) {
    if (totalPags <= 1) { pEl.innerHTML = ''; }
    else {
      pEl.innerHTML = `<div style="display:flex;gap:8px;justify-content:center;padding:10px 0;flex-wrap:wrap">
        ${atribInstaPage>0?`<button class="btn btn-ghost" style="font-size:9px;padding:5px 12px" onclick="atribInstaChangePage(${atribInstaPage-1})">← Anterior</button>`:''}
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);align-self:center">${atribInstaPage+1} / ${totalPags}</span>
        ${atribInstaPage<totalPags-1?`<button class="btn btn-ghost" style="font-size:9px;padding:5px 12px" onclick="atribInstaChangePage(${atribInstaPage+1})">Próxima →</button>`:''}
      </div>`;
    }
  }
}

function atribInstaChangePage(p) { atribInstaPage = p; renderAtribInstaFila(); }

/* ── CONFIRMAR LINK → VAI PARA O BACKLOG ── */
function atribInstaConfirmarLink(id) {
  const input = document.getElementById(`atrib-insta-link-${id}`);
  if (!input) return;
  let url = input.value.trim();
  if (!url) { notify('// cole o link do Instagram antes de confirmar','warn'); return; }
  if (!url.startsWith('http')) url = 'https://instagram.com/' + url.replace('@','');

  const fila = getInstaFila();
  const emp  = fila.find(e => e.id === id);
  if (!emp) return;

  // Salva o link no item — ele permanece na INSTA_KEY, agora com instagram preenchido.
  // O backlog do painel Instagram exibe apenas os que têm e.instagram preenchido.
  emp.instagram = url;
  saveInstaFila(fila);

  updateAtribInstaCorteInfo();
  renderAtribInstaFila();
  if (document.getElementById('panel-instagram')?.classList.contains('active')) renderInstagram();
  updateBadges();
  notify(`✓ ${emp.nome} → Backlog Instagram`);
}

/* ── EXCLUIR DA FILA INSTAGRAM (BASE DE ATRIBUIÇÃO) ── */
function atribInstaExcluir(id) {
  const fila = getInstaFila();
  const emp  = fila.find(e => e.id === id);
  abrirModalConfirm(
    `Excluir <strong>${emp ? escHtml(emp.nome) : 'este lead'}</strong> da fila Instagram?`,
    () => {
      saveInstaFila(getInstaFila().filter(e => e.id !== id));
      renderAtribInstaFila(); updateBadges();
      notify(`✕ Lead removido`);
    }
  );
}



