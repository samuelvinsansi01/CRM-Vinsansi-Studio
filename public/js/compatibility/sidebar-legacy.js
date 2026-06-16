/* V37 MOBILE MENU */
function setupMobileMenuV37(){
 const sidebar=document.querySelector('.sidebar');
 const overlay=document.getElementById('mobileMenuOverlayV37');
 if(!sidebar||!overlay) return;

 let btn=document.getElementById('mobileMenuBtnV37');
 if(!btn){
   btn=document.createElement('button');
   btn.id='mobileMenuBtnV37';
   btn.innerHTML='☰';
   btn.setAttribute('aria-label','Abrir menu');
   btn.className='mobile-menu-trigger-v37';
   document.body.appendChild(btn);
 }

 function closeMenu(){
   sidebar.classList.remove('mobile-open');
   overlay.classList.remove('active');
   document.body.style.overflow='';
   document.body.classList.remove('mobile-menu-open');
 }
 function openMenu(){
   try { cleanupSidebarMenuV39(); } catch(e){}
   sidebar.classList.add('mobile-open');
   overlay.classList.add('active');
   document.body.style.overflow='hidden';
   document.body.classList.add('mobile-menu-open');
 }

 btn.onclick=()=> sidebar.classList.contains('mobile-open')?closeMenu():openMenu();
 overlay.onclick=closeMenu;

 document.querySelectorAll('.sidebar .nav-item').forEach(el=>{
   el.addEventListener('click',()=>{ if(window.innerWidth<=980) closeMenu();});
 });
}
document.addEventListener('DOMContentLoaded',setupMobileMenuV37);

// conversations fallback


/* ════════════════════════════
   MENU CLEANUP V39
════════════════════════════ */
function hasStaticFinalSidebarV414(sidebar = document.querySelector('.sidebar')) {
  return !!(sidebar && sidebar.dataset.menuFinal === 'v41.4' && sidebar.querySelector('.menu-group-final'));
}

function cleanupSidebarMenuV39(){
  try {
    if (hasStaticFinalSidebarV414()) return;
    if (typeof rebuildSidebarV40 === 'function') rebuildSidebarV40();
  } catch(e) {
    console.warn('cleanupSidebarMenuV39 protegido:', e?.message || e);
  }
}

document.addEventListener('DOMContentLoaded', cleanupSidebarMenuV39);
setTimeout(() => { try { cleanupSidebarMenuV39(); } catch(e){} }, 600);
setTimeout(() => { try { cleanupSidebarMenuV39(); } catch(e){} }, 1500);


/* ════════════════════════════
   SIDEBAR FINAL V40
════════════════════════════ */
function createNavItemV40(panel, icon, label, badge = '') {
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.setAttribute('onclick', `switchPanel('${panel}')`);
  item.setAttribute('data-label', label);
  item.innerHTML = `
    <div class="nav-icon">${icon}</div>
    <span class="nav-label">${label}</span>
    ${badge ? `<span class="nav-badge" id="${badge.id}">${badge.text}</span>` : ''}
  `;
  return item;
}

function findSidebarSectionTitleV40(sidebar, text) {
  return Array.from(sidebar.querySelectorAll('*')).find(el => {
    const t = (el.textContent || '').trim().toLowerCase();
    return t === text.toLowerCase();
  });
}

function ensureSidebarItemV40(sidebar, panel, icon, label, badge) {
  let item = sidebar.querySelector(`[data-label="${label}"]`);
  if (!item) item = createNavItemV40(panel, icon, label, badge);
  return item;
}

