
/* V30 final operacional — fluxo sem validação legada intermediária */
(function(){
  const SENT_PAGE_SIZE = 80;
  let sentContactsCacheV30 = [];
  let sentContactsLoadedAtV30 = 0;

  function safeText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? 0);
  }
  function uniqueBy(arr, getKey) {
    const out = [];
    const seen = new Set();
    (Array.isArray(arr) ? arr : []).forEach(item => {
      const key = String(getKey(item) || '').trim();
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      out.push(item);
    });
    return out;
  }
  function getCurrentUserIdV30() {
    try { return window.currentUser?.id || window.currentUserId || null; } catch { return null; }
  }
  async function getUserV30() {
    try {
      if (!window.sbClient) return null;
      const { data } = await sbClient.auth.getUser();
      return data?.user || null;
    } catch { return null; }
  }
  function normalizeLeadPhoneV30(lead) {
    try {
      const raw = lead?.whatsapp || lead?.phone || '';
      const n = typeof normalizePhone === 'function' ? normalizePhone(raw) : String(raw).replace(/\D/g, '');
      return n ? (n.startsWith('55') ? n : '55' + n) : '';
    } catch { return ''; }
  }
  function leadToSupabaseStagePayloadV30(lead, stage, extra = {}) {
    const payload = {
      current_stage: stage,
      updated_at: new Date().toISOString(),
      ...extra
    };
    if (stage === 'assignment_whatsapp' || stage === 'assignment_website') payload.lead_channel = 'whatsapp';
    if (stage === 'instagram_backlog' || stage === 'assignment_instagram') payload.lead_channel = 'instagram';
    return payload;
  }
  async function updateLeadStageV30(lead, stage, extra = {}) {
    if (!lead?.id || !window.sbClient) return { error:null };
    const payload = leadToSupabaseStagePayloadV30(lead, stage, extra);
    const { error } = await sbClient.from('leads').update(payload).eq('id', lead.id);
    if (error) console.warn('[validation][stage-update-error]', lead.id, stage, error.message);
    return { error };
  }

  window.renderValidacao = function renderValidacaoFinalV30() {
    const val = typeof getValData === 'function' ? getValData() : [];
    const pendentes = val.filter(v => (v.tipo === 'sem-site' || v.tipo === 'com-site' || !v.tipo));
    safeText('valCountSemZap', pendentes.length);
    safeText('valCountComZap', 0);

    const chips = typeof getChips === 'function' ? getChips() : [];
    const chipPriority = chips.find(c => c.nome && c.nome.includes('8457')) || chips[0];
    if (!window.activeChipId && chips.length) window.activeChipId = chipPriority ? chipPriority.id : chips[0].id;
    const tabs = document.getElementById('valChipTabs');
    if (tabs) {
      tabs.innerHTML = chips.length
        ? chips.map(c => `<div class="chip-tab${window.activeChipId===c.id?' active':''}" onclick="setValChip('${c.id}')">${escHtml(c.nome)}</div>`).join('')
        : '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado</span>';
    }
    const list = document.getElementById('valComSiteList');
    if (!list) return;
    if (!pendentes.length) {
      list.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead pendente para validar</div>';
      const pg = document.getElementById('valPagination'); if (pg) pg.innerHTML = '';
      return;
    }
    const pageSize = typeof VAL_PG !== 'undefined' ? VAL_PG : 20;
    const totalPages = Math.max(1, Math.ceil(pendentes.length / pageSize));
    if (typeof valPage === 'undefined') window.valPage = 1;
    if (window.valPage > totalPages) window.valPage = totalPages;
    const page = pendentes.slice((window.valPage-1)*pageSize, window.valPage*pageSize);
    list.innerHTML = '<div class="ext-list">' + page.map(v => {
      const tipo = v.tipo || (v.site ? 'com-site' : 'sem-site');
      const badge = tipo === 'com-site'
        ? '<span class="q-badge info">🌐 COM SITE</span>'
        : '<span class="q-badge ok">🚫 SEM SITE</span>';
      return `<div class="empresa-card" id="val-card-${v.id}">
        <div class="empresa-info">
          <div class="empresa-nome">${v.googleUrl?`<a href="${escHtml(v.googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(v.nome)}</a>`:escHtml(v.nome)}</div>
          <div class="empresa-meta">
            ${badge}
            ${v.site?`<div class="empresa-site"><a href="${escHtml(v.site)}" target="_blank">${escHtml(v.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a></div>`:''}
            <div class="empresa-phone">📱 ${escHtml(v.whatsapp || '—')}</div>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">pendente</span>
          </div>
        </div>
      </div>`;
    }).join('') + '</div>';
    if (typeof renderPagination === 'function') renderPagination('valPagination', window.valPage, totalPages, pendentes.length, pageSize, 'goValPage', 'changeValPgSize');
  };

  window.setValChip = function setValChipFinalV30(id) { window.activeChipId = id; window.valPage = 1; renderValidacao(); };

  window.validarTodosNumeros = async function validarTodosNumerosFinalV30() {
    const chip = typeof getChipById === 'function' ? getChipById(window.activeChipId) : null;
    if (!chip) { notify('// selecione um chip primeiro','warn'); return; }
    const val = typeof getValData === 'function' ? getValData() : [];
    const pendentes = val.filter(v => (v.tipo === 'sem-site' || v.tipo === 'com-site' || !v.tipo));
    if (!pendentes.length) { notify('// nenhum lead pendente','warn'); return; }
    const spinner = document.getElementById('valSpinner');
    if (spinner) spinner.style.display = 'block';

    const resultsByNumber = new Map();
    let apiFailed = false;
    for (let i = 0; i < pendentes.length; i += 10) {
      const lote = pendentes.slice(i, i + 10);
      const numbers = lote.map(normalizeLeadPhoneV30).filter(n => n.length >= 12);
      if (!numbers.length) continue;
      try {
        const res = await fetch(`${chip.url}/chat/whatsappNumbers/${chip.instance}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': chip.key },
          body: JSON.stringify({ numbers })
        });
        const data = await res.json();
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        numbers.forEach(num => {
          const found = rows.find(r => String(r?.jid || r?.number || r?.exists || '').includes(num) || String(r?.number || '').replace(/\D/g,'') === num);
          resultsByNumber.set(num, !!(found?.exists || found?.jid));
        });
      } catch(e) {
        apiFailed = true;
        console.error('[validation][whatsapp-check-error]', e?.message || e);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (apiFailed && !resultsByNumber.size) {
      if (spinner) spinner.style.display = 'none';
      notify('// falha ao validar na Evolution. Nada foi movido.', 'err');
      return;
    }

    const atrib = typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : [];
    const insta = typeof getInstaFila === 'function' ? getInstaFila() : [];
    const remaining = [];
    let toZap = 0, toComSite = 0, toInsta = 0;

    for (const lead of val) {
      const isTarget = pendentes.some(p => p.id === lead.id);
      if (!isTarget) { remaining.push(lead); continue; }
      const phone = normalizeLeadPhoneV30(lead);
      const exists = phone ? resultsByNumber.get(phone) : false;
      if (exists) {
        const tipo = lead.tipo || (lead.site ? 'com-site' : 'sem-site');
        const moved = { ...lead, numStatus:'valido', canal:'zap', tipo, validadoEm: typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10) };
        atrib.push(moved);
        if (tipo === 'com-site') { toComSite++; await updateLeadStageV30(lead, 'assignment_website', { whatsapp_validation_status:'valid' }); }
        else { toZap++; await updateLeadStageV30(lead, 'assignment_whatsapp', { whatsapp_validation_status:'valid' }); }
      } else {
        const moved = { ...lead, numStatus:'invalido', canal:'insta', tipo:'instagram', validadoEm: typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10) };
        insta.push(moved);
        toInsta++;
        await updateLeadStageV30(lead, 'instagram_backlog', { whatsapp_validation_status:'invalid' });
      }
    }

    if (typeof saveValData === 'function') saveValData(remaining);
    if (typeof saveAtribuicaoData === 'function') saveAtribuicaoData(uniqueBy(atrib, l => l.id || normalizeLeadPhoneV30(l)));
    if (typeof saveInstaFila === 'function') saveInstaFila(uniqueBy(insta, l => l.id || l.instagram || normalizeLeadPhoneV30(l) || l.nome));
    if (spinner) spinner.style.display = 'none';
    if (typeof loadSupabaseLeadsToLocalState === 'function') await loadSupabaseLeadsToLocalState();
    renderValidacao();
    if (typeof renderAtribuicao === 'function') renderAtribuicao();
    if (typeof updateBadges === 'function') updateBadges();
    notify(`Total: ${pendentes.length} · WhatsApp: ${toZap} · Com site: ${toComSite} · Instagram: ${toInsta}`);
  };

  window.aprovarTodosParaAtribuicao = async function(){ return window.validarTodosNumeros(); };

  window.loadSentContactsPanel = async function loadSentContactsPanel(force = false) {
    if (!force && sentContactsCacheV30.length && Date.now() - sentContactsLoadedAtV30 < 15000) { renderSentContactsPanel(); return; }
    const user = await getUserV30();
    if (!user?.id || !window.sbClient) { sentContactsCacheV30 = []; renderSentContactsPanel(); return; }
    // Alguns já enviados importados de backup antigo podem ter user_id NULL.
    // A tela deve mostrar os contatos do usuário atual e também esses contatos globais/importados,
    // mantendo a proteção funcionando sem exigir reimportação manual.
    const { data, error } = await sbClient
      .from('sent_contacts')
      .select('id,user_id,company_name,phone,normalized_phone,source,reason,block_type,dispatched_at,created_at,active')
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .eq('active', true)
      .order('created_at', { ascending:false })
      .limit(5000);
    if (error) {
      console.warn('[sent_contacts][load-error]', error.message);
      sentContactsCacheV30 = [];
    } else {
      sentContactsCacheV30 = data || [];
      sentContactsLoadedAtV30 = Date.now();
    }
    safeText('badge-ja-enviados', sentContactsCacheV30.length);
    renderSentContactsPanel();
  };

  window.renderSentContactsPanel = function renderSentContactsPanel() {
    const el = document.getElementById('sentContactsList');
    if (!el) return;
    const q = String(document.getElementById('sentContactsSearch')?.value || '').trim().toLowerCase();
    const baseRows = uniqueBy(sentContactsCacheV30, r => r.normalized_phone || r.phone || r.id);
    const rows = q ? baseRows.filter(r => String(r.company_name||'').toLowerCase().includes(q) || String(r.normalized_phone||r.phone||'').includes(q.replace(/\D/g,''))) : baseRows;
    if (!rows.length) {
      el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">// nenhum contato enviado encontrado</div>';
      return;
    }
    el.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:10px">Exibindo ${Math.min(rows.length,SENT_PAGE_SIZE)} de ${rows.length}</div>` +
      '<div class="ext-list">' + rows.slice(0, SENT_PAGE_SIZE).map(r => `
        <div class="empresa-card">
          <div class="empresa-info">
            <div class="empresa-nome">${escHtml(r.company_name || 'Contato sem nome')}</div>
            <div class="empresa-meta">
              <span class="q-badge ok">✅ JÁ ENVIADO</span>
              <div class="empresa-phone">📱 ${escHtml(r.normalized_phone || r.phone || '—')}</div>
              ${r.source ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${escHtml(r.source)}</span>` : ''}
              ${r.created_at ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${escHtml(new Date(r.created_at).toLocaleDateString('pt-BR'))}</span>` : ''}
            </div>
          </div>
        </div>`).join('') + '</div>';
  };

  const oldSwitchPanel = window.switchPanel;
  window.switchPanel = function switchPanelFinalV30(name) {
    if (name === 'ja-enviados') {
      document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === 'panel-ja-enviados'));
      document.querySelectorAll('.nav-item').forEach(el => {
        const label = el.getAttribute('data-label') || '';
        el.classList.toggle('active', label === 'Já enviados');
      });
      loadSentContactsPanel(true);
      updateBadges();
      return;
    }
    return oldSwitchPanel ? oldSwitchPanel(name) : undefined;
  };

  const oldUpdateBadges = window.updateBadges;
  window.updateBadges = function updateBadgesFinalV30() {
    try {
      const data = typeof ensureWeekData === 'function' ? ensureWeekData() : { days:{} };
      const flat = typeof flattenWeekData === 'function' ? flattenWeekData(data) : [];
      safeText('badge-inicio', flat.filter(e => (e.status||'Não enviada')==='Não enviada').length);
      safeText('badge-importar', 0);
      safeText('badge-validacao', typeof getValData === 'function' ? getValData().length : 0);
      const atribCount = (typeof getAtribuicaoData === 'function' ? getAtribuicaoData().length : 0) + (typeof getInstaFila === 'function' ? getInstaFila().length : 0);
      safeText('badge-atribuicao', atribCount);
      safeText('badge-fila-zap', flat.filter(e => (e.status||'Não enviada')==='Não enviada' && (e.whatsapp || e.phone)).length);
      const instaWeek = typeof getInstaWeek === 'function' ? getInstaWeek() : {};
      safeText('badge-instagram', Object.values(instaWeek || {}).flat().length);
      if (typeof updateAtribTabCounts === 'function') updateAtribTabCounts();
      if (sentContactsCacheV30.length) safeText('badge-ja-enviados', sentContactsCacheV30.length);
      else loadSentContactsPanel(false);
    } catch(e) {
      if (oldUpdateBadges) return oldUpdateBadges();
    }
  };

  document.addEventListener('DOMContentLoaded', () => setTimeout(() => { updateBadges(); loadSentContactsPanel(false); }, 900));
})();

