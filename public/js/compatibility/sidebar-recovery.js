/* ════════════════════════════
   V41.2 — TRAVA MENU EXPANSÍVEL
   Impede rebuilds antigos de sobrescreverem a sidebar
════════════════════════════ */
function forceSidebarGroupedV412() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || hasStaticFinalSidebarV414(sidebar)) return;

  // Se já está com o menu novo e possui grupos expansíveis, apenas atualiza badges.
  if (sidebar.querySelector('.sidebar-v411-group')) {
    sidebar.dataset.v411Grouped = 'true';
    sidebar.dataset.v41Grouped = 'true';
    try { updateBadges(); } catch(e) {}
    return;
  }

  // Força reconstrução limpa ignorando flags antigas.
  delete sidebar.dataset.v411Grouped;
  delete sidebar.dataset.v41Grouped;

  if (typeof rebuildSidebarGroupedV41 === 'function') {
    rebuildSidebarGroupedV41();
  }
}

function disableLegacySidebarRebuildersV412() {
  const noopOrForce = function(){
    setTimeout(forceSidebarGroupedV412, 0);
  };

  // Esses nomes foram usados nas versões anteriores e podem estar sobrescrevendo o menu.
  if (typeof cleanupSidebarMenuV39 === 'function') window.cleanupSidebarMenuV39 = noopOrForce;
  if (typeof rebuildSidebarV40 === 'function') window.rebuildSidebarV40 = noopOrForce;
  if (typeof cleanupSidebarMenuV39 !== 'function') window.cleanupSidebarMenuV39 = noopOrForce;
  if (typeof rebuildSidebarV40 !== 'function') window.rebuildSidebarV40 = noopOrForce;
}

function watchSidebarV412() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || hasStaticFinalSidebarV414(sidebar) || sidebar.__v412Watcher) return;
  sidebar.__v412Watcher = true;

  const observer = new MutationObserver(() => {
    clearTimeout(window.__v412MenuTimer);
    window.__v412MenuTimer = setTimeout(() => {
      const hasNewMenu = !!sidebar.querySelector('.sidebar-v411-group');
      const hasOldConnected = /Conectado/i.test(sidebar.textContent || '');
      if (!hasNewMenu || hasOldConnected) {
        forceSidebarGroupedV412();
      }
    }, 80);
  });

  observer.observe(sidebar, { childList:true, subtree:true });
}

document.addEventListener('DOMContentLoaded', () => {
  disableLegacySidebarRebuildersV412();
  setTimeout(forceSidebarGroupedV412, 100);
  setTimeout(forceSidebarGroupedV412, 500);
  setTimeout(forceSidebarGroupedV412, 1300);
  setTimeout(watchSidebarV412, 1500);
});

setTimeout(() => {
  disableLegacySidebarRebuildersV412();
  forceSidebarGroupedV412();
  watchSidebarV412();
}, 2200);

setTimeout(forceSidebarGroupedV412, 3500);


/* ════════════════════════════
   V41.3 — MENU NA ORIGEM / HARD FIX
   Garante que o menu antigo não permaneça.
════════════════════════════ */
function createMenuItemV413(panel, icon, label, badgeId = '') {
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.dataset.label = label;
  item.onclick = () => {
    if (panel === 'logout') {
      if (typeof logout === 'function') logout();
      else if (typeof signOut === 'function') signOut();
      return;
    }
    if (typeof switchPanel === 'function') switchPanel(panel);
  };
  item.innerHTML = `
    <div class="nav-icon">${icon}</div>
    <span class="nav-label">${label}</span>
    ${badgeId ? `<span class="nav-badge" id="${badgeId}">0</span>` : ''}
  `;
  return item;
}

