/* CRM Rebuild Fase 6.44 - Arquivamento seguro de leads */
(function () {
  'use strict';

  let archivedCache = [];
  let archivedSearch = '';
  let pendingArchive = { id: '', name: '', source: '', day: '' };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function getClient() {
    try {
      if (typeof window.resolveSupabaseClient === 'function') {
        const resolved = window.resolveSupabaseClient();
        if (resolved?.from) return resolved;
      }
    } catch (_) {}
    try { if (window.supabaseClient?.from) return window.supabaseClient; } catch (_) {}
    try { if (window.crmSupabase?.from) return window.crmSupabase; } catch (_) {}
    try { if (window.sb?.from) return window.sb; } catch (_) {}
    try { if (typeof sbClient !== 'undefined' && sbClient?.from) return sbClient; } catch (_) {}
    return null;
  }

  async function getUser() {
    try { if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser; } catch (_) {}
    const client = getClient();
    try {
      const { data } = await client.auth.getUser();
      return data?.user || null;
    } catch (_) { return null; }
  }

  function notifySafe(message, type) {
    if (typeof window.notify === 'function') return window.notify(message, type);
    console[type === 'err' ? 'error' : 'log'](message);
  }

  function normalizeLeadName(lead) {
    return lead?.company_name || lead?.nome || lead?.name || lead?.empresa || 'Lead sem nome';
  }

  function removeFromLocalOperationalState(leadId) {
    const id = String(leadId || '');
    if (!id) return;

    try {
      const data = typeof ensureWeekData === 'function' ? ensureWeekData() : null;
      if (data?.days) {
        Object.keys(data.days).forEach((day) => {
          data.days[day] = (data.days[day] || []).filter((item) => String(item.id) !== id);
        });
        if (typeof saveWeekData === 'function') saveWeekData(data);
      }
    } catch (_) {}

    try {
      if (typeof getValData === 'function' && typeof saveValData === 'function') {
        saveValData(getValData().filter((item) => String(item.id) !== id));
      }
    } catch (_) {}

    try {
      if (typeof getInstaFila === 'function' && typeof saveInstaFila === 'function') {
        saveInstaFila(getInstaFila().filter((item) => String(item.id) !== id));
      }
    } catch (_) {}

    try {
      if (typeof getInstaWeek === 'function' && typeof saveInstaWeek === 'function') {
        const week = getInstaWeek();
        Object.keys(week || {}).forEach((day) => {
          week[day] = (week[day] || []).filter((item) => String(item.id) !== id);
        });
        saveInstaWeek(week);
      }
    } catch (_) {}

    try {
      if (typeof getFilaDisparo === 'function' && typeof saveFilaDisparo === 'function') {
        const fila = getFilaDisparo();
        Object.keys(fila || {}).forEach((chipId) => {
          fila[chipId] = (fila[chipId] || []).filter((item) => String(item.id || item.leadId) !== id);
        });
        saveFilaDisparo(fila);
      }
    } catch (_) {}

    try {
      if (Array.isArray(window.rebuildQueueLeads621)) {
        window.rebuildQueueLeads621 = window.rebuildQueueLeads621.filter((item) => String(item.id) !== id);
      }
    } catch (_) {}
  }

  function refreshVisiblePanels() {
    try { if (typeof updateBadges === 'function') updateBadges(); } catch (_) {}
    try { if (document.getElementById('panel-inicio')?.classList.contains('active') && typeof renderInicio === 'function') renderInicio(); } catch (_) {}
    try { if (document.getElementById('panel-validacao')?.classList.contains('active') && typeof renderValidacao === 'function') renderValidacao(); } catch (_) {}
    try { if (document.getElementById('panel-fila-zap')?.classList.contains('active') && typeof renderFilaZap === 'function') renderFilaZap(); } catch (_) {}
    try { if (document.getElementById('panel-instagram')?.classList.contains('active') && typeof renderInstagram === 'function') renderInstagram(); } catch (_) {}
    try { if (document.getElementById('panel-arquivados')?.classList.contains('active')) renderArquivados(); } catch (_) {}
  }

  async function archiveLead(leadId, reason) {
    const client = getClient();
    const user = await getUser();
    if (!client || !user?.id) throw new Error('Supabase/usuario nao disponivel');
    const { data, error } = await client.rpc('rpc_archive_lead', {
      p_user_id: user.id,
      p_lead_id: leadId,
      p_reason: reason || 'arquivado pela interface'
    });
    if (error) throw error;
    removeFromLocalOperationalState(leadId);
    return data;
  }

  async function restoreArchivedLead(leadId) {
    const client = getClient();
    const user = await getUser();
    if (!client || !user?.id) throw new Error('Supabase/usuario nao disponivel');
    const { data, error } = await client.rpc('rpc_restore_archived_lead', {
      p_user_id: user.id,
      p_lead_id: leadId,
      p_reason: 'restaurado pela tela Arquivados'
    });
    if (error) throw error;
    return data;
  }

  async function removeArchivedFromPlatform(leadId) {
    const client = getClient();
    const user = await getUser();
    if (!client || !user?.id) throw new Error('Supabase/usuario nao disponivel');
    const { data, error } = await client.rpc('rpc_platform_remove_archived_lead', {
      p_user_id: user.id,
      p_lead_id: leadId,
      p_reason: 'removido da plataforma pela tela Arquivados'
    });
    if (error) throw error;
    return data;
  }

  function requestArchive(leadId, leadName, source, day) {
    pendingArchive = { id: String(leadId || ''), name: leadName || 'este lead', source: source || '', day: day || '' };
    const run = async () => {
      try {
        await archiveLead(pendingArchive.id, `arquivado em ${pendingArchive.source || 'interface'}`);
        notifySafe(`Lead arquivado: ${pendingArchive.name}`);
        refreshVisiblePanels();
      } catch (error) {
        console.error('[arquivados] falha ao arquivar lead:', error);
        notifySafe(error?.message || 'Erro ao arquivar lead', 'err');
      }
    };
    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm(`Arquivar <strong>${esc(pendingArchive.name)}</strong>?<br><span style="color:var(--muted);font-size:11px">Ele sai da plataforma operacional, mas continua salvo no banco.</span>`, run);
    } else if (confirm(`Arquivar ${pendingArchive.name}?`)) {
      run();
    }
  }

  function findLocalLead(leadId, day) {
    const id = String(leadId || '');
    try {
      const data = typeof ensureWeekData === 'function' ? ensureWeekData() : null;
      if (day && data?.days?.[day]) {
        const found = data.days[day].find((item) => String(item.id) === id);
        if (found) return found;
      }
      if (data?.days) {
        for (const items of Object.values(data.days)) {
          const found = (items || []).find((item) => String(item.id) === id);
          if (found) return found;
        }
      }
    } catch (_) {}
    try {
      if (typeof getValData === 'function') {
        const found = getValData().find((item) => String(item.id) === id);
        if (found) return found;
      }
    } catch (_) {}
    try {
      if (Array.isArray(window.rebuildQueueLeads621)) {
        const found = window.rebuildQueueLeads621.find((item) => String(item.id) === id);
        if (found) return found;
      }
    } catch (_) {}
    return null;
  }

  async function loadArchivedLeads() {
    const client = getClient();
    const user = await getUser();
    if (!client || !user?.id) throw new Error('Supabase/usuario nao disponivel');

    const { data, error } = await client
      .from('leads')
      .select('id,company_name,category,phone,normalized_phone,website,instagram_url,instagram_username,current_stage,current_status,archived_at,removed_at,deleted_at,created_at,updated_at')
      .eq('user_id', user.id)
      .not('archived_at', 'is', null)
      .is('removed_at', null)
      .is('deleted_at', null)
      .order('archived_at', { ascending: false });

    if (error) throw error;
    archivedCache = Array.isArray(data) ? data : [];
    window.__archivedLeadsCacheV644 = archivedCache;
    return archivedCache;
  }

  function filteredArchived() {
    const q = String(archivedSearch || '').toLowerCase().trim();
    if (!q) return archivedCache;
    return archivedCache.filter((lead) => [
      lead.company_name,
      lead.phone,
      lead.normalized_phone,
      lead.website,
      lead.instagram_url,
      lead.instagram_username,
      lead.current_status
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }

  function renderArchivedRows() {
    const list = document.getElementById('archivedLeadsList');
    const count = document.getElementById('archivedLeadsCount');
    if (!list) return;
    const rows = filteredArchived();
    if (count) count.textContent = String(rows.length);

    if (!rows.length) {
      list.innerHTML = '<div style="padding:22px;border:1px dashed var(--border2);border-radius:14px;color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">// nenhum lead arquivado encontrado</div>';
      return;
    }

    list.innerHTML = rows.map((lead) => {
      const name = lead.company_name || 'Lead sem nome';
      const phone = lead.normalized_phone || lead.phone || '';
      const site = lead.website || '';
      const insta = lead.instagram_username || lead.instagram_url || '';
      const archivedAt = lead.archived_at ? new Date(lead.archived_at).toLocaleString('pt-BR') : '-';
      return `<div class="archived-lead-card" style="display:flex;gap:14px;align-items:flex-start;padding:14px;border:1px solid var(--border);background:var(--surface);border-radius:14px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;color:var(--text);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;margin-top:7px">
            ${phone ? `<span>📱 ${esc(phone)}</span>` : '<span>sem telefone</span>'}
            ${site ? `<span>🌐 ${esc(site.replace(/^https?:\/\/(www\.)?/i,'').split('/')[0])}</span>` : ''}
            ${insta ? `<span>📸 ${esc(insta)}</span>` : ''}
            <span>Arquivado: ${esc(archivedAt)}</span>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);margin-top:5px">Status: ${esc(lead.current_status || '-')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="restoreArchivedLeadV644('${esc(lead.id)}')">Restaurar</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="platformRemoveArchivedLeadV644('${esc(lead.id)}')">Excluir da plataforma</button>
        </div>
      </div>`;
    }).join('');
  }

  async function renderArquivados() {
    const panel = document.getElementById('panel-arquivados');
    if (!panel) return;
    const list = document.getElementById('archivedLeadsList');
    if (list) list.innerHTML = '<div style="padding:18px;color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">// carregando arquivados...</div>';
    try {
      await loadArchivedLeads();
      renderArchivedRows();
    } catch (error) {
      console.error('[arquivados] render:', error);
      if (list) list.innerHTML = `<div style="padding:18px;color:var(--error);font-family:'DM Mono',monospace;font-size:11px">Erro ao carregar arquivados: ${esc(error?.message || error)}</div>`;
    }
  }

  function setArchivedSearch(value) {
    archivedSearch = String(value || '');
    renderArchivedRows();
  }

  function restoreArchivedLeadUi(leadId) {
    const lead = archivedCache.find((item) => String(item.id) === String(leadId));
    const run = async () => {
      try {
        await restoreArchivedLead(leadId);
        notifySafe(`Lead restaurado: ${lead?.company_name || 'lead'}`);
        await renderArquivados();
        try { if (typeof updateBadges === 'function') updateBadges(); } catch (_) {}
      } catch (error) {
        console.error('[arquivados] restore:', error);
        notifySafe(error?.message || 'Erro ao restaurar lead', 'err');
      }
    };
    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm(`Restaurar <strong>${esc(lead?.company_name || 'este lead')}</strong>?`, run);
    } else if (confirm('Restaurar lead?')) run();
  }

  function removeArchivedLeadUi(leadId) {
    const lead = archivedCache.find((item) => String(item.id) === String(leadId));
    const run = async () => {
      try {
        await removeArchivedFromPlatform(leadId);
        notifySafe(`Lead removido da plataforma: ${lead?.company_name || 'lead'}`);
        await renderArquivados();
        try { if (typeof updateBadges === 'function') updateBadges(); } catch (_) {}
      } catch (error) {
        console.error('[arquivados] platform remove:', error);
        notifySafe(error?.message || 'Erro ao remover lead da plataforma', 'err');
      }
    };
    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm(`Excluir <strong>${esc(lead?.company_name || 'este lead')}</strong> da plataforma?<br><span style="color:var(--muted);font-size:11px">Ele não aparece mais na plataforma, mas continua salvo no banco com removed_at.</span>`, run);
    } else if (confirm('Excluir lead da plataforma?')) run();
  }

  function installDeleteOverrides() {
    const originalDeleteEmpresa = window.deleteEmpresa;
    window.deleteEmpresa = function deleteEmpresaArchiveV644(id, day) {
      const lead = findLocalLead(id, day);
      return requestArchive(id, normalizeLeadName(lead), 'inicio', day);
    };
    window.deleteEmpresa.__archiveV644 = true;
    window.deleteEmpresa.__previous = originalDeleteEmpresa;

    window.abrirModalExcluirLead = function abrirModalExcluirLeadArchiveV644(id, day) {
      const lead = findLocalLead(id, day);
      return requestArchive(id, normalizeLeadName(lead), 'fila/semana', day);
    };
    window.confirmarExcluirLead = function confirmarExcluirLeadArchiveV644() {
      if (!pendingArchive.id) return;
      return requestArchive(pendingArchive.id, pendingArchive.name, pendingArchive.source, pendingArchive.day);
    };

    const originalInstaDelete = window.abrirModalExcluirInstaLead;
    window.abrirModalExcluirInstaLead = function abrirModalExcluirInstaLeadArchiveV644(id, day) {
      const lead = findLocalLead(id, day) || { id, nome: 'lead Instagram' };
      return requestArchive(id, normalizeLeadName(lead), 'instagram', day);
    };
    window.abrirModalExcluirInstaLead.__previous = originalInstaDelete;

    const originalExcluirInstaFila = window.excluirInstaFila;
    window.excluirInstaFila = function excluirInstaFilaArchiveV644(id) {
      const lead = findLocalLead(id) || { id, nome: 'lead Instagram' };
      return requestArchive(id, normalizeLeadName(lead), 'backlog instagram', '');
    };
    window.excluirInstaFila.__previous = originalExcluirInstaFila;
  }

  function installPanelSwitch() {
    if (window.switchPanel?.__archived644) return;
    const previous = window.switchPanel;
    if (typeof previous !== 'function') return;
    const patched = function switchPanelArchivedV644(name, options) {
      if (String(name) === 'arquivados') {
        document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'panel-arquivados'));
        document.querySelectorAll('.nav-item').forEach((item) => {
          const label = item.getAttribute('data-label') || '';
          item.classList.toggle('active', label === 'Arquivados');
        });
        try { sessionStorage.setItem('vs_active_panel_v434', 'arquivados'); } catch (_) {}
        renderArquivados();
        try { if (typeof updateBadges === 'function') updateBadges(); } catch (_) {}
        return;
      }
      return previous.call(this, name, options);
    };
    patched.__archived644 = true;
    patched.__previous = previous;
    window.switchPanel = patched;
  }

  function installExclusiveSubmenus() {
    document.addEventListener('toggle', (event) => {
      const current = event.target;
      if (!(current instanceof HTMLDetailsElement)) return;
      if (!current.classList.contains('menu-group-final')) return;
      if (!current.open) return;
      document.querySelectorAll('details.menu-group-final[open]').forEach((details) => {
        if (details !== current) details.open = false;
      });
    }, true);
  }

  function boot() {
    installDeleteOverrides();
    installPanelSwitch();
    installExclusiveSubmenus();
    setTimeout(installDeleteOverrides, 500);
    setTimeout(installPanelSwitch, 500);
    setTimeout(installDeleteOverrides, 1800);
    setTimeout(installPanelSwitch, 1800);
  }

  window.renderArquivados = renderArquivados;
  window.setArchivedSearchV644 = setArchivedSearch;
  window.restoreArchivedLeadV644 = restoreArchivedLeadUi;
  window.platformRemoveArchivedLeadV644 = removeArchivedLeadUi;
  window.archiveLeadFromAnywhereV644 = requestArchive;
  window.archiveLeadV644 = archiveLead;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
