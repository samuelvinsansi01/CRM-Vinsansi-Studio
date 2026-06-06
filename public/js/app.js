(async function initCrm() {
  const status = document.getElementById('bootStatus');

  try {
    window.LeadDrawer.init();
    const session = await window.AuthGuard.init();
    if (!session) return;

    if (status) status.textContent = 'Carregando dados do banco...';
    await window.DashboardPage.mount();
    await window.LeadsPage.mount();
    if (status) status.textContent = 'Base nova carregada.';
  } catch (error) {
    console.error(error);
    if (status) status.textContent = error.message || 'Erro ao iniciar o CRM novo.';
  }
})();