/* V30.1 — correções finais: paginação sem NaN, renderização forte e badges reais */
(function(){
  function nint(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }
  function safeTextV31(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? 0);
  }
  function normalizePhoneV31(lead) {
    const raw = lead?.normalized_phone || lead?.whatsapp || lead?.phone || '';
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('55') ? digits : '55' + digits;
  }
  function leadNameV31(lead) {
    return lead?.nome || lead?.company_name || lead?.companyName || lead?.title || 'Lead sem nome';
  }
  function leadSiteV31(lead) {
    return lead?.site || lead?.website || '';
  }
  function leadUrlV31(lead) {
    return lead?.googleUrl || lead?.mapsUrl || lead?.url || '';
  }
  function leadTipoV31(lead) {
    return lead?.tipo || (leadSiteV31(lead) ? 'com-site' : 'sem-site');
  }
  function escV31(value) {
    if (typeof escHtml === 'function') return escHtml(value);
    return String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function renderPagerV31(containerId, cur, total, totalItems, pgSize, onPage, onSize) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const c = nint(cur, 1);
    const t = Math.max(1, nint(total, 1));
    const p = Math.max(1, nint(pgSize, 20));
    const count = Math.max(0, nint(totalItems, 0));
    if (!count) { el.innerHTML = ''; return; }
    const start = Math.min(count, (c - 1) * p + 1);
    const end = Math.min(c * p, count);
    const pages = [];
    for (let i = 1; i <= t; i++) pages.push(i);
    el.innerHTML = `<div class="pagination-bar">
      <div class="pagination-info">Exibindo <strong>${start}–${end}</strong> de <strong>${count}</strong></div>
      <div class="pagination-controls">
        <button class="pg-btn" onclick="${onPage}(${Math.max(1, c-1)})" ${c<=1?'disabled':''}>‹</button>
        ${pages.map(i => `<button class="pg-btn${i===c?' active':''}" onclick="${onPage}(${i})">${i}</button>`).join('')}
        <button class="pg-btn" onclick="${onPage}(${Math.min(t, c+1)})" ${c>=t?'disabled':''}>›</button>
      </div>
      <select class="pg-size-select" onchange="${onSize}(+this.value)" title="Itens por página">
        ${[10,20,50,100].map(n=>`<option value="${n}"${p===n?' selected':''}>${n}/pág</option>`).join('')}
      </select>
    </div>`;
  }

  window.goValPage = function goValPageV31(page) {
    window.valPage = nint(page, 1);
    if (typeof window.renderValidacao === 'function') window.renderValidacao();
  };
  window.changeValPgSize = function changeValPgSizeV31(size) {
    window.VAL_PG = nint(size, 20);
    window.valPage = 1;
    if (typeof window.renderValidacao === 'function') window.renderValidacao();
  };

  const previousRenderValidacao = window.renderValidacao;
  window.renderValidacao = function renderValidacaoV31() {
    const val = typeof getValData === 'function' ? getValData() : [];
    const pendentes = (Array.isArray(val) ? val : []).filter(v => {
      const stage = String(v.current_stage || '').toLowerCase();
      return !stage || stage === 'validation' || v.canal === 'pendente' || v.numStatus === 'pendente';
    });
    safeTextV31('valCountSemZap', pendentes.length);
    safeTextV31('valCountComZap', 0);

    const chips = typeof getChips === 'function' ? getChips() : [];
    if (!window.activeChipId && chips.length) window.activeChipId = (chips.find(c => String(c.nome || c.label || '').includes('8457')) || chips[0]).id;
    const tabs = document.getElementById('valChipTabs');
    if (tabs) {
      tabs.innerHTML = chips.length
        ? chips.map(c => `<div class="chip-tab${window.activeChipId===c.id?' active':''}" onclick="setValChip('${escV31(c.id)}')">${escV31(c.nome || c.label || c.instance || 'chip')}</div>`).join('')
        : '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">Nenhum chip configurado</span>';
    }

    const list = document.getElementById('valComSiteList');
    if (!list) {
      if (typeof previousRenderValidacao === 'function') return previousRenderValidacao();
      return;
    }
    if (!pendentes.length) {
      list.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead pendente para validar</div>';
      const pg = document.getElementById('valPagination'); if (pg) pg.innerHTML = '';
      return;
    }

    const pageSize = nint(window.VAL_PG, 20);
    const totalPages = Math.max(1, Math.ceil(pendentes.length / pageSize));
    window.valPage = Math.min(totalPages, nint(window.valPage, 1));
    const start = (window.valPage - 1) * pageSize;
    const page = pendentes.slice(start, start + pageSize);

    list.innerHTML = '<div class="ext-list">' + page.map(v => {
      const nome = leadNameV31(v);
      const site = leadSiteV31(v);
      const url = leadUrlV31(v);
      const tipo = leadTipoV31(v);
      const phone = v.whatsapp || v.phone || '';
      const badge = tipo === 'com-site'
        ? '<span class="q-badge info">🌐 COM SITE</span>'
        : '<span class="q-badge ok">🚫 SEM SITE</span>';
      return `<div class="empresa-card" id="val-card-${escV31(v.id || normalizePhoneV31(v) || nome)}">
        <div class="empresa-info">
          <div class="empresa-nome">${url ? `<a href="${escV31(url)}" target="_blank" style="color:var(--text);text-decoration:none">${escV31(nome)}</a>` : escV31(nome)}</div>
          <div class="empresa-meta">
            ${badge}
            ${site ? `<div class="empresa-site"><a href="${escV31(site)}" target="_blank">${escV31(site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a></div>` : ''}
            <div class="empresa-phone">📱 ${escV31(phone || '—')}</div>
            ${v.city || v.state ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${escV31([v.city,v.state].filter(Boolean).join(' / '))}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('') + '</div>';
    renderPagerV31('valPagination', window.valPage, totalPages, pendentes.length, pageSize, 'goValPage', 'changeValPgSize');
  };

  const previousUpdateBadges = window.updateBadges;
  window.updateBadges = function updateBadgesV31() {
    try {
      const valCount = typeof getValData === 'function' ? getValData().length : 0;
      const atrib = typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : [];
      const insta = typeof getInstaFila === 'function' ? getInstaFila() : [];
      const zapCount = atrib.filter(l => (l.canal || 'zap') !== 'insta').length;
      safeTextV31('badge-validacao', valCount);
      safeTextV31('badge-atribuicao', zapCount + insta.length);
      if (typeof updateAtribTabCounts === 'function') updateAtribTabCounts();
      if (typeof window.loadSentContactsPanel === 'function') window.loadSentContactsPanel(false);
    } catch (e) {
      if (typeof previousUpdateBadges === 'function') previousUpdateBadges();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try { window.renderValidacao && window.renderValidacao(); } catch(e) {}
      try { window.renderAtribuicao && window.renderAtribuicao(); } catch(e) {}
      try { window.updateBadges && window.updateBadges(); } catch(e) {}
    }, 1200);
  });
})();

/* V30.2 — Conteúdo real em Atribuição Instagram, Já Enviados e badges consistentes */
(function(){
  function escV32(value) {
    if (typeof escHtml === 'function') return escHtml(value);
    return String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function textV32(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? 0);
  }
  function onlyDigitsV32(value) { return String(value || '').replace(/\D/g, ''); }
  function leadNameV32(lead) { return lead?.nome || lead?.company_name || lead?.title || 'Lead sem nome'; }
  function leadInstaV32(lead) { return lead?.instagram || lead?.instagram_url || lead?.instagramUrl || ''; }
  function leadPhoneV32(lead) { return lead?.whatsapp || lead?.phone || ''; }

  window.renderAtribInstaFila = function renderAtribInstaFilaV32() {
    const listEl = document.getElementById('atribInstaList');
    if (!listEl) return;

    const filaAll = Array.isArray(typeof getInstaFila === 'function' ? getInstaFila() : []) ? getInstaFila() : [];
    const buscaEl = document.getElementById('atribInstaBusca');
    const buscaQ = String(buscaEl?.value || '').trim().toLowerCase();
    const buscaDigits = onlyDigitsV32(buscaQ);
    const fila = buscaQ
      ? filaAll.filter(e =>
          String(leadNameV32(e)).toLowerCase().includes(buscaQ) ||
          String(leadInstaV32(e)).toLowerCase().includes(buscaQ) ||
          String(leadPhoneV32(e)).toLowerCase().includes(buscaQ) ||
          (buscaDigits && onlyDigitsV32(leadPhoneV32(e)).includes(buscaDigits))
        )
      : filaAll;

    const totalEl = document.getElementById('atribInstaFilaTotalBadge');
    if (totalEl) totalEl.textContent = fila.length ? `· ${fila.length} lead${fila.length !== 1 ? 's' : ''}` : '';

    if (!fila.length) {
      listEl.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead aguardando atribuição Instagram</div>`;
      const pg = document.getElementById('atribInstaPagination'); if (pg) pg.innerHTML = '';
      return;
    }

    const pageSize = 30;
    window.atribInstaPage = Number.isFinite(Number(window.atribInstaPage)) ? Number(window.atribInstaPage) : 0;
    const totalPages = Math.max(1, Math.ceil(fila.length / pageSize));
    if (window.atribInstaPage >= totalPages) window.atribInstaPage = totalPages - 1;
    if (window.atribInstaPage < 0) window.atribInstaPage = 0;
    const page = fila.slice(window.atribInstaPage * pageSize, (window.atribInstaPage + 1) * pageSize);

    listEl.innerHTML = '<div class="ext-list">' + page.map(e => {
      const id = escV32(e.id || leadNameV32(e));
      const nome = leadNameV32(e);
      const insta = leadInstaV32(e);
      const phone = leadPhoneV32(e);
      const rating = e.totalScore || e.rating || '';
      const reviews = e.reviewsCount || e.reviews_count || '';
      const maps = e.googleUrl || e.mapsUrl || e.url || '';
      return `<div class="empresa-card" id="atrib-insta-card-${id}" style="border-color:rgba(225,48,108,0.22)">
        <div class="empresa-info">
          <div class="empresa-nome">${maps ? `<a href="${escV32(maps)}" target="_blank" style="color:var(--text);text-decoration:none">${escV32(nome)}</a>` : escV32(nome)}</div>
          <div class="empresa-meta">
            <span class="q-badge" style="color:var(--insta);border-color:rgba(225,48,108,0.35);background:rgba(225,48,108,0.08)">📸 INSTAGRAM</span>
            ${phone ? `<div class="empresa-phone">📱 ${escV32(phone)}</div>` : '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--muted)">sem WhatsApp</span>'}
            ${rating ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--ok)">⭐ ${escV32(rating)}${reviews ? ` (${escV32(reviews)} av.)` : ''}</span>` : ''}
            ${e.city || e.state ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${escV32([e.city,e.state].filter(Boolean).join(' / '))}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
            <a href="https://www.google.com/search?q=site:instagram.com+${encodeURIComponent('"' + nome + '"')}" target="_blank"
              style="background:none;border:1px solid rgba(225,48,108,0.25);color:var(--insta);border-radius:6px;font-size:11px;padding:5px 9px;text-decoration:none">🔍</a>
            <input id="atrib-insta-link-${id}" type="text" value="${escV32(insta)}" placeholder="Cole ou confirme o Instagram..."
              style="flex:1;background:rgba(225,48,108,0.06);border:1px solid rgba(225,48,108,0.25);border-radius:6px;color:var(--text);font-family:'DM Mono',monospace;font-size:9px;padding:6px 9px;outline:none"
              onkeydown="if(event.key==='Enter') atribInstaConfirmarLink('${id}')" />
          </div>
        </div>
        <div class="empresa-actions" style="flex-direction:column;gap:6px;align-items:flex-end">
          <button onclick="atribInstaConfirmarLink('${id}')" style="background:var(--insta);color:#fff;border:none;border-radius:7px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:6px 12px;cursor:pointer">✓ Confirmar</button>
          <button onclick="mandarParaFilaInsta('${id}')" style="background:none;border:1px solid rgba(225,48,108,0.35);color:var(--insta);border-radius:7px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:6px 12px;cursor:pointer">→ Fila Insta</button>
        </div>
      </div>`;
    }).join('') + '</div>';

    const pg = document.getElementById('atribInstaPagination');
    if (pg) {
      const start = window.atribInstaPage * pageSize + 1;
      const end = Math.min((window.atribInstaPage + 1) * pageSize, fila.length);
      pg.innerHTML = `<div class="pagination-bar"><div class="pagination-info">Exibindo <strong>${start}–${end}</strong> de <strong>${fila.length}</strong></div><div class="pagination-controls"><button class="pg-btn" onclick="atribInstaPage=Math.max(0,atribInstaPage-1);renderAtribInstaFila()" ${window.atribInstaPage<=0?'disabled':''}>‹</button><button class="pg-btn active">${window.atribInstaPage+1}</button><button class="pg-btn" onclick="atribInstaPage=Math.min(${totalPages-1},atribInstaPage+1);renderAtribInstaFila()" ${window.atribInstaPage>=totalPages-1?'disabled':''}>›</button></div></div>`;
    }
  };

  const previousUpdateBadgesV32 = window.updateBadges;
  window.updateBadges = function updateBadgesV32() {
    try {
      const val = Array.isArray(typeof getValData === 'function' ? getValData() : []) ? getValData() : [];
      const atrib = Array.isArray(typeof getAtribuicaoData === 'function' ? getAtribuicaoData() : []) ? getAtribuicaoData() : [];
      const instaAtrib = Array.isArray(typeof getInstaFila === 'function' ? getInstaFila() : []) ? getInstaFila() : [];
      const zapBacklog = Array.isArray(typeof getZapBacklog === 'function' ? getZapBacklog() : []) ? getZapBacklog() : [];
      const instaWeek = typeof getInstaWeek === 'function' ? getInstaWeek() : {};
      const instaEnvios = Object.values(instaWeek || {}).flat().length;

      textV32('badge-validacao', val.length);
      textV32('badge-atribuicao', atrib.length + instaAtrib.length);
      textV32('badge-whatsapp-queue', zapBacklog.length);
      textV32('badge-fila-zap', zapBacklog.length);
      textV32('badge-instagram', instaEnvios);
      textV32('badge-import', 0);
      textV32('badge-importar', 0);
      if (typeof updateAtribTabCounts === 'function') updateAtribTabCounts();
      if (typeof window.loadSentContactsPanel === 'function') window.loadSentContactsPanel(false);
    } catch (e) {
      if (typeof previousUpdateBadgesV32 === 'function') previousUpdateBadgesV32();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try { if (window.atribActiveTab === 'insta') window.renderAtribInstaFila(); } catch(e) {}
      try { window.updateBadges && window.updateBadges(); } catch(e) {}
    }, 1500);
  });
})();
