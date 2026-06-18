/* V63 — Menu operacional enxuto
   Escopo: apenas esconder itens no menu lateral. Não remove telas, não mexe em banco,
   Supabase, Evolution, webhook, conversas, disparos, validação ou filas. */
(function(){
  'use strict';
  const VERSION = '20260618-V63-MENU-OPERACIONAL-ENXUTO';

  const HIDDEN_LABELS = new Set([
    'Busca',
    'Início',
    'Caixa de Entrada',
    'Conversas',
    'Gerenciamento',
    'Ferramentas'
  ]);

  const HIDDEN_ROUTES = new Set([
    'inicio',
    'inbox',
    'conversations',
    'followups',
    'kanban',
    'acompanhamento',
    'redirecionamentos',
    'audit',
    'responses',
    'whatsappQueue',
    'evolution',
    'chips'
  ]);

  function injectStyle(){
    if (document.getElementById('v63-menu-operacional-enxuto-style')) return;
    const st = document.createElement('style');
    st.id = 'v63-menu-operacional-enxuto-style';
    st.textContent = `
      #sidebar [data-label="Busca"],
      #sidebar [data-label="Início"],
      #sidebar [data-label="Caixa de Entrada"],
      #sidebar [data-label="Conversas"],
      #sidebar [data-label="Gerenciamento"],
      #sidebar [data-label="Ferramentas"]{
        display:none !important;
      }
      #sidebar .menu-group-final[data-v63-hidden="true"],
      #sidebar details[data-v63-hidden="true"]{
        display:none !important;
      }
    `;
    document.head.appendChild(st);
  }

  function labelOf(el){
    return String(el?.getAttribute?.('data-label') || el?.querySelector?.('.nav-label')?.textContent || el?.textContent || '').replace('›','').trim();
  }

  function hideMenuItem(el){
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('tabindex', '-1');
  }

  function applySlimMenu(){
    injectStyle();
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.querySelectorAll('.nav-item, summary, button').forEach(el => {
      const label = labelOf(el);
      if (HIDDEN_LABELS.has(label)) hideMenuItem(el);
    });

    sidebar.querySelectorAll('details, .menu-group-final').forEach(group => {
      const summary = group.querySelector('summary');
      const label = labelOf(summary || group);
      if (HIDDEN_LABELS.has(label)) {
        group.dataset.v63Hidden = 'true';
        group.style.display = 'none';
        group.setAttribute('aria-hidden', 'true');
      }
    });

    // Caso a sidebar tenha iniciado com "Início" ativo, move o destaque para Importar.
    const active = sidebar.querySelector('.nav-item.active');
    if (!active || HIDDEN_LABELS.has(labelOf(active))) {
      sidebar.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      const importar = sidebar.querySelector('[data-label="Importar"]');
      if (importar) importar.classList.add('active');
    }
  }

  function currentPanelName(){
    const active = document.querySelector('.panel.active');
    return active?.id ? active.id.replace(/^panel-/, '') : '';
  }

  function redirectIfHiddenPanel(){
    const panel = currentPanelName();
    if (!panel || !HIDDEN_ROUTES.has(panel)) return;
    if (typeof window.switchPanel === 'function') {
      window.switchPanel('importar');
    } else {
      document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-importar'));
    }
  }

  function run(){
    applySlimMenu();
    redirectIfHiddenPanel();
  }

  document.addEventListener('DOMContentLoaded', () => {
    run();
    setTimeout(run, 100);
    setTimeout(run, 500);
    setTimeout(run, 1200);
    setTimeout(run, 2500);

    const obs = new MutationObserver(() => {
      clearTimeout(window.__v63SlimMenuTimer);
      window.__v63SlimMenuTimer = setTimeout(run, 80);
    });
    obs.observe(document.body, { childList:true, subtree:true });
  });

  setTimeout(run, 50);
  setTimeout(run, 300);
  setTimeout(run, 1000);
  setInterval(applySlimMenu, 2000);

  window.applySlimOperationalMenuV63 = run;
  console.info('[v63][menu-operacional-enxuto] ativo', VERSION);
})();
