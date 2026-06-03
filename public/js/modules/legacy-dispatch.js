/* ════════════════════════════
   VALIDADOR DE LINKS
════════════════════════════ */
// Domínios atualmente colados no validador — lidos pelos cards sem causar loop
let _validadorLinkDomains = new Set();
const _normValidadorLink = (url) => {
  try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); }
};

function previewValidadorLinks() {
  const raw = document.getElementById('validadorLinksInput')?.value || '';
  const links = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  const el = document.getElementById('validadorLinksPreview');
  if (!el) return;

  // Atualiza a variável global de domínios (usada pelos cards no próximo render)
  _validadorLinkDomains = new Set(links.map(_normValidadorLink));

  if (!links.length) {
    el.innerHTML = '';
    updateMantidosBadge(0, false);
    _updateCardMantidoBadges(); // atualiza badges dos cards sem re-renderizar tudo
    return;
  }

  el.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:8px">${links.length} link${links.length!==1?'s':''} colado${links.length!==1?'s':''}:</div>` +
    links.map(l => `<div style="background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:5px 10px;margin-bottom:4px;font-family:'DM Mono',monospace;font-size:9px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l)}</div>`).join('');

  // Atualiza badges dos cards visíveis sem re-renderizar a lista inteira
  _updateCardMantidoBadges();

  // Calcula total mantidos para o badge global
  const val = getValData();
  const isAbaValidados = validadorAba === 'validados';
  const mantidos = val.filter(v => {
    if (v.tipo !== 'com-site') return false;
    const isValidado = v.numStatus === 'valido';
    if (isAbaValidados && !isValidado) return false;
    if (!isAbaValidados && isValidado) return false;
    return _validadorLinkDomains.has(_normValidadorLink(v.site || ''));
  }).length;
  updateMantidosBadge(mantidos, true);
}

// Atualiza apenas os badges de "mantido" nos cards já renderizados no DOM
function _updateCardMantidoBadges() {
  const cards = document.querySelectorAll('#valComSiteList .empresa-card[id^="val-card-"]');
  const val = getValData();
  cards.forEach(card => {
    const id = card.id.replace('val-card-', '');
    const v = val.find(x => x.id === id);
    if (!v) return;
    let badge = card.querySelector('.mantido-inline-badge');
    const isMantido = v.site && _validadorLinkDomains.size > 0 && _validadorLinkDomains.has(_normValidadorLink(v.site));
    if (isMantido) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mantido-inline-badge';
        badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-family:\'DM Mono\',monospace;font-size:7px;padding:2px 7px;border-radius:100px;border:1px solid rgba(91,184,245,0.35);background:rgba(91,184,245,0.07);color:#5bb8f5;white-space:nowrap';
        badge.innerHTML = '<span style="width:4px;height:4px;border-radius:50%;background:#5bb8f5;display:inline-block;flex-shrink:0"></span>mantido';
        // Insere após o badge do chip (último span da .empresa-meta)
        const meta = card.querySelector('.empresa-meta');
        if (meta) meta.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  });
}

