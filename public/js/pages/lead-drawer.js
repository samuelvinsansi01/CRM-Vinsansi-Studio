window.LeadDrawer = (() => {
  function qs(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  }

  async function open(leadId) {
    const drawer = qs('leadDrawer');
    const body = qs('leadDrawerBody');
    if (!drawer || !body) return;

    drawer.hidden = false;
    body.innerHTML = '<p>Carregando ficha...</p>';

    const lead = await window.LeadsRepository.getById(leadId);
    const events = await window.LeadEventsRepository.timeline(leadId);

    body.innerHTML = `
      <h2>${escapeHtml(lead?.company_name || 'Lead')}</h2>
      <div class="drawer-grid">
        <p><strong>Categoria:</strong> ${escapeHtml(lead?.category)}</p>
        <p><strong>Nota:</strong> ${lead?.rating ?? '-'}</p>
        <p><strong>Avaliações:</strong> ${lead?.reviews_count ?? '-'}</p>
        <p><strong>Telefone:</strong> ${escapeHtml(lead?.phone)}</p>
        <p><strong>WhatsApp:</strong> ${escapeHtml(lead?.whatsapp_status)}</p>
        <p><strong>Site:</strong> ${escapeHtml(lead?.website)}</p>
        <p><strong>Instagram:</strong> ${escapeHtml(lead?.instagram_url)}</p>
        <p><strong>Local:</strong> ${escapeHtml([lead?.city, lead?.state, lead?.country].filter(Boolean).join(', '))}</p>
        <p><strong>Etapa:</strong> ${escapeHtml(lead?.current_stage)}</p>
        <p><strong>Score:</strong> ${lead?.lead_score ?? '-'}</p>
        <p><strong>Oportunidade:</strong> ${escapeHtml(lead?.opportunity)}</p>
      </div>
      <h3>Timeline</h3>
      <ol class="timeline">
        ${(events || []).map(ev => `<li><strong>${escapeHtml(ev.event_type)}</strong><br><small>${new Date(ev.created_at).toLocaleString()}</small></li>`).join('') || '<li>Sem eventos ainda.</li>'}
      </ol>
    `;
  }

  function close() {
    const drawer = qs('leadDrawer');
    if (drawer) drawer.hidden = true;
  }

  function init() {
    const btn = qs('closeLeadDrawer');
    if (btn) btn.onclick = close;
  }

  return { init, open, close };
})();
