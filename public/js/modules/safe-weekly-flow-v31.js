/* V31 — Fluxo seguro DB-first
   Importação -> Atribuição -> Pré-envio/validação manual -> Fila de Disparo -> Já enviados
   Sem validação massiva pela Evolution. */
(function(){
  const USER_ID_FALLBACK = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const PER_PAGE = 30;
  let prePage = 1;
  let preCurrentDate = new Date().toISOString().slice(0,10);

  function userId(){
    try { return window.currentUser?.id || USER_ID_FALLBACK; } catch(e){ return USER_ID_FALLBACK; }
  }
  function client(){ return (typeof window.sbClient !== 'undefined' && window.sbClient) ? window.sbClient : null; }
  function esc(v){
    return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  }
  function fmtDate(v){
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString('pt-BR'); } catch(e){ return String(v); }
  }
  function notifySafe(msg,type){
    if (typeof window.notify === 'function') window.notify(msg,type); else console.log(msg);
  }
  function sundayOfWeek(base = new Date()){
    const d = new Date(base); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d;
  }
  function dateAdd(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
  function iso(d){ return d.toISOString().slice(0,10); }
  function brDayLabel(dateIso){
    const d = new Date(dateIso+'T00:00:00');
    const names = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    return `${names[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function guessLeadType(row){
    const stage = String(row.current_stage || '').toLowerCase();
    if (stage.includes('instagram')) return 'instagram';
    if (stage.includes('website') || row.has_own_site || row.website) return 'com-site';
    return 'sem-site';
  }
  function stageForType(type){
    if (type === 'instagram') return 'assignment_instagram';
    if (type === 'com-site') return 'assignment_website';
    return 'assignment_whatsapp';
  }
  function channelForType(type){ return type === 'instagram' ? 'instagram' : 'whatsapp'; }

  async function fetchChips(){
    const sb = client(); if (!sb) return [];
    const { data, error } = await sb
      .from('whatsapp_instances')
      .select('id,label,instance,active,status,connection_state,daily_limit,block_size,interval_seconds')
      .eq('user_id', userId())
      .order('label', { ascending:true });
    if (error) { console.warn('[v31][chips]', error.message); return []; }
    const seen = new Set();
    return (data||[]).filter(c => {
      if (seen.has(c.instance)) return false;
      seen.add(c.instance); return true;
    });
  }

  async function fetchAssignmentCounts(){
    const sb = client(); if (!sb) return { whatsapp:0, website:0, instagram:0 };
    const { data, error } = await sb
      .from('leads')
      .select('current_stage')
      .eq('user_id', userId())
      .in('current_stage', ['assignment_whatsapp','assignment_website','assignment_instagram']);
    if (error) { console.warn('[v31][assignment-counts]', error.message); return { whatsapp:0, website:0, instagram:0 }; }
    return {
      whatsapp: (data||[]).filter(r => r.current_stage === 'assignment_whatsapp').length,
      website: (data||[]).filter(r => r.current_stage === 'assignment_website').length,
      instagram: (data||[]).filter(r => r.current_stage === 'assignment_instagram').length
    };
  }

  async function fetchSentContacts(){
    const sb = client(); if (!sb) return [];
    const { data, error } = await sb
      .from('sent_contacts')
      .select('id,company_name,phone,normalized_phone,block_type,source,reason,active,dispatched_at,created_at,raw_payload')
      .eq('user_id', userId())
      .eq('active', true)
      .order('created_at', { ascending:false });
    if (error) { console.warn('[v31][sent_contacts]', error.message); return []; }
    return data || [];
  }

  async function renderSentContactsPanelV31(){
    const el = document.getElementById('sentContactsList');
    const badge = document.getElementById('badge-ja-enviados');
    if (el) el.innerHTML = `<div style="padding:24px;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px">// carregando sent_contacts...</div>`;
    const rows = await fetchSentContacts();
    if (badge) badge.textContent = String(rows.length);
    const countEl = document.getElementById('sentContactsCount');
    if (countEl) countEl.textContent = `${rows.length} contato${rows.length!==1?'s':''}`;
    if (!el) return;
    const q = (document.getElementById('sentContactsSearch')?.value || '').trim().toLowerCase();
    const filtered = q ? rows.filter(r => `${r.company_name||''} ${r.phone||''} ${r.normalized_phone||''}`.toLowerCase().includes(q)) : rows;
    if (!filtered.length) {
      el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px">// nenhum contato encontrado em sent_contacts</div>`;
      return;
    }
    el.innerHTML = `<div class="ext-list">${filtered.map(r => `
      <div class="empresa-card" style="border-color:rgba(78,203,113,0.22)">
        <div class="empresa-info">
          <div class="empresa-nome">${esc(r.company_name || 'Sem nome')}</div>
          <div class="empresa-meta">
            <span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:var(--ok);background:rgba(78,203,113,0.08);border:1px solid rgba(78,203,113,0.3);border-radius:4px;padding:2px 7px">JÁ ENVIADO</span>
            <span>📱 ${esc(r.phone || r.normalized_phone || '')}</span>
            <span>origem: ${esc(r.source || 'import')}</span>
            <span>${fmtDate(r.dispatched_at || r.created_at)}</span>
          </div>
        </div>
      </div>`).join('')}</div>`;
  }

  async function renderPreEnvioPanelV31(){
    const root = document.getElementById('preEnvioRoot'); if (!root) return;
    const chips = await fetchChips();
    const counts = await fetchAssignmentCounts();
    const weekStart = sundayOfWeek();
    const days = Array.from({length:7}, (_,i) => iso(dateAdd(weekStart,i)));
    root.innerHTML = `
      <div class="page-header" style="flex-shrink:0">
        <div>
          <div class="page-title">Pré-envio <span>semanal.</span></div>
          <div class="page-sub">// atribuição por dia · revisão manual · substituição automática · fila final</div>
        </div>
      </div>
      <div class="stats-row" style="margin-bottom:14px">
        <div class="stat-card"><div class="stat-label">Atribuição WhatsApp</div><div class="stat-value">${counts.whatsapp}</div></div>
        <div class="stat-card"><div class="stat-label">Com site</div><div class="stat-value">${counts.website}</div></div>
        <div class="stat-card"><div class="stat-label">Instagram</div><div class="stat-value">${counts.instagram}</div></div>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">Criar pré-envio</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
          <div class="field-group" style="min-width:150px"><label>Dia</label><select id="preCreateDate">${days.map(d=>`<option value="${d}">${brDayLabel(d)}</option>`).join('')}</select></div>
          <div class="field-group" style="min-width:170px"><label>Chip</label><select id="preCreateChip">${chips.map(c=>`<option value="${esc(c.instance)}">${esc(c.label||c.instance)} · ${esc(c.status||'')}</option>`).join('')}</select></div>
          <div class="field-group" style="min-width:150px"><label>Origem</label><select id="preCreateType"><option value="sem-site">WhatsApp sem site</option><option value="com-site">Com site</option><option value="instagram">Instagram</option></select></div>
          <div class="field-group" style="width:110px"><label>Qtd</label><input id="preCreateQty" type="number" min="1" max="120" value="120"></div>
          <button class="btn btn-primary" onclick="createPreSendBatchV31()">Gerar pré-envio</button>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:10px">O pré-envio não consulta a Evolution. Você revisa manualmente os 120 do dia e só depois libera para a fila final.</div>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">Revisar dia</div>
        <div class="day-tabs" style="margin-bottom:12px">${days.map(d=>`<button class="day-tab ${d===preCurrentDate?'active':''}" onclick="setPreEnvioDateV31('${d}')">${brDayLabel(d)}</button>`).join('')}</div>
        <div id="preEnvioList"></div>
      </div>`;
    await renderPreEnvioListV31();
  }

  async function fetchPreItems(dateIso){
    const sb = client(); if (!sb) return [];
    const { data, error } = await sb
      .from('pre_dispatch_items')
      .select('id,lead_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,created_at,leads(company_name,phone,normalized_phone,website,instagram_url,city,state,rating,reviews_count)')
      .eq('user_id', userId())
      .eq('scheduled_date', dateIso)
      .order('chip_label', { ascending:true })
      .order('position', { ascending:true });
    if (error) { console.warn('[v31][pre-items]', error.message); return []; }
    return data || [];
  }

  async function renderPreEnvioListV31(){
    const el = document.getElementById('preEnvioList'); if (!el) return;
    const rows = await fetchPreItems(preCurrentDate);
    const badge = document.getElementById('badge-pre-envio'); if (badge) badge.textContent = String(rows.filter(r => r.status !== 'ready_to_dispatch').length);
    if (!rows.length) { el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px">// nenhum lead planejado para ${brDayLabel(preCurrentDate)}</div>`; return; }
    const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (prePage > totalPages) prePage = totalPages;
    const pageRows = rows.slice((prePage-1)*PER_PAGE, prePage*PER_PAGE);
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">
        <strong style="color:var(--text)">${rows.length}</strong> planejados · <strong style="color:var(--ok)">${rows.filter(r=>r.status==='approved').length}</strong> aprovados · <strong style="color:var(--accent)">${rows.filter(r=>r.status==='ready_to_dispatch').length}</strong> fila final
        <button class="btn btn-primary" style="margin-left:auto;font-size:10px;padding:7px 12px" onclick="sendApprovedToFinalQueueV31('${preCurrentDate}')">Enviar aprovados para fila final</button>
      </div>
      <div class="ext-list">${pageRows.map(r => {
        const l = r.leads || {};
        const statusColor = r.status === 'approved' ? 'var(--ok)' : r.status === 'ready_to_dispatch' ? 'var(--accent)' : r.status?.startsWith('invalid') ? 'var(--error)' : 'var(--muted)';
        return `<div class="empresa-card">
          <div class="empresa-info">
            <div class="empresa-nome">${esc(l.company_name || 'Lead sem nome')}</div>
            <div class="empresa-meta">
              <span style="color:${statusColor};font-weight:700">${esc(r.status || 'review')}</span>
              <span>${esc(r.chip_label || r.chip_instance || '')}</span>
              <span>${esc(r.lead_type || '')}</span>
              <span>📱 ${esc(l.phone || l.normalized_phone || '')}</span>
              ${l.website ? `<span>🌐 ${esc(String(l.website).replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</span>` : ''}
              ${l.city || l.state ? `<span>${esc([l.city,l.state].filter(Boolean).join('/'))}</span>` : ''}
            </div>
          </div>
          <div class="empresa-actions" style="gap:5px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-primary" style="font-size:9px;padding:5px 9px" onclick="approvePreItemV31('${r.id}')">✓ Aprovar</button>
            <button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" onclick="invalidatePreItemV31('${r.id}','invalid_whatsapp')">Sem WhatsApp</button>
            <button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" onclick="invalidatePreItemV31('${r.id}','invalid_phone')">Número inválido</button>
            <button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" onclick="replacePreItemV31('${r.id}')">↻ Trocar</button>
          </div>
        </div>`;
      }).join('')}</div>
      <div style="display:flex;justify-content:center;gap:6px;margin-top:12px;font-family:'DM Mono',monospace;font-size:10px">
        <button class="btn btn-ghost" onclick="preEnvioGoPageV31(${Math.max(1,prePage-1)})">←</button>
        <span style="padding:8px;color:var(--muted)">Página ${prePage} de ${totalPages}</span>
        <button class="btn btn-ghost" onclick="preEnvioGoPageV31(${Math.min(totalPages,prePage+1)})">→</button>
      </div>`;
  }

  async function pullNextLead(type, excludeIds = []){
    const sb = client(); if (!sb) return null;
    let q = sb.from('leads').select('id,company_name,phone,current_stage,website,has_own_site').eq('user_id', userId()).eq('current_stage', stageForType(type)).order('created_at',{ascending:true}).limit(1);
    if (excludeIds.length) q = q.not('id','in',`(${excludeIds.map(x=>`"${x}"`).join(',')})`);
    const { data, error } = await q;
    if (error) { console.warn('[v31][next-lead]', error.message); return null; }
    return (data||[])[0] || null;
  }

  async function createPreSendBatchV31(){
    const sb = client(); if (!sb) return notifySafe('// Supabase indisponível','err');
    const date = document.getElementById('preCreateDate')?.value || preCurrentDate;
    const chipInstance = document.getElementById('preCreateChip')?.value || '';
    const chipText = document.getElementById('preCreateChip')?.selectedOptions?.[0]?.textContent || chipInstance;
    const type = document.getElementById('preCreateType')?.value || 'sem-site';
    const qty = Math.max(1, Math.min(120, Number(document.getElementById('preCreateQty')?.value || 120)));
    if (!chipInstance) return notifySafe('// nenhum chip selecionado','warn');
    const { data: existing } = await sb.from('pre_dispatch_items').select('lead_id').eq('user_id', userId()).eq('scheduled_date', date).eq('chip_instance', chipInstance);
    const existingIds = new Set((existing||[]).map(x=>x.lead_id));
    const need = Math.max(0, qty - existingIds.size);
    if (need <= 0) { notifySafe('// este chip/dia já tem a quantidade solicitada','warn'); preCurrentDate = date; return renderPreEnvioPanelV31(); }
    const { data: leads, error } = await sb.from('leads')
      .select('id,company_name')
      .eq('user_id', userId())
      .eq('current_stage', stageForType(type))
      .order('created_at', { ascending:true })
      .limit(need);
    if (error) return notifySafe('// erro ao buscar leads: '+error.message,'err');
    if (!leads?.length) return notifySafe('// não há leads suficientes nessa atribuição','warn');
    const rows = leads.map((lead, i) => ({
      user_id: userId(), lead_id: lead.id, chip_instance: chipInstance,
      chip_label: chipText.split('·')[0].trim(), scheduled_date: date,
      lead_type: type, status: 'review', position: existingIds.size + i + 1,
      raw_payload: {}
    }));
    const { error: insErr } = await sb.from('pre_dispatch_items').insert(rows);
    if (insErr) return notifySafe('// erro ao criar pré-envio: '+insErr.message,'err');
    await sb.from('leads').update({ current_stage:'pre_send', updated_at:new Date().toISOString() }).in('id', leads.map(l=>l.id)).eq('user_id', userId());
    preCurrentDate = date; prePage = 1;
    notifySafe(`✓ ${leads.length} lead(s) enviados para pré-envio`);
    await renderPreEnvioPanelV31();
    if (typeof loadSupabaseLeadsToLocalState === 'function') loadSupabaseLeadsToLocalState();
  }

  async function approvePreItemV31(id){
    const sb = client(); if (!sb) return;
    const { data, error } = await sb.from('pre_dispatch_items').update({ status:'approved', updated_at:new Date().toISOString() }).eq('user_id', userId()).eq('id', id).select('lead_id').maybeSingle();
    if (!error && data?.lead_id) await sb.from('leads').update({ current_stage:'pre_send_approved', updated_at:new Date().toISOString() }).eq('user_id', userId()).eq('id', data.lead_id);
    await renderPreEnvioListV31();
  }

  async function replacePreItemV31(id){ return invalidatePreItemV31(id, 'replaced'); }

  async function invalidatePreItemV31(id, reason){
    const sb = client(); if (!sb) return;
    const { data: item, error } = await sb.from('pre_dispatch_items').select('*').eq('user_id', userId()).eq('id', id).maybeSingle();
    if (error || !item) return notifySafe('// item não encontrado','err');
    if (item.lead_id) await sb.from('leads').update({ current_status: reason, current_stage:'archived', updated_at:new Date().toISOString() }).eq('user_id', userId()).eq('id', item.lead_id);
    const next = await pullNextLead(item.lead_type || 'sem-site', []);
    if (next?.id) {
      await sb.from('pre_dispatch_items').update({ lead_id: next.id, status:'review', updated_at:new Date().toISOString(), raw_payload:{ replaced_from:item.lead_id, reason } }).eq('user_id', userId()).eq('id', id);
      await sb.from('leads').update({ current_stage:'pre_send', updated_at:new Date().toISOString() }).eq('user_id', userId()).eq('id', next.id);
      notifySafe('✓ lead substituído');
    } else {
      await sb.from('pre_dispatch_items').update({ status:reason, updated_at:new Date().toISOString() }).eq('user_id', userId()).eq('id', id);
      notifySafe('// sem substituto disponível; item marcado', 'warn');
    }
    await renderPreEnvioListV31();
    if (typeof loadSupabaseLeadsToLocalState === 'function') loadSupabaseLeadsToLocalState();
  }

  async function sendApprovedToFinalQueueV31(dateIso){
    const sb = client(); if (!sb) return;
    const { data, error } = await sb.from('pre_dispatch_items').select('id,lead_id').eq('user_id', userId()).eq('scheduled_date', dateIso).eq('status','approved');
    if (error) return notifySafe('// erro ao liberar fila: '+error.message,'err');
    if (!data?.length) return notifySafe('// nenhum lead aprovado para liberar','warn');
    await sb.from('pre_dispatch_items').update({ status:'ready_to_dispatch', updated_at:new Date().toISOString() }).in('id', data.map(x=>x.id)).eq('user_id', userId());
    await sb.from('leads').update({ current_stage:'dispatch_queue', updated_at:new Date().toISOString() }).in('id', data.map(x=>x.lead_id)).eq('user_id', userId());
    notifySafe(`✓ ${data.length} lead(s) liberados para Fila de Disparo`);
    await renderPreEnvioListV31();
    if (typeof loadSupabaseLeadsToLocalState === 'function') loadSupabaseLeadsToLocalState();
  }

  async function updateSafeBadgesV31(){
    try {
      const sent = await fetchSentContacts();
      const sentBadge = document.getElementById('badge-ja-enviados'); if (sentBadge) sentBadge.textContent = String(sent.length);
      const counts = await fetchAssignmentCounts();
      const atribBadge = document.getElementById('badge-atribuicao'); if (atribBadge) atribBadge.textContent = String(counts.whatsapp + counts.website + counts.instagram);
      const sb = client();
      if (sb) {
        const { count } = await sb.from('pre_dispatch_items').select('id', { count:'exact', head:true }).eq('user_id', userId()).in('status',['review','approved']);
        const preBadge = document.getElementById('badge-pre-envio'); if (preBadge) preBadge.textContent = String(count || 0);
      }
    } catch(e) { console.warn('[v31][badges]', e?.message || e); }
  }

  function setPreEnvioDateV31(d){ preCurrentDate = d; prePage = 1; renderPreEnvioPanelV31(); }
  function preEnvioGoPageV31(p){ prePage = Math.max(1, p); renderPreEnvioListV31(); }

  // Exporta/override
  window.renderSentContactsPanel = renderSentContactsPanelV31;
  window.renderSentContactsPanelV31 = renderSentContactsPanelV31;
  window.renderPreEnvioPanelV31 = renderPreEnvioPanelV31;
  window.createPreSendBatchV31 = createPreSendBatchV31;
  window.approvePreItemV31 = approvePreItemV31;
  window.invalidatePreItemV31 = invalidatePreItemV31;
  window.replacePreItemV31 = replacePreItemV31;
  window.sendApprovedToFinalQueueV31 = sendApprovedToFinalQueueV31;
  window.setPreEnvioDateV31 = setPreEnvioDateV31;
  window.preEnvioGoPageV31 = preEnvioGoPageV31;
  window.updateSafeBadgesV31 = updateSafeBadgesV31;

  document.addEventListener('DOMContentLoaded', () => setTimeout(updateSafeBadgesV31, 1200));
})();

/* Overrides finais V31: precisam rodar depois de final-operational-flow.js */
(function(){
  const previousSwitch = window.switchPanel;
  window.switchPanel = function switchPanelV31(name){
    if (name === 'pre-envio') {
      document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === 'panel-pre-envio'));
      document.querySelectorAll('.nav-item').forEach(el => {
        const label = el.getAttribute('data-label') || '';
        el.classList.toggle('active', label === 'Pré-envio');
      });
      if (typeof window.renderPreEnvioPanelV31 === 'function') window.renderPreEnvioPanelV31();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      return;
    }
    if (name === 'ja-enviados') {
      document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === 'panel-ja-enviados'));
      document.querySelectorAll('.nav-item').forEach(el => {
        const label = el.getAttribute('data-label') || '';
        el.classList.toggle('active', label === 'Já enviados');
      });
      if (typeof window.renderSentContactsPanelV31 === 'function') window.renderSentContactsPanelV31();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      return;
    }
    return previousSwitch ? previousSwitch(name) : undefined;
  };

  const oldUpdate = window.updateBadges;
  window.updateBadges = function updateBadgesV31(){
    try { if (oldUpdate) oldUpdate(); } catch(e) {}
    if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
  };
})();
