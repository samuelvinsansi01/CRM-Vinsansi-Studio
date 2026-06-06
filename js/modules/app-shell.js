(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  function setStatus(text, type) {
    const el = $('#appStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.type = type || 'info';
  }

  async function renderAuthenticated() {
    const profile = await window.AuthService.getProfile();
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#profileName').textContent = profile?.display_name || profile?.email || 'Usuário logado';
    $('#profileRole').textContent = profile?.role || 'owner';
    window.Router.initRouter();
    setStatus('Sessão ativa. Banco DEV conectado.', 'ok');
  }

  function renderUnauthenticated() {
    $('#loginView').hidden = false;
    $('#appView').hidden = true;
    setStatus('Faça login para acessar o CRM.', 'info');
  }

  async function boot() {
    try {
      $('#loginGoogleBtn').addEventListener('click', async () => {
        setStatus('Redirecionando para login Google...', 'info');
        await window.AuthService.signInWithGoogle();
      });

      $('#logoutBtn').addEventListener('click', async () => {
        setStatus('Saindo...', 'info');
        await window.AuthService.signOut();
      });

      const session = await window.AuthService.getSession();
      if (session) await renderAuthenticated();
      else renderUnauthenticated();

      window.AuthService.onAuthChange(async (session) => {
        if (session) await renderAuthenticated();
        else renderUnauthenticated();
      });
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Erro ao iniciar autenticação.', 'error');
      renderUnauthenticated();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
