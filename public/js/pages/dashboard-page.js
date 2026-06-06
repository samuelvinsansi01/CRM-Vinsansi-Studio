window.DashboardPage = (() => {
  function renderCounts(counts = {}) {
    const target = document.getElementById('dashboardCounts');
    if (!target) return;

    const items = [
      ['Total', counts.total_leads || 0],
      ['Importados', counts.imported || 0],
      ['Backlog', counts.backlog || 0],
      ['Fila', counts.queued || 0],
      ['Enviados', counts.sent || 0],
      ['CRM', counts.crm || 0]
    ];

    target.innerHTML = items.map(([label, value]) => `
      <article class="metric-card">
        <strong>${value}</strong>
        <span>${label}</span>
      </article>
    `).join('');
  }

  async function mount() {
    const bootstrap = await window.BootstrapService.load();
    renderCounts(bootstrap.counts || {});
  }

  return { mount };
})();
