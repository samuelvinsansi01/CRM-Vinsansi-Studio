(function () {
  'use strict';

  const routes = ['dashboard', 'imports', 'validation', 'assignment', 'backlog', 'dispatch', 'conversations', 'settings'];

  function setRoute(route) {
    const next = routes.includes(route) ? route : 'dashboard';
    document.querySelectorAll('[data-page]').forEach((page) => {
      page.hidden = page.dataset.page !== next;
    });
    document.querySelectorAll('[data-route]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.route === next);
    });
    history.replaceState(null, '', '#' + next);
  }

  function initRouter() {
    document.querySelectorAll('[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => setRoute(btn.dataset.route));
    });
    setRoute((location.hash || '#dashboard').replace('#', ''));
  }

  window.Router = { initRouter, setRoute };
})();