function rebuildSidebarV40() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || hasStaticFinalSidebarV414(sidebar) || sidebar.dataset.v411Grouped === 'true') return;

  const authBox =
    sidebar.querySelector('#authUserBox') ||
    Array.from(sidebar.children).find(el => {
      const t = (el.textContent || '').toLowerCase();
      return t.includes('conectado') && t.includes('sair');
    });

  // Remove relógio/data soltos
  Array.from(sidebar.querySelectorAll('*')).forEach(el => {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (/^\d{1,2}:\d{2}$/.test(txt) || /sexta|segunda|terça|terca|quarta|quinta|sábado|sabado|domingo/.test(txt)) {
      el.remove();
    }
  });

  // Garante seção Ferramentas
  let toolsTitle = findSidebarSectionTitleV40(sidebar, 'Ferramentas');
  if (!toolsTitle) {
    toolsTitle = document.createElement('div');
    toolsTitle.className = 'nav-section-title';
    toolsTitle.textContent = 'Ferramentas';
    const config = sidebar.querySelector('[data-label="Configurações"]');
    if (config) sidebar.insertBefore(toolsTitle, config);
    else sidebar.appendChild(toolsTitle);
  }

  let toolsGroup = document.getElementById('sidebarToolsV40');
  if (!toolsGroup) {
    toolsGroup = document.createElement('div');
    toolsGroup.id = 'sidebarToolsV40';
    toolsTitle.insertAdjacentElement('afterend', toolsGroup);
  }

  const redirects = sidebar.querySelector('[data-label="Redirecionamentos"]');
  const audit = ensureSidebarItemV40(sidebar, 'audit', '📊', 'Auditoria', { id:'badge-audit', text:'LOG' });
  const responses = ensureSidebarItemV40(sidebar, 'responses', '💬', 'Respostas', { id:'badge-responses', text:'0' });
  const conversations = ensureSidebarItemV40(sidebar, 'conversations', '🗨️', 'Conversas', { id:'badge-conversations', text:'0' });
  const account = ensureSidebarItemV40(sidebar, 'conta', '👤', 'Minha conta');
  const config = sidebar.querySelector('[data-label="Configurações"]');

  [redirects, audit, responses, conversations, account, config].forEach(el => {
    if (el) toolsGroup.appendChild(el);
  });

  // Move conectado para rodapé
  let footer = document.getElementById('sidebarAuthFooterV40');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'sidebarAuthFooterV40';
    sidebar.appendChild(footer);
  }

  if (authBox && !footer.contains(authBox)) {
    footer.appendChild(authBox);
  }

  // Fecha menu mobile ao clicar item
  sidebar.querySelectorAll('.nav-item').forEach(item => {
    if (item.__v40Bound) return;
    item.__v40Bound = true;
    item.addEventListener('click', () => {
      if (window.innerWidth <= 980) {
        const overlay = document.getElementById('mobileMenuOverlayV37');
        sidebar.classList.remove('mobile-open');
        overlay?.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
        document.body.style.overflow = '';
      }
    });
  });

  if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
  if (typeof updateConversationsBadgeV38 === 'function') updateConversationsBadgeV38();
}

document.addEventListener('DOMContentLoaded', rebuildSidebarV40);
setTimeout(rebuildSidebarV40, 300);
setTimeout(rebuildSidebarV40, 1000);
setTimeout(rebuildSidebarV40, 2000);


/* SIDEBAR FINAL V40.4 SAFE */
(function(){
  const originalRebuildSidebarV40 = typeof rebuildSidebarV40 === 'function' ? rebuildSidebarV40 : null;

  window.rebuildSidebarV40 = function(){
    try {
      if (originalRebuildSidebarV40) originalRebuildSidebarV40();
    } catch(e) {
      console.warn('rebuildSidebarV40 protegido:', e?.message || e);
    }

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || hasStaticFinalSidebarV414(sidebar) || sidebar.dataset.v411Grouped === 'true') return;

    const authBox = sidebar.querySelector('#authUserBox');
    let footer = document.getElementById('sidebarAuthFooterV40');

    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'sidebarAuthFooterV40';
      sidebar.appendChild(footer);
    }

    if (authBox && authBox.parentElement !== footer) {
      footer.appendChild(authBox);
    }

    let toolsGroup = document.getElementById('sidebarToolsV40');
    if (!toolsGroup) {
      toolsGroup = document.createElement('div');
      toolsGroup.id = 'sidebarToolsV40';

      const toolsTitle = Array.from(sidebar.querySelectorAll('*'))
        .find(el => (el.textContent || '').trim().toLowerCase() === 'ferramentas');

      if (toolsTitle && toolsTitle.parentElement) {
        toolsTitle.insertAdjacentElement('afterend', toolsGroup);
      } else if (footer.parentElement === sidebar) {
        sidebar.insertBefore(toolsGroup, footer);
      } else {
        sidebar.appendChild(toolsGroup);
      }
    }

    ['Redirecionamentos','Auditoria','Respostas','Conversas','Minha conta','Configurações'].forEach(label => {
      const item = sidebar.querySelector(`[data-label="${label}"]`);
      if (item && item.parentElement !== toolsGroup) {
        toolsGroup.appendChild(item);
      }
    });

    if (typeof updateResponsesBadgeV34 === 'function') updateResponsesBadgeV34();
    if (typeof updateConversationsBadgeV38 === 'function') updateConversationsBadgeV38();
    if (typeof updateAuditBadgeV35 === 'function') updateAuditBadgeV35();
  };

  document.addEventListener('DOMContentLoaded', () => { try { window.rebuildSidebarV40(); } catch(e){} });
  setTimeout(() => { try { window.rebuildSidebarV40(); } catch(e){} }, 1200);
})();


/* V40.4 NotFoundError guard */
window.addEventListener('error', function(e){
  if (String(e.message || '').includes("insertBefore") || String(e.message || '').includes("NotFoundError")) {
    console.warn('Erro de menu protegido:', e.message);
    e.preventDefault?.();
    try { rebuildSidebarV40(); } catch(err){}
  }
});