function updateMantidosBadge(count, visible) {
  const badge = document.getElementById('valMantidosBadge');
  const countEl = document.getElementById('valMantidosCount');
  if (!badge || !countEl) return;
  countEl.textContent = count;
  if (visible && count > 0) {
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function renderValidadorLinks() {
  previewValidadorLinks();
}

function confirmarValidadorLinks() {
  const raw = document.getElementById('validadorLinksInput')?.value || '';
  const links = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  if (!links.length) { notify('// nenhum link colado','warn'); return; }

  // Normaliza para comparar domínios
  const normLink = (url) => {
    try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); }
  };
  const linkDomains = new Set(links.map(normLink));

  const val = getValData();
  // filtra apenas as empresas da aba selecionada (validadorAba)
  const isAbaValidados = validadorAba === 'validados';
  const antes = val.filter(v => v.tipo === 'com-site' && (isAbaValidados ? v.numStatus === 'valido' : v.numStatus !== 'valido')).length;

  const novaVal = val.filter(v => {
    if (v.tipo !== 'com-site') return true; // preserva outros tipos
    const isValidado = v.numStatus === 'valido';
    // se não pertence à aba selecionada, preserva sem tocar
    if (isAbaValidados && !isValidado) return true;
    if (!isAbaValidados && isValidado) return true;
    // pertence à aba: só mantém se o site está na lista
    const empDomain = normLink(v.site || '');
    return linkDomains.has(empDomain);
  });

  const removidos = antes - novaVal.filter(v => v.tipo === 'com-site' && (isAbaValidados ? v.numStatus === 'valido' : v.numStatus !== 'valido')).length;

  // Registra os sites removidos como "já vistos"
  const removedSites = val
    .filter(v => {
      if (v.tipo !== 'com-site') return false;
      const isValidado = v.numStatus === 'valido';
      if (isAbaValidados && !isValidado) return false;
      if (!isAbaValidados && isValidado) return false;
      return !linkDomains.has(normLink(v.site || ''));
    })
    .map(v => v.site)
    .filter(Boolean);
  if (removedSites.length) addExcludedDomains(removedSites);

  saveValData(novaVal);
  document.getElementById('validadorLinksInput').value = '';
  updateMantidosBadge(0, false);
  renderValidacao(); updateBadges();
  const abaLabel = isAbaValidados ? 'Validados' : 'Pendentes/Inválidos';
  notify(`✓ ${links.length} mantidos · ${removidos} removidos → sites já vistos (${abaLabel})`);
}

/* Remove da página atual apenas os itens que NÃO estão nos links colados,
   preservando todas as outras páginas intocadas. */
function limparPaginaValidador() {
  const raw = document.getElementById('validadorLinksInput')?.value || '';
  const links = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));

  const normLink = (url) => {
    try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return url.toLowerCase().trim(); }
  };
  const linkDomains = new Set(links.map(normLink));

  const val = getValData();
  const isAbaValidados = validadorAba === 'validados';

  // Identifica quais empresas estão na página atual (mesma lógica do renderValidacao)
  const comSite = val.filter(v => v.tipo === 'com-site');
  const activeGroup = isAbaValidados
    ? comSite.filter(v => v.numStatus === 'valido')
    : comSite.filter(v => v.numStatus !== 'valido');

  const totalValPages = Math.max(1, Math.ceil(activeGroup.length / VAL_PG));
  const currentPageIdx = Math.min(valPage, totalValPages);
  const pageItems = activeGroup.slice((currentPageIdx - 1) * VAL_PG, currentPageIdx * VAL_PG);
  const pageIds = new Set(pageItems.map(v => v.id));

  // Remove apenas os itens da página atual que não estão nos links
  let removidos = 0;
  const novaVal = val.filter(v => {
    if (!pageIds.has(v.id)) return true; // fora da página: preserva
    const empDomain = normLink(v.site || '');
    if (linkDomains.has(empDomain)) return true; // está nos links: preserva
    removidos++;
    return false;
  });

  if (!removidos) { notify('// nenhum item removido nesta página', 'warn'); return; }

  // Registra os sites removidos como "já vistos"
  const removedSites = pageItems
    .filter(v => !linkDomains.has(normLink(v.site || '')))
    .map(v => v.site)
    .filter(Boolean);
  addExcludedDomains(removedSites);

  saveValData(novaVal);
  // Ajusta a página se necessário (se a página ficou vazia e havia mais)
  const novaGroup = novaVal.filter(v => {
    if (v.tipo !== 'com-site') return false;
    return isAbaValidados ? v.numStatus === 'valido' : v.numStatus !== 'valido';
  });
  const novasPages = Math.max(1, Math.ceil(novaGroup.length / VAL_PG));
  if (valPage > novasPages) valPage = novasPages;

  renderValidacao(); updateBadges();
  updateMantidosBadge(0, false);
  document.getElementById('validadorLinksInput').value = '';
  const abaLabel = isAbaValidados ? 'Validados' : 'Pendentes/Inválidos';
  notify(`✓ ${removidos} removidos da página ${currentPageIdx} → sites já vistos (${abaLabel})`);
}

