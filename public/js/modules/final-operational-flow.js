
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
    const { data, error } = await sbClient
      .from('sent_contacts')
      .select('id,company_name,phone,normalized_phone,source,reason,block_type,dispatched_at,created_at,active')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('created_at', { ascending:false })
      .limit(2000);
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
    const rows = q ? sentContactsCacheV30.filter(r => String(r.company_name||'').toLowerCase().includes(q) || String(r.normalized_phone||r.phone||'').includes(q.replace(/\D/g,''))) : sentContactsCacheV30;
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
