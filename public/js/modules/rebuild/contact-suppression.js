/* CRM Rebuild Fase 6.29 - Protecao operacional */
(function () {
  'use strict';

  const TYPES = {
    already_sent: { label: 'Ja Enviados', tone: 'sent' },
    blocked: { label: 'Bloqueados', tone: 'blocked' }
  };

  let entries = [];
  let activeType = 'already_sent';
  let loading = false;
  let loaded = false;

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
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

  async function getAuthUser() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser;
    } catch (_) {}

    const client = getClient();
    if (!client?.auth?.getUser) return null;

    try {
      const { data } = await client.auth.getUser();
      const user = data?.user || null;
      if (user) {
        try {
          if (typeof currentUser !== 'undefined') currentUser = user;
        } catch (_) {}
      }
      return user;
    } catch (_) {
      return null;
    }
  }

  function fieldValue(id) {
    return String(document.getElementById(id)?.value || '').trim();
  }

  function setFieldValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value || '';
  }

  function onlyDigits(value = '') {
    return String(value || '').replace(/\D+/g, '');
  }

  function normalizeHost(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
        .replace(/^www\./i, '')
        .toLowerCase();
    } catch (_) {
      return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    }
  }

  function normalizeInstagram(value = '') {
    let raw = String(value || '').trim().toLowerCase().replace('@', '');
    if (!raw) return '';
    if (raw.includes('instagram.com/')) {
      raw = raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
      raw = raw.split('/')[1] || '';
    }
    raw = raw.split('?')[0].split('#')[0].split('/')[0];
    if (['p', 'reel', 'tv', 'stories', 'explore', 'invites'].includes(raw)) return '';
    return raw;
  }

  function normalizeCompany(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeEntry(entry = {}) {
    const listType = entry.list_type || entry.block_type || entry.type || 'already_sent';
    const archivedAt = entry.archived_at || entry.removed_at || (entry.active === false ? entry.updated_at || entry.created_at : null);
    return {
      ...entry,
      list_type: listType === 'blocked' ? 'blocked' : 'already_sent',
      block_type: listType === 'blocked' ? 'blocked' : 'already_sent',
      phone_normalized: onlyDigits(entry.phone_normalized || entry.normalized_phone || entry.phone || entry.whatsapp),
      normalized_phone: onlyDigits(entry.normalized_phone || entry.phone_normalized || entry.phone || entry.whatsapp),
      instagram: entry.instagram || entry.instagram_url || entry.instagramUrl || '',
      instagram_url: entry.instagram_url || entry.instagram || entry.instagramUrl || '',
      instagram_username: normalizeInstagram(entry.instagram_username || entry.instagram || entry.instagram_url || entry.instagramUrl),
      website_host: normalizeHost(entry.website_host || entry.website || entry.site || entry.website_url || entry.websiteUrl),
      place_id: String(entry.place_id || entry.placeId || entry.googlePlaceId || '').trim().toLowerCase(),
      company_name_normalized: normalizeCompany(entry.company_name || entry.companyName || entry.nome || entry.name || entry.title),
      notes: entry.notes || entry.note || '',
      note: entry.note || entry.notes || '',
      archived_at: archivedAt
    };
  }

  function publishEntries(nextEntries) {
    entries = (Array.isArray(nextEntries) ? nextEntries : []).map(normalizeEntry);
    window.contactSuppressionEntriesV629 = entries;
    window.__contactSuppressionEntriesV629 = entries;
    updateProtectionBadge();
    return entries;
  }

  function updateProtectionBadge() {
    const badge = document.getElementById('badge-protecao');
    if (badge) badge.textContent = String(entries.filter((entry) => !entry.archived_at).length);
  }

  async function loadContactSuppressionEntriesV629(options = {}) {
    const silent = options.silent === true;
    if (loading) return entries;

    const client = getClient();
    const user = await getAuthUser();
    if (!client?.from || !user?.id) {
      publishEntries([]);
      renderContactSuppressionPanelV629();
      return entries;
    }

    loading = true;
    try {
      const { data, error } = await client
        .from('lead_blocks')
        .select('id,user_id,lead_id,block_type,company_name,contact_name,phone,normalized_phone,instagram_url,instagram_username,website,website_host,place_id,reason,note,source,created_at,updated_at,removed_at,active')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      loaded = true;
      publishEntries(data || []);
      renderContactSuppressionPanelV629();
      return entries;
    } catch (error) {
      publishEntries([]);
      renderContactSuppressionPanelV629(error?.message || 'Falha ao carregar protecao.');
      if (!silent && typeof notify === 'function') notify('Execute a SQL 00637 para ativar Protecao por contato.', 'warn');
      return entries;
    } finally {
      loading = false;
    }
  }

  function readFormEntry() {
    const entry = {
      list_type: activeType,
      company_name: fieldValue('protectionCompanyName'),
      contact_name: fieldValue('protectionContactName'),
      phone: fieldValue('protectionPhone'),
      instagram: fieldValue('protectionInstagram'),
      website: fieldValue('protectionWebsite'),
      place_id: fieldValue('protectionPlaceId'),
      reason: fieldValue('protectionReason'),
      notes: fieldValue('protectionNotes'),
      source: fieldValue('protectionSource') || 'manual'
    };
    return normalizeEntry(entry);
  }

  function hasIdentity(entry) {
    return !!(
      entry.phone_normalized ||
      entry.instagram_username ||
      entry.website_host ||
      entry.place_id ||
      entry.company_name_normalized
    );
  }

  async function saveContactSuppressionEntryV629() {
    const client = getClient();
    const user = await getAuthUser();
    if (!client?.rpc || !user?.id) {
      if (typeof notify === 'function') notify('Usuario autenticado nao encontrado.', 'warn');
      return;
    }

    const entry = readFormEntry();
    if (!hasIdentity(entry)) {
      if (typeof notify === 'function') notify('Informe empresa, telefone, Instagram, site ou Place ID.', 'warn');
      return;
    }

    try {
      const { error } = await client.rpc('rpc_lead_block_upsert', {
        p_user_id: user.id,
        p_entry: {
          ...entry,
          block_type: entry.list_type,
          normalized_phone: entry.phone_normalized,
          instagram_url: entry.instagram,
          note: entry.notes
        }
      });
      if (error) throw error;

      clearContactSuppressionFormV629({ keepType: true });
      await loadContactSuppressionEntriesV629({ silent: true });
      if (typeof notify === 'function') notify(`${TYPES[activeType].label}: contato salvo.`);
    } catch (error) {
      console.warn('[protection] save:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao salvar protecao.', 'err');
    }
  }

  async function archiveContactSuppressionEntryNow(id) {
    const client = getClient();
    const user = await getAuthUser();
    if (!client?.rpc || !user?.id || !id) return;

    try {
      const { error } = await client.rpc('rpc_lead_block_archive', {
        p_user_id: user.id,
        p_block_id: id
      });
      if (error) throw error;
      await loadContactSuppressionEntriesV629({ silent: true });
      if (typeof notify === 'function') notify('Registro removido da protecao.');
    } catch (error) {
      console.warn('[protection] archive:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao remover registro.', 'err');
    }
  }

  function archiveContactSuppressionEntryV629(id) {
    const run = () => archiveContactSuppressionEntryNow(id);
    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm('Remover este registro da Protecao?', run);
      return;
    }
    if (window.confirm && !window.confirm('Remover este registro da Protecao?')) return;
    run();
  }

  function clearContactSuppressionFormV629(options = {}) {
    [
      'protectionCompanyName',
      'protectionContactName',
      'protectionPhone',
      'protectionInstagram',
      'protectionWebsite',
      'protectionPlaceId',
      'protectionReason',
      'protectionNotes'
    ].forEach((id) => setFieldValue(id, ''));
    setFieldValue('protectionSource', 'manual');
    if (!options.keepType) setProtectionTypeV629('already_sent');
  }

  function setProtectionTypeV629(type) {
    activeType = TYPES[type] ? type : 'already_sent';
    renderContactSuppressionPanelV629();
  }

  function formatDate(value) {
    if (!value) return '--';
    try {
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
    } catch (_) {
      return String(value).slice(0, 16).replace('T', ' ');
    }
  }

  function identityChips(entry) {
    const chips = [];
    if (entry.phone_normalized) chips.push(['Telefone', entry.phone_normalized]);
    if (entry.instagram_username) chips.push(['Instagram', `@${entry.instagram_username}`]);
    if (entry.website_host) chips.push(['Site', entry.website_host]);
    if (entry.place_id) chips.push(['Place ID', entry.place_id]);
    return chips.map(([label, value]) => (
      `<span class="protection-chip"><b>${escHtml(label)}</b>${escHtml(value)}</span>`
    )).join('');
  }

  function renderEntry(entry) {
    const title = entry.company_name || entry.contact_name || entry.phone_normalized || entry.instagram_username || entry.website_host || 'Contato protegido';
    const type = TYPES[entry.list_type] || TYPES.already_sent;
    const meta = [
      entry.contact_name ? `Contato: ${entry.contact_name}` : '',
      entry.reason ? `Motivo: ${entry.reason}` : '',
      entry.source ? `Origem: ${entry.source}` : '',
      `Data: ${formatDate(entry.occurred_at || entry.created_at)}`
    ].filter(Boolean).join(' | ');

    return `
      <div class="protection-item ${type.tone}">
        <div class="protection-item-main">
          <div class="protection-item-title">
            <span>${escHtml(title)}</span>
            <small>${escHtml(type.label)}</small>
          </div>
          <div class="protection-item-meta">${escHtml(meta)}</div>
          <div class="protection-chip-row">${identityChips(entry)}</div>
          ${entry.notes ? `<div class="protection-notes">${escHtml(entry.notes)}</div>` : ''}
        </div>
        <button class="btn btn-ghost protection-remove-btn" onclick="archiveContactSuppressionEntryV629('${entry.id}')">Remover</button>
      </div>
    `;
  }

  function renderContactSuppressionPanelV629(errorMessage = '') {
    const panel = document.getElementById('panel-protecao');
    if (!panel) return;

    const activeEntries = entries.filter((entry) => !entry.archived_at);
    const alreadySent = activeEntries.filter((entry) => entry.list_type === 'already_sent').length;
    const blocked = activeEntries.filter((entry) => entry.list_type === 'blocked').length;

    const sentCount = document.getElementById('protectionSentCount');
    const blockedCount = document.getElementById('protectionBlockedCount');
    const totalCount = document.getElementById('protectionTotalCount');
    if (sentCount) sentCount.textContent = String(alreadySent);
    if (blockedCount) blockedCount.textContent = String(blocked);
    if (totalCount) totalCount.textContent = String(activeEntries.length);

    document.querySelectorAll('[data-protection-type]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-protection-type') === activeType);
    });

    const list = document.getElementById('protectionListV629');
    if (!list) return;

    if (errorMessage) {
      list.innerHTML = `<div class="protection-empty">${escHtml(errorMessage)}</div>`;
      return;
    }

    if (loading) {
      list.innerHTML = '<div class="protection-empty">Carregando...</div>';
      return;
    }

    const filtered = activeEntries.filter((entry) => entry.list_type === activeType);
    if (!filtered.length) {
      list.innerHTML = `<div class="protection-empty">Nenhum registro em ${escHtml(TYPES[activeType].label)}.</div>`;
      return;
    }

    list.innerHTML = filtered.map(renderEntry).join('');
  }

  function renderProtecao() {
    renderContactSuppressionPanelV629();
    if (!loaded && !loading) loadContactSuppressionEntriesV629({ silent: true });
  }

  window.renderProtecao = renderProtecao;
  window.renderContactSuppressionPanelV629 = renderContactSuppressionPanelV629;
  window.loadContactSuppressionEntriesV629 = loadContactSuppressionEntriesV629;
  window.getContactSuppressionEntriesV629 = () => entries;
  window.setProtectionTypeV629 = setProtectionTypeV629;
  window.saveContactSuppressionEntryV629 = saveContactSuppressionEntryV629;
  window.clearContactSuppressionFormV629 = clearContactSuppressionFormV629;
  window.archiveContactSuppressionEntryV629 = archiveContactSuppressionEntryV629;

  publishEntries([]);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderContactSuppressionPanelV629();
      setTimeout(() => loadContactSuppressionEntriesV629({ silent: true }), 1200);
      setTimeout(() => { if (!loaded) loadContactSuppressionEntriesV629({ silent: true }); }, 3500);
      setTimeout(() => { if (!loaded) loadContactSuppressionEntriesV629({ silent: true }); }, 7000);
    });
  } else {
    renderContactSuppressionPanelV629();
    setTimeout(() => loadContactSuppressionEntriesV629({ silent: true }), 1200);
    setTimeout(() => { if (!loaded) loadContactSuppressionEntriesV629({ silent: true }); }, 3500);
    setTimeout(() => { if (!loaded) loadContactSuppressionEntriesV629({ silent: true }); }, 7000);
  }
})();
