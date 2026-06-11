/* CRM Rebuild Fase 6.18 - Validacao consolidada sobre Supabase */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const PAGE_SIZE = 40;

  const state = {
    activeTab: 'pendentes',
    page: 1,
    selected: new Set(),
    rows: [],
    loading: false
  };

  const runtimeLeadCache = new Map();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function text(value, fallback = '-') {
    const clean = String(value ?? '').trim();
    return clean || fallback;
  }

  function numberText(value, fallback = '-') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
  }

  function normalizePhoneLabel(phone) {
    const raw = text(phone, '');
    if (!raw) return 'Sem telefone';
    const digits = raw.replace(/\D+/g, '');
    if (digits.length >= 12 && digits.startsWith('55')) {
      return `+55 ${digits.slice(2, 4)} ${digits.slice(4)}`;
    }
    return raw;
  }

  function getStageLocation(row) {
    return [row.city, row.state_code || row.state].filter(Boolean).join(' - ');
  }

  async function getCurrentUserIdRebuild() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}

    if (window.currentUser?.id) return window.currentUser.id;

    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) {
        return currentUser.id;
      }
    } catch (_) {}

    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;

    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423();
      }
    } catch (_) {}

    if (!headers?.apikey) {
      headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      };
    }

    return content
      ? { ...headers, 'Content-Type': 'application/json' }
      : headers;
  }

  async function readJson(response) {
    const textBody = await response.text();
    return textBody ? JSON.parse(textBody) : null;
  }

  async function fetchValidationLeads() {
    const userId = await getCurrentUserIdRebuild?.() || await getUserId?.() || window.currentUser?.id || (typeof currentUser !== 'undefined' ? currentUser?.id : null);
    if (!userId) throw new Error('Usuario nao encontrado para carregar Validacao.');

    const headers = await getHeaders();

    async function fetchJson(endpoint, params) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}?${params.toString()}`, { headers });
      const data = await readJson ? await readJson(response) : await response.json().catch(() => []);
      if (!response.ok) throw data || new Error(`Falha ao carregar ${endpoint} (${response.status}).`);
      return Array.isArray(data) ? data : [];
    }

    function normalizeValidationRowV681(row = {}) {
      const lead = row.leads || row.lead || {};
      return {
        ...lead,
        ...row,
        id: row.id || row.lead_id || lead.id,
        lead_id: row.lead_id || row.id || lead.id,
        company_name: row.company_name || row.nome || lead.company_name || 'Empresa sem nome',
        phone: row.phone || row.whatsapp || row.telefone || lead.phone || '',
        normalized_phone: row.normalized_phone || row.phone_normalized || lead.normalized_phone || '',
        website: row.website || row.site || lead.website || '',
        has_own_site: row.has_own_site ?? row.hasOwnSite ?? lead.has_own_site ?? !!(row.website || row.site || lead.website),
        instagram_url: row.instagram_url || row.instagram || lead.instagram_url || '',
        current_stage: row.current_stage || lead.current_stage || 'validation',
        current_status: row.current_status || lead.current_status || 'pending_validation',
        whatsapp_status: row.whatsapp_status || lead.whatsapp_status || 'pending'
      };
    }

    function isValidationCandidateV681(row = {}) {
      const stage = String(row.current_stage || '').toLowerCase();
      const status = String(row.current_status || '').toLowerCase();
      const wa = String(row.whatsapp_status || '').toLowerCase();
      const removed = row.removed_at || row.deleted_at || row.archived_at;
      if (removed) return false;
      if (['sent','platform_removed','archived','blocked','rejected','rejected_validation'].includes(status)) return false;
      if (stage === 'validation') return true;
      if (status === 'pending_validation') return true;
      if (wa === 'pending' && row.phone) return true;
      return false;
    }

    const attempts = [];

    // 1) View principal da Validação
    try {
      const params = new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
        current_stage: 'eq.validation',
        order: 'created_at.desc',
        limit: '1000'
      });
      const rows = await fetchJson('v_lead_cards_persistent', params);
      if (rows.length) return rows.map(normalizeValidationRowV681);
      attempts.push('v_lead_cards_persistent stage=validation retornou 0');
    } catch (error) {
      attempts.push(`v_lead_cards_persistent stage=validation falhou: ${error?.message || JSON.stringify(error)}`);
    }

    // 2) View antiga/específica, se existir
    try {
      const params = new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
        order: 'created_at.desc',
        limit: '1000'
      });
      const rows = await fetchJson('v_validation_leads_rebuild', params);
      if (rows.length) return rows.map(normalizeValidationRowV681).filter(isValidationCandidateV681);
      attempts.push('v_validation_leads_rebuild retornou 0');
    } catch (error) {
      attempts.push(`v_validation_leads_rebuild falhou: ${error?.message || JSON.stringify(error)}`);
    }

    // 3) View geral sem filtro rígido de stage
    try {
      const params = new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
        order: 'created_at.desc',
        limit: '1000'
      });
      const rows = await fetchJson('v_lead_cards_persistent', params);
      const candidates = rows.map(normalizeValidationRowV681).filter(isValidationCandidateV681);
      if (candidates.length) return candidates;
      attempts.push(`v_lead_cards_persistent geral retornou ${rows.length}, candidatos 0`);
    } catch (error) {
      attempts.push(`v_lead_cards_persistent geral falhou: ${error?.message || JSON.stringify(error)}`);
    }

    // 4) Fallback direto na tabela leads
    try {
      const params = new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
        order: 'created_at.desc',
        limit: '1000'
      });
      const rows = await fetchJson('leads', params);
      const candidates = rows.map(normalizeValidationRowV681).filter(isValidationCandidateV681);
      if (candidates.length) return candidates;
      attempts.push(`leads retornou ${rows.length}, candidatos 0`);
    } catch (error) {
      attempts.push(`leads falhou: ${error?.message || JSON.stringify(error)}`);
    }

    console.warn('[validation-v681-empty]', attempts);
    return [];
  }

  async function rpcValidationAction(leadId, action, reason = null) {
    const userId = await getCurrentUserIdRebuild();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_validation_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_reason: reason
      })
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha na acao de validacao (${response.status}).`);
    return data;
  }

  async function rpcValidationBacklogAction(leadId, bucket) {
    const userId = await getCurrentUserIdRebuild();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_assignment_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: 'send_to_backlog',
        p_bucket: bucket
      })
    });
    const data = await readJson(response);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn('[validation-v687] rpc_assignment_lead_action ausente. Usando fallback direto.', { leadId, bucket });
        return directValidationBacklogFallbackV687(userId, leadId, bucket);
      }
      throw new Error(data?.message || data?.details || `Falha ao enviar ao backlog (${response.status}).`);
    }
    return data;
  }

  async function directValidationBacklogFallbackV687(userId, leadId, bucket) {
    const now = new Date().toISOString();
    const channel = bucket === 'insta' ? 'instagram' : 'whatsapp';
    const currentStatus = bucket === 'insta' ? 'backlog_instagram' : 'backlog_whatsapp';
    const headers = await getHeaders(true);

    const existingParams = new URLSearchParams({
      select: 'id,lead_id,channel,bucket,status',
      user_id: `eq.${userId}`,
      lead_id: `eq.${leadId}`,
      channel: `eq.${channel}`,
      limit: '1'
    });

    const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/backlog_items?${existingParams.toString()}`, {
      headers: await getHeaders()
    });
    const existing = await readJson(existingResponse).catch(() => []);
    if (!existingResponse.ok) throw existing || new Error(`Falha ao consultar backlog (${existingResponse.status}).`);

    if (Array.isArray(existing) && existing[0]?.id) {
      const patchResponse = await fetch(`${SUPABASE_URL}/rest/v1/backlog_items?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'backlog',
          bucket,
          moved_to_queue_item_id: null,
          updated_at: now
        })
      });
      const patchData = await readJson(patchResponse).catch(() => null);
      if (!patchResponse.ok) throw patchData || new Error(`Falha ao atualizar backlog (${patchResponse.status}).`);
    } else {
      const insertPayload = {
        user_id: userId,
        lead_id: leadId,
        channel,
        bucket,
        status: 'backlog',
        moved_to_queue_item_id: null,
        created_at: now,
        updated_at: now
      };

      const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/backlog_items`, {
        method: 'POST',
        headers,
        body: JSON.stringify(insertPayload)
      });
      const insertData = await readJson(insertResponse).catch(() => null);
      if (!insertResponse.ok) throw insertData || new Error(`Falha ao criar backlog (${insertResponse.status}).`);
    }

    const leadPatch = {
      current_stage: 'backlog',
      current_status: currentStatus,
      lead_channel: channel,
      updated_at: now
    };

    const leadResponse = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&user_id=eq.${userId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(leadPatch)
    });
    const leadData = await readJson(leadResponse).catch(() => null);
    if (!leadResponse.ok) throw leadData || new Error(`Falha ao atualizar lead (${leadResponse.status}).`);

    return { ok: true, fallback: true, lead_id: leadId, bucket, channel };
  }


  async function markValidationLeadAsNotOpportunityV688(leadId, reason = 'site_bom_sem_oportunidade') {
    const userId = await getCurrentUserIdRebuild();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');
    const now = new Date().toISOString();
    const headers = await getHeaders(true);

    const leadResponse = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&user_id=eq.${userId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        current_stage: 'archived',
        current_status: 'not_opportunity',
        archived_at: now,
        updated_at: now
      })
    });
    const leadData = await readJson(leadResponse).catch(() => null);
    if (!leadResponse.ok) throw leadData || new Error(`Falha ao arquivar lead (${leadResponse.status}).`);

    // Remove qualquer entrada operacional pendente para garantir que não vá para backlog/fila.
    for (const table of ['backlog_items', 'queue_items']) {
      try {
        const params = new URLSearchParams({
          user_id: `eq.${userId}`,
          lead_id: `eq.${leadId}`
        });
        await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            status: 'removed',
            updated_at: now
          })
        });
      } catch (error) {
        console.warn(`[validation-v688] falha ao limpar ${table}:`, error);
      }
    }

    try {
      await fetch(`${SUPABASE_URL}/rest/v1/lead_events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          lead_id: leadId,
          event_type: 'not_opportunity',
          event_payload: {
            reason,
            source: 'validation_com_site_manual_review_v688',
            label: 'Site bom / sem oportunidade'
          },
          created_at: now
        })
      });
    } catch (error) {
      console.warn('[validation-v688] lead_events opcional falhou:', error);
    }

    return { ok: true, lead_id: leadId, reason };
  }

  async function removeComSiteLeadFromValidationV688(leadId) {
    const row = state.rows.find((item) => String(item.id) === String(leadId));
    const label = row?.company_name || row?.nome || 'este lead';

    const run = async () => {
      try {
        setActionButtonsDisabled(leadId, true);
        await markValidationLeadAsNotOpportunityV688(leadId, 'site_bom_sem_oportunidade');
        state.rows = state.rows.filter((item) => String(item.id) !== String(leadId));
        state.selected.delete(String(leadId));
        renderActiveValidationTab();
        if (typeof updateBadges === 'function') updateBadges();
        if (typeof notify === 'function') notify('Lead removido da Validação: site bom / sem oportunidade.');
        return true;
      } catch (error) {
        console.error('[validation-v688] erro ao remover lead com site:', error);
        if (typeof notify === 'function') notify(error?.message || 'Falha ao remover lead da Validação.', 'err');
        return false;
      } finally {
        setActionButtonsDisabled(leadId, false);
      }
    };

    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm(`Remover ${label} da Validação? Motivo: site bom / sem oportunidade.`, run);
      return;
    }

    if (window.confirm && !window.confirm(`Remover ${label} da Validação?`)) return;
    await run();
  }

  function normalizeLeadForRuntime(row = {}) {
    const companyName = row.company_name || row.nome || 'Empresa sem nome';
    const website = row.website || row.site || '';
    const phone = row.phone || row.whatsapp || '';
    const maps = row.google_maps_url || row.googleUrl || row.maps || '';
    const instagram = row.instagram_url || row.instagram || '';
    const location = getStageLocation(row);
    const status = row.current_status || '';

    return {
      ...row,
      id: row.id,
      lead_id: row.id,
      nome: companyName,
      empresa: companyName,
      name: companyName,
      company_name: companyName,
      categoria: row.category || row.categoria || '',
      category: row.category || row.categoria || '',
      descricao: row.description || row.descricao || '',
      description: row.description || row.descricao || '',
      nota: row.rating,
      rating: row.rating,
      avaliacoes: row.reviews_count,
      reviews: row.reviews_count,
      reviews_count: row.reviews_count,
      whatsapp: phone,
      telefone: phone,
      phone,
      normalized_phone: row.normalized_phone || row.phone_normalized || '',
      whatsapp_status: row.whatsapp_status || (status === 'whatsapp_validated' ? 'valid' : 'pending'),
      whatsappValidationStatus: status === 'whatsapp_validated' ? 'valid' : 'pending',
      numStatus: status === 'whatsapp_validated' ? 'valido' : (status === 'rejected_validation' ? 'invalido' : 'pendente'),
      site: website,
      website,
      hasOwnSite: !!row.has_own_site,
      has_own_site: !!row.has_own_site,
      instagram,
      instagram_url: instagram,
      instagram_username: row.instagram_username || '',
      googleUrl: maps,
      google_maps_url: maps,
      maps,
      place_id: row.place_id || '',
      pais: row.country || '',
      country: row.country || '',
      estado: row.state || '',
      state: row.state || '',
      uf: row.state_code || '',
      state_code: row.state_code || '',
      cidade: row.city || '',
      city: row.city || '',
      bairro: row.neighborhood || '',
      neighborhood: row.neighborhood || '',
      endereco: row.address || '',
      address: row.address || '',
      cep: row.zip_code || '',
      zip_code: row.zip_code || '',
      local: location,
      current_stage: row.current_stage || 'validation',
      current_status: status || 'pending_validation',
      stage: row.current_stage || 'validation',
      status: status || 'pending_validation',
      lead_channel: row.lead_channel || '',
      opportunity: row.opportunity || '',
      lead_score: row.lead_score,
      baseSource: 'Supabase validation'
    };
  }

  function patchFindLeadEverywhere() {
    if (window.findLeadEverywhere?.__rebuild618) return;

    const previous = window.findLeadEverywhere;
    const patched = function findLeadEverywhereRebuild618(id) {
      const key = String(id || '');
      if (runtimeLeadCache.has(key)) return runtimeLeadCache.get(key);
      return typeof previous === 'function' ? previous.apply(this, arguments) : null;
    };

    patched.__rebuild618 = true;
    patched.__previous = previous;
    window.findLeadEverywhere = patched;
  }

  function publishRuntimeLeads(rows) {
    runtimeLeadCache.clear();
    const normalized = rows.map(normalizeLeadForRuntime);
    normalized.forEach((lead) => runtimeLeadCache.set(String(lead.id), lead));
    window.rebuildValidationLeads = normalized;

    patchFindLeadEverywhere();

    try {
      if (typeof mergeLeadsIntoPermanentBase === 'function' && normalized.length) {
        mergeLeadsIntoPermanentBase(normalized, { source: 'Supabase validation' }, { schedule: false });
      }
    } catch (error) {
      console.warn('[rebuild618] falha ao publicar leads para ficha:', error);
    }
  }

  function digits(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function hasUsefulPhone(row = {}) {
    return digits(row.phone || row.normalized_phone || row.whatsapp || row.telefone).length >= 10;
  }

  function hasValidatedWhatsapp(row = {}) {
    return row.current_status === 'whatsapp_validated'
      || row.whatsapp_status === 'valid'
      || row.whatsappValidationStatus === 'valid'
      || row.numStatus === 'valido';
  }

  function hasOwnSite(row = {}) {
    return !!(row.has_own_site || row.hasOwnSite) && !!text(row.website || row.site, '');
  }

  function bucketForValidation(row = {}) {
    if (!hasValidatedWhatsapp(row)) return 'insta';
    if (hasOwnSite(row)) return 'com-site';
    return 'zap';
  }

  function isBacklogReadyTab(tab = state.activeTab) {
    return ['validados', 'insta', 'com-site'].includes(tab);
  }

  function getPendingRows() {
    return state.rows.filter((row) => row.current_status === 'pending_validation');
  }

  function getValidatedRows() {
    return state.rows.filter((row) => hasValidatedWhatsapp(row) && bucketForValidation(row) === 'zap');
  }

  function getInstagramRows() {
    return state.rows.filter((row) => {
      if (row.current_status === 'pending_validation_instagram') return true;
      if (row.lead_channel === 'instagram' && !hasValidatedWhatsapp(row)) return true;
      return row.current_stage === 'validation' && !hasValidatedWhatsapp(row) && !hasUsefulPhone(row);
    });
  }

  function getComSiteRows() {
    return state.rows.filter((row) => hasValidatedWhatsapp(row) && bucketForValidation(row) === 'com-site');
  }

  function getActiveRows() {
    if (state.activeTab === 'validados') return getValidatedRows();
    if (state.activeTab === 'insta') return getInstagramRows();
    if (state.activeTab === 'com-site') return getComSiteRows();
    return getPendingRows();
  }

  function setBadgeText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function paintTab(tab, active) {
    const ids = {
      pendentes: 'valResultTabPendentes',
      validados: 'valResultTabValidados',
      insta: 'valResultTabInsta',
      'com-site': 'valResultTabComSite'
    };
    const element = document.getElementById(ids[tab] || ids.pendentes);
    if (!element) return;

    const activeColor = tab === 'insta' ? 'var(--insta)' : tab === 'com-site' ? '#5bb8f5' : 'var(--accent)';
    const activeBorder = tab === 'insta' ? 'rgba(225,48,108,0.3)' : tab === 'com-site' ? 'rgba(91,184,245,0.35)' : 'var(--accent-border)';
    const activeBg = tab === 'insta' ? 'rgba(225,48,108,0.06)' : tab === 'com-site' ? 'rgba(91,184,245,0.07)' : 'var(--accent-dim)';

    element.classList.toggle('active', active);
    element.style.borderColor = active ? activeBorder : 'var(--border2)';
    element.style.background = active ? activeBg : 'var(--bg)';
    element.style.color = active ? activeColor : 'var(--muted)';
  }

  function renderCounters() {
    const pending = getPendingRows().length;
    const validated = getValidatedRows().length;
    const instagram = getInstagramRows().length;
    const comSite = getComSiteRows().length;
    const total = pending + validated + instagram + comSite;

    setBadgeText('valCountSemZap', pending);
    setBadgeText('valCountComZap', validated);
    setBadgeText('valCountInsta', instagram);
    setBadgeText('valCountComSite', comSite);
    setBadgeText('badge-validacao', total);

    paintTab('pendentes', state.activeTab === 'pendentes');
    paintTab('validados', state.activeTab === 'validados');
    paintTab('insta', state.activeTab === 'insta');
    paintTab('com-site', state.activeTab === 'com-site');
  }

  function renderPagination(total) {
    const target = document.getElementById('valPagination');
    if (!target) return;

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));

    if (pages <= 1) {
      target.innerHTML = '';
      return;
    }

    target.innerHTML = `
      <div class="btn-row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page <= 1 ? 'disabled' : ''} onclick="goValidationPageRebuild618(${state.page - 1})">Anterior</button>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);padding:7px 4px">Pagina ${state.page} de ${pages}</span>
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page >= pages ? 'disabled' : ''} onclick="goValidationPageRebuild618(${state.page + 1})">Proxima</button>
      </div>
    `;
  }

  function linkHtml(url, label) {
    if (!url) return `<span class="empresa-site">${esc(label)} -</span>`;
    return `<span class="empresa-site"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a></span>`;
  }


  function validationRowStatusBadgeV689(row = {}) {
    const bucket = bucketForValidation(row);
    const hasSite = !!(row.website || row.site);
    if (bucket === 'com-site' || hasSite) return '<span class="q-badge info">Com site</span>';
    if (bucket === 'insta') return '<span class="q-badge insta">Instagram</span>';
    return '<span class="q-badge ok">Sem site</span>';
  }

  function validationLeadRamoV689(row = {}) {
    return text(row.ramo_nome || row.ramo || row.parent_category || row.category_parent || row.category || row.categoria || 'Sem ramo');
  }

  function validationLeadStateV689(row = {}) {
    const location = getStageLocation(row) || '';
    return text(row.state || row.estado || row.uf || row.location_state || row.lead_locations?.state || (String(location).match(/\b[A-Z]{2}\b/) || [])[0] || '-');
  }

  function validationLeadCityV689(row = {}) {
    const location = getStageLocation(row) || '';
    const fromLocation = String(location).split(',').map((part) => part.trim()).filter(Boolean)[0] || '';
    return text(row.city || row.cidade || row.location_city || row.lead_locations?.city || fromLocation || '-');
  }

  function validationLeadPhoneV689(row = {}) {
    return normalizePhoneLabel(row.phone || row.normalized_phone || row.whatsapp || row.telefone || '');
  }

  function validationTableActionButtonsV689(row = {}) {
    const id = esc(row.id);
    const readyForBacklog = isBacklogReadyTab();
    const validated = hasValidatedWhatsapp(row);
    const approveTitle = readyForBacklog
      ? (state.activeTab === 'com-site' ? 'Site ruim / enviar ao backlog' : 'Enviar ao backlog')
      : (validated ? 'Já validado' : 'Aprovar manualmente');
    const approveAction = readyForBacklog ? `sendValidationLeadToBacklogRebuild629('${id}')` : `approveLeadWhatsappRebuild('${id}')`;
    const archiveAction = state.activeTab === 'com-site' ? `removeComSiteLeadFromValidationV688('${id}')` : `rejectLeadValidationRebuild('${id}')`;
    const archiveTitle = state.activeTab === 'com-site' ? 'Site bom / remover' : 'Arquivar / reprovar';

    return `
      <div class="validation-table-actions">
        <button class="icon-action" type="button" title="Ficha" aria-label="Ficha" onclick="openValidationLeadDrawerRebuild('${id}')">
          <svg viewBox="0 0 24 24"><path d="M12 5c5.2 0 8.7 4.2 9.8 5.8a2 2 0 0 1 0 2.4C20.7 14.8 17.2 19 12 19s-8.7-4.2-9.8-5.8a2 2 0 0 1 0-2.4C3.3 9.2 6.8 5 12 5Zm0 2C7.8 7 4.8 10.3 3.9 12c.9 1.7 3.9 5 8.1 5s7.2-3.3 8.1-5C19.2 10.3 16.2 7 12 7Zm0 2.5A2.5 2.5 0 1 1 12 14.5 2.5 2.5 0 0 1 12 9.5Z"/></svg>
        </button>
        <button class="icon-action icon-action-ok" type="button" title="${esc(approveTitle)}" aria-label="${esc(approveTitle)}" data-validation-action-id="${id}" onclick="${approveAction}">
          <svg viewBox="0 0 24 24"><path d="M9.2 16.6 4.9 12.3l-1.4 1.4 5.7 5.7L21 7.6l-1.4-1.4-10.4 10.4Z"/></svg>
        </button>
        <button class="icon-action icon-action-danger" type="button" title="${esc(archiveTitle)}" aria-label="${esc(archiveTitle)}" data-validation-action-id="${id}" onclick="${archiveAction}">
          <svg viewBox="0 0 24 24"><path d="M5 4h14v4H5V4Zm2 6h10v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8Zm2 2v6h6v-6H9Z"/></svg>
        </button>
      </div>
    `;
  }

  function renderValidationLeadCard(row) {
    const selected = state.selected.has(String(row.id));
    return `
      <tr class="validation-table-row" data-lead-id="${esc(row.id)}">
        <td class="validation-check-cell">
          <button type="button" class="validation-check ${selected ? 'is-selected' : ''}" aria-label="Selecionar lead" onclick="toggleValidacaoBacklogSel('${esc(row.id)}')">
            ${selected ? `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="#0a0a0d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
          </button>
        </td>
        <td>${validationRowStatusBadgeV689(row)}</td>
        <td>
          <div class="validation-company-name">${esc(row.company_name || row.nome || 'Empresa sem nome')}</div>
          <div class="validation-company-links">
            ${row.website ? linkHtml(row.website, 'Site') : ''}
            ${row.google_maps_url ? linkHtml(row.google_maps_url, 'Maps') : ''}
            ${row.instagram_url ? linkHtml(row.instagram_url, 'Instagram') : ''}
          </div>
        </td>
        <td>${esc(validationLeadRamoV689(row))}</td>
        <td>${esc(validationLeadStateV689(row))}</td>
        <td>${esc(validationLeadCityV689(row))}</td>
        <td><span class="empresa-phone">${esc(validationLeadPhoneV689(row))}</span></td>
        <td>${validationTableActionButtonsV689(row)}</td>
      </tr>
    `;
  }

  function renderActiveValidationTab() {
    const list = document.getElementById('valComSiteList');
    if (!list) return;

    renderCounters();

    const rows = getActiveRows();
    const emptyTexts = {
      validados: '// nenhum WhatsApp pronto para backlog',
      insta: '// nenhum lead pronto para Backlog Instagram',
      'com-site': '// nenhum lead com site pronto para backlog',
      pendentes: '// nenhum lead aguardando validacao'
    };
    const emptyText = emptyTexts[state.activeTab] || emptyTexts.pendentes;

    if (!rows.length) {
      list.innerHTML = `<div class="table-empty">${emptyText}</div>`;
      renderPagination(0);
      return;
    }

    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const visibleIds = new Set(pageRows.map((row) => String(row.id)));
    const selectedVisible = pageRows.length && pageRows.every((row) => state.selected.has(String(row.id)));

    list.innerHTML = `
      <div class="validation-table-shell">
        <table class="validation-table">
          <thead>
            <tr>
              <th class="validation-check-cell">
                <button type="button" class="validation-check ${selectedVisible ? 'is-selected' : ''}" title="Selecionar todos desta página" onclick="toggleValidationPageSelectionV689()">
                  ${selectedVisible ? `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="#0a0a0d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
                </button>
              </th>
              <th>Status</th>
              <th>Nome da empresa</th>
              <th>Ramo</th>
              <th>Estado</th>
              <th>Cidade</th>
              <th>WhatsApp</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map(renderValidationLeadCard).join('')}
          </tbody>
        </table>
      </div>
    `;

    window.__validationVisiblePageIdsV689 = [...visibleIds];
    renderPagination(total);
  }

  function openValidationLeadDrawerRebuild(leadId) {
    patchFindLeadEverywhere();

    if (typeof window.openLeadDrawer === 'function') {
      window.openLeadDrawer(leadId);
      return;
    }

    if (typeof notify === 'function') notify('Ficha do lead indisponivel.', 'warn');
  }

  function installHooks() {
    const oldRenderValidacao = window.renderValidacao;
    window.renderValidacao = function renderValidacaoRebuild618() {
      return renderValidationStageFromSupabase();
    };
    window.renderValidacao.__previous = oldRenderValidacao;

    const oldSetValResultTab = window.setValResultTab;
    window.setValResultTab = function setValResultTabRebuild618(tab) {
      if (['validados', 'pendentes', 'insta', 'com-site'].includes(tab)) {
        setValidationResultTab(tab);
        return;
      }
      if (typeof oldSetValResultTab === 'function') return oldSetValResultTab.apply(this, arguments);
    };

    const oldSwitchPanel = window.switchPanel;
    if (typeof oldSwitchPanel === 'function' && !oldSwitchPanel.__rebuild618) {
      const patchedSwitchPanel = function switchPanelRebuild618(panel) {
        const result = oldSwitchPanel.apply(this, arguments);
        const normalized = panel === 'validation' || panel === 'panel-validacao' ? 'validacao' : panel;
        if (normalized === 'validacao') setTimeout(renderValidationStageFromSupabase, 80);
        return result;
      };
      patchedSwitchPanel.__rebuild618 = true;
      patchedSwitchPanel.__previous = oldSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }

    const oldUpdateBadges = window.updateBadges;
    if (typeof oldUpdateBadges === 'function' && !oldUpdateBadges.__rebuild618) {
      const patchedUpdateBadges = function updateBadgesRebuild618() {
        const result = oldUpdateBadges.apply(this, arguments);
        renderCounters();
        return result;
      };
      patchedUpdateBadges.__rebuild618 = true;
      patchedUpdateBadges.__previous = oldUpdateBadges;
      window.updateBadges = patchedUpdateBadges;
    }

    const oldImportarLeads = window.importarLeads;
    if (typeof oldImportarLeads === 'function' && !oldImportarLeads.__validationRefresh618) {
      const patchedImportarLeads = async function importarLeadsValidationRefresh618() {
        const result = await oldImportarLeads.apply(this, arguments);
        setTimeout(renderValidationStageFromSupabase, 200);
        return result;
      };
      patchedImportarLeads.__validationRefresh618 = true;
      patchedImportarLeads.__previous = oldImportarLeads;
      window.importarLeads = patchedImportarLeads;
    }
  }

  function boot() {
    installHooks();
    patchFindLeadEverywhere();

    const waitTab = document.getElementById('valResultTabPendentes');
    const validTab = document.getElementById('valResultTabValidados');
    const instaTab = document.getElementById('valResultTabInsta');
    const siteTab = document.getElementById('valResultTabComSite');
    if (waitTab) waitTab.onclick = () => setValidationResultTab('pendentes');
    if (validTab) validTab.onclick = () => setValidationResultTab('validados');
    if (instaTab) instaTab.onclick = () => setValidationResultTab('insta');
    if (siteTab) siteTab.onclick = () => setValidationResultTab('com-site');

    renderCounters();

    if (document.getElementById('panel-validacao')?.classList.contains('active')) {
      renderValidationStageFromSupabase();
    }
  }

  window.renderValidationStageFromSupabase = renderValidationStageFromSupabase;
  window.openValidationLeadDrawerRebuild = openValidationLeadDrawerRebuild;
  window.approveLeadWhatsappRebuild = approveLeadWhatsappRebuild;
  window.rejectLeadValidationRebuild = rejectLeadValidationRebuild;
  window.sendValidationLeadToBacklogRebuild629 = sendValidationLeadToBacklog;
  window.removeComSiteLeadFromValidationV688 = removeComSiteLeadFromValidationV688;
  window.toggleValidacaoBacklogSel = toggleValidationBacklogSelection;
  window.toggleValidationPageSelectionV689 = toggleValidationPageSelectionV689;
  window.selecionarTodosValidacaoBacklog = selectVisibleValidationBacklogRows;
  window.limparSelecaoValidacaoBacklog = clearValidationBacklogSelection;
  window.enviarSelecionadosValidacaoAoBacklog = sendSelectedValidationToBacklog;
  window.enviarTodosValidacaoAoBacklog = sendVisibleValidationToBacklog;
  window.showValidationWaiting = () => setValidationResultTab('pendentes');
  window.showValidationValidated = () => setValidationResultTab('validados');
  window.goValidationPageRebuild618 = (page) => {
    state.page = Number(page) || 1;
    renderActiveValidationTab();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.22 - Lotes de disparo persistentes */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  const state = {
    batches: [],
    loading: false
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  async function getCurrentUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}
    if (window.currentUser?.id) return window.currentUser.id;
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}
    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;
    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();
    } catch (_) {}
    if (!headers?.apikey) {
      headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      };
    }
    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  async function fetchBatches() {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    const today = new Date();
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      select: 'id,lead_id,position,status,chip_id,chip_name,batch_id,batch_index,batch_position,template_type,updated_at',
      user_id: `eq.${userId}`,
      channel: 'eq.whatsapp',
      scheduled_for: `eq.${localDate}`,
      batch_id: 'not.is.null',
      order: 'batch_id.asc,batch_position.asc,position.asc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/queue_items?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao carregar lotes (${response.status}).`);
    const groups = new Map();
    (Array.isArray(data) ? data : []).forEach((row) => {
      const batchId = row.batch_id || '';
      if (!batchId) return;
      if (!groups.has(batchId)) {
        groups.set(batchId, {
          id: row.id,
          lead_id: batchId,
          position: row.batch_index || row.position || 0,
          updated_at: row.updated_at,
          data: {
            batch_id: batchId,
            batch_index: row.batch_index || 1,
            chip_id: row.chip_id || '',
            chip_name: row.chip_name || row.chip_id || 'Chip',
            status: 'ready',
            items: []
          }
        });
      }
      const group = groups.get(batchId);
      group.updated_at = row.updated_at || group.updated_at;
      if (row.status === 'batch_sending') group.data.status = 'sending';
      if (row.status === 'sent' && group.data.status !== 'sending') group.data.status = 'completed';
      group.data.items.push({
        queue_item_id: row.id,
        lead_id: row.lead_id,
        queue_position: row.position,
        template_type: row.template_type || ''
      });
      group.data.item_count = group.data.items.length;
    });
    return [...groups.values()].sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  async function rpcBatchAction(action, batchId = null) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_dispatch_batch_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_action: action,
        p_batch_id: batchId,
        p_payload: { source: 'fase-6.27' }
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha na acao de lote (${response.status}).`);
    return data;
  }

  function normalizeBatch(row = {}) {
    const data = row.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    return {
      id: row.lead_id || data.batch_id || row.id,
      rowId: row.id,
      position: row.position || 0,
      status: data.status || 'ready',
      chipId: data.chip_id || '',
      chipName: data.chip_name || data.chip_id || 'Chip',
      batchIndex: data.batch_index || row.position || 1,
      itemCount: Number(data.item_count || items.length || 0),
      items,
      createdAt: data.created_at || row.updated_at || '',
      startedAt: data.started_at || '',
      completedAt: data.completed_at || ''
    };
  }

  function statusLabel(status) {
    if (status === 'sending') return 'Em disparo';
    if (status === 'completed') return 'Concluido';
    return 'Pronto';
  }

  function statusClass(status) {
    if (status === 'completed') return 'ok';
    if (status === 'sending') return 'info';
    return 'warn';
  }

  function batchCard(batch) {
    const actions = batch.status === 'completed'
      ? '<span class="q-badge ok">Lote concluido</span>'
      : batch.status === 'sending'
        ? `<button class="add-btn added" type="button" data-batch622-id="${esc(batch.id)}" onclick="completeDispatchBatchRebuild622('${esc(batch.id)}')">Concluir lote</button>`
        : `<button class="add-btn added" type="button" data-batch622-id="${esc(batch.id)}" onclick="startDispatchBatchRebuild622('${esc(batch.id)}')">Iniciar lote</button>`;

    return `
      <div style="border:1px solid var(--border);border-radius:8px;background:var(--surface2);padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
          <div style="font-size:11px;font-weight:700;color:var(--text);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            Lote ${esc(batch.batchIndex)} - ${esc(batch.chipName)}
          </div>
          <span class="q-badge ${statusClass(batch.status)}">${esc(statusLabel(batch.status))}</span>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px">
          <span>${esc(batch.itemCount)} leads</span>
          <span>ID ${esc(batch.id)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${actions}
        </div>
      </div>
    `;
  }

  function renderBatchPanel() {
    // Hotfix visual 6.29.3:
    // A versao nova estava inserindo um painel grande de lotes no topo da lateral
    // direita, mudando completamente o visual antigo da Fila WhatsApp. Mantemos as
    // funcoes/regras de lote ativas, mas os controles ficam na barra de acoes da
    // esquerda via enhanceQueueControls().
    const oldPanel = document.getElementById('dispatchBatchesPanel622');
    if (oldPanel) oldPanel.remove();
    enhanceQueueControls();
  }

  function enhanceQueueControls() {
    const statusTabs = document.getElementById('disparoStatusTabs');
    if (!statusTabs || document.getElementById('generateBatchesBtn622')) return;
    const button = document.createElement('button');
    button.id = 'generateBatchesBtn622';
    button.className = 'btn btn-ghost';
    button.type = 'button';
    button.style.cssText = 'font-size:10px;padding:7px 12px';
    button.textContent = 'Gerar lotes';
    button.onclick = () => generateBatches();
    statusTabs.appendChild(button);
  }

  async function refreshBatches() {
    state.loading = true;
    try {
      state.batches = await fetchBatches();
      enhanceQueueControls();
      renderBatchPanel();
      return state.batches;
    } catch (error) {
      console.error('[rebuild622] erro ao carregar lotes:', error);
      return [];
    } finally {
      state.loading = false;
    }
  }

  function setBatchButtonsDisabled(batchId, disabled) {
    document.querySelectorAll('[data-batch622-id]').forEach((button) => {
      if (button.getAttribute('data-batch622-id') === String(batchId)) button.disabled = disabled;
    });
  }

  async function generateBatches() {
    try {
      const result = await rpcBatchAction('generate_batches');
      if (typeof window.renderQueueStageFromSupabase621 === 'function') await window.renderQueueStageFromSupabase621();
      await refreshBatches();
      const created = Number(result?.batches_created || 0);
      const readyCount = Array.isArray(window.rebuildQueueLeads621)
        ? window.rebuildQueueLeads621.filter((row) => row?.inTodayQueue && (row.batchId || row.batch_id)).length
        : 0;
      if (typeof notify === 'function') {
        notify(created > 0 ? `${created} lote(s) gerado(s).` : (readyCount > 0 ? `Nenhum lote novo gerado. ${readyCount} lead(s) ja estavam em lotes prontos.` : 'Nenhum lead elegivel para gerar lote.'));
      }
    } catch (error) {
      console.error('[rebuild622] erro ao gerar lotes:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao gerar lotes. Verifique o SQL 6.27.', 'err');
    }
  }

  async function startBatch(batchId) {
    setBatchButtonsDisabled(batchId, true);
    try {
      await rpcBatchAction('start_batch', batchId);
      if (typeof notify === 'function') notify('Lote iniciado.');
      await refreshBatches();
    } catch (error) {
      console.error('[rebuild622] erro ao iniciar lote:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao iniciar lote.', 'err');
    } finally {
      setBatchButtonsDisabled(batchId, false);
    }
  }

  async function completeBatch(batchId) {
    setBatchButtonsDisabled(batchId, true);
    try {
      await rpcBatchAction('complete_batch', batchId);
      if (typeof notify === 'function') notify('Lote concluido.');
      await refreshBatches();
    } catch (error) {
      console.error('[rebuild622] erro ao concluir lote:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao concluir lote.', 'err');
    } finally {
      setBatchButtonsDisabled(batchId, false);
    }
  }

  function installHooks() {
    window.generateDispatchBatchesRebuild622 = generateBatches;
    window.refreshDispatchBatchesRebuild622 = refreshBatches;
    window.startDispatchBatchRebuild622 = startBatch;
    window.completeDispatchBatchRebuild622 = completeBatch;

    const previousRenderQueue = window.renderQueueStageFromSupabase621;
    if (typeof previousRenderQueue === 'function' && !previousRenderQueue.__batches622) {
      const patched = async function renderQueueStageBatches622() {
        const result = await previousRenderQueue.apply(this, arguments);
        await refreshBatches();
        return result;
      };
      patched.__batches622 = true;
      patched.__previous = previousRenderQueue;
      window.renderQueueStageFromSupabase621 = patched;
      window.renderFilaZap = patched;
    }

    const previousSetQueueTab = window.setQueueTabRebuild621;
    if (typeof previousSetQueueTab === 'function' && !previousSetQueueTab.__batches622) {
      const patchedSetTab = function setQueueTabBatches622() {
        const result = previousSetQueueTab.apply(this, arguments);
        setTimeout(refreshBatches, 120);
        return result;
      };
      patchedSetTab.__batches622 = true;
      patchedSetTab.__previous = previousSetQueueTab;
      window.setQueueTabRebuild621 = patchedSetTab;
    }

    const previousSwitchPanel = window.switchPanel;
    if (typeof previousSwitchPanel === 'function' && !previousSwitchPanel.__batches622) {
      const patchedSwitchPanel = function switchPanelBatches622(panel) {
        const result = previousSwitchPanel.apply(this, arguments);
        if (panel === 'fila-zap' || panel === 'whatsapp' || panel === 'panel-fila-zap') {
          setTimeout(refreshBatches, 180);
        }
        return result;
      };
      patchedSwitchPanel.__batches622 = true;
      patchedSwitchPanel.__previous = previousSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  function boot() {
    installHooks();
    let attempts = 0;
    const retry = () => {
      attempts++;
      installHooks();
      if (!window.renderQueueStageFromSupabase621?.__batches622 && attempts < 12) setTimeout(retry, 120);
    };
    if (!window.renderQueueStageFromSupabase621?.__batches622) setTimeout(retry, 120);

    if (document.getElementById('panel-fila-zap')?.classList.contains('active')) {
      refreshBatches();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.25 - Chips na Validacao WhatsApp */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  const state = {
    chips: [],
    activeChipId: '',
    validating: false
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function digits(value) {
    return clean(value).replace(/\D+/g, '');
  }

  function notifyUser(message, type = '') {
    if (typeof notify === 'function') notify(message, type);
  }

  function normalizeEvolutionUrl(value = '') {
    return clean(value).replace(/\/+$/, '');
  }

  function normalizeChip(row = {}) {
    const instance = clean(row.instance || row.instance_name || row.instanceName || row.name);
    const name = clean(row.name || row.nome || row.label || row.phone || instance, 'Chip');
    const id = clean(row.chip_id || row.chipId || row.id || instance, name);
    const url = normalizeEvolutionUrl(row.url || row.base_url || row.baseUrl || row.evolution_url || row.evolutionUrl);
    const key = clean(row.api_key || row.apiKey || row.key || row.apikey || row.token);

    return {
      ...row,
      id: String(id),
      chip_id: String(id),
      dbId: row.dbId || row.id || null,
      name,
      nome: name,
      label: name,
      instance,
      instance_name: instance,
      url,
      baseUrl: url,
      evolutionUrl: url,
      key,
      apiKey: key,
      api_key: key,
      status: row.active === false ? 'disabled' : clean(row.status || row.connection_state || row.connectionState, 'saved'),
      active: row.active !== false
    };
  }

  function dedupeChips(chips = []) {
    const map = new Map();
    chips.map(normalizeChip).forEach((chip) => {
      if (!chip.id && !chip.instance) return;
      const key = chip.id || chip.instance;
      const existing = map.get(key) || {};
      map.set(key, { ...existing, ...chip });
    });
    return [...map.values()].filter((chip) => chip.active !== false && chip.status !== 'disabled' && chip.url && chip.instance && chip.key);
  }

  async function getCurrentUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}
    if (window.currentUser?.id) return window.currentUser.id;
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}
    return null;
  }

  async function getHeaders(content = false) {
    let headers = {};
    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();
    } catch (_) {}
    headers = { ...(headers || {}), apikey: headers?.apikey || SUPABASE_KEY };
    if (!headers.Authorization) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  async function fetchPersistedChips() {
    const sources = [
      ...(Array.isArray(window.__crmChipsCache) ? window.__crmChipsCache : []),
      ...(typeof window.getChips === 'function' ? window.getChips() || [] : [])
    ];

    try {
      if (typeof window.CRMHydrateChipsCache === 'function') {
        const hydrated = await window.CRMHydrateChipsCache();
        if (Array.isArray(hydrated)) sources.push(...hydrated);
      }
    } catch (error) {
      console.warn('[rebuild625] hydrate chips falhou:', error);
    }

    const userId = await getCurrentUserId();

    if (userId) {
      try {
        const params = new URLSearchParams({
          select: '*',
          user_id: `eq.${userId}`,
          archived_at: 'is.null',
          active: 'eq.true',
          order: 'updated_at.desc'
        });
        const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
          headers: await getHeaders()
        });
        const data = await readJson(response);
        if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);
        if (Array.isArray(data)) sources.push(...data);
      } catch (error) {
        console.warn('[rebuild625] fetch chips falhou:', error);
      }
    }

    const chips = dedupeChips(sources);
    const priority = (chip = {}) => {
      const stateText = chipStateTextV686(chip);
      if (['open','connected','conectado'].includes(stateText)) return 0;
      if (['connecting','conectando'].includes(stateText)) return 1;
      if (['saved','closed','disconnected','desconectado'].includes(stateText)) return 3;
      return 2;
    };

    return chips.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      return String(a.name || a.label || a.instance || '').localeCompare(String(b.name || b.label || b.instance || ''));
    });
  }

  function getActiveChip() {
    return state.chips.find((chip) => String(chip.id) === String(state.activeChipId) || String(chip.instance) === String(state.activeChipId)) || getPreferredValidationChipV686() || state.chips[0] || null;
  }

  function chipStateTextV686(chip = {}) {
    return String(chip.connectionState || chip.connection_state || chip.status || chip.payload?.status || '').trim().toLowerCase();
  }

  function isChipUsableForValidationV686(chip = {}) {
    const stateText = chipStateTextV686(chip);
    return chip.active !== false && ['open','connected','conectado'].includes(stateText);
  }

  function getPreferredValidationChipV686(excludeIds = new Set()) {
    return state.chips.find((chip) => {
      const id = String(chip.id || chip.instance || '');
      return !excludeIds.has(id) && isChipUsableForValidationV686(chip);
    }) || null;
  }

  function getValidationChipCandidatesV686() {
    const active = getActiveChip();
    const seen = new Set();
    const list = [];
    const push = (chip) => {
      if (!chip) return;
      const id = String(chip.id || chip.instance || chip.chip_id || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      list.push(chip);
    };

    // Primeiro chips realmente marcados como open/connected no banco/cache.
    state.chips.filter(isChipUsableForValidationV686).forEach(push);

    // Depois o ativo, caso não esteja na lista, para não perder seleção manual.
    push(active);

    // Não tenta saved/desconectado/conectando antes dos conectados.
    state.chips
      .filter((chip) => chip.active !== false)
      .filter((chip) => !['saved','closed','disconnected','desconectado','connecting','conectando'].includes(chipStateTextV686(chip)))
      .forEach(push);

    return list;
  }

  function renderChipTabs() {
    const targets = ['valChipTabs', 'manualValChipTabs']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!targets.length) return;

    if (!state.chips.length) {
      targets.forEach((target) => {
        target.innerHTML = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado em Configuracoes > Chips</span>';
      });
      return;
    }

    if (!state.activeChipId || !state.chips.some((chip) => String(chip.id) === String(state.activeChipId))) {
      const preferredChip = getPreferredValidationChipV686() || state.chips[0];
      state.activeChipId = preferredChip.id;
    }

    const html = state.chips.map((chip, index) => {
      const active = String(chip.id) === String(state.activeChipId);
      const status = chip.connectionState || chip.status || 'salvo';
      return `
        <div class="chip-tab${active ? ' active' : ''}" title="${esc(chip.instance)} · ${esc(status)}" onclick="setValChip('${esc(chip.id)}')">
          ${esc(chip.name || `Chip ${index + 1}`)}
        </div>
      `;
    }).join('');

    targets.forEach((target) => { target.innerHTML = html; });
  }

  async function refreshValidationChips() {
    state.chips = await fetchPersistedChips();
    renderChipTabs();
    return state.chips;
  }

  function normalizePhone(value = '') {
    const raw = digits(value);
    if (!raw) return '';
    if (raw.startsWith('55')) return raw;
    if (raw.length === 10 || raw.length === 11) return `55${raw}`;
    return raw;
  }

  function leadPhone(lead = {}) {
    const candidates = [lead.normalized_phone, lead.phone, lead.whatsapp, lead.telefone]
      .map(normalizePhone)
      .filter(Boolean);
    return candidates.find((phone) => phone.length >= 12) || candidates[0] || '';
  }

  function parseValidationResult(data = {}) {
    const item = Array.isArray(data)
      ? data[0]
      : (data?.data?.[0] || data?.result?.[0] || data?.numbers?.[0] || data);
    const explicitFalse = item && (
      item.exists === false ||
      item.isWhatsapp === false ||
      item.numberExists === false ||
      item.exists === 'false' ||
      item.isWhatsapp === 'false' ||
      item.numberExists === 'false'
    );
    const exists = !!(
      item?.exists === true ||
      item?.isWhatsapp === true ||
      item?.numberExists === true ||
      item?.exists === 'true' ||
      item?.isWhatsapp === 'true' ||
      item?.numberExists === 'true' ||
      item?.jid ||
      item?.waId ||
      item?.wa_id
    );

    return { item: item || {}, exists, definitive: exists || explicitFalse };
  }

  function findResultForPhone(results, phone) {
    const list = Array.isArray(results)
      ? results
      : (Array.isArray(results?.data) ? results.data : (Array.isArray(results?.result) ? results.result : []));
    if (!list.length) return null;
    return list.find((item) => {
      const raw = digits(item?.number || item?.phone || item?.jid || item?.waId || item?.wa_id || item?.id || '');
      return raw && (raw.includes(phone) || phone.includes(raw));
    }) || list[0] || null;
  }

  async function callEvolutionDirect(chip, numbers) {
    const response = await fetch(`${chip.url}/chat/whatsappNumbers/${encodeURIComponent(chip.instance)}`, {
      method: 'POST',
      headers: {
        apikey: chip.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ numbers })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error || data?.message === 'Unauthorized' || data?.status === 401) {
      throw new Error(data?.error || data?.message || `Evolution ${response.status}`);
    }
    return data;
  }

  async function callEvolutionValidation(chip, numbers) {
    const payload = {
      numbers,
      chipUrl: chip.url,
      instance: chip.instance,
      apikey: chip.key
    };

    try {
      const response = await fetch('/api/prospeccao/validar-numero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && !data?.error) return data;
      if (response.status === 409 || data?.error === 'INSTANCE_NOT_CONNECTED') {
        const stateLabel = data?.state ? ` (${data.state})` : '';
        const err = new Error(data?.message || `Chip ${chip.instance || chip.name || ''} nao esta conectado${stateLabel}`);
        err.connectionError = true;
        err.details = data;
        throw err;
      }
      if (![404, 405].includes(response.status)) {
        const detail = data?.message || data?.error || data?.details?.message || `Proxy validacao ${response.status}`;
        throw new Error(detail);
      }
    } catch (error) {
      if (!/Failed to fetch|404|405/i.test(error?.message || '')) throw error;
    }

    return callEvolutionDirect(chip, numbers);
  }

  async function rpcValidationChipAction(lead, action, payload = {}) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');
    const chip = payload.chip || getActiveChip() || {};

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_validation_chip_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: lead.id,
        p_action: action,
        p_reason: payload.reason || null,
        p_chip_id: chip.id || chip.chip_id || chip.instance || null,
        p_chip_name: chip.name || chip.nome || chip.label || chip.instance || null,
        p_phone: payload.phone || lead.phone || lead.whatsapp || lead.normalized_phone || null,
        p_exists_whatsapp: typeof payload.exists === 'boolean' ? payload.exists : null,
        p_raw_payload: payload.raw || {}
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao salvar validacao (${response.status}). Rode o SQL 6.25.`);
    return data;
  }

  function setValidationChipButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-validation-chip-action-id]').forEach((button) => {
      if (button.getAttribute('data-validation-chip-action-id') === String(leadId)) {
        button.disabled = disabled;
      }
    });
  }

  async function validateLeadWithChip(leadId, options = {}) {
    await refreshValidationChips();
    const chip = getActiveChip();
    if (!chip) {
      notifyUser('// cadastre ou selecione um chip antes de validar', 'warn');
      return { ok: false, skipped: true };
    }

    const lead = (window.rebuildValidationLeads || []).find((item) => String(item.id) === String(leadId));
    if (!lead) {
      notifyUser('// lead nao encontrado na validacao atual', 'warn');
      return { ok: false, skipped: true };
    }

    const phone = leadPhone(lead);
    if (!phone || phone.length < 12) {
      await rpcValidationChipAction(lead, 'validation_error', {
        chip,
        phone: phone || '',
        reason: 'Numero ausente ou invalido para consulta Evolution',
        raw: { source: 'fase-6.25', reason: 'invalid_phone' }
      }).catch((error) => console.warn('[rebuild625] tentativa invalida nao registrada:', error));
      notifyUser(`// ${lead.nome || lead.company_name}: numero ausente ou invalido`, 'warn');
      return { ok: false, invalidPhone: true };
    }

    setValidationChipButtonsDisabled(leadId, true);

    try {
      const candidates = getValidationChipCandidatesV686();
      let lastConnectionError = null;
      let lastError = null;

      for (const candidateChip of candidates) {
        try {
          const raw = await callEvolutionValidation(candidateChip, [phone]);
          const parsed = parseValidationResult(findResultForPhone(raw, phone) || raw);

          if (!parsed.definitive) {
            await rpcValidationChipAction(lead, 'validation_error', {
              chip: candidateChip,
              phone,
              reason: 'Resposta da Evolution sem resultado definitivo',
              raw
            });
            if (!options.silent) notifyUser('// resposta sem resultado definitivo. Lead continua pendente.', 'warn');
            return { ok: false, error: true };
          }

          state.activeChipId = candidateChip.id;
          renderChipTabs();

          await rpcValidationChipAction(lead, parsed.exists ? 'approve_whatsapp' : 'reject_validation', {
            chip: candidateChip,
            phone,
            exists: parsed.exists,
            reason: parsed.exists ? null : 'Numero sem WhatsApp pela Evolution',
            raw
          });

          if (!options.silent) {
            notifyUser(parsed.exists ? `Numero validado: ${lead.nome || lead.company_name}` : `Sem WhatsApp: ${lead.nome || lead.company_name}`, parsed.exists ? '' : 'warn');
          }

          return { ok: true, exists: parsed.exists, chip: candidateChip };
        } catch (error) {
          lastError = error;
          if (error?.connectionError) {
            lastConnectionError = error;
            console.warn('[validation-v686] chip indisponivel, tentando proximo:', candidateChip.instance, error?.message);
            continue;
          }
          throw error;
        }
      }

      const finalError = lastConnectionError || lastError || new Error('Nenhum chip conectado para validar.');
      throw finalError;
    } catch (error) {
      await rpcValidationChipAction(lead, 'validation_error', {
        chip,
        phone,
        reason: error?.message || 'Falha ao consultar Evolution',
        raw: { source: 'fase-6.86', error: error?.message || String(error) }
      }).catch((rpcError) => console.warn('[rebuild625] erro nao registrado:', rpcError));
      if (!options.silent) notifyUser(error?.message || 'Falha ao validar numero.', 'err');
      return { ok: false, error: true, connectionError: !!error?.connectionError, message: error?.message || '' };
    } finally {
      setValidationChipButtonsDisabled(leadId, false);
    }
  }

  async function validarNumeroUnico(leadId) {
    const result = await validateLeadWithChip(leadId);
    if (result && !result.skipped && typeof window.renderValidationStageFromSupabase === 'function') {
      await window.renderValidationStageFromSupabase();
    }
    if (typeof window.refreshCRMRebuild624 === 'function') window.refreshCRMRebuild624();
  }

  function setSpinner(visible) {
    const spinner = document.getElementById('valSpinner');
    if (spinner) spinner.style.display = visible ? 'inline-block' : 'none';
  }

  async function validarTodosNumeros(options = {}) {
    if (state.validating) {
      notifyUser('// validacao ja em andamento', 'warn');
      return;
    }

    const retryAll = options === true || options?.retryAll === true;
    await refreshValidationChips();
    const chip = getActiveChip();
    if (!chip) {
      notifyUser('// cadastre ou selecione um chip antes de validar', 'warn');
      return;
    }

    if (typeof window.renderValidationStageFromSupabase === 'function') {
      await window.renderValidationStageFromSupabase();
    }

    const rows = (window.rebuildValidationLeads || [])
      .filter((lead) => lead.current_stage === 'validation')
      .filter((lead) => retryAll ? lead.current_status !== 'whatsapp_validated' : lead.current_status === 'pending_validation');

    if (!rows.length) {
      notifyUser(retryAll ? '// nenhum numero para revalidar' : '// nenhum numero pendente', 'warn');
      return;
    }

    state.validating = true;
    setSpinner(true);

    let valid = 0;
    let invalid = 0;
    let failed = 0;
    let skipped = 0;

    try {
      for (const lead of rows) {
        const result = await validateLeadWithChip(lead.id, { silent: true });
        if (result?.connectionError) {
          failed++;
          notifyUser(result.message || 'Chip nao conectado. Validação interrompida.', 'err');
          break;
        }
        if (result?.skipped || result?.invalidPhone) skipped++;
        else if (result?.ok && result.exists) valid++;
        else if (result?.ok && !result.exists) invalid++;
        else failed++;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      notifyUser(`${valid} valido(s) · ${invalid} sem WhatsApp · ${failed} falha(s) · ${skipped} ignorado(s)`);
      if (typeof window.renderValidationStageFromSupabase === 'function') {
        await window.renderValidationStageFromSupabase();
      }
      if (typeof window.refreshCRMRebuild624 === 'function') window.refreshCRMRebuild624();
    } finally {
      state.validating = false;
      setSpinner(false);
    }
  }

  function setValChip(chipId) {
    state.activeChipId = chipId;
    renderChipTabs();
  }

  function patchRenderValidation() {
    const previous = window.renderValidationStageFromSupabase;
    if (typeof previous !== 'function' || previous.__chips625) return;

    const patched = async function renderValidationStageChips625() {
      const result = await previous.apply(this, arguments);
      await refreshValidationChips();
      return result;
    };

    patched.__chips625 = true;
    patched.__previous = previous;
    window.renderValidationStageFromSupabase = patched;
    window.renderValidacao = patched;
  }

  function patchSwitchPanel() {
    const previous = window.switchPanel;
    if (typeof previous !== 'function' || previous.__chips625) return;

    const patched = function switchPanelValidationChips625(panel) {
      const result = previous.apply(this, arguments);
      if (['validacao', 'validation', 'panel-validacao', 'importar', 'panel-importar'].includes(panel)) {
        setTimeout(refreshValidationChips, 180);
      }
      return result;
    };

    patched.__chips625 = true;
    patched.__previous = previous;
    window.switchPanel = patched;
  }

  function install() {
    patchRenderValidation();
    patchSwitchPanel();
    window.refreshValidationChipsRebuild625 = refreshValidationChips;
    window.setValChip = setValChip;
    window.validarNumeroUnico = validarNumeroUnico;
    window.validarTodosNumeros = validarTodosNumeros;
  }

  function boot() {
    install();
    refreshValidationChips();
    setTimeout(install, 300);
    setTimeout(() => {
      install();
      refreshValidationChips();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.24 - Estabilizacao ponta a ponta */
(function () {
  const state = {
    refreshing: false,
    installedAt: ''
  };

  function isActivePanel(id) {
    return !!document.getElementById(id)?.classList.contains('active');
  }

  function safeCall(name, args = []) {
    try {
      const fn = window[name];
      if (typeof fn === 'function') return fn.apply(window, args);
    } catch (error) {
      console.warn(`[rebuild624] ${name} falhou:`, error);
    }
    return null;
  }

  async function refreshMaybe(result) {
    if (result && typeof result.then === 'function') return result.catch((error) => {
      console.warn('[rebuild624] refresh async falhou:', error);
      return null;
    });
    return result;
  }

  async function refreshFlowSurfaces() {
    if (state.refreshing) return;
    state.refreshing = true;

    try {
      const tasks = [];

      if (isActivePanel('panel-validacao')) {
        tasks.push(refreshMaybe(safeCall('renderValidationStageFromSupabase')));
      }

      if (isActivePanel('panel-fila-zap')) {
        tasks.push(refreshMaybe(safeCall('renderQueueStageFromSupabase621')));
      } else if (typeof window.refreshDispatchBatchesRebuild622 === 'function') {
        tasks.push(refreshMaybe(safeCall('refreshDispatchBatchesRebuild622')));
      }

      if (typeof window.updateBadges === 'function') {
        tasks.push(refreshMaybe(safeCall('updateBadges')));
      }

      await Promise.all(tasks);
    } finally {
      state.refreshing = false;
    }
  }

  function scheduleFlowRefresh(delay = 120) {
    clearTimeout(window.__crm624RefreshTimer);
    window.__crm624RefreshTimer = setTimeout(() => {
      refreshFlowSurfaces().catch((error) => {
        console.warn('[rebuild624] refresh geral falhou:', error);
      });
    }, delay);
  }

  function patchAsyncAction(name, delay = 120) {
    const previous = window[name];
    if (typeof previous !== 'function' || previous.__flow624) return false;

    const patched = async function actionRebuild624() {
      try {
        return await previous.apply(this, arguments);
      } finally {
        scheduleFlowRefresh(delay);
      }
    };

    patched.__flow624 = true;
    patched.__previous = previous;
    window[name] = patched;
    return true;
  }

  function patchSwitchPanel() {
    const previous = window.switchPanel;
    if (typeof previous !== 'function' || previous.__flow624) return false;

    const patched = function switchPanelFlow624(panel) {
      const result = previous.apply(this, arguments);
      if (['validacao', 'validation', 'panel-validacao', 'fila-zap', 'whatsapp', 'panel-fila-zap'].includes(panel)) {
        scheduleFlowRefresh(220);
      }
      return result;
    };

    patched.__flow624 = true;
    patched.__previous = previous;
    window.switchPanel = patched;
    return true;
  }

  function installActionPatches() {
    [
      'approveLeadWhatsappRebuild',
      'rejectLeadValidationRebuild',
      'assignLeadToChipRebuild620',
      'queueLeadTodayRebuild621',
      'backToBacklogRebuild621',
      'queueAllBacklogRebuild621',
      'generateDispatchBatchesRebuild622',
      'startDispatchBatchRebuild622',
      'completeDispatchBatchRebuild622',
      'salvarChip',
      'deletarChip'
    ].forEach((name) => patchAsyncAction(name, 180));

    patchSwitchPanel();
  }

  function smokeCheck() {
    const requiredFunctions = [
      'importarLeads',
      'renderValidationStageFromSupabase',
      'approveLeadWhatsappRebuild',
      'sendValidationLeadToBacklogRebuild629',
      'assignLeadToChipRebuild620',
      'renderQueueStageFromSupabase621',
      'queueLeadTodayRebuild621',
      'generateDispatchBatchesRebuild622',
      'completeDispatchBatchRebuild622',
      'hydrateWhatsappChipsRebuild623'
    ];

    const requiredElements = [
      'importJsonInput',
      'importSummary',
      'valComSiteList',
      'disparoEmpresasList',
      'zapRight',
      'chipNome',
      'qrModal'
    ];

    const report = {
      phase: '6.24',
      checkedAt: new Date().toISOString(),
      functions: requiredFunctions.map((name) => ({ name, ok: typeof window[name] === 'function' })),
      elements: requiredElements.map((id) => ({ id, ok: !!document.getElementById(id) }))
    };

    try {
      console.table(report.functions);
      console.table(report.elements);
    } catch (_) {}

    const missingFunctions = report.functions.filter((item) => !item.ok).length;
    const missingElements = report.elements.filter((item) => !item.ok).length;
    if (typeof notify === 'function') {
      notify(
        missingFunctions || missingElements
          ? `Diagnostico 6.24: ${missingFunctions} funcao(oes) e ${missingElements} elemento(s) ausente(s).`
          : 'Diagnostico 6.24 OK: funcoes e elementos principais carregados.',
        missingFunctions || missingElements ? 'warn' : ''
      );
    }

    return report;
  }

  function boot() {
    installActionPatches();
    state.installedAt = new Date().toISOString();
    window.CRMRebuild624 = {
      refresh: refreshFlowSurfaces,
      install: installActionPatches,
      smokeCheck
    };
    window.refreshCRMRebuild624 = refreshFlowSurfaces;
    window.runCRMRebuild624SmokeCheck = smokeCheck;

    setTimeout(installActionPatches, 400);
    setTimeout(installActionPatches, 1200);
    setTimeout(() => {
      if (isActivePanel('panel-validacao') || isActivePanel('panel-fila-zap')) {
        scheduleFlowRefresh(0);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.21 - Backlog e Fila WhatsApp persistentes */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const QUEUE_CHANNEL = 'whatsapp';

  const state = {
    activeTab: 'backlog',
    activeQueueMode: 'operation',
    weekRows: [],
    openChipKeys: new Set(),
    chips: [],
    rows: [],
    operationSelected: new Set(),
    operationBusy: false,
    dispatchAsideOpen: false,
    openDispatchChipKey: '',
    dispatchBusy: false,
    loading: false
  };

  const queueLeadCache = new Map();
  const dispatchMessageSaveTimers = new Map();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function digits(value) {
    return clean(value).replace(/\D+/g, '');
  }

  async function getCurrentUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}

    if (window.currentUser?.id) return window.currentUser.id;

    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}

    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;

    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423();
      }
    } catch (_) {}

    if (!headers?.apikey) {
      headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      };
    }

    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  function normalizeChip(row = {}, index = 0) {
    const id = String(row.chip_id || row.id || row.instance || `chip_${index + 1}`);
    return {
      id,
      dbId: row.id || null,
      name: row.name || row.nome || row.label || row.instance || `Chip ${index + 1}`,
      instance: row.instance || row.name || '',
      status: row.status || row.connection_state || 'active',
      dailyLimit: Number(row.dailyLimit || row.daily_limit || 120)
    };
  }

  function localChipsFallback() {
    try {
      return (typeof getChips === 'function' ? getChips() : [])
        .filter((chip) => chip && chip.id && chip.instance && chip.status !== 'disabled' && chip.active !== false)
        .map(normalizeChip);
    } catch (_) {
      return [];
    }
  }

  async function fetchWhatsappChips() {
    const fallback = localChipsFallback();
    const userId = await getCurrentUserId();
    if (!userId) return fallback;

    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
      order: 'created_at.asc'
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);
      const chips = (Array.isArray(data) ? data : [])
        .filter((row) => row.active !== false)
        .map(normalizeChip)
        .filter((chip) => chip.id && chip.instance);
      return chips.length ? chips : fallback;
    } catch (error) {
      console.warn('[rebuild621] falha ao carregar chips:', error);
      return fallback;
    }
  }

  function localDateISO(date = new Date()) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
  }

  function addDaysISO(offset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + Number(offset || 0));
    return localDateISO(date);
  }

  function queueWeekDays() {
    const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const iso = localDateISO(date);
      return {
        iso,
        label: offset === 0 ? 'Hoje' : offset === 1 ? 'Amanhã' : labels[date.getDay()],
        caption: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
      };
    });
  }

  function chunks(list, size = 120) {
    const output = [];
    for (let index = 0; index < list.length; index += size) output.push(list.slice(index, index + size));
    return output;
  }

  async function runQueueRollover() {
    const userId = await getCurrentUserId();
    if (!userId) return null;

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_queue_day_rollover`, {
        method: 'POST',
        headers: await getHeaders(true),
        body: JSON.stringify({ p_user_id: userId })
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha no rollover da fila (${response.status}).`);
      return data;
    } catch (error) {
      console.warn('[rebuild621] rollover indisponivel:', error);
      return null;
    }
  }

  async function fetchBacklogItems(userId) {
    const params = new URLSearchParams({
      select: 'id,lead_id,channel,bucket,status,position,moved_to_queue_item_id,created_at,updated_at',
      user_id: `eq.${userId}`,
      channel: `eq.${QUEUE_CHANNEL}`,
      status: 'not.in.(removed,sent,completed)',
      order: 'position.asc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/backlog_items?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar backlog (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function fetchTodayQueueItems(userId) {
    const params = new URLSearchParams({
      select: 'id,lead_id,source_backlog_item_id,channel,bucket,status,position,chip_id,chip_name,chip_instance,scheduled_for,batch_id,batch_index,batch_position,template_type,template_index,template_part1,template_part2,dispatch_status,current_part,text1_sent_at,text2_sent_at,media_sent_at,dispatch_started_at,completed_at,paused_at,error_message,last_checkpoint_at,created_at,updated_at',
      user_id: `eq.${userId}`,
      channel: `eq.${QUEUE_CHANNEL}`,
      scheduled_for: `eq.${localDateISO()}`,
      status: 'not.in.(removed)',
      order: 'position.asc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/queue_items?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar fila de hoje (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function fetchWeeklyQueueItems(userId) {
    const params = new URLSearchParams({
      select: 'id,lead_id,source_backlog_item_id,channel,bucket,status,position,chip_id,chip_name,chip_instance,scheduled_for,batch_id,batch_index,batch_position,template_type,template_index,template_part1,template_part2,dispatch_status,current_part,text1_sent_at,text2_sent_at,media_sent_at,dispatch_started_at,completed_at,paused_at,error_message,last_checkpoint_at,created_at,updated_at',
      user_id: `eq.${userId}`,
      channel: `eq.${QUEUE_CHANNEL}`,
      status: 'not.in.(removed)',
      order: 'scheduled_for.asc,position.asc'
    });
    params.append('scheduled_for', `gte.${addDaysISO(-1)}`);
    params.append('scheduled_for', `lte.${addDaysISO(6)}`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/queue_items?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar visão semanal (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function fetchLeadsByIds(ids = []) {
    const userId = await getCurrentUserId();
    const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
    const leads = new Map();
    if (!uniqueIds.length) return leads;

    async function fetchFrom(table, idChunk) {
      const params = new URLSearchParams({
        select: '*',
        id: `in.(${idChunk.join(',')})`
      });
      if (userId) params.set('user_id', `eq.${userId}`);
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar leads (${response.status}).`);
      return Array.isArray(data) ? data : [];
    }

    for (const idChunk of chunks(uniqueIds)) {
      let rows = [];
      try {
        rows = await fetchFrom('v_lead_ficha_rebuild', idChunk);
      } catch (error) {
        console.warn('[rebuild621] view da ficha indisponivel, usando leads:', error);
        rows = await fetchFrom('leads', idChunk);
      }
      rows.forEach((lead) => {
        if (lead?.id) leads.set(String(lead.id), lead);
      });
    }

    return leads;
  }

  function normalizeForMatch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function inferRamoId(lead = {}) {
    const explicit = lead.ramoId || lead.ramo_id || lead.segment_id || '';
    if (explicit) return explicit;
    const haystack = normalizeForMatch([
      lead.company_name,
      lead.nome,
      lead.category,
      lead.description
    ].filter(Boolean).join(' '));

    try {
      const ramos = typeof RAMOS_DEFAULT !== 'undefined' && Array.isArray(RAMOS_DEFAULT) ? RAMOS_DEFAULT : [];
      const found = ramos.find((ramo) => (ramo.keywords || []).some((keyword) => haystack.includes(normalizeForMatch(keyword))));
      return found?.id || null;
    } catch (_) {
      return null;
    }
  }

  function rowLead(row = {}, lead = {}, source = 'backlog') {
    const companyName = lead.company_name || lead.nome || lead.name || 'Empresa sem nome';
    const phone = lead.phone || lead.whatsapp || lead.telefone || lead.normalized_phone || '';
    const site = lead.website || lead.site || '';
    const hasSite = !!(lead.has_own_site || lead.hasOwnSite || site);
    const bucket = row.bucket || (hasSite ? 'com-site' : 'zap');
    const templateType = row.template_type || (bucket === 'com-site' || hasSite ? 'com-site' : 'sem-site');
    const status = row.status || (source === 'today' ? 'queued_dispatch' : 'backlog');
    const inToday = source === 'today';

    return {
      ...lead,
      id: String(row.lead_id || lead.id || ''),
      nome: companyName,
      empresa: companyName,
      company_name: companyName,
      categoria: lead.category || '',
      category: lead.category || '',
      whatsapp: phone,
      phone,
      telefone: phone,
      normalized_phone: lead.normalized_phone || digits(phone),
      site,
      website: site,
      hasOwnSite: hasSite,
      has_own_site: hasSite,
      instagram: lead.instagram_url || lead.instagram || '',
      instagram_url: lead.instagram_url || lead.instagram || '',
      chipId: row.chip_id || '',
      assignedChipId: row.chip_id || '',
      chipName: row.chip_name || '',
      chipInstance: row.chip_instance || '',
      current_stage: inToday ? 'dispatch' : 'backlog',
      current_status: inToday ? status : 'backlog_whatsapp',
      status,
      statusRaw: status,
      bucket,
      templateType,
      siteSegment: templateType,
      templateIdx: Number.isFinite(Number(row.template_index)) ? Number(row.template_index) : null,
      mensagem: row.template_part1 || '',
      mensagem2: row.template_part2 || '',
      ramoId: inferRamoId(lead),
      queueType: inToday ? 'queue_items' : 'backlog_items',
      queueItemId: row.id,
      sourceBacklogItemId: row.source_backlog_item_id || '',
      source_backlog_item_id: row.source_backlog_item_id || '',
      queuePosition: row.position || 0,
      scheduledFor: row.scheduled_for || '',
      batchId: row.batch_id || '',
      batchIndex: row.batch_index || null,
      batchPosition: row.batch_position || null,
      dispatchStatus: row.dispatch_status || '',
      currentPart: row.current_part || '',
      textSent: !!row.text1_sent_at,
      text2Sent: !!row.text2_sent_at,
      mediaSent: !!row.media_sent_at,
      text1SentAt: row.text1_sent_at || '',
      text2SentAt: row.text2_sent_at || '',
      mediaSentAt: row.media_sent_at || '',
      dispatchStartedAt: row.dispatch_started_at || '',
      completedAt: row.completed_at || '',
      pausedAt: row.paused_at || '',
      error: row.error_message || '',
      updated_at: row.updated_at,
      baseSource: 'Supabase fila 6.27'
    };
  }

  function mergeQueueRows(backlogItems = [], queueItems = [], leadsById = new Map()) {
    const byLead = new Map();

    backlogItems.forEach((row) => {
      const leadId = String(row.lead_id || '');
      if (!leadId || !leadsById.has(leadId)) return;
      const current = byLead.get(leadId) || {};
      current.backlog = row;
      byLead.set(leadId, current);
    });

    queueItems.forEach((row) => {
      const leadId = String(row.lead_id || '');
      if (!leadId || !leadsById.has(leadId)) return;
      const current = byLead.get(leadId) || {};
      current.today = row;
      byLead.set(leadId, current);
    });

    return [...byLead.entries()].map(([leadId, group]) => {
      if (!group.today && group.backlog?.status === 'moved_to_queue') return null;
      const source = group.today || group.backlog;
      const lead = rowLead(source, leadsById.get(leadId), group.today ? 'today' : 'backlog');
      lead.id = leadId;
      lead.inTodayQueue = !!group.today;
      lead.backlogRowId = group.backlog?.id || '';
      lead.todayRowId = group.today?.id || '';
      lead.backlogPosition = group.backlog?.position ?? 0;
      lead.todayPosition = group.today?.position ?? 0;
      return lead;
    }).filter(Boolean).sort((a, b) => {
      const pa = state.activeTab === 'today' ? a.todayPosition : a.backlogPosition;
      const pb = state.activeTab === 'today' ? b.todayPosition : b.backlogPosition;
      return pa - pb;
    });
  }

  function publishQueueLeads(rows) {
    queueLeadCache.clear();
    rows.forEach((lead) => queueLeadCache.set(String(lead.id), lead));
    window.rebuildQueueLeads621 = rows;

    if (window.findLeadEverywhere?.__queue621) return;
    const previous = window.findLeadEverywhere;
    const patched = function findLeadEverywhereQueue621(id) {
      const key = String(id || '');
      if (queueLeadCache.has(key)) return queueLeadCache.get(key);
      return typeof previous === 'function' ? previous.apply(this, arguments) : null;
    };
    patched.__queue621 = true;
    patched.__previous = previous;
    window.findLeadEverywhere = patched;
  }

  async function fetchQueueState() {
    state.loading = true;
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        state.chips = localChipsFallback();
        state.rows = [];
        publishQueueLeads(state.rows);
        return state.rows;
      }

      await runQueueRollover();

      const [chips, backlogItems, queueItems, weeklyQueueItems] = await Promise.all([
        fetchWhatsappChips(),
        fetchBacklogItems(userId),
        fetchTodayQueueItems(userId),
        fetchWeeklyQueueItems(userId)
      ]);
      const leadIds = [
        ...backlogItems.map((row) => row.lead_id),
        ...queueItems.map((row) => row.lead_id),
        ...weeklyQueueItems.map((row) => row.lead_id)
      ];
      const leadsById = await fetchLeadsByIds(leadIds);
      state.chips = chips;
      state.rows = mergeQueueRows(backlogItems, queueItems, leadsById);
      state.weekRows = weeklyQueueItems
        .map((row) => {
          const leadId = String(row.lead_id || '');
          if (!leadId || !leadsById.has(leadId)) return null;
          const normalized = rowLead(row, leadsById.get(leadId), 'today');
          normalized.id = leadId;
          normalized.inTodayQueue = row.scheduled_for === localDateISO();
          normalized.inScheduledQueue = true;
          normalized.todayRowId = row.id;
          normalized.queueItemId = row.id;
          normalized.todayPosition = row.position ?? 0;
          return normalized;
        })
        .filter(Boolean);
      publishQueueLeads(state.rows);
      return state.rows;
    } finally {
      state.loading = false;
    }
  }

  async function rpcQueueAction(leadId, action, extraPayload = {}) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_backlog_queue_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_payload: {
          source: 'fase-6.27',
          queued_from: 'crm_rebuild',
          ...extraPayload
        }
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha na acao de fila (${response.status}).`);
    return data;
  }

  function filteredRows() {
    return state.rows.filter((row) => state.activeTab === 'today' ? row.inTodayQueue : !row.inTodayQueue);
  }

  function setBadge(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function statusLabelForRow(row = {}) {
    const raw = String(row.statusRaw || row.current_status || '').toLowerCase();
    if (raw === 'batch_sending') return 'Em disparo';
    if (raw === 'batch_ready' || raw === 'queued_dispatch') return 'Em fila';
    if (raw === 'sent' || raw === 'completed' || raw === 'batch_completed') return 'Enviado';
    if (raw === 'error') return 'Erro';
    if (row.inScheduledQueue || row.inTodayQueue) return 'Em fila';
    return 'Não enviado';
  }

  function statusClassForRow(row = {}) {
    const raw = String(row.statusRaw || row.current_status || '').toLowerCase();
    if (raw === 'sent' || raw === 'completed' || raw === 'batch_completed') return 'ok';
    if (raw === 'batch_sending') return 'info';
    if (raw === 'error') return 'err';
    if (raw === 'batch_ready' || raw === 'queued_dispatch' || row.inScheduledQueue || row.inTodayQueue) return 'ok';
    return 'warn';
  }

  function templateTypeLabel(row = {}) {
    return row.templateType === 'com-site' ? 'Com site' : 'Sem site';
  }

  function pickTemplatePayload(row = {}) {
    const templateType = row.templateType || row.siteSegment || (row.site ? 'com-site' : 'sem-site');
    let picked = { text: '', text2: '', idx: null };
    try {
      if (typeof pickTemplate === 'function') picked = pickTemplate(row.nome || row.company_name || 'Lead', row.ramoId || null, templateType);
    } catch (error) {
      console.warn('[rebuild621] falha ao sortear template:', error);
    }
    return {
      template_type: templateType,
      template_index: Number.isFinite(Number(picked.idx)) ? Number(picked.idx) : null,
      template_part1: picked.text || '',
      template_part2: picked.text2 || ''
    };
  }

  function chipMatchesRow(chip, row = {}) {
    const chips = typeof chipKeyCandidates === 'function' ? chipKeyCandidates(chip) : [chip?.id, chip?.dbId, chip?.instance, chip?.name].map((value) => String(value || '').trim()).filter(Boolean);
    const rows = typeof rowChipCandidates === 'function' ? rowChipCandidates(row) : [row?.chipId, row?.chipName, row?.chipInstance].map((value) => String(value || '').trim()).filter(Boolean);
    return rows.some((rowKey) => chips.includes(rowKey));
  }


  function operationActiveChipsRebuild673() {
    const source = (typeof dispatchChipsForControls === 'function' ? dispatchChipsForControls() : state.chips) || [];
    return source
      .map((chip) => (typeof normalizeChip === 'function' ? normalizeChip(chip) : chip))
      .filter((chip) => chip && (chip.id || chip.dbId || chip.instance) && chip.status !== 'disabled' && chip.active !== false);
  }

  function buildChipUsage(activeChips = []) {
    const usage = new Map(activeChips.map((chip) => [String(chip.id), 0]));
    state.rows.filter((row) => row.inTodayQueue).forEach((row) => {
      const chip = activeChips.find((item) => chipMatchesRow(item, row));
      if (!chip) return;
      usage.set(String(chip.id), (usage.get(String(chip.id)) || 0) + 1);
    });
    return usage;
  }

  function chooseNextAvailableChip(activeChips = [], usage = null, startIndex = 0) {
    const currentUsage = usage || buildChipUsage(activeChips);
    const limits = new Map(activeChips.map((chip) => [String(chip.id), Number(chip.dailyLimit || 120)]));
    for (let attempt = 0; attempt < activeChips.length; attempt++) {
      const chip = activeChips[(startIndex + attempt) % activeChips.length];
      const key = String(chip.id);
      if ((currentUsage.get(key) || 0) < (limits.get(key) || 120)) {
        currentUsage.set(key, (currentUsage.get(key) || 0) + 1);
        return { chip, nextIndex: (startIndex + attempt + 1) % activeChips.length };
      }
    }
    return { chip: null, nextIndex: startIndex };
  }

  function chooseSequentialAvailableChipRebuild672(activeChips = [], usage = null, startIndex = 0) {
    const currentUsage = usage || buildChipUsage(activeChips);
    const limits = new Map(activeChips.map((chip) => [String(chip.id), Number(chip.dailyLimit || 120)]));
    for (let attempt = 0; attempt < activeChips.length; attempt++) {
      const index = (startIndex + attempt) % activeChips.length;
      const chip = activeChips[index];
      const key = String(chip.id);
      if ((currentUsage.get(key) || 0) < (limits.get(key) || 120)) {
        currentUsage.set(key, (currentUsage.get(key) || 0) + 1);
        return { chip, nextIndex:index };
      }
    }
    return { chip:null, nextIndex:startIndex };
  }

  function chipStartIndexRebuild672(activeChips = [], chipId = '') {
    const target = String(chipId || '');
    const idx = activeChips.findIndex((chip) => [chip.id, chip.dbId, chip.instance, chip.name, chip.nome]
      .map((value) => String(value || ''))
      .includes(target));
    return idx >= 0 ? idx : 0;
  }

  function queuePayloadFor(row, chip, reason = 'manual') {
    return {
      source: 'fase-6.27',
      queued_from: reason,
      chip_id: chip.id,
      chip_name: chip.name,
      chip_instance: chip.instance,
      filled_day_at: new Date().toISOString(),
      scheduled_for: (state.operationScope && state.operationScope !== 'backlog' ? String(state.operationScope).slice(0, 10) : localDateISO()),
      ...pickTemplatePayload(row)
    };
  }

  function renderTabs() {
    const dayTabs = document.getElementById('disparoDayTabs');
    const statusTabs = document.getElementById('disparoStatusTabs');
    const stats = document.getElementById('disparoStats');
    const backlogCount = state.rows.filter((row) => !row.inTodayQueue).length;
    const todayCount = state.rows.filter((row) => row.inTodayQueue).length;
    const notSent = state.rows.filter((row) => !row.inTodayQueue).length;
    const queued = state.rows.filter((row) => row.inTodayQueue && ['queued_dispatch', 'batch_ready'].includes(row.statusRaw)).length;
    const sending = state.rows.filter((row) => row.statusRaw === 'batch_sending').length;
    const sent = state.rows.filter((row) => row.inTodayQueue && ['sent', 'completed', 'batch_completed'].includes(row.statusRaw)).length;
    const errors = state.rows.filter((row) => row.statusRaw === 'error').length;

    setBadge('badge-fila-zap', todayCount || backlogCount);

    if (dayTabs) {
      dayTabs.innerHTML = `
        <div class="day-tab${state.activeTab === 'backlog' ? ' active' : ''}" onclick="setQueueTabRebuild621('backlog')">
          Backlog <span class="day-count">${backlogCount}</span>
        </div>
        <div class="day-tab${state.activeTab === 'today' ? ' active' : ''}" onclick="setQueueTabRebuild621('today')">
          Fila de hoje <span class="day-count">${todayCount}</span>
        </div>
      `;
    }

    if (statusTabs) {
      statusTabs.innerHTML = `
        <span class="q-badge warn">${notSent} nao enviados</span>
        <span class="q-badge ok">${queued} em fila</span>
        <span class="q-badge info">${sending} em disparo</span>
        <span class="q-badge ok">${sent} enviados</span>
        ${errors ? `<span class="q-badge err">${errors} erro(s)</span>` : ''}
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 12px" onclick="renderQueueStageFromSupabase621()">Atualizar</button>
        <button class="btn btn-primary" type="button" style="font-size:10px;padding:7px 12px" onclick="queueAllBacklogRebuild621()">Preencher o dia</button>
      `;
    }

    if (stats) {
      stats.innerHTML = `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${backlogCount} no backlog · ${todayCount} na fila de hoje · ${state.chips.length} chip${state.chips.length !== 1 ? 's' : ''} ativo${state.chips.length !== 1 ? 's' : ''}</span>`;
    }
  }

  function linkButton(url, label) {
    if (!url) return '';
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="add-btn">${esc(label)}</a>`;
  }

  function actionButtons(row) {
    const whats = digits(row.whatsapp);
    const wa = whats ? linkButton(`https://wa.me/${whats}`, 'Abrir ZAP') : '';
    const locked = ['sent', 'completed', 'batch_completed', 'batch_sending'].includes(row.statusRaw);
    const queueButton = row.inTodayQueue
      ? locked
        ? `<span class="q-badge ${statusClassForRow(row)}">${esc(statusLabelForRow(row))}</span>`
        : `<button class="add-btn" type="button" data-queue621-lead="${esc(row.id)}" onclick="backToBacklogRebuild621('${esc(row.id)}')">Voltar backlog</button>`
      : `<button class="add-btn added" type="button" data-queue621-lead="${esc(row.id)}" onclick="queueLeadTodayRebuild621('${esc(row.id)}')">Entrar na fila</button>`;

    return `
      ${wa}
      <button class="add-btn" type="button" onclick="openQueueLeadDrawerRebuild621('${esc(row.id)}')">Ficha</button>
      ${queueButton}
    `;
  }

  function rowCard(row) {
    const phone = row.whatsapp || 'Sem WhatsApp';
    const chip = row.chipName || row.chipId || 'Chip nao definido';
    const status = statusLabelForRow(row);
    const statusClass = statusClassForRow(row);
    const messageBadge = row.inTodayQueue
      ? (row.mensagem || row.mensagem2 ? '<span class="q-badge ok">Mensagem sorteada</span>' : '<span class="q-badge warn">Sem mensagem</span>')
      : '';

    return `
      <div class="empresa-card" data-lead-id="${esc(row.id)}" style="align-items:flex-start">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(row.nome)}</div>
          <div class="empresa-meta">
            <span class="q-badge ${statusClass}">${esc(status)}</span>
            <span class="q-badge info">${esc(templateTypeLabel(row))}</span>
            <span class="q-badge ${row.chipId ? 'ok' : 'warn'}">${esc(chip)}</span>
            ${messageBadge}
            <span class="empresa-phone">${esc(phone)}</span>
            ${row.site ? `<span class="empresa-site">${esc(row.site)}</span>` : ''}
          </div>
        </div>
        <div class="empresa-actions">
          ${actionButtons(row)}
        </div>
      </div>
    `;
  }

  function renderLeftList() {
    const list = document.getElementById('disparoEmpresasList');
    const pagination = document.getElementById('disparoPagination');
    if (pagination) pagination.innerHTML = '';
    if (!list) return;

    const rows = filteredRows();
    if (!rows.length) {
      list.innerHTML = `<div class="fila-empty">// ${state.activeTab === 'today' ? 'fila de hoje vazia' : 'backlog vazio'}.</div>`;
      return;
    }

    list.innerHTML = rows.map(rowCard).join('');
  }

  function groupRowsByBatch(rows = []) {
    const groups = new Map();
    const LOTE_SIZE = (typeof getLoteSize === 'function' ? Number(getLoteSize()) : 30) || 30;

    rows.forEach((row, index) => {
      const realBatchId = row.batchId || row.batch_id || row.dispatchBatchId || row.dispatch_batch_id || '';
      const isTestBatch = String(realBatchId || '').startsWith('teste-');
      const computedBatchIndex = Number(row.batchIndex || row.batch_index) || (Math.floor(index / LOTE_SIZE) + 1);
      const batchId = realBatchId || `auto-lote-${computedBatchIndex}`;

      if (!groups.has(batchId)) {
        groups.set(batchId, {
          id: String(batchId),
          batchId: String(batchId),
          batchIndex: computedBatchIndex,
          isAutoBatch: !realBatchId,
          isTestBatch,
          statusRaw: row.statusRaw || row.status || 'queued_dispatch',
          rows: []
        });
      }

      const group = groups.get(batchId);
      group.rows.push(row);
      if (row.statusRaw === 'batch_sending') group.statusRaw = 'batch_sending';
      if (['sent', 'completed', 'batch_completed'].includes(row.statusRaw) && group.statusRaw !== 'batch_sending') group.statusRaw = row.statusRaw;
    });

    return [...groups.values()].sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0));
  }

  function batchStatusLabel(raw = '') {
    if (raw === 'batch_sending') return 'Em disparo';
    if (['sent', 'completed', 'batch_completed'].includes(raw)) return 'Concluído';
    return 'Pronto';
  }


  function selectedRamoForBatchRebuild648(chipId, batchIndex, group = {}) {
    const rowRamos = [...new Set((group.rows || [])
      .map((row) => String(row.ramoId || row.ramo_id || '').trim())
      .filter(Boolean))];
    if (rowRamos.length === 1) return rowRamos[0];
    try {
      if (typeof getLoteRamo === 'function') return getLoteRamo(chipId, batchIndex) || '';
    } catch (_) {}
    return '';
  }

  window.onRebuildKanbanLoteRamoChange = async function onRebuildKanbanLoteRamoChange(chipId, batchIndex, ramoId, isSlot, slot, batchId) {
    try {
      if (typeof setLoteRamo === 'function') setLoteRamo(chipId, batchIndex, ramoId);
    } catch (error) {
      console.warn('[rebuild648] falha ao salvar ramo local do lote:', error?.message || error);
    }
    const targetBatch = String(batchId || '');
    const changedRowsByKey = new Map();
    const rememberChangedRow = (row) => {
      const key = String(row.queueItemId || row.todayRowId || row.queue_item_id || row.id || row.leadId || row.lead_id || Math.random());
      changedRowsByKey.set(key, row);
    };
    const applyTemplate = (row) => {
      row.ramoId = ramoId || null;
      row.ramo_id = ramoId || null;
      if (ramoId && typeof pickTemplate === 'function') {
        const picked = pickTemplate(row.nome || row.company_name || 'Lead', ramoId, row.templateType || row.siteSegment || row.template_type || 'sem-site');
        row.mensagem = picked?.text || '';
        row.mensagem2 = picked?.text2 || '';
        row.template_part1 = row.mensagem;
        row.template_part2 = row.mensagem2;
        row.templateIdx = Number.isFinite(Number(picked?.idx)) ? Number(picked.idx) : -1;
        row.template_index = Number.isFinite(Number(picked?.idx)) ? Number(picked.idx) : null;
      } else {
        row.mensagem = '';
        row.mensagem2 = '';
        row.template_part1 = '';
        row.template_part2 = '';
        row.templateIdx = -1;
        row.template_index = null;
      }
    };

    [state.rows, state.weekRows].forEach((list) => {
      (list || []).forEach((row) => {
        const rowBatch = String(row.batchId || row.batch_id || '');
        const rowChip = rowChipCandidates(row);
        const sameBatch = targetBatch && rowBatch
          ? rowBatch === targetBatch
          : Number(row.batchIndex || row.batch_index || 1) === Number(batchIndex || 1);
        if (!sameBatch || !rowChip.includes(String(chipId || ''))) return;
        applyTemplate(row);
        rememberChangedRow(row);
      });
    });

    const rows = readTestDispatchRows();
    let changed = false;
    rows.forEach((row) => {
      if (String(row.batchId || row.batch_id || '') !== targetBatch) return;
      applyTemplate(row);
      changed = true;
    });
    if (changed) saveTestDispatchRows(rows);
    renderRightPanel();

    const changedRows = [...changedRowsByKey.values()];
    if (changedRows.length && typeof updateDispatchCheckpointV635 === 'function') {
      await Promise.all(changedRows.map((row) => updateDispatchCheckpointV635(row, {
        template_part1: row.template_part1 || '',
        template_part2: row.template_part2 || '',
        template_index: Number.isFinite(Number(row.template_index)) ? Number(row.template_index) : null
      })));
    }
  };

  function batchConfigBlock(chip, slot, group) {
    const batchIndex = Number(group.batchIndex || 1) || 1;
    const chipId = chip.id || chip.dbId || chip.instance || String(slot);
    const selectedRamo = selectedRamoForBatchRebuild648(chipId, batchIndex, group);
    const ramos = (typeof getRamos === 'function' ? getRamos() : []) || [];
    const imageKey = (typeof getLoteImgKey === 'function') ? getLoteImgKey(chipId, batchIndex) : `chip-${chipId}-lote-${batchIndex}`;
    const imageSrc = (typeof getLoteImagem === 'function') ? getLoteImagem(chipId, batchIndex) : null;
    try {
      if (typeof carregarImagensLote === 'function') carregarImagensLote(chipId, batchIndex, slot, true);
    } catch (_) {}
    return `
      <div style="border:1px dashed var(--border2);border-radius:12px;background:rgba(255,255,255,.02);padding:10px;margin-bottom:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">
          <label style="display:flex;flex-direction:column;gap:6px;min-width:0">
            <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">Ramo do lote</span>
            <select onchange="typeof onRebuildKanbanLoteRamoChange==='function'&&onRebuildKanbanLoteRamoChange('${esc(chipId)}',${batchIndex},this.value,true,${slot},'${esc(group.batchId || group.id || '')}')" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:8px;font-family:'DM Mono',monospace;font-size:9px">
              <option value="">— selecione o ramo —</option>
              ${ramos.map((ramo) => `<option value="${esc(ramo.id)}" ${String(selectedRamo || '') === String(ramo.id) ? 'selected' : ''}>${esc(ramo.nome || ramo.name || ramo.id)}</option>`).join('')}
            </select>
          </label>
          <div style="min-width:0">
            <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:6px">Imagem do lote</div>
            <div class="fila-img-area ${imageSrc ? 'has-img' : ''}" style="position:relative;border:1px dashed var(--border2);border-radius:9px;min-height:42px;padding:8px;background:var(--bg);display:flex;align-items:center;gap:8px;overflow:hidden">
              <img data-lote-img-key="${esc(imageKey)}" src="${esc(imageSrc || '')}" style="${imageSrc ? '' : 'display:none;'}width:40px;height:40px;object-fit:cover;border-radius:7px;border:1px solid var(--border)" />
              <span class="fila-img-label" style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);${imageSrc ? 'display:none' : ''}">Sem imagem</span>
              <span class="fila-img-ok" style="font-family:'DM Mono',monospace;font-size:8px;color:var(--accent);${imageSrc ? '' : 'display:none'}">Imagem salva</span>
              <input type="file" accept="image/*" onchange="typeof onLoteImgChange==='function'&&onLoteImgChange('${esc(chipId)}',${batchIndex},this,true,${slot});setTimeout(function(){typeof renderQueueDispatchAsideRebuild648==='function'&&renderQueueDispatchAsideRebuild648()},420)" style="position:absolute;inset:0;opacity:0;cursor:pointer" />
              <button class="fila-remove-btn add-btn" type="button" onclick="event.stopPropagation();typeof onLoteImgRemove==='function'&&onLoteImgRemove('${esc(chipId)}',${batchIndex},true,${slot});setTimeout(function(){typeof renderQueueDispatchAsideRebuild648==='function'&&renderQueueDispatchAsideRebuild648()},220)" style="margin-left:auto;${imageSrc ? '' : 'display:none'}">Remover</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function dispatchChipsForControls() {
    const persisted = Array.isArray(state.chips) ? state.chips.filter((chip) => chip && chip.active !== false && chip.status !== 'disabled') : [];
    if (persisted.length) return persisted;
    try {
      const legacy = typeof getChips === 'function' ? getChips() : [];
      if (Array.isArray(legacy) && legacy.length) {
        return legacy.filter((chip) => chip && chip.active !== false && chip.status !== 'disabled');
      }
    } catch (_) {}
    return [];
  }

  function dispatchChipKey(chip = {}, slot = 0) {
    return String(chip.id || chip.dbId || chip.instance || chip.phone || chip.name || slot);
  }

  function dispatchChipSlotFromKey(key) {
    const target = String(key ?? '').trim();
    const chips = dispatchChipsForControls();
    if (/^\d+$/.test(target) && chips[Number(target)]) return Number(target);
    return chips.findIndex((chip, index) => {
      if (String(index) === target) return true;
      return chipKeyCandidates(chip).includes(target);
    });
  }

  function selectedDispatchRowsForChip(slotOrKey, dispatchDate = selectedQueueDateForDispatch()) {
    const chips = dispatchChipsForControls();
    const slot = dispatchChipSlotFromKey(slotOrKey);
    const chip = chips[slot] || null;
    if (!chip) return { chip:null, slot:-1, rows:[] };
    const rows = queueRowsForDispatchDate(dispatchDate).filter((row) => chipMatchesRow(chip, row));
    return { chip, slot, rows };
  }

  function dispatchRowStateMatches(row = {}, key = '') {
    const target = String(key || '');
    return operationRowKey(row) === target
      || String(row.queueItemId || row.todayRowId || row.queue_item_id || '') === target
      || String(row.leadId || row.lead_id || '') === target;
  }

  function updateDispatchRowsInState(rowKey, updater) {
    let changed = false;
    [state.rows, state.weekRows].forEach((list) => {
      (list || []).forEach((row) => {
        if (!dispatchRowStateMatches(row, rowKey)) return;
        updater(row);
        changed = true;
      });
    });
    return changed;
  }

  function findDispatchRowInState(rowKey) {
    return [...(state.rows || []), ...(state.weekRows || [])].find((row) => dispatchRowStateMatches(row, rowKey)) || null;
  }

  function scheduleDispatchRowMessageSave(rowKey, row, patch) {
    if (!row || row.isTestLead) return;
    const timerKey = `${rowKey}:${Object.keys(patch).sort().join(',')}`;
    clearTimeout(dispatchMessageSaveTimers.get(timerKey));
    dispatchMessageSaveTimers.set(timerKey, setTimeout(async () => {
      dispatchMessageSaveTimers.delete(timerKey);
      if (typeof updateDispatchCheckpointV635 === 'function') {
        await updateDispatchCheckpointV635(row, patch);
      }
    }, 650));
  }

  window.updateDispatchLeadMessageRebuild648 = function updateDispatchLeadMessageRebuild648(rowKey, field, value) {
    const key = String(rowKey || '');
    const safeField = field === 'mensagem2' ? 'mensagem2' : 'mensagem';
    const patch = safeField === 'mensagem2'
      ? { template_part2: value || '' }
      : { template_part1: value || '' };

    let updatedRow = null;
    updateDispatchRowsInState(key, (row) => {
      row[safeField] = value || '';
      if (safeField === 'mensagem2') row.template_part2 = value || '';
      else row.template_part1 = value || '';
      updatedRow = row;
    });

    const testRows = readTestDispatchRows();
    let testChanged = false;
    testRows.forEach((row) => {
      if (!dispatchRowStateMatches(row, key)) return;
      row[safeField] = value || '';
      if (safeField === 'mensagem2') row.template_part2 = value || '';
      else row.template_part1 = value || '';
      testChanged = true;
    });
    if (testChanged) saveTestDispatchRows(testRows);

    const legacyRows = Object.values(typeof filaDisparo !== 'undefined' ? (filaDisparo || {}) : {}).flat();
    legacyRows.forEach((row) => {
      if (!dispatchRowStateMatches(row, key)) return;
      row[safeField] = value || '';
      if (safeField === 'mensagem2') row.template_part2 = value || '';
      else row.template_part1 = value || '';
    });
    if (updatedRow) scheduleDispatchRowMessageSave(key, updatedRow, patch);
    try { if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ reason:'dispatch-aside-message-update' }); } catch (_) {}
  };

  function hasDispatchLeadMessageSentRebuild648(row = {}) {
    const raw = String(row.statusRaw || row.status || row.current_status || '').toLowerCase();
    return !!(
      row.textSent || row.text2Sent || row.mediaSent ||
      row.text1SentAt || row.text2SentAt || row.mediaSentAt ||
      row.text1_sent_at || row.text2_sent_at || row.media_sent_at ||
      row.completedAt || row.completed_at ||
      ['sent', 'completed', 'batch_completed'].includes(raw)
    );
  }

  function isDispatchLeadRemovalAllowedRebuild648(row = {}, slot = -1) {
    if (!row || hasDispatchLeadMessageSentRebuild648(row)) return false;
    const raw = String(row.statusRaw || row.status || row.current_status || '').toLowerCase();
    const currentPart = String(row.currentPart || row.current_part || '').toLowerCase();
    const dispatchStatus = String(row.dispatchStatus || row.dispatch_status || '').toLowerCase();
    if (raw === 'batch_sending' || row.dispatchStartedAt || row.dispatch_started_at) {
      const st = chipSlotState?.[slot] || {};
      return !!(st.pausado || dispatchStatus === 'paused' || currentPart === 'paused' || row.pausedAt || row.paused_at);
    }
    return true;
  }

  function dispatchLeadRemovalTitleRebuild648(row = {}, slot = -1) {
    if (hasDispatchLeadMessageSentRebuild648(row)) return 'Lead com mensagem ou imagem ja enviada nao pode ser removido do lote.';
    const raw = String(row.statusRaw || row.status || row.current_status || '').toLowerCase();
    if (raw === 'batch_sending' && !isDispatchLeadRemovalAllowedRebuild648(row, slot)) {
      return 'Pause o chip antes de remover um lead que esta em disparo.';
    }
    return 'Remover do lote e voltar ao backlog.';
  }

  function removeDispatchLeadLocallyRebuild648(row = {}, chipId = '', slot = -1) {
    const rowKey = operationRowKey(row);
    const ids = new Set([rowKey, row.id, row.leadId, row.lead_id, row.queueItemId, row.todayRowId, row.queue_item_id]
      .map((value) => String(value || '').trim())
      .filter(Boolean));
    const matches = (item = {}) => [...ids].some((id) => dispatchRowStateMatches(item, id) || operationRowKey(item) === id);

    const testRows = readTestDispatchRows().filter((item) => !matches(item));
    saveTestDispatchRows(testRows);

    try {
      if (chipId && filaDisparo?.[chipId]) {
        filaDisparo[chipId] = (filaDisparo[chipId] || []).filter((item) => !matches(item));
        if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:'dispatch-aside-lead-remove' });
      }
      if (slot >= 0 && typeof removeDispatchItemFromRuntimeV439 === 'function') {
        ids.forEach((id) => removeDispatchItemFromRuntimeV439(slot, id));
      }
    } catch (error) {
      console.warn('[rebuild648] falha ao limpar fila local do lead:', error?.message || error);
    }

    state.weekRows = (state.weekRows || []).filter((item) => !matches(item));
    (state.rows || []).forEach((item) => {
      if (!matches(item)) return;
      item.inTodayQueue = false;
      item.inScheduledQueue = false;
      item.statusRaw = 'backlog';
      item.status = 'backlog';
      item.chipId = '';
      item.assignedChipId = '';
      item.chipName = '';
      item.chipInstance = '';
      item.batchId = '';
      item.batchIndex = null;
      item.batchPosition = null;
    });

    try {
      if (typeof ensureWeekData === 'function' && typeof saveWeekData === 'function') {
        const data = ensureWeekData();
        Object.keys(data.days || {}).forEach((day) => {
          (data.days[day] || []).forEach((lead) => {
            if (!ids.has(String(lead.id || '')) || lead.status !== 'Em fila') return;
            if (typeof clearChipLinkFromDayLeadV48 === 'function') clearChipLinkFromDayLeadV48(lead);
            else lead.status = 'Não enviada';
          });
        });
        saveWeekData(data);
      }
    } catch (_) {}
  }

  function dispatchLeadRemoveButtonRebuild648(row = {}, slot = -1) {
    const allowed = isDispatchLeadRemovalAllowedRebuild648(row, slot);
    const disabled = allowed && !state.dispatchBusy ? '' : 'disabled';
    const title = dispatchLeadRemovalTitleRebuild648(row, slot);
    return `<button class="add-btn" type="button" data-queue621-lead="${esc(row.id)}" ${disabled} title="${esc(title)}" onclick="removeDispatchLeadFromBatchRebuild648('${esc(operationRowKey(row))}','${esc(slot)}')">Remover do lote</button>`;
  }

  function dispatchLeadRemoveButtonCompactRebuild672(row = {}, slot = -1) {
    const allowed = isDispatchLeadRemovalAllowedRebuild648(row, slot);
    const disabled = allowed && !state.dispatchBusy ? '' : 'disabled';
    const title = dispatchLeadRemovalTitleRebuild648(row, slot);
    return `<button class="queue-lead-remove-mini" type="button" data-queue621-lead="${esc(row.id)}" ${disabled} title="${esc(title)}" onclick="event.stopPropagation();removeDispatchLeadFromBatchRebuild648('${esc(operationRowKey(row))}','${esc(slot)}')">Remover</button>`;
  }

  async function directBackToBacklogForUnsentDispatchLeadRebuild648(row = {}) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');
    const leadId = String(row.leadId || row.lead_id || row.id || '').trim();
    const queueId = String(row.queueItemId || row.todayRowId || row.queue_item_id || '').trim();
    if (!leadId && !queueId) throw new Error('Lead sem identificador para remover do lote.');

    const headers = await getHeaders(true);
    const now = new Date().toISOString();
    const backlogId = String(row.backlogRowId || row.sourceBacklogItemId || row.source_backlog_item_id || '').trim();
    const backlogParams = new URLSearchParams({
      user_id: `eq.${userId}`,
      channel: `eq.${QUEUE_CHANNEL}`
    });
    if (backlogId) backlogParams.set('id', `eq.${backlogId}`);
    else backlogParams.set('lead_id', `eq.${leadId}`);

    const backlogResponse = await fetch(`${SUPABASE_URL}/rest/v1/backlog_items?${backlogParams.toString()}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status:'backlog',
        moved_to_queue_item_id:null,
        updated_at:now
      })
    });
    if (!backlogResponse.ok) throw await readJson(backlogResponse);

    const queueParams = new URLSearchParams({
      user_id: `eq.${userId}`,
      channel: `eq.${QUEUE_CHANNEL}`
    });
    if (queueId) queueParams.set('id', `eq.${queueId}`);
    else {
      queueParams.set('lead_id', `eq.${leadId}`);
      queueParams.set('scheduled_for', `eq.${String(row.scheduledFor || row.scheduled_for || localDateISO()).slice(0, 10)}`);
    }

    const queueResponse = await fetch(`${SUPABASE_URL}/rest/v1/queue_items?${queueParams.toString()}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status:'removed',
        chip_id:null,
        chip_name:null,
        chip_instance:null,
        batch_id:null,
        batch_index:null,
        batch_position:null,
        dispatch_status:null,
        current_part:null,
        updated_at:now,
        last_checkpoint_at:now
      })
    });
    if (!queueResponse.ok) throw await readJson(queueResponse);
    return { ok:true };
  }

  async function removeDispatchLeadFromBatchNowRebuild648(rowKey, slotOrKey) {
    if (state.dispatchBusy) return;
    const dispatchDate = selectedQueueDateForDispatch();
    const { chip, slot, rows } = selectedDispatchRowsForChip(slotOrKey, dispatchDate);
    const key = String(rowKey || '');
    const row = (rows || []).find((item) => dispatchRowStateMatches(item, key) || operationRowKey(item) === key)
      || queueRowsForDispatchDate(dispatchDate).find((item) => dispatchRowStateMatches(item, key) || operationRowKey(item) === key);
    if (!row) {
      if (typeof notify === 'function') notify('Lead nao encontrado no lote.', 'err');
      return;
    }
    if (!isDispatchLeadRemovalAllowedRebuild648(row, slot)) {
      if (typeof notify === 'function') notify(dispatchLeadRemovalTitleRebuild648(row, slot), 'warn');
      return;
    }

    state.dispatchBusy = true;
    renderRightPanel();
    try {
      const chipId = chip?.id || chip?.dbId || chip?.instance || row.chipId || row.chip_id || '';
      if (!row.isTestLead) {
        try {
          await rpcQueueAction(row.id, 'back_to_backlog');
        } catch (rpcError) {
          console.warn('[rebuild648] RPC back_to_backlog falhou, tentando fallback para lead sem envio:', rpcError?.message || rpcError);
          await directBackToBacklogForUnsentDispatchLeadRebuild648(row);
        }
      }
      removeDispatchLeadLocallyRebuild648(row, chipId, slot);
      if (typeof notify === 'function') notify('Lead removido do lote e devolvido ao backlog.');
      await renderQueueStageFromSupabase();
    } catch (error) {
      console.error('[rebuild648] erro ao remover lead do lote:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao remover lead do lote.', 'err');
    } finally {
      state.dispatchBusy = false;
      renderRightPanel();
    }
  }

  window.removeDispatchLeadFromBatchRebuild648 = function removeDispatchLeadFromBatchRebuild648(rowKey, slotOrKey) {
    const run = () => removeDispatchLeadFromBatchNowRebuild648(rowKey, slotOrKey);
    const row = queueRowsForDispatchDate(selectedQueueDateForDispatch())
      .find((item) => dispatchRowStateMatches(item, String(rowKey || '')) || operationRowKey(item) === String(rowKey || ''));
    const name = row?.nome || row?.company_name || 'este lead';
    if (typeof abrirModalConfirm === 'function') {
      abrirModalConfirm(`Remover <strong>${esc(name)}</strong> do lote e voltar ao backlog?`, run);
    } else if (confirm(`Remover ${name} do lote e voltar ao backlog?`)) {
      run();
    }
  };

  function batchBlock(chip, slot, group) {
    const batchDomId = `batch-${slot}-${String(group.batchId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const loteNumber = String(Number(group.batchIndex || 1) || 1).padStart(2, '0');
    const label = group.isTestBatch || String(group.batchId || '').startsWith('teste-') ? 'Lote teste' : `Lote ${loteNumber}`;
    return `
      <details class="queue-aside-lote" data-batch-id="${esc(group.batchId || group.id || '')}">
        <summary class="queue-aside-lote-summary" style="padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span style="font-size:11px;font-weight:900;color:var(--accent);letter-spacing:.08em">${esc(label)}</span>
          <span style="display:flex;align-items:center;gap:7px;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">
            <span>${group.rows.length} lead${group.rows.length !== 1 ? 's' : ''}</span>
            <span class="q-badge ${statusClassForRow({ statusRaw: group.statusRaw })}">${esc(batchStatusLabel(group.statusRaw))}</span>
          </span>
        </summary>
        <div id="${esc(batchDomId)}" style="padding:10px;max-height:620px;overflow:auto">
          ${batchConfigBlock(chip, slot, group)}
          ${group.rows.map((row, index) => `
            <details class="queue-aside-lead fila-item ${esc(row.statusRaw || row.status || 'aguardando')}" id="fila-item-${slot}-${esc(row.id)}">
              <summary class="queue-aside-lead-summary" style="padding:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0">
                <div style="min-width:0;flex:1 1 auto;overflow:hidden">
                  <div style="font-size:10px;line-height:14px;font-weight:900;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${esc(row.nome || row.company_name || 'Lead')}</div>
                </div>
                <div style="flex:0 0 auto;display:flex;align-items:center;gap:6px;white-space:nowrap">
                  <span class="q-badge ${templateTypeLabel(row) === 'Com site' ? 'info' : 'warn'}">${esc(templateTypeLabel(row))}</span>
                  <span class="fila-item-status q-badge ${statusClassForRow(row)}">${esc(statusLabelForRow(row))}</span>
                  ${dispatchLeadRemoveButtonCompactRebuild672(row, slot)}
                </div>
              </summary>
              <div id="lead-${esc(batchDomId)}-${index}" style="border-top:1px solid var(--border);padding:10px">
                <label style="display:block;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:6px">Mensagem 1</label>
                <textarea class="queue-aside-message" oninput="updateDispatchLeadMessageRebuild648('${esc(operationRowKey(row))}','mensagem',this.value)">${esc(row.mensagem || row.template_part1 || '')}</textarea>
                <label style="display:block;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin:10px 0 6px">Mensagem 2</label>
                <textarea class="queue-aside-message" oninput="updateDispatchLeadMessageRebuild648('${esc(operationRowKey(row))}','mensagem2',this.value)">${esc(row.mensagem2 || row.template_part2 || '')}</textarea>
                <div style="display:flex;justify-content:flex-end;gap:7px;margin-top:10px;flex-wrap:wrap">
                  <button class="add-btn" type="button" onclick="openQueueLeadDrawerRebuild621('${esc(row.id)}')">Ficha</button>
                </div>
              </div>
            </details>
          `).join('')}
        </div>
      </details>
    `;
  }

  function testLeadBoxRebuild632(chip, slot, dispatchDate = localDateISO()) {
    const id = chip.id || chip.instance || slot;
    const disabledAttr = dispatchControlsDisabledAttr(dispatchDate);
    const disabledTitle = dispatchControlsTitle(dispatchDate);
    return `
      <div style="border:1px dashed var(--border2);border-radius:12px;background:rgba(255,255,255,.02);padding:10px;margin-bottom:10px">
        <div style="font-size:10px;font-weight:900;color:var(--muted);letter-spacing:.08em;margin-bottom:7px">LEAD TESTE</div>
        <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
          <input id="testLeadPhone-${esc(id)}" placeholder="Número para teste" style="flex:1;min-width:160px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:8px;font-family:'DM Mono',monospace;font-size:9px" />
          <button class="add-btn added" type="button" onclick="typeof sendTestLeadFromChipRebuild632==='function'?sendTestLeadFromChipRebuild632('${esc(id)}'):notify('Envio teste ainda não configurado', 'warn')" ${disabledAttr}${disabledTitle}>Testar</button>
        </div>
      </div>
    `;
  }


  function selectedQueueDateForDispatch() {
    const scope = String(state.operationScope || '').slice(0, 10);
    if (scope && /^\d{4}-\d{2}-\d{2}$/.test(scope)) return scope;
    return localDateISO();
  }

  function selectedQueueDateLabel(iso) {
    const days = operationWeekDays();
    const found = days.find((day) => day.iso === iso);
    if (found) return found.label;
    try {
      const [y, m, d] = String(iso || '').split('-').map(Number);
      if (!y || !m || !d) return 'Hoje';
      const date = new Date(y, m - 1, d);
      const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      return `${labels[date.getDay()]} ${date.getDate()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    } catch (_) {
      return 'Hoje';
    }
  }


  const TEST_DISPATCH_ROWS_KEY = 'rebuild_test_dispatch_rows_v1';

  function readTestDispatchRows() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TEST_DISPATCH_ROWS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveTestDispatchRows(rows = []) {
    try { localStorage.setItem(TEST_DISPATCH_ROWS_KEY, JSON.stringify(Array.isArray(rows) ? rows : [])); } catch (_) {}
  }

  function testRowChipMatchesKey(row = {}, key = '') {
    const target = String(key || '').trim();
    if (!target) return false;
    return rowChipCandidates(row).includes(target) || String(row.chipSlot || '') === target;
  }

  window.sendTestLeadFromChipRebuild632 = function sendTestLeadFromChipRebuild632(chipKey) {
    const key = String(chipKey || '').trim();
    const chip = state.chips.find((item, index) => chipKeyCandidates(item).includes(key) || String(index) === key);
    if (!chip) {
      if (typeof notify === 'function') notify('Chip de teste não encontrado.', 'err');
      return;
    }
    const input = document.getElementById(`testLeadPhone-${key}`) || document.getElementById(`testLeadPhone-${chip.id || chip.instance || ''}`);
    const rawPhone = input?.value || '';
    const phone = digits(rawPhone);
    if (phone.length < 10) {
      if (typeof notify === 'function') notify('Informe um número válido para o lead teste.', 'warn');
      return;
    }
    const dispatchDate = selectedQueueDateForDispatch();
    if (dispatchDate !== localDateISO()) {
      if (typeof notify === 'function') notify('Lead teste só pode ser criado para o dia de hoje.', 'warn');
      return;
    }
    const chipId = chip.id || chip.dbId || chip.instance || key;
    const chipName = chip.name || chip.nome || chip.instance || `Chip ${key}`;
    const chipInstance = chip.instance || chip.phone || chip.numero || '';
    const now = Date.now();
    const testRow = {
      id: `teste-${chipId}-${now}`,
      leadId: `teste-${chipId}-${now}`,
      isTestLead: true,
      nome: 'Lead teste',
      company_name: 'Lead teste',
      phone,
      whatsapp: phone,
      normalized_phone: phone,
      site: '',
      website: '',
      templateType: 'sem-site',
      siteSegment: 'sem-site',
      statusRaw: 'queued_dispatch',
      status: 'queued_dispatch',
      scheduledFor: dispatchDate,
      scheduled_for: dispatchDate,
      chipId,
      chip_id: chipId,
      chipName,
      chip_name: chipName,
      chipInstance,
      chip_instance: chipInstance,
      batchId: `teste-${chipId}-${dispatchDate}`,
      batch_id: `teste-${chipId}-${dispatchDate}`,
      batchIndex: 1,
      batch_index: 1,
      batchPosition: 1,
      batch_position: 1,
      created_at: new Date().toISOString()
    };
    const rows = readTestDispatchRows().filter((row) => !(row.isTestLead && String(row.phone || row.whatsapp || '') === phone && testRowChipMatchesKey(row, chipId)));
    rows.push(testRow);
    saveTestDispatchRows(rows);
    if (input) input.value = '';
    if (typeof notify === 'function') notify('Lead teste adicionado ao lote de teste do chip. Selecione ramo e imagem antes de disparar.');
    renderRightPanel();
  };

  function queueRowsForDispatchDate(iso) {
    const target = String(iso || localDateISO()).slice(0, 10);
    const map = new Map();
    const push = (row) => {
      if (!row) return;
      const scheduled = String(row.scheduledFor || row.scheduled_for || '').slice(0, 10);
      if (scheduled !== target) return;
      const key = String(row.id || row.leadId || row.lead_id || row.queueItemId || row.queue_item_id || '');
      if (!key) return;
      map.set(key, { ...row, inTodayQueue: target === localDateISO(), inScheduledQueue: true });
    };
    (state.weekRows || []).forEach(push);
    (state.rows || []).filter((row) => row.inTodayQueue).forEach(push);
    readTestDispatchRows().forEach(push);
    return [...map.values()].sort((a, b) => {
      const chipA = String(a.chipName || a.chipId || '').localeCompare(String(b.chipName || b.chipId || ''));
      if (chipA) return chipA;
      return Number(a.todayPosition || a.queuePosition || 0) - Number(b.todayPosition || b.queuePosition || 0);
    });
  }

  function chipKeyCandidates(chip = {}) {
    return [chip.id, chip.dbId, chip.instance, chip.name, chip.phone, chip.label]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  }

  function rowChipCandidates(row = {}) {
    return [row.chipId, row.assignedChipId, row.chip_id, row.chipName, row.chipInstance, row.chip_name, row.chip_instance]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  }

  function dispatchAgendaHtml(activeIso) {
    const days = operationWeekDays();
    return `
      <div class="card" style="margin:0 0 12px;padding:14px;flex-shrink:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
          <div>
            <div class="card-title" style="margin:0">Agenda semanal</div>
            <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:4px">// selecione o dia para visualizar a fila de disparos</div>
          </div>
          <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 12px" onclick="renderQueueStageFromSupabase621()">Atualizar</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px">
          ${days.map((day) => {
            const active = day.iso === activeIso;
            const total = queueRowsForDispatchDate(day.iso).length;
            return `
              <button type="button" onclick="setQueueOperationScopeRebuild646('${esc(day.iso)}');setQueueModeRebuild643('dispatch')" style="min-width:0;text-align:left;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:12px;background:${active ? 'rgba(182,255,75,.08)' : 'var(--surface2)'};padding:10px;cursor:pointer;color:var(--text)">
                <div style="font-size:11px;font-weight:900;color:${day.isToday ? 'var(--accent)' : 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(day.label)}${day.isToday ? ' ●' : ''}</div>
                <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:7px">${total} itens</div>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function dispatchControlsDisabledAttr(dispatchDate) {
    return String(dispatchDate || '').slice(0, 10) === localDateISO() ? '' : 'disabled';
  }

  function dispatchControlsTitle(dispatchDate) {
    return String(dispatchDate || '').slice(0, 10) === localDateISO() ? '' : ' title="Disparo permitido apenas para o dia de hoje"';
  }

  function syncDispatchAsideState() {
    const aside = document.getElementById('queueDispatchAside');
    if (aside) aside.classList.toggle('is-closed', !state.dispatchAsideOpen);
  }

  window.toggleQueueDispatchAsideRebuild648 = function toggleQueueDispatchAsideRebuild648(force) {
    state.dispatchAsideOpen = typeof force === 'boolean' ? force : !state.dispatchAsideOpen;
    syncDispatchAsideState();
    renderRightPanel();
  };

  window.toggleDispatchChipAccordionRebuild648 = function toggleDispatchChipAccordionRebuild648(key) {
    const cleanKey = String(key || '');
    state.openDispatchChipKey = state.openDispatchChipKey === cleanKey ? '' : cleanKey;
    renderRightPanel();
  };

  function updateLocalWeekForLegacyDispatch(rows = [], chip = {}, dispatchDate = localDateISO()) {
    if (dispatchDate !== localDateISO()) return;
    try {
      if (typeof ensureWeekData !== 'function' || typeof saveWeekData !== 'function' || typeof todayStr !== 'function') return;
      const today = todayStr();
      const data = ensureWeekData();
      data.days = data.days || {};
      data.days[today] = data.days[today] || [];
      const ids = new Set(rows.map((row) => String(row.id || row.leadId || row.lead_id || '')).filter(Boolean));
      data.days[today] = (data.days[today] || []).filter((lead) => !ids.has(String(lead.id || '')));
      rows.forEach((row) => {
        data.days[today].push({
          ...row,
          id: String(row.id || row.leadId || row.lead_id || ''),
          nome: row.nome || row.company_name || 'Lead',
          whatsapp: row.whatsapp || row.phone || row.normalized_phone || '',
          phone: row.phone || row.whatsapp || row.normalized_phone || '',
          status: 'Em fila',
          queueStatus: 'aguardando',
          chipId: chip.id || chip.dbId || chip.instance || '',
          assignedChipId: chip.id || chip.dbId || chip.instance || '',
          chipName: chip.name || chip.nome || chip.instance || '',
          chipLabel: chip.nome || chip.name || chip.instance || ''
        });
      });
      saveWeekData(data);
    } catch (error) {
      console.warn('[rebuild648] falha ao atualizar semana local para disparo:', error);
    }
  }

  function legacyDispatchItemFromRow(row = {}, chip = {}) {
    const statusRaw = String(row.statusRaw || row.status || '').toLowerCase();
    const status = statusRaw === 'error' ? 'erro' : statusRaw === 'sent' || statusRaw === 'completed' || statusRaw === 'batch_completed' ? 'enviado' : 'aguardando';
    const phone = String(row.whatsapp || row.phone || row.normalized_phone || '').replace(/\D+/g, '');
    return {
      ...row,
      id: String(row.id || row.leadId || row.lead_id || ''),
      leadId: String(row.leadId || row.lead_id || row.id || ''),
      queueItemId: row.queueItemId || row.todayRowId || row.queue_item_id || '',
      todayRowId: row.todayRowId || row.queueItemId || row.queue_item_id || '',
      nome: row.nome || row.company_name || 'Lead',
      whatsapp: phone,
      phone,
      telefone: phone,
      site: row.site || row.website || '',
      mensagem: row.mensagem || row.template_part1 || '',
      mensagem2: row.mensagem2 || row.template_part2 || '',
      template_part1: row.mensagem || row.template_part1 || '',
      template_part2: row.mensagem2 || row.template_part2 || '',
      templateIdx: Number.isFinite(Number(row.templateIdx ?? row.template_index)) ? Number(row.templateIdx ?? row.template_index) : -1,
      template_index: Number.isFinite(Number(row.templateIdx ?? row.template_index)) ? Number(row.templateIdx ?? row.template_index) : null,
      ramoId: row.ramoId || row.ramo_id || null,
      templateType: row.templateType || row.siteSegment || row.template_type || 'sem-site',
      siteSegment: row.siteSegment || row.templateType || row.template_type || 'sem-site',
      chipId: chip.id || chip.dbId || chip.instance || '',
      assignedChipId: chip.id || chip.dbId || chip.instance || '',
      chipName: chip.name || chip.nome || chip.instance || '',
      chipLabel: chip.nome || chip.name || chip.instance || '',
      status,
      scheduledFor: row.scheduledFor || row.scheduled_for || localDateISO(),
      scheduled_for: row.scheduled_for || row.scheduledFor || localDateISO(),
      aberto: false
    };
  }

  async function hydrateDispatchImagesForBatches(chip, groups = []) {
    if (typeof idbGet !== 'function' || typeof getLoteImgKey !== 'function') return;
    const chipId = chip.id || chip.dbId || chip.instance || '';
    await Promise.all(groups.map(async (group) => {
      const loteNum = Number(group.batchIndex || 1) || 1;
      const key = getLoteImgKey(chipId, loteNum);
      if (typeof _imgCache !== 'undefined' && _imgCache[key] !== undefined) return;
      try { _imgCache[key] = (await idbGet(key)) || null; } catch (_) { if (typeof _imgCache !== 'undefined') _imgCache[key] = null; }
    }));
  }

  async function bridgeDispatchRowsToLegacyQueue(slot, dispatchDate = selectedQueueDateForDispatch()) {
    const chips = dispatchChipsForControls();
    const chip = chips[slot] || null;
    if (!chip) return { ok:false, error:'Chip nao encontrado para disparo.' };
    if (dispatchDate !== localDateISO()) return { ok:false, error:'Disparo permitido apenas para o dia de hoje.' };

    const rows = queueRowsForDispatchDate(dispatchDate)
      .filter((row) => chipMatchesRow(chip, row))
      .filter((row) => !['sent', 'completed', 'batch_completed', 'batch_sending'].includes(String(row.statusRaw || row.status || '').toLowerCase()));
    if (!rows.length) return { ok:false, error:'Nenhum lead pronto para este chip.' };

    const missingMessages = rows.filter((row) => !String(row.mensagem || row.template_part1 || '').trim() || !String(row.mensagem2 || row.template_part2 || '').trim());
    if (missingMessages.length) return { ok:false, error:`${missingMessages.length} lead(s) sem mensagens. Selecione o ramo do lote antes de disparar.` };

    const groups = groupRowsByBatch(rows);
    await hydrateDispatchImagesForBatches(chip, groups);
    const chipId = chip.id || chip.dbId || chip.instance || '';
    const missingImages = groups
      .filter((group) => group.rows.some((row) => !['sent', 'completed', 'batch_completed'].includes(String(row.statusRaw || row.status || '').toLowerCase())))
      .map((group) => Number(group.batchIndex || 1) || 1)
      .filter((loteNum) => typeof getLoteImagem === 'function' && !getLoteImagem(chipId, loteNum));
    if (missingImages.length) return { ok:false, error:`Lote(s) ${missingImages.join(', ')} sem imagem.` };

    try {
      if (typeof todayStr === 'function') disparoDay = todayStr();
      updateLocalWeekForLegacyDispatch(rows, chip, dispatchDate);
      const legacyRows = rows
        .slice()
        .sort((a, b) => Number(a.batchIndex || a.batch_index || 0) - Number(b.batchIndex || b.batch_index || 0)
          || Number(a.batchPosition || a.batch_position || a.queuePosition || 0) - Number(b.batchPosition || b.batch_position || b.queuePosition || 0))
        .map((row) => legacyDispatchItemFromRow(row, chip));
      filaDisparo[chipId] = legacyRows;
      if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:'dispatch-aside-bridge' });
    } catch (error) {
      return { ok:false, error:error?.message || 'Falha ao preparar fila local para disparo.' };
    }
    return { ok:true, chip, rows };
  }

  function renderRightPanel() {
    const right = document.getElementById('zapRight');
    if (!right) return;
    syncDispatchAsideState();

    const chips = dispatchChipsForControls();
    if (!chips.length) {
      right.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:40px">// nenhum chip ativo encontrado</div>`;
      return;
    }
    try {
      while (chipSlotState.length < chips.length) {
        chipSlotState.push({ filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false });
      }
    } catch (_) {}

    const dispatchDate = selectedQueueDateForDispatch();
    const dispatchLabel = selectedQueueDateLabel(dispatchDate);
    const dispatchRows = queueRowsForDispatchDate(dispatchDate);
    const disabledAttr = dispatchControlsDisabledAttr(dispatchDate);
    const disabledTitle = dispatchControlsTitle(dispatchDate);
    const actionDisabled = state.dispatchBusy ? 'disabled' : disabledAttr;
    const actionTitle = state.dispatchBusy ? ' title="Processando acao atual"' : disabledTitle;
    const readyTotal = dispatchRows.filter((row) => ['queued_dispatch', 'batch_ready'].includes(row.statusRaw)).length;
    const sendingTotal = dispatchRows.filter((row) => row.statusRaw === 'batch_sending').length;
    const sentTotal = dispatchRows.filter((row) => ['sent', 'completed', 'batch_completed'].includes(row.statusRaw)).length;
    const errorTotal = dispatchRows.filter((row) => row.statusRaw === 'error').length;

    right.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;min-height:0;overflow:hidden;width:100%">
        <div style="padding:14px 14px 12px;border-bottom:1px solid var(--border);background:var(--surface2);flex-shrink:0">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">
            <div style="min-width:0">
              <div class="card-title" style="margin:0">Disparos</div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:4px">${esc(dispatchLabel)} · ${esc(dispatchDate)}</div>
            </div>
            <button class="add-btn" type="button" onclick="toggleQueueDispatchAsideRebuild648(false)">Fechar</button>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
            <span class="q-badge ok">${readyTotal} prontos</span>
            <span class="q-badge info">${sendingTotal} disparo</span>
            <span class="q-badge ok">${sentTotal} enviados</span>
            <span class="q-badge err">${errorTotal} erro</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn btn-ghost" type="button" style="font-size:10px;padding:8px 10px" onclick="renderQueueStageFromSupabase621()">Atualizar</button>
            <button class="btn btn-primary" type="button" style="font-size:10px;padding:8px 10px" onclick="generateDispatchBatchesRebuild622()">Gerar lotes</button>
          </div>
        </div>
        <div style="overflow:auto;min-height:0;flex:1;padding:12px">
          ${chips.map((chip, slot) => {
            const chipKey = dispatchChipKey(chip, slot);
            const isOpen = state.openDispatchChipKey === chipKey;
            const rows = dispatchRows.filter((row) => chipMatchesRow(chip, row));
            const groups = groupRowsByBatch(rows);
            const ready = rows.filter((row) => ['queued_dispatch', 'batch_ready'].includes(row.statusRaw)).length;
            const sending = rows.filter((row) => row.statusRaw === 'batch_sending').length;
            const sent = rows.filter((row) => ['sent', 'completed', 'batch_completed'].includes(row.statusRaw)).length;
            const error = rows.filter((row) => row.statusRaw === 'error').length;
            const withSite = rows.filter((row) => templateTypeLabel(row) === 'Com site').length;
            const withoutSite = rows.filter((row) => templateTypeLabel(row) !== 'Com site').length;
            const chipLabel = chip.name || chip.nome || `Chip ${slot + 1}`;
            const chipInstance = chip.instance || chip.numero || chip.phone || '';
            return `
              <section class="queue-aside-chip">
                <button class="queue-aside-chip-header" type="button" onclick="toggleDispatchChipAccordionRebuild648('${esc(chipKey)}')" style="padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
                  <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
                    <div style="font-size:12px;font-weight:900;color:var(--accent);letter-spacing:.08em">CHIP ${slot + 1}</div>
                    <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(chipLabel)}${chipInstance ? ` · ${esc(chipInstance)}` : ''}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                    <span class="q-badge ok">${ready} prontos</span>
                    <span class="q-badge info">${sending} disparo</span>
                    <span class="q-badge ok">${sent} enviados</span>
                    <span class="q-badge err">${error} erro</span>
                    <span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--muted)">${isOpen ? '-' : '+'}</span>
                  </div>
                </button>
                ${isOpen ? `
                  <div style="padding:12px;border-top:1px solid var(--border)">
                    <div style="border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.02);padding:9px 10px;font-size:11px;color:var(--text);margin-bottom:10px">
                      ${esc(chipInstance || chipLabel)} · ${esc(chipLabel)}
                    </div>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
                      <span class="q-badge info">${withSite} com site</span>
                      <span class="q-badge warn">${withoutSite} sem site</span>
                      <span class="q-badge ok">${rows.length} em fila</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                      <button class="btn btn-ghost" type="button" style="font-size:10px;padding:9px 10px" onclick="clearChipQueueRebuild643('${esc(slot)}')" ${actionDisabled}${actionTitle}>Limpar fila</button>
                      <button class="btn btn-primary" id="btnDisparar${slot}" type="button" style="font-size:11px;padding:9px 10px" onclick="dispatchChipQueueRebuild643('${esc(slot)}')" ${actionDisabled}${actionTitle}>
                        <div class="spinner" id="spinner${slot}"></div>
                        <span id="disparoBtn${slot}">Disparar</span>
                      </button>
                    </div>
                    <button class="btn btn-ghost" id="btnPausa${slot}" type="button" onclick="togglePausaChip(${slot})" style="display:none;font-size:10px;border-color:var(--warning);color:var(--warning);margin-bottom:8px">Pausar</button>
                    <div class="lote-espera-panel" id="loteEsperaPanel${slot}" style="display:none;margin-bottom:10px">
                      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                        <div style="flex:1">
                          <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--accent);margin-bottom:4px" id="loteEsperaTitle${slot}">Aguardando lote...</div>
                          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">Proximo lote em <span id="loteCountdown${slot}" style="color:var(--text2)">--:--</span></div>
                        </div>
                        <button class="add-btn" type="button" onclick="cancelarLotesChip(${slot})">Cancelar</button>
                        <button class="add-btn added" id="btnProximoLote${slot}" type="button" onclick="confirmarProximoLoteChip(${slot})" disabled>Proximo</button>
                      </div>
                      <div style="margin-top:8px;background:var(--surface2);border-radius:6px;height:3px;overflow:hidden">
                        <div id="loteProgressBar${slot}" style="height:100%;background:var(--accent);width:0%;transition:width .5s linear"></div>
                      </div>
                    </div>
                    ${testLeadBoxRebuild632(chip, slot, dispatchDate)}
                    <div style="font-size:10px;font-weight:900;color:var(--accent);letter-spacing:.08em;margin:12px 0 10px">FILA CHIP ${slot + 1}</div>
                    <div id="filaCount${slot}" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:8px">${rows.length} empresa${rows.length !== 1 ? 's' : ''}</div>
                    <div class="fila-empty" id="filaVazia${slot}" style="${groups.length ? 'display:none' : ''};min-height:90px">// sem lotes neste chip</div>
                    <div id="filaItens${slot}" style="${groups.length ? 'display:block' : 'display:none'}">
                      ${groups.map((group) => batchBlock(chip, slot, group)).join('')}
                    </div>
                    <div class="disparo-log" id="disparoLog${slot}"></div>
                  </div>
                ` : ''}
              </section>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  window.toggleBatchLeadDetailsRebuild631 = function toggleBatchLeadDetailsRebuild631(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const willOpen = el.style.display === 'none' || !el.style.display;
    el.style.display = willOpen ? 'block' : 'none';
    const arrow = document.getElementById(`arrow-${id}`);
    if (arrow) {
      arrow.textContent = willOpen ? '▼' : '▶';
      arrow.style.transform = willOpen ? 'rotate(0deg)' : 'rotate(0deg)';
    }
  };

  function renderQueueModeTabs() {
    const tabs = document.getElementById('queueModeTabs');
    const operation = document.getElementById('queueOperationView');
    const dispatch = document.getElementById('queueDispatchView');
    if (tabs) {
      tabs.innerHTML = '';
      tabs.style.display = 'none';
    }
    if (operation) operation.style.display = 'flex';
    if (dispatch) dispatch.style.display = 'none';
    syncDispatchAsideState();
  }

  function rowsForWeekDate(iso) {
    return (state.weekRows || []).filter((row) => String(row.scheduledFor || '').slice(0, 10) === iso);
  }

  function chipCapacity() {
    return state.chips.reduce((total, chip) => total + (Number(chip.dailyLimit || 120) || 120), 0);
  }

  function operationWeekStart(date = new Date()) {
    const base = new Date(date);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() - base.getDay());
    return base;
  }

  function operationWeekDays() {
    const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const start = operationWeekStart();
    const todayIso = localDateISO();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = localDateISO(date);
      return {
        iso,
        isToday: iso === todayIso,
        isPast: iso < todayIso,
        label: `${labels[date.getDay()]} ${date.getDate()}/${String(date.getMonth() + 1).padStart(2, '0')}`
      };
    });
  }

  function normalizeOperationScope(scope) {
    if (scope === 'backlog') return 'backlog';
    const iso = String(scope || '').slice(0, 10);
    const days = operationWeekDays().map((day) => day.iso);
    if (days.includes(iso)) return iso;
    return localDateISO();
  }

  function operationStatusCounts(iso) {
    const todayIso = localDateISO();
    const rows = rowsForWeekDate(iso);
    const sentRows = rows.filter((row) => ['sent', 'completed', 'batch_completed'].includes(row.statusRaw) || row.completedAt || row.mediaSentAt);
    const sendingRows = rows.filter((row) => row.statusRaw === 'batch_sending' || row.dispatchStartedAt);
    const queuedRows = rows.filter((row) => ['batch_ready'].includes(row.statusRaw));
    const notSentRows = rows.filter((row) => ['queued_dispatch'].includes(row.statusRaw));
    const respondedRows = rows.filter((row) => row.respondedAt || row.response_at || row.hasResponse || row.replied_at);
    const refusedRows = rows.filter((row) => ['refused', 'recused', 'declined'].includes(String(row.current_status || row.statusRaw || '').toLowerCase()));
    const closedRows = rows.filter((row) => ['closed', 'won', 'fechado'].includes(String(row.current_status || row.statusRaw || '').toLowerCase()));
    const isPast = iso < todayIso;
    const sent = sentRows.length;
    const responded = respondedRows.length;
    return {
      isPast,
      notSent: isPast ? null : notSentRows.length,
      queued: isPast ? null : queuedRows.length,
      sending: sendingRows.length,
      sent,
      responded,
      notResponded: Math.max(0, sent - responded),
      refused: refusedRows.length,
      closed: closedRows.length,
      total: rows.length
    };
  }

  function operationStatusDefinitions(isPast = false, isBacklog = false) {
    if (isBacklog) return [
      ['not_sent', 'Não enviada'],
      ['queued', 'Em fila'],
      ['sent', 'Enviada'],
      ['responded', 'Respondida'],
      ['not_responded', 'Não respondida'],
      ['refused', 'Recusada'],
      ['closed', 'Fechada']
    ];
    return [
      ...(isPast ? [] : [
        ['not_sent', 'Não enviada'],
        ['queued', 'Em fila']
      ]),
      ['sent', 'Enviada'],
      ['responded', 'Respondida'],
      ['not_responded', 'Não respondida'],
      ['refused', 'Recusada'],
      ['closed', 'Fechada']
    ];
  }

  function operationScopeRows(scope) {
    const todayIso = localDateISO();
    if (!scope || scope === 'backlog') return state.rows.filter((row) => !row.inTodayQueue);
    const iso = String(scope).slice(0, 10);
    const map = new Map();
    const source = iso === todayIso
      ? [...rowsForWeekDate(iso), ...state.rows.filter((row) => row.inTodayQueue)]
      : rowsForWeekDate(iso);
    source.forEach((row) => {
      const key = String(row.id || row.leadId || row.lead_id || row.queueItemId || Math.random());
      if (!map.has(key)) map.set(key, row);
    });
    return [...map.values()];
  }

  function rowMatchesOperationStatus(row = {}, status = 'not_sent', scope = 'backlog') {
    const raw = String(row.statusRaw || row.current_status || '').toLowerCase();
    const sent = ['sent', 'completed', 'batch_completed'].includes(raw) || row.completedAt || row.mediaSentAt || row.sent_at;
    const sending = raw === 'batch_sending' || row.dispatchStartedAt;
    const queued = row.inTodayQueue || ['queued_dispatch', 'batch_ready'].includes(raw) || row.inScheduledQueue;
    const responded = !!(row.respondedAt || row.response_at || row.hasResponse || row.replied_at);
    const refused = ['refused', 'recused', 'declined', 'recusada'].some((key) => raw.includes(key));
    const closed = ['closed', 'won', 'fechado', 'fechada'].some((key) => raw.includes(key));
    if (status === 'queued') return queued && !sent && !sending;
    if (status === 'sent') return !!sent;
    if (status === 'responded') return !!responded;
    if (status === 'not_responded') return !!sent && !responded;
    if (status === 'refused') return !!refused;
    if (status === 'closed') return !!closed;
    return !queued && !sent && !sending;
  }

  function countOperationStatus(scope, status) {
    return operationScopeRows(scope).filter((row) => rowMatchesOperationStatus(row, status, scope)).length;
  }

  function operationRowsForActiveFilter() {
    const scope = state.operationScope || 'backlog';
    const status = state.operationStatus || 'not_sent';
    const term = String(state.operationSearch || '').toLowerCase().trim();
    return operationScopeRows(scope).filter((row) => {
      if (!rowMatchesOperationStatus(row, status, scope)) return false;
      if (!term) return true;
      return [row.nome, row.company_name, row.site, row.website, row.instagram, row.whatsapp, row.phone, row.normalized_phone]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }

  function operationLeadActions(row = {}) {
    const activeChips = operationActiveChipsRebuild673();
    const locked = ['sent', 'completed', 'batch_completed', 'batch_sending'].includes(String(row.statusRaw || '').toLowerCase());
    const disabled = state.operationBusy ? 'disabled' : '';
    const base = `<button class="add-btn" type="button" onclick="openQueueLeadDrawerRebuild621('${esc(row.id)}')">Ficha</button>`;
    if (locked) return `${base}<span class="q-badge ${statusClassForRow(row)}">${esc(statusLabelForRow(row))}</span>`;
    if (row.inTodayQueue || row.inScheduledQueue) {
      return `${base}<button class="add-btn" type="button" data-queue621-lead="${esc(row.id)}" ${disabled} onclick="backToBacklogRebuild621('${esc(row.id)}')">Voltar backlog</button>`;
    }
    if (!activeChips.length) return `${base}<span class="q-badge warn">Sem chip ativo</span>`;
    return `${base}${activeChips.map((chip, index) => `
      <button class="add-btn added" type="button" data-queue621-lead="${esc(row.id)}" ${disabled} onclick="queueLeadToChipRebuild646('${esc(row.id)}','${esc(chip.id)}')">Chip ${index + 1}</button>
    `).join('')}`;
  }

  function operationMetaBadge(label, value, kind = 'warn', href = '') {
    const textValue = String(value || '').trim();
    if (!textValue) return `<span class="q-badge ${kind}">${esc(label)}</span>`;
    if (href) return `<a class="q-badge ${kind}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(textValue)}">${esc(label)}</a>`;
    return `<span class="q-badge ${kind}" title="${esc(textValue)}">${esc(label)}</span>`;
  }

  function operationLeadMeta(row = {}) {
    const instagram = row.instagram || row.instagram_username || row.instagram_url || '';
    const site = row.site || row.website || '';
    const phone = row.whatsapp || row.phone || row.normalized_phone || '';
    return `
      <span class="q-badge ${statusClassForRow(row)}">${esc(statusLabelForRow(row))}</span>
      ${instagram ? operationMetaBadge('Instagram', instagram, 'info', String(instagram).startsWith('http') ? instagram : '') : operationMetaBadge('Sem Instagram', '', 'warn')}
      ${site ? operationMetaBadge('Site', site, 'info', site) : operationMetaBadge('Sem site', '', 'warn')}
      ${phone ? operationMetaBadge(phone, '', 'ok') : operationMetaBadge('Sem WhatsApp', '', 'warn')}
      ${row.mensagem || row.mensagem2 ? '<span class="q-badge ok">Mensagem sorteada</span>' : ''}
    `;
  }

  function operationRowKey(row = {}) {
    return String(row.id || row.leadId || row.lead_id || row.queueItemId || row.queue_item_id || '');
  }

  function isOperationRowLocked(row = {}) {
    return ['sent', 'completed', 'batch_completed', 'batch_sending']
      .includes(String(row.statusRaw || row.current_status || '').toLowerCase());
  }

  function isOperationRowQueued(row = {}) {
    const raw = String(row.statusRaw || row.current_status || '').toLowerCase();
    return row.inTodayQueue || row.inScheduledQueue || ['queued_dispatch', 'batch_ready'].includes(raw);
  }

  function syncOperationSelection(rows = []) {
    const available = new Set(rows.map(operationRowKey).filter(Boolean));
    [...state.operationSelected].forEach((id) => {
      if (!available.has(id)) state.operationSelected.delete(id);
    });
  }

  function selectedOperationRows(rows = []) {
    return rows.filter((row) => state.operationSelected.has(operationRowKey(row)));
  }

  function operationSelectionStats(allRows = []) {
    const selectableRows = allRows.filter((row) => !isOperationRowLocked(row));
    const selectedRows = selectedOperationRows(allRows);
    const actionable = selectedRows.filter((row) => !isOperationRowLocked(row));
    const queued = actionable.filter(isOperationRowQueued);
    const toQueue = actionable.filter((row) => !isOperationRowQueued(row));
    return {
      selectableCount: selectableRows.length,
      selectedRows,
      selectedCount: selectedRows.length,
      queuedCount: queued.length,
      toQueueCount: toQueue.length,
      allSelected: selectableRows.length > 0 && selectableRows.every((row) => state.operationSelected.has(operationRowKey(row))),
      partiallySelected: selectableRows.some((row) => state.operationSelected.has(operationRowKey(row)))
    };
  }

  function syncOperationSelectAllInput(stats) {
    const input = document.getElementById('queueOperationSelectAll');
    if (!input) return;
    input.indeterminate = !!(stats.partiallySelected && !stats.allSelected);
  }

  function operationSelectionToolbar(allRows = []) {
    const stats = operationSelectionStats(allRows);
    const selectDisabled = !stats.selectableCount || state.operationBusy;
    const selectedLabel = `${stats.selectedCount} selecionado${stats.selectedCount !== 1 ? 's' : ''}`;
    return `
      <div class="bulk-list-toolbar">
        <div class="bulk-list-left">
          <button class="bulk-select-btn" type="button" ${selectDisabled ? 'disabled' : ''} onclick="toggleQueueOperationSelectAllRebuild648(true)">Selecionar todos</button>
          <span class="q-badge info">${allRows.length} filtrado${allRows.length !== 1 ? 's' : ''}</span>
          ${stats.selectedCount ? `<span class="q-badge ok">${selectedLabel}</span>` : ''}
        </div>
        <div class="bulk-list-actions ${stats.selectedCount ? 'is-visible' : ''}">
          <button class="btn btn-primary" type="button" ${!stats.toQueueCount || state.operationBusy ? 'disabled' : ''} onclick="queueSelectedOperationLeadsRebuild648()">Auto chips</button>
          ${stats.toQueueCount ? operationActiveChipsRebuild673().slice(0, 5).map((chip, idx) => {
            const chipKey = dispatchChipKey(chip, idx);
            return `
            <button class="btn btn-ghost" type="button" ${state.operationBusy ? 'disabled' : ''} onclick="queueSelectedOperationLeadsToChipRebuild672('${esc(chipKey)}')" title="Preenche este chip ate 120 e depois continua nos proximos">Chip ${idx + 1}</button>
          `;
          }).join('') : ''}
          <button class="btn btn-ghost" type="button" ${!stats.queuedCount || state.operationBusy ? 'disabled' : ''} onclick="backSelectedOperationToBacklogRebuild648()">Voltar backlog</button>
          <button class="btn btn-ghost" type="button" ${!stats.selectedCount || state.operationBusy ? 'disabled' : ''} onclick="clearQueueOperationSelectionRebuild648()">Limpar</button>
          ${state.operationBusy ? '<span class="q-badge warn">Processando</span>' : ''}
        </div>
      </div>
    `;
  }

  function operationLeadRow(row = {}) {
    const key = operationRowKey(row);
    const checked = state.operationSelected.has(key);
    const locked = isOperationRowLocked(row);
    return `
      <div class="empresa-card has-bulk-checkbox" data-lead-id="${esc(row.id)}">
        <label class="bulk-row-check" aria-label="Selecionar lead">
          <input class="bulk-checkbox" type="checkbox" ${checked ? 'checked' : ''} ${locked || state.operationBusy ? 'disabled' : ''}
            onclick="event.stopPropagation()"
            onchange="toggleQueueOperationSelectionRebuild648('${esc(key)}')" />
        </label>
        <div class="empresa-info" style="min-width:0">
          <div class="empresa-nome">${esc(row.nome || row.company_name || 'Lead')}</div>
          <div class="empresa-meta" style="gap:6px;flex-wrap:wrap">
            ${operationLeadMeta(row)}
          </div>
        </div>
        <div class="empresa-actions" style="justify-content:flex-end;gap:6px;flex-wrap:wrap">
          ${operationLeadActions(row)}
        </div>
      </div>
    `;
  }

  function operationPaginatedRows(rows = []) {
    const pageSize = Number(state.operationPageSize || 10) || 10;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Math.max(1, Number(state.operationPage || 1) || 1), totalPages);
    state.operationPage = page;
    return {
      page,
      pageSize,
      totalPages,
      total: rows.length,
      rows: rows.slice((page - 1) * pageSize, page * pageSize)
    };
  }

  function operationPaginationHtml(pagination) {
    if (!pagination || pagination.totalPages <= 1) return '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap">
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">
          Página ${pagination.page} de ${pagination.totalPages} · ${pagination.total} leads
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 10px" ${pagination.page <= 1 ? 'disabled' : ''} onclick="setQueueOperationPageRebuild647(${pagination.page - 1})">Anterior</button>
          <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 10px" ${pagination.page >= pagination.totalPages ? 'disabled' : ''} onclick="setQueueOperationPageRebuild647(${pagination.page + 1})">Próxima</button>
        </div>
      </div>
    `;
  }

  function renderOperationView() {
    const content = document.getElementById('queueOperationContent');
    if (!content) return;
    const days = operationWeekDays();
    const todayIso = localDateISO();
    if (!state.operationScope) state.operationScope = 'backlog';
    state.operationScope = normalizeOperationScope(state.operationScope);
    const selectedScope = state.operationScope;
    const selectedDay = days.find((day) => day.iso === selectedScope);
    const isBacklog = selectedScope === 'backlog';
    const isPast = !!selectedDay && selectedDay.iso < todayIso;
    const statuses = operationStatusDefinitions(isPast, isBacklog);
    if (!statuses.some(([key]) => key === state.operationStatus)) state.operationStatus = statuses[0]?.[0] || 'not_sent';
    const allRows = operationRowsForActiveFilter();
    syncOperationSelection(allRows);
    const pagination = operationPaginatedRows(allRows);
    const rows = pagination.rows;
    const scopeLabel = isBacklog ? 'Backlog' : (selectedDay?.label || selectedScope);
    const backlogTotal = operationScopeRows('backlog').length;

    content.innerHTML = `
      <div class="card" style="margin:0;padding:16px;flex-shrink:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div>
            <div class="card-title" style="margin:0">Agenda semanal</div>
            <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:4px">// operação diária · ao virar o dia, não enviadas e em fila retornam ao backlog</div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 12px;border-color:var(--accent);color:var(--accent)" onclick="toggleQueueDispatchAsideRebuild648(true)">‹ Disparos</button>
            <button class="btn btn-ghost" type="button" style="font-size:10px;padding:7px 12px" onclick="renderQueueStageFromSupabase621()">Atualizar</button>
            <button class="btn btn-primary" type="button" style="font-size:10px;padding:7px 12px" onclick="generateDispatchBatchesRebuild622()">Gerar lotes</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px">
          <button type="button" onclick="setQueueOperationScopeRebuild646('backlog')" style="min-width:0;text-align:left;border:1px solid ${isBacklog ? 'var(--accent)' : 'var(--border)'};border-radius:12px;background:${isBacklog ? 'rgba(182,255,75,.08)' : 'var(--surface2)'};padding:10px;cursor:pointer;color:var(--text)">
            <div style="font-size:11px;font-weight:900;color:${isBacklog ? 'var(--accent)' : 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Backlog</div>
            <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:7px">${backlogTotal} leads</div>
          </button>
          ${days.map((day) => {
            const active = day.iso === selectedScope;
            const total = operationScopeRows(day.iso).length;
            return `
              <button type="button" onclick="setQueueOperationScopeRebuild646('${esc(day.iso)}')" style="min-width:0;text-align:left;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:12px;background:${active ? 'rgba(182,255,75,.08)' : 'var(--surface2)'};padding:10px;cursor:pointer;color:var(--text)">
                <div style="font-size:11px;font-weight:900;color:${day.isToday ? 'var(--accent)' : 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(day.label)}${day.isToday ? ' ●' : ''}</div>
                <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:7px">${total} itens</div>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card" style="margin:0;padding:16px;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">
        <div class="card-title" style="margin:0 0 14px">Leads ativos</div>
        <div class="day-tabs" style="margin-bottom:12px;gap:7px;flex-wrap:wrap">
          ${statuses.map(([key, label]) => `
            <div class="day-tab${state.operationStatus === key ? ' active' : ''}" onclick="setQueueOperationStatusRebuild646('${esc(key)}')">
              ${esc(label)} <span class="day-count">${countOperationStatus(selectedScope, key)}</span>
            </div>
          `).join('')}
        </div>
        ${operationSelectionToolbar(allRows)}
        <input type="text" value="${esc(state.operationSearch || '')}" oninput="setQueueOperationSearchRebuild646(this.value)" placeholder="🔍 Buscar por nome, site ou WhatsApp..." style="width:100%;margin-bottom:12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:12px;font-family:'DM Mono',monospace;font-size:11px;outline:none" />
        <div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;min-height:0;flex:1;display:flex;flex-direction:column">
          <div style="overflow:auto;min-height:0;flex:1;padding:10px">
            ${rows.length ? rows.map(operationLeadRow).join('') : `<div class="fila-empty" style="min-height:160px">// nenhuma empresa em ${esc(scopeLabel)} com este status</div>`}
          </div>
        </div>
        ${operationPaginationHtml(pagination)}
      </div>
    `;
    syncOperationSelectAllInput(operationSelectionStats(allRows));
  }

  window.setQueueOperationDateRebuild645 = function setQueueOperationDateRebuild645(iso) {
    window.setQueueOperationScopeRebuild646(iso);
  };

  window.setQueueOperationScopeRebuild646 = function setQueueOperationScopeRebuild646(scope) {
    state.operationScope = normalizeOperationScope(scope);
    state.operationStatus = 'not_sent';
    state.operationPage = 1;
    state.operationSelected.clear();
    renderOperationView();
  };

  window.setQueueOperationStatusRebuild646 = function setQueueOperationStatusRebuild646(status) {
    state.operationStatus = String(status || 'not_sent');
    state.operationPage = 1;
    state.operationSelected.clear();
    renderOperationView();
  };

  window.setQueueOperationSearchRebuild646 = function setQueueOperationSearchRebuild646(value) {
    state.operationSearch = String(value || '');
    state.operationPage = 1;
    state.operationSelected.clear();
    renderOperationView();
  };

  window.setQueueOperationPageRebuild647 = function setQueueOperationPageRebuild647(page) {
    state.operationPage = Math.max(1, Number(page || 1));
    renderOperationView();
  };

  window.toggleQueueOperationSelectionRebuild648 = function toggleQueueOperationSelectionRebuild648(leadId) {
    if (state.operationBusy) return;
    const key = String(leadId || '');
    if (!key) return;
    const row = operationRowsForActiveFilter().find((item) => operationRowKey(item) === key);
    if (!row || isOperationRowLocked(row)) return;
    if (state.operationSelected.has(key)) state.operationSelected.delete(key);
    else state.operationSelected.add(key);
    renderOperationView();
  };

  window.toggleQueueOperationSelectAllRebuild648 = function toggleQueueOperationSelectAllRebuild648(checked) {
    if (state.operationBusy) return;
    const rows = operationRowsForActiveFilter().filter((row) => !isOperationRowLocked(row));
    rows.forEach((row) => {
      const key = operationRowKey(row);
      if (!key) return;
      if (checked) state.operationSelected.add(key);
      else state.operationSelected.delete(key);
    });
    renderOperationView();
  };

  window.clearQueueOperationSelectionRebuild648 = function clearQueueOperationSelectionRebuild648() {
    if (state.operationBusy) return;
    state.operationSelected.clear();
    renderOperationView();
  };

  function setQueueOperationBulkBusy(value) {
    state.operationBusy = !!value;
    renderOperationView();
  }

  window.queueSelectedOperationLeadsRebuild648 = async function queueSelectedOperationLeadsRebuild648() {
    if (state.operationBusy) return;
    const rows = selectedOperationRows(operationRowsForActiveFilter())
      .filter((row) => !isOperationRowLocked(row) && !isOperationRowQueued(row));
    if (!rows.length) {
      if (typeof notify === 'function') notify('// selecione ao menos 1 lead fora da fila', 'warn');
      return;
    }

    const activeChips = operationActiveChipsRebuild673();
    if (!activeChips.length) {
      if (typeof notify === 'function') notify('// configure pelo menos um chip ativo antes de preencher a fila', 'warn');
      return;
    }

    setQueueOperationBulkBusy(true);
    const usage = buildChipUsage(activeChips);
    let chipCursor = 0;
    let moved = 0;

    try {
      for (const row of rows) {
        const result = chooseSequentialAvailableChipRebuild672(activeChips, usage, chipCursor);
        const chip = result.chip;
        chipCursor = result.nextIndex;
        if (!chip) break;
        try {
          await rpcQueueAction(row.id, 'queue_today', queuePayloadFor(row, chip, 'operation_bulk_selected'));
          moved++;
        } catch (error) {
          console.warn('[rebuild648] falha ao colocar lead selecionado na fila:', row.id, error);
        }
      }
      if (typeof notify === 'function') {
        notify(`${moved} lead${moved !== 1 ? 's' : ''} entrou${moved !== 1 ? 'aram' : ''} na fila.`);
      }
    } finally {
      state.operationSelected.clear();
      state.operationBusy = false;
      await renderQueueStageFromSupabase();
    }
  };

  window.queueSelectedOperationLeadsToChipRebuild672 = async function queueSelectedOperationLeadsToChipRebuild672(chipKey) {
    if (state.operationBusy) return;
    const rows = selectedOperationRows(operationRowsForActiveFilter())
      .filter((row) => !isOperationRowLocked(row) && !isOperationRowQueued(row));
    if (!rows.length) {
      if (typeof notify === 'function') notify('// selecione ao menos 1 lead fora da fila', 'warn');
      return;
    }

    const activeChips = operationActiveChipsRebuild673();
    if (!activeChips.length) {
      if (typeof notify === 'function') notify('// configure pelo menos um chip ativo antes de preencher a fila', 'warn');
      return;
    }

    const startIndex = chipStartIndexRebuild672(activeChips, chipKey);
    setQueueOperationBulkBusy(true);

    const usage = buildChipUsage(activeChips);
    let chipCursor = startIndex;
    let moved = 0;

    try {
      for (const row of rows) {
        const result = chooseSequentialAvailableChipRebuild672(activeChips, usage, chipCursor);
        const chip = result.chip;
        chipCursor = result.nextIndex;
        if (!chip) break;
        try {
          await rpcQueueAction(row.id, 'queue_today', queuePayloadFor(row, chip, 'operation_bulk_selected_chip'));
          moved++;
        } catch (error) {
          console.warn('[rebuild673] falha ao colocar lead selecionado no chip:', row.id, chipKey, error);
        }
      }
      if (typeof notify === 'function') {
        notify(`${moved} lead${moved !== 1 ? 's' : ''} entrou${moved !== 1 ? 'aram' : ''} na fila respeitando a ordem dos chips.`);
      }
    } finally {
      state.operationSelected.clear();
      state.operationBusy = false;
      await renderQueueStageFromSupabase();
    }
  };

  window.backSelectedOperationToBacklogRebuild648 = async function backSelectedOperationToBacklogRebuild648() {
    if (state.operationBusy) return;
    const rows = selectedOperationRows(operationRowsForActiveFilter())
      .filter((row) => !isOperationRowLocked(row) && isOperationRowQueued(row));
    if (!rows.length) {
      if (typeof notify === 'function') notify('// selecione ao menos 1 lead em fila', 'warn');
      return;
    }

    setQueueOperationBulkBusy(true);
    let moved = 0;

    try {
      for (const row of rows) {
        try {
          await rpcQueueAction(row.id, 'back_to_backlog');
          moved++;
        } catch (error) {
          console.warn('[rebuild648] falha ao voltar lead selecionado ao backlog:', row.id, error);
        }
      }
      if (typeof notify === 'function') {
        notify(`${moved} lead${moved !== 1 ? 's' : ''} voltou${moved !== 1 ? 'aram' : ''} ao backlog.`);
      }
    } finally {
      state.operationSelected.clear();
      state.operationBusy = false;
      await renderQueueStageFromSupabase();
    }
  };

  window.queueLeadToChipRebuild646 = async function queueLeadToChipRebuild646(leadId, chipId) {
    setButtonsDisabled(leadId, true);
    try {
      if (!state.rows.length) await fetchQueueState();
      const row = state.rows.find((item) => String(item.id) === String(leadId));
      if (!row) throw new Error('Lead nao encontrado no backlog.');
      const chip = state.chips.find((item) => String(item.id) === String(chipId) || String(item.dbId || '') === String(chipId));
      if (!chip) throw new Error('Chip selecionado nao encontrado.');
      await rpcQueueAction(leadId, 'queue_today', queuePayloadFor(row, chip, 'operation_manual_chip'));
      if (typeof notify === 'function') notify(`Lead enviado para ${chip.name || chip.instance || 'chip'} na fila de disparos.`);
      await renderQueueStageFromSupabase();
    } catch (error) {
      console.error('[rebuild646] erro ao enviar lead ao chip:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao enviar lead para o chip.', 'err');
    } finally {
      setButtonsDisabled(leadId, false);
    }
  };

  window.clearChipQueueRebuild643 = async function clearChipQueueRebuild643(slotOrKey) {
    if (state.dispatchBusy) return;
    const dispatchDate = selectedQueueDateForDispatch();
    const { chip, slot, rows } = selectedDispatchRowsForChip(slotOrKey, dispatchDate);
    if (!chip || slot < 0) {
      if (typeof notify === 'function') notify('Chip nao encontrado.', 'err');
      return;
    }

    const movableRows = rows.filter((row) => {
      const raw = String(row.statusRaw || row.status || '').toLowerCase();
      return !['sent', 'completed', 'batch_completed', 'batch_sending'].includes(raw);
    });
    if (!movableRows.length) {
      if (typeof notify === 'function') notify('// nenhum lead limpavel neste chip', 'warn');
      return;
    }

    state.dispatchBusy = true;
    renderRightPanel();
    let moved = 0;
    try {
      for (const row of movableRows) {
        if (row.isTestLead) {
          moved++;
          continue;
        }
        try {
          await rpcQueueAction(row.id, 'back_to_backlog');
          moved++;
        } catch (error) {
          console.warn('[rebuild648] falha ao limpar lead do chip:', row.id, error);
        }
      }

      const chipId = chip.id || chip.dbId || chip.instance || '';
      const ids = new Set(movableRows.map((row) => String(row.id || row.leadId || row.lead_id || '')).filter(Boolean));
      const testRows = readTestDispatchRows().filter((row) => !(ids.has(String(row.id || row.leadId || '')) && testRowChipMatchesKey(row, chipId)));
      saveTestDispatchRows(testRows);
      try {
        if (filaDisparo?.[chipId]) {
          filaDisparo[chipId] = (filaDisparo[chipId] || []).filter((row) => !ids.has(String(row.id || row.leadId || '')));
          if (typeof saveFilaDisparo === 'function') saveFilaDisparo({ delay:0, reason:'dispatch-aside-chip-clear' });
        }
      } catch (_) {}
      if (typeof notify === 'function') notify(`${moved} lead${moved !== 1 ? 's' : ''} voltou${moved !== 1 ? 'aram' : ''} ao backlog.`);
    } finally {
      state.dispatchBusy = false;
      await renderQueueStageFromSupabase();
    }
  };

  window.dispatchChipQueueRebuild643 = async function dispatchChipQueueRebuild643(slotOrKey) {
    if (state.dispatchBusy) return;
    const slot = dispatchChipSlotFromKey(slotOrKey);
    if (slot < 0) {
      if (typeof notify === 'function') notify('Chip nao encontrado para disparo.', 'err');
      return;
    }
    const dispatchDate = selectedQueueDateForDispatch();
    const bridge = await bridgeDispatchRowsToLegacyQueue(slot, dispatchDate);
    if (!bridge.ok) {
      if (typeof notify === 'function') notify(`// ${bridge.error}`, 'err');
      return;
    }
    if (typeof iniciarDisparoChip !== 'function') {
      if (typeof notify === 'function') notify('Motor de disparo nao carregado.', 'err');
      return;
    }

    state.dispatchBusy = true;
    renderRightPanel();
    try {
      await iniciarDisparoChip(slot);
    } finally {
      state.dispatchBusy = false;
      await renderQueueStageFromSupabase();
    }
  };

  function renderQueueView() {
    renderQueueModeTabs();
    renderTabs();
    renderOperationView();
    renderRightPanel();
  }

  window.setQueueModeRebuild643 = function setQueueModeRebuild643(mode) {
    state.activeQueueMode = 'operation';
    if (mode === 'dispatch') state.dispatchAsideOpen = true;
    renderQueueView();
  };

  async function renderQueueStageFromSupabase() {
    const list = document.getElementById('disparoEmpresasList');
    if (list && !state.rows.length) {
      list.innerHTML = '<div class="fila-empty">// carregando backlog e fila...</div>';
    }

    try {
      await fetchQueueState();
      renderQueueView();
      return state.rows;
    } catch (error) {
      console.error('[rebuild621] erro ao carregar backlog/fila:', error);
      if (list) list.innerHTML = '<div class="fila-empty">// erro ao carregar backlog/fila. Verifique o SQL 6.27.</div>';
      return [];
    }
  }

  function setButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-queue621-lead]').forEach((button) => {
      if (button.getAttribute('data-queue621-lead') === String(leadId)) button.disabled = disabled;
    });
  }

  async function queueLeadToday(leadId) {
    setButtonsDisabled(leadId, true);
    try {
      if (!state.rows.length) await fetchQueueState();
      const row = state.rows.find((item) => String(item.id) === String(leadId));
      if (!row) throw new Error('Lead nao encontrado no backlog.');
      const activeChips = operationActiveChipsRebuild673();
      if (!activeChips.length) throw new Error('Configure pelo menos um chip ativo antes de preencher a fila.');
      const { chip } = chooseNextAvailableChip(activeChips);
      if (!chip) throw new Error('Todos os chips atingiram o limite diario de 120 leads.');
      await rpcQueueAction(leadId, 'queue_today', queuePayloadFor(row, chip, 'manual_single'));
      if (typeof notify === 'function') notify('Lead entrou na fila de hoje.');
      await renderQueueStageFromSupabase();
    } catch (error) {
      console.error('[rebuild621] erro ao colocar lead na fila:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao colocar lead na fila.', 'err');
    } finally {
      setButtonsDisabled(leadId, false);
    }
  }

  async function backToBacklog(leadId) {
    setButtonsDisabled(leadId, true);
    try {
      await rpcQueueAction(leadId, 'back_to_backlog');
      if (typeof notify === 'function') notify('Lead voltou para o backlog.');
      await renderQueueStageFromSupabase();
    } catch (error) {
      console.error('[rebuild621] erro ao voltar lead ao backlog:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao voltar lead ao backlog.', 'err');
    } finally {
      setButtonsDisabled(leadId, false);
    }
  }

  async function queueAllBacklog() {
    if (!state.rows.length) await fetchQueueState();
    const backlog = state.rows.filter((row) => !row.inTodayQueue);
    if (!backlog.length) {
      if (typeof notify === 'function') notify('// nenhum lead no backlog para colocar na fila', 'warn');
      return;
    }
    const activeChips = operationActiveChipsRebuild673();
    if (!activeChips.length) {
      if (typeof notify === 'function') notify('// configure pelo menos um chip ativo antes de preencher o dia', 'warn');
      return;
    }

    const usage = buildChipUsage(activeChips);
    let chipCursor = 0;

    let moved = 0;
    for (const row of backlog) {
      const result = chooseNextAvailableChip(activeChips, usage, chipCursor);
      const chip = result.chip;
      chipCursor = result.nextIndex;
      if (!chip) break;
      try {
        await rpcQueueAction(row.id, 'queue_today', queuePayloadFor(row, chip, 'manual_backlog_fill'));
        moved++;
      } catch (error) {
        console.warn('[rebuild621] falha ao colocar lead em lote:', row.id, error);
      }
    }

    if (typeof notify === 'function') notify(`${moved} lead${moved !== 1 ? 's' : ''} entrou${moved !== 1 ? 'aram' : ''} na fila de hoje.`);
    state.activeTab = 'today';
    await renderQueueStageFromSupabase();
  }

  function openQueueLeadDrawer(leadId) {
    if (typeof window.openLeadDrawer === 'function') {
      window.openLeadDrawer(leadId);
      return;
    }
    if (typeof notify === 'function') notify('Ficha do lead indisponivel.', 'warn');
  }

  function setQueueTab(tab) {
    state.activeTab = tab === 'today' ? 'today' : 'backlog';
    renderQueueView();
  }

  function toggleChipAccordion(key) {
    const normalized = String(key || '');
    if (!normalized) return;
    if (state.openChipKeys.has(normalized)) state.openChipKeys.delete(normalized);
    else state.openChipKeys.add(normalized);
    renderRightPanel();
  }

  function installHooks() {
    window.renderFilaZap = renderQueueStageFromSupabase;
    window.renderQueueStageFromSupabase621 = renderQueueStageFromSupabase;
    window.queueLeadTodayRebuild621 = queueLeadToday;
    window.backToBacklogRebuild621 = backToBacklog;
    window.queueAllBacklogRebuild621 = queueAllBacklog;
    window.openQueueLeadDrawerRebuild621 = openQueueLeadDrawer;
    window.setQueueTabRebuild621 = setQueueTab;
    window.toggleQueueChipAccordion621 = toggleChipAccordion;
    window.renderQueueDispatchAsideRebuild648 = renderRightPanel;
    window.setDisparoDay = function setDisparoDayRebuild621(day) {
      state.activeTab = day === 'today' || day !== 'backlog' ? 'today' : 'backlog';
      renderQueueView();
    };

    const oldSwitchPanel = window.switchPanel;
    if (typeof oldSwitchPanel === 'function' && !oldSwitchPanel.__queue621) {
      const patchedSwitchPanel = function switchPanelQueue621(panel) {
        const result = oldSwitchPanel.apply(this, arguments);
        if (panel === 'fila-zap' || panel === 'whatsapp' || panel === 'panel-fila-zap') {
          setTimeout(renderQueueStageFromSupabase, 100);
        }
        return result;
      };
      patchedSwitchPanel.__queue621 = true;
      patchedSwitchPanel.__previous = oldSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  function boot() {
    installHooks();
    if (document.getElementById('panel-fila-zap')?.classList.contains('active')) {
      renderQueueStageFromSupabase();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.20 - Chips e interface estavel */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  const state = {
    chips: [],
    assignments: new Map(),
    loading: false
  };

  const CP1252_REVERSE = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
  };

  const MOJIBAKE_RE = /(\u00c3[\u00a0-\u00bf]|\u00c2[\u00a0-\u00bf]|\u00e2[\u0080-\u00bf]|\u00f0\u0178|\ufffd)/g;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function badScore(value) {
    return (String(value ?? '').match(MOJIBAKE_RE) || []).length;
  }

  function encodeAsCp1252Bytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code <= 0xff) {
        bytes.push(code);
      } else if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE, code)) {
        bytes.push(CP1252_REVERSE[code]);
      } else {
        return null;
      }
    }
    return new Uint8Array(bytes);
  }

  function fixMojibakeText(value) {
    const text = String(value ?? '');
    if (!badScore(text) || typeof TextDecoder === 'undefined') return text;
    const bytes = encodeAsCp1252Bytes(text);
    if (!bytes) return text;
    try {
      const decoded = new TextDecoder('utf-8').decode(bytes);
      return badScore(decoded) < badScore(text) ? decoded : text;
    } catch (_) {
      return text;
    }
  }

  function repairDomText() {
    if (!document.body) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!badScore(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement?.tagName;
        if (tag && ['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'].includes(tag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const fixed = fixMojibakeText(node.nodeValue);
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
    });

    const attrs = ['title', 'aria-label', 'placeholder', 'data-label', 'alt'];
    document.querySelectorAll(attrs.map((attr) => `[${attr}]`).join(',')).forEach((element) => {
      attrs.forEach((attr) => {
        const current = element.getAttribute(attr);
        if (!current || !badScore(current)) return;
        const fixed = fixMojibakeText(current);
        if (fixed !== current) element.setAttribute(attr, fixed);
      });
    });
  }

  function iconSvg(name) {
    const paths = {
      search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4.2-4.2"></path>',
      chart: '<path d="M4 19V5"></path><path d="M4 19h16"></path><path d="M8 16V9"></path><path d="M12 16V7"></path><path d="M16 16v-4"></path>',
      inbox: '<path d="M4 4h16l-2 10H6L4 4Z"></path><path d="M6 14l2 4h8l2-4"></path>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="9.5" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.8"></path><path d="M16 3.2a4 4 0 0 1 0 7.6"></path>',
      check: '<path d="M20 6 9 17l-5-5"></path>',
      folder: '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path>',
      send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"></path><path d="M22 2 11 13"></path>',
      message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"></path>',
      camera: '<path d="M5 7h3l2-2h4l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"></path><circle cx="12" cy="13" r="4"></circle>',
      clipboard: '<path d="M9 4h6l1 2h3v15H5V6h3l1-2Z"></path><path d="M9 10h6"></path><path d="M9 14h6"></path>',
      clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
      columns: '<path d="M4 5h16v14H4z"></path><path d="M9 5v14"></path><path d="M15 5v14"></path>',
      trend: '<path d="M3 17 9 11l4 4 8-8"></path><path d="M14 7h7v7"></path>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path><path d="m9 12 2 2 4-5"></path>',
      wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-3 3-3-3 3-3Z"></path>',
      link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1.2-1.2"></path>',
      user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
      settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a8 8 0 0 0 .1-6l2-1.5-2-3.4-2.4 1a8 8 0 0 0-5.2-3l-.4-2.6h-4l-.4 2.6a8 8 0 0 0-5.2 3l-2.4-1-2 3.4 2 1.5a8 8 0 0 0 .1 6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 5.2 3l.4 2.6h4l.4-2.6a8 8 0 0 0 5.2-3l2.4 1 2-3.4-2-1.5Z"></path>',
      logout: '<path d="M10 17 15 12l-5-5"></path><path d="M15 12H3"></path><path d="M21 3v18h-8"></path>',
      menu: '<path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.folder}</svg>`;
  }

  function iconKey(value) {
    return fixMojibakeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function installIconStyles() {
    if (document.getElementById('crm620-icon-style')) return;
    const style = document.createElement('style');
    style.id = 'crm620-icon-style';
    style.textContent = [
      '.nav-icon svg,.sidebar-hamburger svg{width:16px;height:16px;display:block;stroke:currentColor}',
      '.nav-icon{display:inline-flex;align-items:center;justify-content:center;min-width:18px}',
      '.sidebar-hamburger{display:inline-flex;align-items:center;justify-content:center}',
      '.crm620-chip-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}',
      '.crm620-chip-actions .add-btn{font-size:9px;padding:5px 9px;white-space:nowrap}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function installSvgIcons() {
    installIconStyles();
    const map = {
      busca: 'search',
      inicio: 'chart',
      'caixa de entrada': 'inbox',
      leads: 'users',
      importar: 'inbox',
      validacao: 'check',
      envios: 'send',
      whatsapp: 'message',
      instagram: 'camera',
      conversas: 'message',
      gerenciamento: 'clipboard',
      'follow-ups': 'clock',
      kanban: 'columns',
      acompanhamentos: 'trend',
      ferramentas: 'wrench',
      redirecionamentos: 'link',
      protecao: 'shield',
      auditoria: 'chart',
      'minha conta': 'user',
      configuracoes: 'settings',
      sair: 'logout'
    };

    document.querySelectorAll('.nav-item').forEach((item) => {
      const label = item.getAttribute('data-label') || item.querySelector('.nav-label')?.textContent || item.textContent || '';
      const name = map[iconKey(label)];
      const icon = item.querySelector('.nav-icon');
      if (!name || !icon || icon.getAttribute('data-crm620-icon') === name) return;
      icon.innerHTML = iconSvg(name);
      icon.setAttribute('data-crm620-icon', name);
    });

    document.querySelectorAll('.menu-arrow-final').forEach((arrow) => {
      if (arrow.getAttribute('data-crm620-arrow')) return;
      arrow.innerHTML = '&rsaquo;';
      arrow.setAttribute('data-crm620-arrow', '1');
    });

    document.querySelectorAll('.sidebar-hamburger').forEach((button) => {
      if (button.getAttribute('data-crm620-icon') === 'menu') return;
      button.innerHTML = iconSvg('menu');
      button.setAttribute('data-crm620-icon', 'menu');
    });
  }

  function localChipsFallback() {
    try {
      return (typeof getChips === 'function' ? getChips() : [])
        .filter((chip) => chip && chip.id && chip.instance && chip.status !== 'disabled' && chip.active !== false)
        .map((chip, index) => ({
          id: String(chip.id || chip.instance || `chip_${index + 1}`),
          dbId: chip.dbId || null,
          name: chip.nome || chip.name || chip.label || chip.instance || `Chip ${index + 1}`,
          instance: chip.instance || '',
          status: chip.status || 'active',
          source: 'runtime'
        }));
    } catch (_) {
      return [];
    }
  }

  async function getCurrentUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}
    if (window.currentUser?.id) return window.currentUser.id;
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}
    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;
    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') headers = await getSupabaseAuthHeadersV423();
    } catch (_) {}
    if (!headers?.apikey) {
      headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    }
    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  function normalizeChip(row = {}, index = 0) {
    const id = String(row.chip_id || row.id || row.instance || `chip_${index + 1}`);
    return {
      id,
      dbId: row.id || null,
      name: row.name || row.nome || row.label || row.instance || `Chip ${index + 1}`,
      instance: row.instance || row.name || '',
      status: row.status || row.connection_state || 'active',
      phone: row.phone || row.number || '',
      source: 'supabase'
    };
  }

  async function fetchWhatsappChips() {
    const fallback = localChipsFallback();
    const userId = await getCurrentUserId();
    if (!userId) return fallback;

    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
      order: 'created_at.asc'
    });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
        headers: await getHeaders()
      });
      const data = await readJson(response);
      if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);
      const rows = Array.isArray(data) ? data : [];
      const chips = rows
        .filter((row) => row.active !== false)
        .map(normalizeChip)
        .filter((chip) => chip.id && chip.instance);
      return chips.length ? chips : fallback;
    } catch (error) {
      console.warn('[rebuild620] falha ao carregar chips:', error);
      return fallback;
    }
  }

  async function fetchChipAssignments() {
    return new Map();
  }

  async function refreshChipState() {
    state.loading = true;
    try {
      const [chips, assignments] = await Promise.all([
        fetchWhatsappChips(),
        fetchChipAssignments()
      ]);
      state.chips = chips;
      state.assignments = assignments;
      return state;
    } finally {
      state.loading = false;
    }
  }

  function findAssignmentLead(leadId) {
    const id = String(leadId || '');
    return (window.rebuildAssignmentLeads || []).find((lead) => String(lead.id) === id) || null;
  }

  function bucketForLead(lead = {}) {
    const bucket = lead.assignmentBucket || lead.bucket || lead.siteSegment || lead.templateType || '';
    if (bucket) return bucket;
    if (!clean(lead.whatsapp || lead.phone || lead.telefone) && clean(lead.instagram || lead.instagram_url)) return 'insta';
    if (lead.hasOwnSite || lead.has_own_site) return 'com-site';
    return 'zap';
  }

  function assignmentPayload(lead, chip, bucket) {
    return {
      source: 'fase-6.20',
      bucket,
      channel: 'whatsapp',
      assigned_at: new Date().toISOString(),
      lead: {
        id: lead.id,
        nome: lead.nome || lead.empresa || lead.company_name || '',
        whatsapp: lead.whatsapp || lead.phone || lead.telefone || '',
        site: lead.site || lead.website || '',
        instagram: lead.instagram || lead.instagram_url || ''
      },
      chip: {
        id: chip.id,
        db_id: chip.dbId || null,
        name: chip.name,
        instance: chip.instance
      }
    };
  }

  async function rpcChipAction(leadId, chipId) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const lead = findAssignmentLead(leadId);
    if (!lead) throw new Error('Lead nao encontrado na Atribuicao.');
    const chip = state.chips.find((item) => String(item.id) === String(chipId) || String(item.dbId) === String(chipId));
    if (!chip) throw new Error('Chip nao encontrado.');

    const bucket = bucketForLead(lead);
    const payload = assignmentPayload(lead, chip, bucket);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_chip_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: lead.id,
        p_chip_id: chip.id,
        p_action: 'assign_chip',
        p_bucket: bucket,
        p_payload: payload
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao vincular chip (${response.status}).`);
    return { data, payload, chip, lead };
  }

  function isWhatsappLead(lead = {}) {
    return clean(lead.whatsapp || lead.phone || lead.telefone).replace(/\D+/g, '').length >= 10;
  }

  function isLeadInAssignmentStage(lead = {}) {
    return lead.current_stage === 'assignment' || lead.stage === 'assignment';
  }

  function chipControlsHtml(lead) {
    return '';
  }

  function enhanceAssignmentCards() {
    const cards = document.querySelectorAll('#atribList .empresa-card[data-lead-id],#atribInstaList .empresa-card[data-lead-id]');
    cards.forEach((card) => {
      const leadId = card.getAttribute('data-lead-id');
      const lead = findAssignmentLead(leadId);
      const actions = card.querySelector('.empresa-actions');
      if (!lead || !actions) return;

      actions.querySelectorAll('.q-badge.warn').forEach((badge) => {
        if (clean(badge.textContent).toLowerCase().includes('chip na 6.20')) badge.remove();
      });

      let host = actions.querySelector('[data-crm620-chip-host]');
      if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-crm620-chip-host', '1');
        actions.appendChild(host);
      }
      host.innerHTML = chipControlsHtml(lead);
    });
  }

  function setChipButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-chip620-lead]').forEach((button) => {
      if (button.getAttribute('data-chip620-lead') === String(leadId)) button.disabled = disabled;
    });
  }

  async function assignLeadToChip(leadId, chipId) {
    setChipButtonsDisabled(leadId, true);
    try {
      if (!state.chips.length) await refreshChipState();
      const result = await rpcChipAction(leadId, chipId);
      const lead = result.lead;
      const payload = result.payload;
      state.assignments.set(String(leadId), payload);
      lead.current_status = 'chip_assigned';
      lead.status = 'chip_assigned';
      lead.assignedChipId = result.chip.id;
      lead.chipName = result.chip.name;
      enhanceAssignmentCards();
      if (typeof notify === 'function') notify(`Lead vinculado ao ${result.chip.name}.`);
    } catch (error) {
      console.error('[rebuild620] erro ao vincular chip:', error);
      const message = error?.message || error?.details || 'Falha ao vincular chip. Verifique o SQL 6.20.';
      if (typeof notify === 'function') notify(message, 'err');
    } finally {
      setChipButtonsDisabled(leadId, false);
    }
  }

  function scheduleVisualRepair() {
    clearTimeout(window.__crm620VisualTimer);
    window.__crm620VisualTimer = setTimeout(() => {
      repairDomText();
      installSvgIcons();
      enhanceAssignmentCards();
    }, 80);
  }

  function installHooks() {
    const previousRenderAssignment = window.renderAssignmentStageFromSupabase;
    if (typeof previousRenderAssignment === 'function' && !previousRenderAssignment.__chips620) {
      const patched = async function renderAssignmentStageChips620() {
        const result = await previousRenderAssignment.apply(this, arguments);
        await refreshChipState();
        enhanceAssignmentCards();
        return result;
      };
      patched.__chips620 = true;
      patched.__previous = previousRenderAssignment;
      window.renderAssignmentStageFromSupabase = patched;
      window.renderAtribuicao = patched;
    }

    const previousSetTab = window.setAtribTab;
    if (typeof previousSetTab === 'function' && !previousSetTab.__chips620) {
      const patchedSetTab = function setAtribTabChips620() {
        const result = previousSetTab.apply(this, arguments);
        setTimeout(enhanceAssignmentCards, 120);
        return result;
      };
      patchedSetTab.__chips620 = true;
      patchedSetTab.__previous = previousSetTab;
      window.setAtribTab = patchedSetTab;
    }

    const previousSwitchPanel = window.switchPanel;
    if (typeof previousSwitchPanel === 'function' && !previousSwitchPanel.__chips620) {
      const patchedSwitchPanel = function switchPanelChips620(panel) {
        const result = previousSwitchPanel.apply(this, arguments);
        if (['atribuicao', 'assignment', 'panel-atribuicao'].includes(panel)) {
          setTimeout(async () => {
            await refreshChipState();
            enhanceAssignmentCards();
          }, 160);
        }
        scheduleVisualRepair();
        return result;
      };
      patchedSwitchPanel.__chips620 = true;
      patchedSwitchPanel.__previous = previousSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  function boot() {
    repairDomText();
    installSvgIcons();
    installHooks();
    let hookAttempts = 0;
    const retryHooks = () => {
      hookAttempts++;
      installHooks();
      if (!window.renderAssignmentStageFromSupabase?.__chips620 && hookAttempts < 12) {
        setTimeout(retryHooks, 120);
      }
    };
    if (!window.renderAssignmentStageFromSupabase?.__chips620) setTimeout(retryHooks, 120);

    window.assignLeadToChipRebuild620 = assignLeadToChip;
    window.refreshChipsRebuild620 = refreshChipState;
    window.repairInterfaceEncodingRebuild620 = function repairInterfaceEncodingRebuild620() {
      repairDomText();
      installSvgIcons();
      enhanceAssignmentCards();
    };

    if (!window.__crm620Observer && document.body) {
      window.__crm620Observer = new MutationObserver(scheduleVisualRepair);
      window.__crm620Observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.getElementById('panel-atribuicao')?.classList.contains('active')) {
      refreshChipState().then(enhanceAssignmentCards);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.19 - Atribuicao lendo Supabase */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const PAGE_SIZE = 30;

  const state = {
    rows: [],
    activeTab: 'zap',
    page: 1,
    loading: false,
    selected: new Set()
  };

  const assignmentLeadCache = new Map();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function digits(value) {
    return clean(value).replace(/\D+/g, '');
  }

  function hasUsefulPhone(row) {
    return digits(row.phone || row.normalized_phone).length >= 10;
  }

  function hasOwnSite(row) {
    return !!row.has_own_site && !!clean(row.website);
  }

  function hasValidatedWhatsapp(row = {}) {
    return row.current_status === 'whatsapp_validated'
      || row.whatsapp_status === 'valid'
      || row.whatsappValidationStatus === 'valid'
      || row.numStatus === 'valido';
  }

  function isReadyForAssignment(row) {
    return row.current_stage === 'validation';
  }

  function isInAssignment(row) {
    return row.current_stage === 'assignment';
  }

  function isBacklogStatus(row = {}) {
    return ['backlog_whatsapp', 'backlog_instagram', 'chip_assigned', 'queued_dispatch'].includes(clean(row.current_status || row.status));
  }

  function bucketFor(row) {
    if (!hasValidatedWhatsapp(row)) return 'insta';
    if (hasOwnSite(row)) return 'com-site';
    return 'zap';
  }

  async function getCurrentUserId() {
    try {
      if (typeof getCurrentSupabaseUserIdV412 === 'function') {
        const maybe = await getCurrentSupabaseUserIdV412();
        if (maybe) return maybe;
      }
    } catch (_) {}

    if (window.currentUser?.id) return window.currentUser.id;

    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
    } catch (_) {}

    return null;
  }

  async function getHeaders(content = false) {
    let headers = null;

    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423();
      }
    } catch (_) {}

    if (!headers?.apikey) {
      headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      };
    }

    return content ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async function readJson(response) {
    const textBody = await response.text();
    return textBody ? JSON.parse(textBody) : null;
  }

  async function fetchLeadCardsBy(paramsObject) {
    const userId = await getCurrentUserId();
    const params = new URLSearchParams({
      select: '*',
      order: 'created_at.desc',
      ...paramsObject
    });

    if (userId) params.set('user_id', `eq.${userId}`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/v_lead_cards_persistent?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);

    if (!response.ok) throw data || new Error(`Falha ao carregar Atribuicao (${response.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function fetchAssignmentRows() {
    const [validation, assigned] = await Promise.all([
      fetchLeadCardsBy({
        current_stage: 'eq.validation'
      }),
      fetchLeadCardsBy({
        current_stage: 'eq.assignment'
      })
    ]);

    const byId = new Map();
    [...validation, ...assigned].forEach((row) => {
      if (row?.id && !byId.has(String(row.id))) byId.set(String(row.id), row);
    });

    return [...byId.values()].filter((row) => !isBacklogStatus(row));
  }

  async function rpcAssignmentAction(leadId, action = 'send_to_assignment', bucket = null) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_assignment_lead_action`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: userId,
        p_lead_id: leadId,
        p_action: action,
        p_bucket: bucket
      })
    });
    const data = await readJson(response);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('RPC rpc_assignment_lead_action nao encontrado. Execute o SQL 6.27 no Supabase e recarregue a pagina.');
      }
      throw new Error(data?.message || data?.details || `Falha na acao de atribuicao (${response.status}).`);
    }
    return data;
  }

  function normalizeLeadForDrawer(row = {}) {
    const companyName = row.company_name || 'Empresa sem nome';
    const location = [row.city, row.state_code || row.state].filter(Boolean).join(' - ');

    return {
      ...row,
      id: row.id,
      lead_id: row.id,
      nome: companyName,
      empresa: companyName,
      name: companyName,
      company_name: companyName,
      categoria: row.category || '',
      category: row.category || '',
      descricao: row.description || '',
      description: row.description || '',
      rating: row.rating,
      reviews_count: row.reviews_count,
      whatsapp: row.phone || '',
      telefone: row.phone || '',
      phone: row.phone || '',
      normalized_phone: row.normalized_phone || '',
      whatsapp_status: row.whatsapp_status || '',
      whatsappValidationStatus: hasValidatedWhatsapp(row) ? 'valid' : '',
      numStatus: hasValidatedWhatsapp(row) ? 'valido' : '',
      site: row.website || '',
      website: row.website || '',
      hasOwnSite: !!row.has_own_site,
      has_own_site: !!row.has_own_site,
      instagram: row.instagram_url || '',
      instagram_url: row.instagram_url || '',
      googleUrl: row.google_maps_url || '',
      google_maps_url: row.google_maps_url || '',
      maps: row.google_maps_url || '',
      local: location,
      cidade: row.city || '',
      city: row.city || '',
      estado: row.state || '',
      state: row.state || '',
      uf: row.state_code || '',
      state_code: row.state_code || '',
      current_stage: row.current_stage || '',
      current_status: row.current_status || '',
      stage: row.current_stage || '',
      status: row.current_status || '',
      assignmentBucket: bucketFor(row),
      baseSource: 'Supabase assignment'
    };
  }

  function patchFindLeadEverywhere() {
    if (window.findLeadEverywhere?.__assignment619) return;

    const previous = window.findLeadEverywhere;
    const patched = function findLeadEverywhereAssignment619(id) {
      const key = String(id || '');
      if (assignmentLeadCache.has(key)) return assignmentLeadCache.get(key);
      return typeof previous === 'function' ? previous.apply(this, arguments) : null;
    };

    patched.__assignment619 = true;
    patched.__previous = previous;
    window.findLeadEverywhere = patched;
  }

  function publishRows(rows) {
    assignmentLeadCache.clear();
    rows.map(normalizeLeadForDrawer).forEach((lead) => assignmentLeadCache.set(String(lead.id), lead));
    window.rebuildAssignmentLeads = [...assignmentLeadCache.values()];
    patchFindLeadEverywhere();
  }

  function getActiveTab() {
    try {
      if (typeof atribActiveTab !== 'undefined') return atribActiveTab || state.activeTab;
    } catch (_) {}
    return state.activeTab;
  }

  function setActiveTab(tab) {
    state.activeTab = ['zap', 'insta', 'com-site'].includes(tab) ? tab : 'zap';
    try {
      if (typeof atribActiveTab !== 'undefined') atribActiveTab = state.activeTab;
    } catch (_) {}
  }

  function rowsForBucket(bucket) {
    return state.rows.filter((row) => bucketFor(row) === bucket);
  }

  function visibleRowsForActiveTab() {
    let rows = rowsForBucket(getActiveTab());
    const searchId = getActiveTab() === 'insta' ? 'atribInstaBusca' : 'atribBusca';
    const query = clean(document.getElementById(searchId)?.value).toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [
      row.company_name,
      row.phone,
      row.website,
      row.instagram_url,
      row.city,
      row.category
    ].some((value) => clean(value).toLowerCase().includes(query)));
  }

  function updateBulkActions() {
    const selectedCount = state.selected.size;
    const actions = document.getElementById('atribAcoesLote');
    const label = document.getElementById('atribLoteLabel');
    if (actions) actions.style.display = selectedCount ? 'flex' : 'none';
    if (label) label.textContent = `${selectedCount} selecionado${selectedCount !== 1 ? 's' : ''}`;
  }

  function renderCounts() {
    const zap = rowsForBucket('zap').length;
    const site = rowsForBucket('com-site').length;
    const insta = rowsForBucket('insta').length;
    const total = state.rows.length;

    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value ? `(${value})` : '';
    };

    set('atribTabZapCount', zap);
    set('atribTabComSiteCount', site);
    set('atribTabInstaCount', insta);

    const totalBadge = document.getElementById('atribTotalBadge');
    if (totalBadge) totalBadge.textContent = total ? `(${total} lead${total !== 1 ? 's' : ''})` : '';

    const sidebarBadge = document.getElementById('badge-atribuicao');
    if (sidebarBadge) sidebarBadge.textContent = String(total);
    updateBulkActions();
  }

  function paintAssignmentTabs() {
    const active = getActiveTab();
    const tabZap = document.getElementById('atribTabZap');
    const tabInsta = document.getElementById('atribTabInsta');
    const tabSite = document.getElementById('atribTabComSite');
    const panelZap = document.getElementById('atribPanelZap');
    const panelInsta = document.getElementById('atribPanelInsta');

    [tabZap, tabInsta, tabSite].forEach((button) => {
      if (!button) return;
      button.style.borderBottomColor = 'transparent';
      button.style.color = 'var(--muted)';
    });

    if (active === 'insta') {
      if (tabInsta) {
        tabInsta.style.borderBottomColor = 'var(--insta)';
        tabInsta.style.color = 'var(--insta)';
      }
      if (panelInsta) panelInsta.style.display = 'flex';
      if (panelZap) panelZap.style.display = 'none';
    } else {
      const button = active === 'com-site' ? tabSite : tabZap;
      if (button) {
        button.style.borderBottomColor = 'var(--accent)';
        button.style.color = 'var(--accent)';
      }
      if (panelZap) panelZap.style.display = 'flex';
      if (panelInsta) panelInsta.style.display = 'none';
    }
  }

  function link(url, label) {
    if (!url) return '';
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="add-btn">${esc(label)}</a>`;
  }

  function rowStatusBadge(row) {
    if (isInAssignment(row)) return '<span class="q-badge ok">Na atribuicao</span>';
    if (hasValidatedWhatsapp(row)) return '<span class="q-badge info">WhatsApp validado</span>';
    if (isReadyForAssignment(row)) return '<span class="q-badge insta">Sem WhatsApp validado</span>';
    return `<span class="q-badge warn">${esc(row.current_status || 'pendente')}</span>`;
  }

  function renderAssignmentCard(row) {
    const bucket = bucketFor(row);
    const title = row.company_name || 'Empresa sem nome';
    const location = [row.city, row.state_code || row.state].filter(Boolean).join(' - ') || 'Local nao informado';
    const phone = row.phone || row.normalized_phone || '';
    const selected = state.selected.has(String(row.id));
    const canBacklog = isReadyForAssignment(row) || isInAssignment(row);
    const actionLabel = bucket === 'insta' ? 'Enviar ao Backlog Instagram' : 'Enviar ao Backlog Zap';
    const moveButton = canBacklog
      ? `<button class="add-btn added" type="button" data-assignment-action-id="${esc(row.id)}" onclick="sendLeadToBacklogRebuild626('${esc(row.id)}')">${esc(actionLabel)}</button>`
      : `<span class="q-badge warn">${esc(row.current_status || 'pendente')}</span>`;
    const bucketLabel = bucket === 'com-site' ? 'Com site' : bucket === 'insta' ? 'Instagram' : 'WhatsApp sem site';

    return `
      <div class="empresa-card" data-lead-id="${esc(row.id)}" style="align-items:flex-start">
        <div style="flex-shrink:0;margin-right:4px">
          <button type="button" aria-label="Selecionar lead" onclick="toggleAtribSel('${esc(row.id)}')"
            style="width:18px;height:18px;border-radius:4px;border:2px solid ${selected ? 'var(--accent)' : 'var(--border2)'};
            background:${selected ? 'var(--accent)' : 'transparent'};cursor:pointer;display:flex;align-items:center;justify-content:center;
            transition:all 0.15s;flex-shrink:0;padding:0">
            ${selected ? `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="#0a0a0d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
          </button>
        </div>
        <div class="empresa-info">
          <div class="empresa-nome">${esc(title)}</div>
          <div class="empresa-meta">
            ${rowStatusBadge(row)}
            <span class="q-badge ${bucket === 'insta' ? 'insta' : bucket === 'com-site' ? 'info' : 'ok'}">${esc(bucketLabel)}</span>
            <span class="q-badge info">Nota ${esc(row.rating ?? '-')}</span>
            <span class="q-badge info">${esc(row.reviews_count ?? 0)} avaliacoes</span>
            <span class="empresa-phone">${esc(phone || 'Sem telefone')}</span>
            <span class="empresa-site">${esc(location)}</span>
          </div>
          <div class="empresa-meta" style="margin-top:7px">
            ${link(row.website, 'Site')}
            ${link(row.instagram_url, 'Instagram')}
            ${link(row.google_maps_url, 'Maps')}
          </div>
        </div>
        <div class="empresa-actions">
          <button class="add-btn" type="button" onclick="openAssignmentLeadDrawerRebuild619('${esc(row.id)}')">Ficha</button>
          ${moveButton}
        </div>
      </div>
    `;
  }

  function renderPagination(total, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));

    if (pages <= 1) {
      target.innerHTML = '';
      return;
    }

    target.innerHTML = `
      <div class="btn-row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page <= 1 ? 'disabled' : ''} onclick="goAssignmentPageRebuild619(${state.page - 1})">Anterior</button>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);padding:7px 4px">Pagina ${state.page} de ${pages}</span>
        <button class="btn btn-ghost" type="button" style="font-size:10px;padding:6px 10px" ${state.page >= pages ? 'disabled' : ''} onclick="goAssignmentPageRebuild619(${state.page + 1})">Proxima</button>
      </div>
    `;
  }

  function renderAssignmentList() {
    paintAssignmentTabs();
    renderCounts();

    const active = getActiveTab();
    const targetId = active === 'insta' ? 'atribInstaList' : 'atribList';
    const paginationId = active === 'insta' ? 'atribInstaPagination' : 'atribPagination';
    const target = document.getElementById(targetId);
    if (!target) return;

    const rows = visibleRowsForActiveTab();

    if (!rows.length) {
      target.innerHTML = '<div class="table-empty">// nenhum lead aguardando atribuicao nesta aba</div>';
      renderPagination(0, paginationId);
      return;
    }

    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    target.innerHTML = '<div class="ext-list">' + pageRows.map(renderAssignmentCard).join('') + '</div>';
    renderPagination(total, paginationId);
  }

  async function renderAssignmentStageFromSupabase() {
    const active = getActiveTab();
    const target = document.getElementById(active === 'insta' ? 'atribInstaList' : 'atribList');
    if (target && !state.rows.length) {
      target.innerHTML = '<div class="table-empty">Carregando leads da Atribuicao...</div>';
    }

    state.loading = true;

    try {
      state.rows = await fetchAssignmentRows();
      publishRows(state.rows);
      renderAssignmentList();
      return state.rows;
    } catch (error) {
      console.error('[rebuild619] erro ao carregar Atribuicao:', error);
      if (target) target.innerHTML = '<div class="table-empty">Erro ao carregar Atribuicao. Verifique o SQL 6.27.</div>';
      return [];
    } finally {
      state.loading = false;
    }
  }

  function setAssignmentButtonsDisabled(leadId, disabled) {
    document.querySelectorAll('[data-assignment-action-id]').forEach((button) => {
      if (button.getAttribute('data-assignment-action-id') === String(leadId)) button.disabled = disabled;
    });
  }

  async function sendLeadToAssignment(leadId) {
    const row = state.rows.find((item) => String(item.id) === String(leadId));
    const bucket = row ? bucketFor(row) : null;
    setAssignmentButtonsDisabled(leadId, true);

    try {
      await rpcAssignmentAction(leadId, 'send_to_assignment', bucket);
      if (row) {
        row.current_stage = 'assignment';
        row.current_status = bucket === 'insta' ? 'pending_assignment_instagram' : 'pending_assignment';
      }
      if (typeof notify === 'function') notify('Lead movido para Atribuicao.');
      renderAssignmentList();
      await renderAssignmentStageFromSupabase();
      if (typeof renderValidationStageFromSupabase === 'function') renderValidationStageFromSupabase();
    } catch (error) {
      console.error('[rebuild619] erro ao mover para atribuicao:', error);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao mover lead para Atribuicao.', 'err');
    } finally {
      setAssignmentButtonsDisabled(leadId, false);
    }
  }

  function mirrorInstagramBacklog(row = {}) {
    if (typeof getInstaFila !== 'function' || typeof saveInstaFila !== 'function') return;
    const lead = normalizeLeadForDrawer(row);
    const existing = getInstaFila();
    const nextLead = {
      ...lead,
      nome: lead.nome || lead.company_name || '',
      instagram: lead.instagram || lead.instagram_url || '',
      instagramUrl: lead.instagram || lead.instagram_url || '',
      canal: 'insta',
      status: 'backlog_instagram',
      entradaBacklogEm: typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10)
    };
    saveInstaFila([...existing.filter((item) => String(item.id) !== String(row.id)), nextLead]);
  }

  async function sendLeadToBacklog(leadId, options = {}) {
    const row = state.rows.find((item) => String(item.id) === String(leadId));
    if (!row) {
      if (!options.silent && typeof notify === 'function') notify('// lead nao encontrado na Atribuicao', 'warn');
      return false;
    }

    const bucket = bucketFor(row);
    setAssignmentButtonsDisabled(leadId, true);

    try {
      await rpcAssignmentAction(leadId, 'send_to_backlog', bucket);
      if (bucket === 'insta') mirrorInstagramBacklog(row);

      state.rows = state.rows.filter((item) => String(item.id) !== String(leadId));
      state.selected.delete(String(leadId));

      if (!options.silent && typeof notify === 'function') {
        notify(bucket === 'insta' ? 'Lead enviado ao Backlog Instagram.' : 'Lead enviado ao Backlog Zap.');
      }

      renderAssignmentList();
      if (bucket === 'insta' && typeof renderInstagram === 'function') renderInstagram();
      if (bucket !== 'insta' && typeof renderQueueStageFromSupabase621 === 'function') renderQueueStageFromSupabase621();
      if (typeof updateBadges === 'function') updateBadges();
      return true;
    } catch (error) {
      console.error('[rebuild626] erro ao enviar lead ao backlog:', error);
      if (!options.silent && typeof notify === 'function') notify(error?.message || 'Falha ao enviar lead ao backlog. Reexecute o SQL 6.27.', 'err');
      return false;
    } finally {
      setAssignmentButtonsDisabled(leadId, false);
    }
  }

  async function sendSelectedToBacklog() {
    if (!state.selected.size) {
      if (typeof notify === 'function') notify('// selecione ao menos 1 lead', 'warn');
      return;
    }

    const ids = [...state.selected];
    let moved = 0;
    for (const id of ids) {
      if (await sendLeadToBacklog(id, { silent: true })) moved++;
    }

    state.selected.clear();
    renderAssignmentList();
    if (typeof notify === 'function') notify(`${moved} lead${moved !== 1 ? 's' : ''} enviado${moved !== 1 ? 's' : ''} ao backlog.`);
    if (typeof renderQueueStageFromSupabase621 === 'function') renderQueueStageFromSupabase621();
    if (typeof renderInstagram === 'function') renderInstagram();
  }

  function toggleAssignmentSelection(leadId) {
    const key = String(leadId || '');
    if (!key) return;
    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);
    renderAssignmentList();
  }

  function selectAllVisibleAssignmentRows() {
    visibleRowsForActiveTab().forEach((row) => state.selected.add(String(row.id)));
    renderAssignmentList();
  }

  function clearAssignmentSelection() {
    state.selected.clear();
    renderAssignmentList();
  }

  async function sendAllValidatedToAssignment() {
    if (!state.rows.length) await renderAssignmentStageFromSupabase();
    const ready = state.rows.filter(isReadyForAssignment);

    if (!ready.length) {
      if (typeof notify === 'function') notify('// nenhum lead validado pronto para atribuicao', 'warn');
      return;
    }

    let moved = 0;
    for (const row of ready) {
      try {
        await rpcAssignmentAction(row.id, 'send_to_assignment', bucketFor(row));
        row.current_stage = 'assignment';
        row.current_status = bucketFor(row) === 'insta' ? 'pending_assignment_instagram' : 'pending_assignment';
        moved++;
      } catch (error) {
        console.warn('[rebuild619] falha ao mover lead em lote:', row.id, error);
      }
    }

    if (typeof notify === 'function') notify(`${moved} lead${moved !== 1 ? 's' : ''} movido${moved !== 1 ? 's' : ''} para Atribuicao.`);
    await renderAssignmentStageFromSupabase();
    if (typeof renderValidationStageFromSupabase === 'function') renderValidationStageFromSupabase();
  }

  function openAssignmentLeadDrawer(leadId) {
    patchFindLeadEverywhere();

    if (typeof window.openLeadDrawer === 'function') {
      window.openLeadDrawer(leadId);
      return;
    }

    if (typeof notify === 'function') notify('Ficha do lead indisponivel.', 'warn');
  }

  function installHooks() {
    window.renderAtribuicao = function renderAtribuicaoRebuild619() {
      return renderAssignmentStageFromSupabase();
    };

    window.renderAtribInstaFila = function renderAtribInstaFilaRebuild619() {
      setActiveTab('insta');
      return renderAssignmentStageFromSupabase();
    };

    window.updateAtribTabCounts = renderCounts;

    window.setAtribTab = function setAtribTabRebuild619(tab) {
      setActiveTab(tab);
      state.page = 1;
      renderAssignmentList();
      if (!state.rows.length) renderAssignmentStageFromSupabase();
    };

    window.aprovarTodosParaAtribuicao = sendAllValidatedToAssignment;
    window.toggleAtribSel = toggleAssignmentSelection;
    window.selecionarTodos = selectAllVisibleAssignmentRows;
    window.deselecionarTodos = clearAssignmentSelection;
    window.atribuirLote = sendSelectedToBacklog;

    const oldSwitchPanel = window.switchPanel;
    if (typeof oldSwitchPanel === 'function' && !oldSwitchPanel.__assignment619) {
      const patchedSwitchPanel = function switchPanelAssignment619(panel) {
        const result = oldSwitchPanel.apply(this, arguments);
        if (panel === 'atribuicao' || panel === 'assignment' || panel === 'panel-atribuicao') {
          setTimeout(renderAssignmentStageFromSupabase, 80);
        }
        return result;
      };
      patchedSwitchPanel.__assignment619 = true;
      patchedSwitchPanel.__previous = oldSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }
  }

  window.renderAssignmentStageFromSupabase = renderAssignmentStageFromSupabase;
  window.sendLeadToAssignmentRebuild619 = sendLeadToAssignment;
  window.sendLeadToBacklogRebuild626 = sendLeadToBacklog;
  window.openAssignmentLeadDrawerRebuild619 = openAssignmentLeadDrawer;
  window.goAssignmentPageRebuild619 = (page) => {
    state.page = Number(page) || 1;
    renderAssignmentList();
  };

  function boot() {
    installHooks();
    patchFindLeadEverywhere();
    renderCounts();

    if (document.getElementById('panel-atribuicao')?.classList.contains('active')) {
      renderAssignmentStageFromSupabase();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.23 - Persistencia e conexao dos chips */
(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  const MAX_HYDRATE_ATTEMPTS = 18;

  const state = {
    chips: [],
    hydrating: false
  };

  function clean(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function normalizeEvolutionUrl(value = '') {
    let url = clean(value).replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url.replace(/\/+$/, '');
  }

  function stableChipId(instance = '', name = '') {
    const base = clean(instance) || clean(name) || String(Date.now());
    return 'chip_' + base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  function getClient() {
    try {
      if (typeof sbClient !== 'undefined' && sbClient?.from) return sbClient;
    } catch (_) {}
    return window.supabaseClient || window.crmSupabase || window.sb || null;
  }

  async function getCurrentUser() {
    try {
      const client = getClient();
      if (client?.auth?.getUser) {
        const { data } = await client.auth.getUser();
        if (data?.user?.id) return data.user;
      }
    } catch (_) {}
    try {
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser;
    } catch (_) {}
    return window.currentUser || null;
  }

  async function getHeaders(content = false) {
    let headers = {};
    try {
      if (typeof getSupabaseAuthHeadersV423 === 'function') {
        headers = await getSupabaseAuthHeadersV423(content ? { 'Content-Type': 'application/json' } : {});
      }
    } catch (_) {}

    try {
      const client = getClient();
      if (!headers.Authorization && client?.auth?.getSession) {
        const { data } = await client.auth.getSession();
        const token = data?.session?.access_token || '';
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch (_) {}

    headers = {
      ...headers,
      apikey: headers.apikey || SUPABASE_KEY
    };
    if (!headers.Authorization) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
    if (content && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function readJson(response) {
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  function normalizeChip(row = {}) {
    const instance = clean(row.instance || row.instance_name || row.instanceName || row.name);
    const name = clean(row.name || row.nome || row.label || row.phone || instance, 'Chip');
    const id = clean(row.chip_id || row.chipId || row.id || instance, stableChipId(instance, name));
    const url = normalizeEvolutionUrl(row.url || row.base_url || row.baseUrl || row.evolution_url || row.evolutionUrl);
    const key = clean(row.api_key || row.apiKey || row.key || row.apikey || row.token);
    const status = row.active === false ? 'disabled' : clean(row.status || row.connection_state || row.connectionState, 'saved');

    return {
      ...row,
      id: String(id),
      chip_id: String(id),
      dbId: row.dbId || row.id || null,
      name,
      nome: name,
      label: name,
      instance,
      instance_name: instance,
      url,
      baseUrl: url,
      base_url: url,
      evolutionUrl: url,
      evolution_url: url,
      key,
      apiKey: key,
      api_key: key,
      status,
      connectionState: clean(row.connectionState || row.connection_state || status, status),
      active: row.active !== false,
      dailyLimit: Number(row.dailyLimit || row.daily_limit || 120),
      blockSize: Number(row.blockSize || row.block_size || 30),
      intervalSeconds: Number(row.intervalSeconds || row.interval_seconds || 120),
      blocks: Array.isArray(row.blocks) ? row.blocks : ['08:00', '10:00', '12:00', '14:00']
    };
  }

  function dedupeChips(chips = []) {
    const byKey = new Map();
    chips.map(normalizeChip).forEach((chip) => {
      const key = clean(chip.id || chip.instance || chip.name);
      if (!key || !chip.instance) return;
      const existing = byKey.get(key) || {};
      byKey.set(key, { ...existing, ...chip });
    });
    return [...byKey.values()];
  }

  function localChips() {
    try {
      if (window.getChips?.__chips623) return window.getChips.__previous();
      if (typeof window.getChips === 'function') return window.getChips() || [];
    } catch (_) {}
    return [];
  }

  function publishChips(chips = []) {
    const normalized = dedupeChips(chips);
    state.chips = normalized;
    window.__crmChipsCache = normalized.map(normalizeChip);

    try {
      if (typeof storeWhatsappChipsCacheV426 === 'function') {
        storeWhatsappChipsCacheV426(normalized);
      }
    } catch (_) {}

    try {
      if (typeof saveOperationalKey === 'function' && typeof CHIPS_KEY !== 'undefined') {
        saveOperationalKey(CHIPS_KEY, normalized.map(normalizeChip), 'chips-623-hydrate');
      }
    } catch (_) {}

    try {
      if (typeof updateChipsBadge === 'function') updateChipsBadge();
      if (typeof renderConfiguracoes === 'function') renderConfiguracoes();
      if (typeof renderChipsPanel === 'function') renderChipsPanel();
      if (document.getElementById('panel-fila-zap')?.classList.contains('active') && typeof renderFilaZap === 'function') renderFilaZap();
    } catch (_) {}

    return normalized;
  }

  async function fetchPersistedChips() {
    const user = await getCurrentUser();
    if (!user?.id) return [];

    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${user.id}`,
      order: 'updated_at.desc'
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_instances?${params.toString()}`, {
      headers: await getHeaders()
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao carregar chips (${response.status}).`);

    const email = clean(user.email).toLowerCase();
    return (Array.isArray(data) ? data : [])
      .filter((row) => row.active !== false)
      .filter((row) => {
        const rowEmail = clean(row.user_email).toLowerCase();
        return !rowEmail || !email || rowEmail === email;
      })
      .map(normalizeChip);
  }

  async function hydrateChips() {
    if (state.hydrating) return state.chips;
    const user = await getCurrentUser();
    if (!user?.id) return state.chips;

    state.hydrating = true;
    try {
      const remote = await fetchPersistedChips();
      window.__crmChipsAuthoritativeV626 = true;
      const merged = publishChips(remote);
      return merged;
    } catch (error) {
      console.warn('[rebuild623] falha ao hidratar chips:', error);
      return publishChips(localChips());
    } finally {
      state.hydrating = false;
    }
  }

  async function rpcUpsertChip(chip) {
    const user = await getCurrentUser();
    if (!user?.id) throw new Error('Usuario autenticado nao encontrado.');

    const normalized = normalizeChip(chip);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_whatsapp_instance_upsert`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: user.id,
        p_user_email: clean(user.email).toLowerCase(),
        p_chip_id: normalized.id,
        p_name: normalized.name,
        p_instance: normalized.instance,
        p_url: normalized.url,
        p_api_key: normalized.key,
        p_payload: {
          dailyLimit: normalized.dailyLimit,
          blockSize: normalized.blockSize,
          intervalSeconds: normalized.intervalSeconds,
          blocks: normalized.blocks,
          status: normalized.status,
          source: 'fase-6.23'
        }
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao salvar chip (${response.status}).`);
    return normalizeChip(data?.chip || data || normalized);
  }

  async function rpcDeleteChip(chipId) {
    const user = await getCurrentUser();
    if (!user?.id) throw new Error('Usuario autenticado nao encontrado.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_whatsapp_instance_delete`, {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify({
        p_user_id: user.id,
        p_chip_id: chipId
      })
    });
    const data = await readJson(response);
    if (!response.ok) throw data || new Error(`Falha ao remover chip (${response.status}).`);
    return data;
  }

  function chipFromModal() {
    const name = clean(document.getElementById('chipNome')?.value);
    const url = normalizeEvolutionUrl(document.getElementById('chipUrl')?.value);
    const instance = clean(document.getElementById('chipInstance')?.value);
    const key = clean(document.getElementById('chipKey')?.value);
    const existing = [...localChips(), ...state.chips].find((chip) => chip.instance === instance || chip.name === name);

    return normalizeChip({
      ...(existing || {}),
      id: existing?.id || stableChipId(instance, name),
      chip_id: existing?.id || stableChipId(instance, name),
      name,
      nome: name,
      label: name,
      url,
      baseUrl: url,
      evolutionUrl: url,
      instance,
      instance_name: instance,
      key,
      apiKey: key,
      status: existing?.status || 'saved',
      connectionState: existing?.connectionState || 'saved',
      active: true,
      updatedAt: new Date().toISOString()
    });
  }

  async function testEvolutionConnection(chip) {
    const normalized = normalizeChip(chip);
    if (!normalized.url || !normalized.instance || !normalized.key) {
      return { ok: false, error: 'dados incompletos' };
    }

    try {
      const response = await fetch(`${normalized.url}/instance/connectionState/${encodeURIComponent(normalized.instance)}`, {
        method: 'GET',
        headers: { apikey: normalized.key }
      });
      const data = await response.json().catch(() => ({}));
      const connection = data?.instance?.state || data?.state || data?.connectionState || '';
      return { ok: response.ok, state: connection || (response.ok ? 'reachable' : ''), data, status: response.status };
    } catch (error) {
      return { ok: false, error: error?.message || 'falha ao testar conexao' };
    }
  }

  async function saveChipFromModal() {
    const chip = chipFromModal();
    if (!chip.name || !chip.url || !chip.instance || !chip.key) {
      if (typeof notify === 'function') notify('// preencha todos os campos do chip', 'err');
      return;
    }

    const optimistic = publishChips([...localChips().filter((item) => item.id !== chip.id && item.instance !== chip.instance), { ...chip, _syncStatus: 'saving' }]);
    try {
      if (typeof fecharChipModal === 'function') fecharChipModal();
      if (typeof notify === 'function') notify('Salvando chip no Supabase...');
      const saved = await rpcUpsertChip(chip);
      const test = await testEvolutionConnection(saved);
      const connectedStatus = test.ok ? (test.state || 'reachable') : 'saved';
      const finalChip = normalizeChip({ ...saved, status: connectedStatus, connectionState: connectedStatus });
      publishChips([...optimistic.filter((item) => item.id !== finalChip.id && item.instance !== finalChip.instance), finalChip]);
      await hydrateChips();
      if (typeof notify === 'function') {
        notify(test.ok ? `Chip salvo e acessivel: ${connectedStatus}` : 'Chip salvo. Abra o QR Code para conectar a instancia.', test.ok ? '' : 'warn');
      }
    } catch (error) {
      console.error('[rebuild623] erro ao salvar chip:', error);
      publishChips(optimistic.map((item) => item.id === chip.id ? { ...item, _syncStatus: 'pending', _syncError: error?.message || error } : item));
      if (typeof notify === 'function') notify(error?.message || 'Falha ao salvar chip. Rode o SQL 6.23.', 'err');
    }
  }

  async function loadWhatsappChipsCompat() {
    return hydrateChips();
  }

  async function persistWhatsappChipsCompat(list = []) {
    const chips = dedupeChips(list);
    const saved = [];
    for (const chip of chips) {
      saved.push(await rpcUpsertChip(chip));
    }
    publishChips(saved);
    return { ok: true, count: saved.length };
  }

  async function removeChip(chipId) {
    const current = dedupeChips([...localChips(), ...state.chips]);
    const chip = current.find((item) => item.id === chipId || item.instance === chipId);
    window.__crmChipsAuthoritativeV626 = true;
    publishChips(current.filter((item) => item.id !== chipId && item.instance !== chipId));

    try {
      await rpcDeleteChip(chip?.id || chipId);
      if (typeof notify === 'function') notify('Chip removido.');
    } catch (error) {
      console.error('[rebuild623] erro ao remover chip:', error);
      if (chip) publishChips([...state.chips, chip]);
      if (typeof notify === 'function') notify(error?.message || 'Falha ao remover chip.', 'err');
    }
  }

  async function renderQrForChip(chip) {
    const normalized = normalizeChip(chip);
    const qrWrap = document.getElementById('qrWrap');
    if (!qrWrap) return;
    qrWrap.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Verificando instancia...</div>';

    const stateCheck = await testEvolutionConnection(normalized);
    if (stateCheck.ok && ['open', 'connected'].includes(String(stateCheck.state || '').toLowerCase())) {
      qrWrap.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--ok)">Instancia ja conectada.</div>';
      await rpcUpsertChip({ ...normalized, status: stateCheck.state, connectionState: stateCheck.state }).catch(() => {});
      return;
    }

    try {
      const response = await fetch(`${normalized.url}/instance/connect/${encodeURIComponent(normalized.instance)}`, {
        headers: { apikey: normalized.key }
      });
      const data = await response.json().catch(() => ({}));
      const qr = data.qrcode?.base64 || data.base64 || data.qr || data.code || '';
      if (qr) {
        qrWrap.innerHTML = `<img src="${qr.startsWith('data:') ? qr : 'data:image/png;base64,' + qr}" alt="QR Code"/>`;
      } else {
        qrWrap.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--warning)">QR nao retornado. Confira a instancia na Evolution API.</div>';
      }
    } catch (error) {
      qrWrap.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error)">Erro ao gerar QR Code: ${esc(error?.message || error)}</div>`;
    }
  }

  async function verQrChipCompat(id) {
    const chip = dedupeChips([...localChips(), ...state.chips]).find((item) => item.id === id || item.instance === id);
    if (!chip) {
      if (typeof notify === 'function') notify('Chip nao encontrado. Atualize a lista.', 'warn');
      await hydrateChips();
      return;
    }
    window.qrChipIdAtivo = chip.id;
    const title = document.getElementById('qrChipNome');
    if (title) title.textContent = chip.name;
    const modal = document.getElementById('qrModal');
    if (modal) modal.classList.add('open');
    await renderQrForChip(chip);
  }

  function installGetChipsPatch() {
    if (window.getChips?.__chips623) return;
    const previous = window.getChips;
    const patched = function getChipsRebuild623() {
      let oldList = [];
      try {
        oldList = typeof previous === 'function' ? previous.apply(this, arguments) || [] : [];
      } catch (_) {}
      const authoritative = dedupeChips([...(window.__crmChipsCache || []), ...state.chips]);
      if (window.__crmChipsAuthoritativeV626) return authoritative;
      return dedupeChips([...oldList, ...(window.__crmChipsCache || []), ...state.chips]);
    };
    patched.__chips623 = true;
    patched.__previous = previous;
    window.getChips = patched;
  }

  function installSaveChipsPatch() {
    if (window.saveChips?.__chips623) return;
    const previous = window.saveChips;
    const patched = function saveChipsRebuild623(list) {
      const normalized = publishChips(list || []);
      try {
        if (typeof previous === 'function') previous.call(this, normalized);
      } catch (error) {
        console.warn('[rebuild623] saveChips legado falhou:', error);
      }
      persistWhatsappChipsCompat(normalized).catch((error) => {
        console.warn('[rebuild623] persistencia async falhou:', error);
      });
    };
    patched.__chips623 = true;
    patched.__previous = previous;
    window.saveChips = patched;
  }

  function installHooks() {
    installGetChipsPatch();
    installSaveChipsPatch();

    window.CRMListWhatsappInstances = fetchPersistedChips;
    window.CRMHydrateChipsCache = hydrateChips;
    window.loadWhatsappChipsFromSupabaseV22 = loadWhatsappChipsCompat;
    window.persistWhatsappChipsToSupabaseV22 = persistWhatsappChipsCompat;
    window.salvarChip = saveChipFromModal;
    window.verQRChip = verQrChipCompat;
    window.carregarQR = renderQrForChip;
    window.deletarChip = removeChip;
    window.persistWhatsappChipRebuild623 = rpcUpsertChip;
    window.hydrateWhatsappChipsRebuild623 = hydrateChips;

    const previousHydrate = window.hydrateAuthenticatedUserDataV436;
    if (typeof previousHydrate === 'function' && !previousHydrate.__chips623) {
      const patchedHydrate = async function hydrateAuthenticatedUserDataChips623() {
        const result = await previousHydrate.apply(this, arguments);
        await hydrateChips();
        return result;
      };
      patchedHydrate.__chips623 = true;
      patchedHydrate.__previous = previousHydrate;
      window.hydrateAuthenticatedUserDataV436 = patchedHydrate;
    }
  }

  function boot() {
    installHooks();
    let attempts = 0;
    const retry = async () => {
      attempts++;
      installHooks();
      const user = await getCurrentUser();
      if (user?.id) {
        await hydrateChips();
        return;
      }
      if (attempts < MAX_HYDRATE_ATTEMPTS) setTimeout(retry, 500);
    };
    retry();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.24 - Finalizador apos todos os blocos */
(function () {
  function reinstall624() {
    try {
      if (window.CRMRebuild624 && typeof window.CRMRebuild624.install === 'function') {
        window.CRMRebuild624.install();
      }
    } catch (error) {
      console.warn('[rebuild624] finalizador final falhou:', error);
    }
  }

  function boot() {
    reinstall624();
    setTimeout(reinstall624, 300);
    setTimeout(reinstall624, 900);
    setTimeout(reinstall624, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.25 - Finalizador apos chips persistidos */
(function () {
  function refresh625() {
    try {
      if (typeof window.refreshValidationChipsRebuild625 === 'function') {
        window.refreshValidationChipsRebuild625();
      }
    } catch (error) {
      console.warn('[rebuild625] finalizador final falhou:', error);
    }
  }

  function boot() {
    refresh625();
    setTimeout(refresh625, 500);
    setTimeout(refresh625, 1500);
    setTimeout(refresh625, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* CRM Rebuild Fase 6.29 - Atribuicao removida do fluxo operacional */
(function () {
  const REMOVED_PANELS = new Set(['atribuicao', 'assignment', 'panel-atribuicao']);

  function normalizeRemovedPanel(panel) {
    return REMOVED_PANELS.has(String(panel || '')) ? 'validacao' : panel;
  }

  function validationTabFromLegacy(tab) {
    if (tab === 'insta' || tab === 'instagram') return 'insta';
    if (tab === 'com-site' || tab === 'site' || tab === 'sites') return 'com-site';
    return 'validados';
  }

  function openValidation(tab) {
    try {
      if (tab && typeof window.setValResultTab === 'function') {
        window.setValResultTab(validationTabFromLegacy(tab));
      }
    } catch (_) {}

    try {
      if (typeof window.switchPanel === 'function') {
        return window.switchPanel('validacao');
      }
    } catch (_) {}

    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === 'panel-validacao');
    });
    if (typeof window.renderValidacao === 'function') return window.renderValidacao();
    return null;
  }

  function notifyRemovedFlow() {
    if (typeof notify === 'function') {
      notify('Atribuicao foi incorporada a Validacao. Envie ao Backlog pela propria Validacao.', 'warn');
    }
  }

  async function sendLegacyLeadToBacklog(leadId) {
    if (leadId && typeof window.sendValidationLeadToBacklogRebuild629 === 'function') {
      return window.sendValidationLeadToBacklogRebuild629(leadId);
    }
    notifyRemovedFlow();
    return openValidation();
  }

  async function sendSelectedFromValidation() {
    if (typeof window.enviarSelecionadosValidacaoAoBacklog === 'function') {
      return window.enviarSelecionadosValidacaoAoBacklog();
    }
    notifyRemovedFlow();
    return openValidation();
  }

  async function sendVisibleFromValidation() {
    if (typeof window.enviarTodosValidacaoAoBacklog === 'function') {
      return window.enviarTodosValidacaoAoBacklog();
    }
    notifyRemovedFlow();
    return openValidation();
  }

  function selectVisibleValidation() {
    if (typeof window.selecionarTodosValidacaoBacklog === 'function') {
      return window.selecionarTodosValidacaoBacklog();
    }
    return openValidation();
  }

  function clearValidationSelection() {
    if (typeof window.limparSelecaoValidacaoBacklog === 'function') {
      return window.limparSelecaoValidacaoBacklog();
    }
    return openValidation();
  }

  function installAssignmentRemoval() {
    const previousSwitchPanel = window.switchPanel;
    if (typeof previousSwitchPanel === 'function' && !previousSwitchPanel.__assignmentRemoved629) {
      const patchedSwitchPanel = function switchPanelWithoutAssignment(panel, options) {
        return previousSwitchPanel.call(this, normalizeRemovedPanel(panel), options);
      };
      patchedSwitchPanel.__assignmentRemoved629 = true;
      patchedSwitchPanel.__previous = previousSwitchPanel;
      window.switchPanel = patchedSwitchPanel;
    }

    window.renderAssignmentStageFromSupabase = function renderAssignmentRemoved629() {
      return openValidation();
    };
    window.renderAtribuicao = function renderAtribuicaoRemoved629() {
      return openValidation();
    };
    window.renderAtribInstaFila = function renderAtribInstaRemoved629() {
      return openValidation('insta');
    };
    window.updateAtribTabCounts = function updateAtribTabCountsRemoved629() {};
    window.setAtribTab = function setAtribTabRemoved629(tab) {
      return openValidation(validationTabFromLegacy(tab));
    };

    window.sendLeadToAssignmentRebuild619 = sendLegacyLeadToBacklog;
    window.aprovarTodosParaAtribuicao = sendVisibleFromValidation;
    window.atribuirLote = sendSelectedFromValidation;
    window.selecionarTodos = selectVisibleValidation;
    window.deselecionarTodos = clearValidationSelection;

    window.CRMRebuild629AssignmentRemoved = {
      active: true,
      panel: 'validacao',
      backlogEntryPoints: ['sendValidationLeadToBacklogRebuild629', 'enviarSelecionadosValidacaoAoBacklog', 'enviarTodosValidacaoAoBacklog']
    };
  }

  function boot() {
    installAssignmentRemoval();
    setTimeout(installAssignmentRemoval, 120);
    setTimeout(installAssignmentRemoval, 600);
    setTimeout(installAssignmentRemoval, 1600);
    setTimeout(installAssignmentRemoval, 3200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