function createExpandableMenuGroupV413(title, items = []) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-v413-group';

  const head = document.createElement('div');
  head.className = 'sidebar-v413-group-head';
  head.innerHTML = `<span>${title}</span><span class="sidebar-v413-chevron">›</span>`;

  const body = document.createElement('div');
  body.className = 'sidebar-v413-group-body';

  items.forEach(item => {
    const el = createMenuItemV413(item.panel, item.icon, item.label, item.badgeId || '');
    el.classList.add('sidebar-v413-subitem');
    body.appendChild(el);
  });

  head.onclick = () => wrap.classList.toggle('open');
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function buildFinalSidebarV413() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return false;
  if (hasStaticFinalSidebarV414(sidebar)) return true;

  sidebar.innerHTML = '';

  const brand = document.createElement('div');
  brand.className = 'sidebar-v413-brand';
  brand.innerHTML = `
    <div class="sidebar-v413-hello">Olá, Samuel 👋</div>
    <div class="sidebar-v413-sub">CRM de Prospecção</div>
  `;
  sidebar.appendChild(brand);

  sidebar.appendChild(createMenuItemV413('busca', '🔎', 'Busca'));
  sidebar.appendChild(createMenuItemV413('inicio', '📊', 'Início', 'badge-inicio'));
  sidebar.appendChild(createMenuItemV413('inbox', '📥', 'Caixa de Entrada', 'badge-inbox'));

  sidebar.appendChild(createExpandableMenuGroupV413('Leads', [
    { panel:'import', icon:'📥', label:'Importar', badgeId:'badge-import' },
    { panel:'validacao', icon:'✅', label:'Validação', badgeId:'badge-validacao' },
    { panel:'atribuicao', icon:'🗂️', label:'Atribuição', badgeId:'badge-atribuicao' }
  ]));

  sidebar.appendChild(createExpandableMenuGroupV413('Envios', [
    { panel:'whatsappQueue', icon:'💬', label:'WhatsApp', badgeId:'badge-whatsapp-queue' },
    { panel:'instagram', icon:'📸', label:'Instagram', badgeId:'badge-instagram' }
  ]));

  sidebar.appendChild(createMenuItemV413('conversations', '💬', 'Conversas'));

  sidebar.appendChild(createExpandableMenuGroupV413('Gerenciamento', [
    { panel:'followups', icon:'⏰', label:'Follow-ups', badgeId:'badge-followups' },
    { panel:'kanban', icon:'📋', label:'Kanban' },
    { panel:'acompanhamento', icon:'📈', label:'Acompanhamentos', badgeId:'badge-acompanhamento' }
  ]));

  sidebar.appendChild(createExpandableMenuGroupV413('Ferramentas', [
    { panel:'redirects', icon:'🔗', label:'Redirecionamentos' },
    { panel:'audit', icon:'📊', label:'Auditoria', badgeId:'badge-audit' }
  ]));

  sidebar.appendChild(createMenuItemV413('conta', '👤', 'Minha conta'));
  sidebar.appendChild(createMenuItemV413('configuracoes', '⚙️', 'Configurações'));

  const footer = document.createElement('div');
  footer.id = 'sidebarAuthFooterV413';
  footer.appendChild(createMenuItemV413('logout', '🚪', 'Sair'));
  sidebar.appendChild(footer);

  sidebar.dataset.v413Final = 'true';
  try { if (typeof updateBadges === 'function') updateBadges(); } catch(e) {}
  return true;
}

function ensureFinalSidebarV413() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || hasStaticFinalSidebarV414(sidebar)) return;

  const txt = sidebar.textContent || '';
  const hasOldMenu = /PRINCIPAL|LEADS|ENVIO|RESULTADOS|Conectado|Fila WhatsApp/i.test(txt);
  const hasFinal = sidebar.dataset.v413Final === 'true' && sidebar.querySelector('.sidebar-v413-group');

  if (!hasFinal || hasOldMenu) buildFinalSidebarV413();
}

function installSidebarWatchV413() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || hasStaticFinalSidebarV414(sidebar) || sidebar.__v413Watch) return;
  sidebar.__v413Watch = true;

  const observer = new MutationObserver(() => {
    clearTimeout(window.__v413Timer);
    window.__v413Timer = setTimeout(ensureFinalSidebarV413, 40);
  });
  observer.observe(sidebar, { childList:true, subtree:true, characterData:true });
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(buildFinalSidebarV413, 50);
  setTimeout(buildFinalSidebarV413, 250);
  setTimeout(buildFinalSidebarV413, 750);
  setTimeout(() => { buildFinalSidebarV413(); installSidebarWatchV413(); }, 1500);
});

setTimeout(() => { buildFinalSidebarV413(); installSidebarWatchV413(); }, 2500);
setInterval(ensureFinalSidebarV413, 1200);


