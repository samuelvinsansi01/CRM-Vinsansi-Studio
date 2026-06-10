// 6.80 — Design System Base
// Camada leve de padronização visual. Não altera regras de negócio.

(function(){
  function qsAll(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function enhanceSearches(){
    qsAll('input[type="search"], input[placeholder*="Buscar"], input[placeholder*="busca"], input[placeholder*="Pesquisar"]').forEach(input => {
      const parent = input.parentElement;
      if (!parent) return;
      if (!parent.classList.contains('ds-search-auto') && parent.children.length <= 4) {
        parent.classList.add('ds-search-auto');
      }
    });
  }

  function enhanceTables(){
    qsAll('table').forEach(table => table.classList.add('ds-table'));
  }

  function enhanceEmptyStates(){
    qsAll('[class*="empty"], .protection-empty').forEach(el => el.classList.add('ds-empty'));
  }

  function enhanceCheckboxes(){
    qsAll('input[type="checkbox"]').forEach(input => {
      if (!input.classList.contains('bulk-checkbox')) input.classList.add('bulk-checkbox');
    });
  }

  function run(){
    try {
      enhanceSearches();
      enhanceTables();
      enhanceEmptyStates();
      enhanceCheckboxes();
    } catch (error) {
      console.warn('[ds-v680]', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();

  window.applyDesignSystemV680 = run;
})();