function aprovarParaFila(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v || v.numStatus !== 'valido') { notify('// valide o número primeiro','warn'); return; }

  // Manda para a Base de Atribuição (sem dia ainda)
  const atrib = getAtribuicaoData();
  if (atrib.find(a => a.id === v.id)) { notify('// já está na Base de Atribuição','warn'); return; }
  markLeadWhatsappValidatedForQueue(v);
  atrib.push({
    id: v.id, nome: v.nome, site: v.site || '', whatsapp: v.whatsapp,
    instagram: v.instagram, googleUrl: v.googleUrl,
    canal: 'zap', // número validado via WhatsApp
    numStatus: 'valido', whatsappValidationStatus: 'valid',
    status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
    validadoEm: todayStr(), diaDestino: null,
  });
  saveAtribuicaoData(atrib);

  // Remove da fila de validação
  saveValData(getValData().filter(x => x.id !== id));
  renderValidacao(); updateBadges();
  notify(`✓ ${v.nome} → Base de Atribuição`);
}

function aprovarParaInsta(id) {
  const val = getValData();
  const v = val.find(x => x.id === id);
  if (!v) return;

  // Salva link do insta editado
  const linkInput = document.getElementById(`insta-link-${id}`);
  if (linkInput) v.instagram = linkInput.value.trim();

  // Manda diretamente para a atribuição de Instagram.
  const fila = getInstaFila();
  if (!fila.find(a => a.id === v.id)) {
    fila.push({
      id: v.id, nome: v.nome, site: '', whatsapp: v.whatsapp || '',
      instagram: v.instagram || '', googleUrl: v.googleUrl || '',
      canal: 'insta', // sem WhatsApp validado
      status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    saveInstaFila(fila);
  }

  saveValData(getValData().filter(x => x.id !== id));
  renderValidacao(); updateBadges(); updateAtribTabCounts();
  notify(`✓ ${v.nome} → Atribuição (tag INSTA)`);
}

/* Aprova TODOS os leads validados para Atribuição (ZAP ou INSTA conforme numStatus) */
function aprovarTodosParaAtribuicao() {
  const val = getValData();
  const atrib = getAtribuicaoData();
  const existIds = new Set(atrib.map(a => a.id));
  const instaFila = getInstaFila();
  const instaIds = new Set(instaFila.map(a => a.id));
  let addedZap = 0, addedInsta = 0;

  // Processa leads com número válido → tag ZAP
  val.filter(v => v.numStatus === 'valido' && !existIds.has(v.id)).forEach(v => {
    markLeadWhatsappValidatedForQueue(v);
    atrib.push({
      id: v.id, nome: v.nome, site: '', whatsapp: v.whatsapp,
      instagram: v.instagram || '', googleUrl: v.googleUrl || '',
      canal: 'zap',
      numStatus: 'valido', whatsappValidationStatus: 'valid',
      status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    existIds.add(v.id);
    addedZap++;
  });

  // Processa leads sem número válido (invalido) → tag INSTA
  val.filter(v => v.numStatus === 'invalido' && !instaIds.has(v.id)).forEach(v => {
    instaFila.push({
      id: v.id, nome: v.nome, site: '', whatsapp: '',
      instagram: v.instagram || '', googleUrl: v.googleUrl || '',
      canal: 'insta',
      status: 'Não enviada', criadoEm: v.importadoEm || todayStr(),
      validadoEm: todayStr(), diaDestino: null,
    });
    instaIds.add(v.id);
    addedInsta++;
  });

  if (!addedZap && !addedInsta) { notify('// nenhum lead pronto para atribuição','warn'); return; }

  saveAtribuicaoData(atrib);
  saveInstaFila(instaFila);
  // Remove os aprovados da validação
  const removedIds = new Set([...val.filter(v => v.numStatus === 'valido' || v.numStatus === 'invalido').map(v => v.id)]);
  saveValData(val.filter(v => !removedIds.has(v.id)));
  renderValidacao(); updateBadges(); updateAtribTabCounts();
  let msg = `✓ `;
  if (addedZap)   msg += `${addedZap} ZAP`;
  if (addedInsta) msg += `${addedZap?', ':''}${addedInsta} INSTA`;
  msg += ' → Atribuição';
  notify(msg);
}





