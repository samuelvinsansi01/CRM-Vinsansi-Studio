window.LeadsPage = (() => {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  }

  function renderRows(leads) {
    const target = document.getElementById('leadsList');
    if (!target) return;

    if (!leads.length) {
      target.innerHTML = '<p class="empty">Nenhum lead encontrado no banco novo.</p>';
      return;
    }

    target.innerHTML = leads.map(lead => `
      <button class="lead-row" data-lead-id="${lead.id}">
        <span>
          <strong>${escapeHtml(lead.company_name)}</strong>
          <small>${escapeHtml([lead.city, lead.state].filter(Boolean).join(', '))}</small>
        </span>
        <span>${escapeHtml(lead.current_stage)}</span>
        <span>${escapeHtml(lead.lead_channel)}</span>
        <span>${lead.rating ?? '-'} ⭐</span>
      </button>
    `).join('');

    target.querySelectorAll('[data-lead-id]').forEach(btn => {
      btn.addEventListener('click', () => window.LeadDrawer.open(btn.dataset.leadId));
    });
  }

  async function mount() {
    const leads = await window.LeadService.listDashboardLeads();
    renderRows(leads || []);
  }

  return { mount };
})();
