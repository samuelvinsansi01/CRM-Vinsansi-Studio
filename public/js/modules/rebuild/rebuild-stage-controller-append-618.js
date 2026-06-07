/* CRM Rebuild Fase 6.18 — Ficha, ações de Validação e preview separado
   Cole este bloco no FINAL de js/modules/rebuild/rebuild-stage-controller.js
*/
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  function headers() {
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  async function getCurrentUserIdRebuild() {
    return (
      (typeof getCurrentSupabaseUserIdV412 === 'function' ? await getCurrentSupabaseUserIdV412() : null) ||
      window.currentUser?.id ||
      (typeof currentUser !== 'undefined' ? currentUser?.id : null)
    );
  }

  async function rpcValidationAction(leadId, action, reason) {
    const userId = await getCurrentUserIdRebuild();
    if (!userId) throw new Error('Usuário não encontrado.');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_validation_lead_action`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_reason: reason || null
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) throw data || new Error('Falha ao validar lead.');
    return data;
  }

  async function fetchLeadFichaRebuild(leadId) {
    const userId = await getCurrentUserIdRebuild();
    if (!userId) throw new Error('Usuário não encontrado.');

    const url = `${SUPABASE_URL}/rest/v1/v_lead_ficha_rebuild` +
      `?select=*` +
      `&id=eq.${encodeURIComponent(leadId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&limit=1`;

    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw data;
    return Array.isArray(data) ? data[0] : null;
  }

  function ensureLeadDrawer() {
    let drawer = document.getElementById('leadFichaDrawerRebuild');
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.id = 'leadFichaDrawerRebuild';
    drawer.style.cssText = 'position:fixed;top:0;right:0;width:min(520px,96vw);height:100vh;background:#fff;z-index:9999;box-shadow:-12px 0 30px rgba(0,0,0,.18);transform:translateX(105%);transition:.22s ease;overflow:auto;border-left:1px solid #e5e7eb;';
    drawer.innerHTML = `
      <div style="position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e7eb;padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;z-index:1;">
        <strong>Ficha do Lead</strong>
        <button type="button" id="closeLeadFichaDrawerRebuild" class="add-btn">Fechar</button>
      </div>
      <div id="leadFichaDrawerContentRebuild" style="padding:16px;"></div>
    `;
    document.body.appendChild(drawer);

    drawer.querySelector('#closeLeadFichaDrawerRebuild').onclick = () => {
      drawer.style.transform = 'translateX(105%)';
    };

    return drawer;
  }

  function fichaRow(label, value, link) {
    if (!value) value = '—';
    const safeValue = esc(value);
    const rendered = link && value !== '—'
      ? `<a href="${esc(value)}" target="_blank" rel="noopener">${safeValue}</a>`
      : safeValue;

    return `
      <div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">${esc(label)}</div>
        <div style="font-size:14px;color:#0f172a;margin-top:3px;word-break:break-word;">${rendered}</div>
      </div>
    `;
  }

  async function openLeadFichaRebuild(leadId) {
    const drawer = ensureLeadDrawer();
    const content = document.getElementById('leadFichaDrawerContentRebuild');
    drawer.style.transform = 'translateX(0)';
    content.innerHTML = '<div class="table-empty">Carregando ficha...</div>';

    try {
      const lead = await fetchLeadFichaRebuild(leadId);
      if (!lead) {
        content.innerHTML = '<div class="table-empty">Lead não encontrado.</div>';
        return;
      }

      content.innerHTML = `
        <h2 style="margin:0 0 8px;font-size:18px;">${esc(lead.company_name || 'Empresa sem nome')}</h2>
        <div style="margin-bottom:14px;color:#64748b;font-size:13px;">${esc(lead.category || '')}</div>

        ${fichaRow('Nota', lead.rating)}
        ${fichaRow('Avaliações', lead.reviews_count)}
        ${fichaRow('Telefone', lead.phone)}
        ${fichaRow('Status WhatsApp', lead.whatsapp_status)}
        ${fichaRow('Site próprio', lead.website, true)}
        ${fichaRow('Instagram', lead.instagram_url, true)}
        ${fichaRow('Google Maps', lead.google_maps_url, true)}
        ${fichaRow('Cidade', [lead.city, lead.state].filter(Boolean).join(' - '))}
        ${fichaRow('Endereço', lead.address)}
        ${fichaRow('CEP', lead.zip_code)}
        ${fichaRow('Etapa atual', lead.current_stage)}
        ${fichaRow('Status atual', lead.current_status)}

        <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;">
          <button type="button" class="add-btn" onclick="approveLeadWhatsappRebuild('${esc(lead.id)}')">✓ Aprovar WhatsApp</button>
          <button type="button" class="danger-btn" onclick="rejectLeadValidationRebuild('${esc(lead.id)}')">✗ Reprovar</button>
        </div>
      `;
    } catch (err) {
      console.error('[Ficha] erro:', err);
      content.innerHTML = '<div class="table-empty">Erro ao carregar ficha.</div>';
    }
  }

  async function approveLeadWhatsappRebuild(leadId) {
    await rpcValidationAction(leadId, 'approve_whatsapp', null);
    if (typeof notify === 'function') notify('WhatsApp validado.');
    if (typeof window.renderValidationStageFromSupabase === 'function') await window.renderValidationStageFromSupabase();
  }

  async function rejectLeadValidationRebuild(leadId) {
    const reason = prompt('Motivo da reprovação:', 'Número inválido');
    if (reason === null) return;
    await rpcValidationAction(leadId, 'reject_validation', reason || 'Reprovado manualmente');
    if (typeof notify === 'function') notify('Lead reprovado na validação.');
    if (typeof window.renderValidationStageFromSupabase === 'function') await window.renderValidationStageFromSupabase();
  }

  function enhanceValidationCardsActions() {
    const cards = document.querySelectorAll('#valComSiteList .empresa-card[data-lead-id]');
    cards.forEach(card => {
      const leadId = card.getAttribute('data-lead-id');
      const actions = card.querySelector('.empresa-actions');
      if (!leadId || !actions || actions.dataset.rebuild618 === '1') return;
      actions.dataset.rebuild618 = '1';
      actions.innerHTML = `
        <button class="add-btn" type="button" onclick="openLeadFichaRebuild('${esc(leadId)}')">Ficha</button>
        <button class="add-btn" type="button" onclick="approveLeadWhatsappRebuild('${esc(leadId)}')">✓ Aprovar</button>
        <button class="danger-btn" type="button" onclick="rejectLeadValidationRebuild('${esc(leadId)}')">✗ Reprovar</button>
      `;
    });
  }

  const oldRenderValidation = window.renderValidationStageFromSupabase;
  if (typeof oldRenderValidation === 'function') {
    window.renderValidationStageFromSupabase = async function patchedValidationActions618() {
      const result = await oldRenderValidation.apply(this, arguments);
      enhanceValidationCardsActions();
      return result;
    };
  }

  function renderImportPreviewSeparated(summary) {
    const target = document.getElementById('importPreview') || document.getElementById('importResumo') || document.querySelector('[data-import-preview]');
    if (!target || !summary) return;

    const total = summary.total || 0;
    const created = summary.created || 0;
    const ignored = summary.ignored || 0;

    target.innerHTML = `
      <div class="import-preview-grid">
        <div class="preview-block"><strong>Total analisado</strong><br>${total} empresas</div>
        <div class="preview-block"><strong>Aprovados</strong><br>${created} enviados para Validação</div>
        <div class="preview-block"><strong>Reprovados</strong><br>${ignored} ignorados</div>
        <div class="preview-block small">Nota baixa: ${summary.rejected_low_rating || 0}</div>
        <div class="preview-block small">Poucas avaliações: ${summary.rejected_low_reviews || 0}</div>
        <div class="preview-block small">Duplicados: ${summary.rejected_duplicate || 0}</div>
        <div class="preview-block small">Blacklist: ${summary.blacklisted || 0}</div>
        <div class="preview-block small">Erros: ${summary.errors || 0}</div>
      </div>
    `;
  }

  const oldImport = window.importarLeads;
  if (typeof oldImport === 'function') {
    window.importarLeads = async function patchedImportPreview618() {
      const result = await oldImport.apply(this, arguments);
      renderImportPreviewSeparated(result);
      return result;
    };
  }

  window.openLeadFichaRebuild = openLeadFichaRebuild;
  window.approveLeadWhatsappRebuild = approveLeadWhatsappRebuild;
  window.rejectLeadValidationRebuild = rejectLeadValidationRebuild;
  window.renderImportPreviewSeparated = renderImportPreviewSeparated;

  setTimeout(enhanceValidationCardsActions, 500);
})();
