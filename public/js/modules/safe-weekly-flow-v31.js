/* V31 — Fluxo seguro DB-first
   Importação -> Atribuição -> Pré-envio/validação manual -> Fila de Disparo -> Já enviados
   Sem validação massiva pela Evolution. */
(function(){
  const USER_ID_FALLBACK = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const PER_PAGE = 30;
  let prePage = 1;
  let preCurrentDate = new Date().toISOString().slice(0,10);

  function userId(){
    try {
      if (window.currentUser?.id) return window.currentUser.id;
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
      const stored = localStorage.getItem('vs_auth_local_user_v423');
      return stored || USER_ID_FALLBACK;
    } catch(e){ return USER_ID_FALLBACK; }
  }
  function client(){
    try {
      if (window.sbClient) return window.sbClient;
      if (typeof sbClient !== 'undefined' && sbClient) return sbClient;
    } catch(e){}
    return null;
  }
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
  function leadStageFromData(lead){
    const hasPhone = String(lead?.normalized_phone || lead?.phone || '').trim();
    const hasSite = String(lead?.website || '').trim();
    if (!hasPhone) return 'instagram_backlog';
    return hasSite ? 'attribution_site' : 'attribution_whatsapp';
  }
  function normalizeUrl(url){
    const u = String(url || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
  }
  function displayPhone(lead){
    return String(lead?.phone || lead?.normalized_phone || '').trim();
  }
  async function copyTextSafe(text){
    const value = String(text || '').trim();
    if (!value) return notifySafe('// telefone vazio', 'warn');
    try { await navigator.clipboard.writeText(value); notifySafe('✓ WhatsApp copiado'); }
    catch(e){
      try {
        const ta = document.createElement('textarea'); ta.value = value; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); notifySafe('✓ WhatsApp copiado');
      } catch(err){ notifySafe('// não foi possível copiar', 'err'); }
    }
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
    if (type === 'instagram') return 'instagram_backlog';
    if (type === 'com-site') return 'attribution_site';
    return 'attribution_whatsapp';
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
    async function countStage(stage){
      const { count, error } = await sb
        .from('leads')
        .select('id', { count:'exact', head:true })
        .eq('user_id', userId())
        .eq('current_stage', stage);
      if (error) { console.warn('[v31][assignment-count]', stage, error.message); return 0; }
      return count || 0;
    }
    return {
      whatsapp: await countStage('attribution_whatsapp'),
      website: await countStage('attribution_site'),
      instagram: await countStage('instagram_backlog')
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
          <div class="field-group" style="width:110px"><label>Qtd</label><input id="preCreateQty" type="number" min="1" max="120" value="120"></div>
          <button class="btn btn-primary" onclick="createPreSendBatchV31()">Gerar pré-envio</button>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:10px">O pré-envio mistura automaticamente leads com site e sem site. Você revisa manualmente os 120 do dia e só depois libera para a fila final.</div>
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
        <button class="btn btn-ghost" style="margin-left:auto;font-size:10px;padding:7px 12px" onclick="returnPreEnvioDayToAttributionV31('${preCurrentDate}')">↩ Voltar dia para atribuição</button>
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="sendApprovedToFinalQueueV31('${preCurrentDate}')">Enviar aprovados para fila final</button>
      </div>
      <div class="ext-list">${pageRows.map(r => {
        const l = r.leads || {};
        const statusColor = r.status === 'approved' ? 'var(--ok)' : r.status === 'ready_to_dispatch' ? 'var(--accent)' : r.status?.startsWith('invalid') ? 'var(--error)' : 'var(--muted)';
        return `<div class="empresa-card">
          <div class="empresa-info">
            <div class="empresa-nome">${esc(l.company_name || 'Lead sem nome')}</div>
            <div style="margin-top:5px;margin-bottom:4px;font-family:'DM Mono',monospace;font-size:8px;color:${statusColor};text-transform:uppercase;letter-spacing:.04em">${esc(r.status === 'approved' ? 'aprovado' : r.status === 'ready_to_dispatch' ? 'fila final' : r.status === 'invalid_whatsapp' ? 'sem whatsapp' : r.status === 'invalid_phone' ? 'número inválido' : 'em revisão')}</div>
            <div class="empresa-meta" style="gap:8px">
              ${l.website ? `<a href="${esc(normalizeUrl(l.website))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;font-weight:700">Site</a>` : `<span style="color:var(--muted)">Sem site</span>`}
              <span style="color:var(--muted)">|</span>
              <button type="button" class="link-btn" style="background:none;border:0;color:var(--ok);font:inherit;font-weight:700;cursor:pointer;padding:0" onclick="copyPreEnvioWhatsappV31('${esc(displayPhone(l))}')">WhatsApp</button>
            </div>
          </div>
          <div class="empresa-actions" style="gap:5px;flex-wrap:wrap;justify-content:flex-end">
            ${r.status === 'approved' ? `<button class="btn btn-ghost" style="font-size:9px;padding:5px 9px;border-color:rgba(78,203,113,.45);color:var(--ok)" disabled>✓ Aprovado</button>` : r.status === 'ready_to_dispatch' ? `<button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" disabled>Na fila final</button>` : `<button class="btn btn-primary" style="font-size:9px;padding:5px 9px" onclick="approvePreItemV31('${r.id}')">✓ Aprovar</button>`}
            <button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" onclick="invalidatePreItemV31('${r.id}','invalid_whatsapp')" ${r.status === 'ready_to_dispatch' ? 'disabled' : ''}>Sem WhatsApp</button>
            <button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" onclick="invalidatePreItemV31('${r.id}','invalid_phone')" ${r.status === 'ready_to_dispatch' ? 'disabled' : ''}>Número inválido</button>
            <button class="btn btn-ghost" style="font-size:9px;padding:5px 9px" onclick="replacePreItemV31('${r.id}')" ${r.status === 'ready_to_dispatch' ? 'disabled' : ''}>↻ Trocar</button>
          </div>
        </div>`;
      }).join('')}</div>
      <div style="display:flex;justify-content:center;gap:6px;margin-top:12px;font-family:'DM Mono',monospace;font-size:10px">
        <button class="btn btn-ghost" onclick="preEnvioGoPageV31(${Math.max(1,prePage-1)})">←</button>
        <span style="padding:8px;color:var(--muted)">Página ${prePage} de ${totalPages}</span>
        <button class="btn btn-ghost" onclick="preEnvioGoPageV31(${Math.min(totalPages,prePage+1)})">→</button>
      </div>`;
  }

  async function fetchMixedAttributionLeads(limit, excludeIds = []){
    const sb = client(); if (!sb) return [];
    async function fetchStage(st, lim){
      let q = sb.from('leads')
        .select('id,company_name,phone,normalized_phone,current_stage,website,has_own_site,created_at')
        .eq('user_id', userId())
        .eq('current_stage', st)
        .order('created_at',{ascending:true})
        .limit(lim);
      if (excludeIds.length) q = q.not('id','in',`(${excludeIds.map(x=>`"${x}"`).join(',')})`);
      const { data, error } = await q;
      if (error) { console.warn('[v31][mixed-leads]', st, error.message); return []; }
      return data || [];
    }
    const half = Math.ceil(limit / 2);
    const [semSite, comSite] = await Promise.all([
      fetchStage('attribution_whatsapp', half + 20),
      fetchStage('attribution_site', half + 20)
    ]);
    const mixed = [];
    let a = 0, b = 0;
    while (mixed.length < limit && (a < semSite.length || b < comSite.length)) {
      if (a < semSite.length) mixed.push(semSite[a++]);
      if (mixed.length < limit && b < comSite.length) mixed.push(comSite[b++]);
    }
    return mixed.slice(0, limit);
  }

  async function pullNextLead(type, excludeIds = []){
    const rows = await fetchMixedAttributionLeads(1, excludeIds);
    return rows[0] || null;
  }

  async function createPreSendBatchV31(){
    const sb = client(); if (!sb) return notifySafe('// Supabase indisponível','err');
    const date = document.getElementById('preCreateDate')?.value || preCurrentDate;
    const chipInstance = document.getElementById('preCreateChip')?.value || '';
    const chipText = document.getElementById('preCreateChip')?.selectedOptions?.[0]?.textContent || chipInstance;
    const qty = Math.max(1, Math.min(120, Number(document.getElementById('preCreateQty')?.value || 120)));
    if (!chipInstance) return notifySafe('// nenhum chip selecionado','warn');
    const { data: existing } = await sb.from('pre_dispatch_items').select('lead_id').eq('user_id', userId()).eq('scheduled_date', date).eq('chip_instance', chipInstance);
    const existingIds = new Set((existing||[]).map(x=>x.lead_id));
    const need = Math.max(0, qty - existingIds.size);
    if (need <= 0) { notifySafe('// este chip/dia já tem a quantidade solicitada','warn'); preCurrentDate = date; return renderPreEnvioPanelV31(); }
    const leads = await fetchMixedAttributionLeads(need, Array.from(existingIds));
    if (!leads?.length) return notifySafe('// não há leads suficientes na atribuição','warn');
    const rows = leads.map((lead, i) => ({
      user_id: userId(), lead_id: lead.id, chip_instance: chipInstance,
      chip_label: chipText.split('·')[0].trim(), scheduled_date: date,
      lead_type: leadStageFromData(lead) === 'attribution_site' ? 'com-site' : 'sem-site', status: 'review', position: existingIds.size + i + 1,
      raw_payload: { origin_stage: lead.current_stage }
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
    const sb = client();
    if (!sb) return notifySafe('// Supabase indisponível', 'err');
    try {
      const now = new Date().toISOString();
      const { data, error } = await sb
        .from('pre_dispatch_items')
        .update({ status:'approved', updated_at: now })
        .eq('user_id', userId())
        .eq('id', id)
        .select('id,lead_id,status')
        .maybeSingle();
      if (error) {
        console.warn('[v31][approve-pre-item-error]', error);
        return notifySafe('// erro ao aprovar: ' + error.message, 'err');
      }
      if (!data?.id) return notifySafe('// item não encontrado para aprovar', 'warn');
      if (data.lead_id) {
        const { error: leadErr } = await sb
          .from('leads')
          .update({ current_stage:'pre_send_approved', updated_at: now })
          .eq('user_id', userId())
          .eq('id', data.lead_id);
        if (leadErr) console.warn('[v31][approve-lead-stage-error]', leadErr.message);
      }
      notifySafe('✓ lead aprovado para pré-envio');
      await renderPreEnvioListV31();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
    } catch(e) {
      console.warn('[v31][approve-pre-item-exception]', e);
      notifySafe('// erro inesperado ao aprovar', 'err');
    }
  }

  async function replacePreItemV31(id){
    const sb = client(); if (!sb) return;
    const { data: item, error } = await sb
      .from('pre_dispatch_items')
      .select('*,leads(id,website,phone,normalized_phone)')
      .eq('user_id', userId())
      .eq('id', id)
      .maybeSingle();
    if (error || !item) return notifySafe('// item não encontrado','err');
    if (item.lead_id) {
      await sb.from('leads')
        .update({ current_stage: leadStageFromData(item.leads || {}), updated_at:new Date().toISOString() })
        .eq('user_id', userId())
        .eq('id', item.lead_id);
    }
    const next = await pullNextLead('mixed', [item.lead_id].filter(Boolean));
    if (!next?.id) {
      await sb.from('pre_dispatch_items').delete().eq('user_id', userId()).eq('id', id);
      notifySafe('// lead devolvido, mas não havia substituto disponível', 'warn');
      await renderPreEnvioListV31();
      return;
    }
    await sb.from('pre_dispatch_items')
      .update({
        lead_id: next.id,
        lead_type: leadStageFromData(next) === 'attribution_site' ? 'com-site' : 'sem-site',
        status:'review',
        updated_at:new Date().toISOString(),
        raw_payload:{ replaced_from:item.lead_id, reason:'manual_swap' }
      })
      .eq('user_id', userId())
      .eq('id', id);
    await sb.from('leads').update({ current_stage:'pre_send', updated_at:new Date().toISOString() }).eq('user_id', userId()).eq('id', next.id);
    notifySafe('✓ lead trocado e anterior voltou para atribuição');
    await renderPreEnvioListV31();
    if (typeof loadSupabaseLeadsToLocalState === 'function') loadSupabaseLeadsToLocalState();
  }

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

  async function returnPreEnvioDayToAttributionV31(dateIso){
    const sb = client(); if (!sb) return;
    if (!confirm(`Voltar todos os leads de ${brDayLabel(dateIso)} para atribuição?`)) return;
    const { data, error } = await sb
      .from('pre_dispatch_items')
      .select('id,lead_id,leads(id,website,phone,normalized_phone)')
      .eq('user_id', userId())
      .eq('scheduled_date', dateIso)
      .neq('status','ready_to_dispatch');
    if (error) return notifySafe('// erro ao buscar pré-envio: '+error.message,'err');
    const rows = data || [];
    for (const item of rows) {
      if (!item.lead_id) continue;
      await sb.from('leads')
        .update({ current_stage: leadStageFromData(item.leads || {}), updated_at:new Date().toISOString() })
        .eq('user_id', userId())
        .eq('id', item.lead_id);
    }
    if (rows.length) await sb.from('pre_dispatch_items').delete().eq('user_id', userId()).in('id', rows.map(x=>x.id));
    notifySafe(`✓ ${rows.length} lead(s) voltaram para atribuição`);
    prePage = 1;
    await renderPreEnvioPanelV31();
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
  window.returnPreEnvioDayToAttributionV31 = returnPreEnvioDayToAttributionV31;
  window.copyPreEnvioWhatsappV31 = copyTextSafe;
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


/* V31.1 — Atribuição DB-first final: lê exatamente os stages reais do banco. */
(function(){
  const USER_ID_FALLBACK = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';
  let currentTab = 'zap';
  let page = 1;
  const PER_PAGE = 30;
  function uid(){ try { if (window.currentUser?.id) return window.currentUser.id; if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id; return localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK; } catch(e){ return USER_ID_FALLBACK; } }
  function sb(){ try { return window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null); } catch(e){ return null; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function stage(){ return currentTab === 'com-site' ? 'attribution_site' : currentTab === 'insta' ? 'instagram_backlog' : 'attribution_whatsapp'; }
  async function countStage(st){ const c=sb(); if(!c) return 0; const {count,error}=await c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('current_stage',st); if(error){console.warn('[v31][count-stage]',st,error.message); return 0;} return count||0; }
  async function updateAtribCounts(){
    const w=await countStage('attribution_whatsapp');
    const s=await countStage('attribution_site');
    const i=await countStage('instagram_backlog');
    const badge=document.getElementById('badge-atribuicao'); if(badge) badge.textContent=String(w+s+i);
    const z=document.getElementById('atribTabZapCount'); if(z) z.textContent=`(${w})`;
    const cs=document.getElementById('atribTabComSiteCount'); if(cs) cs.textContent=`(${s})`;
    const ins=document.getElementById('atribTabInstaCount'); if(ins) ins.textContent=`(${i})`;
    const instaBadge=document.getElementById('badge-instagram'); if(instaBadge) instaBadge.textContent=String(i);
  }
  async function fetchRows(){
    const c=sb(); if(!c) return {rows:[],total:0};
    const st=stage();
    const q=(currentTab==='insta' ? (document.getElementById('atribInstaBusca')?.value||'') : (document.getElementById('atribBusca')?.value||'')).trim();
    let query=c.from('leads').select('id,company_name,phone,normalized_phone,website,instagram_url,city,state,rating,reviews_count,current_stage,created_at',{count:'exact'}).eq('user_id',uid()).eq('current_stage',st).order('created_at',{ascending:true});
    if(q){ query=query.or(`company_name.ilike.%${q.replaceAll('%','')}%,phone.ilike.%${q.replaceAll('%','')}%,normalized_phone.ilike.%${q.replaceAll('%','')}%`); }
    const from=(page-1)*PER_PAGE, to=from+PER_PAGE-1;
    const {data,count,error}=await query.range(from,to);
    if(error){ console.warn('[v31][atrib-fetch]',error.message); return {rows:[],total:0,error}; }
    return {rows:data||[],total:count||0};
  }
  async function renderAtribuicaoPanelV31(){
    await updateAtribCounts();
    const isInsta=currentTab==='insta';
    const panelZap=document.getElementById('atribPanelZap');
    const panelInsta=document.getElementById('atribPanelInsta');
    if(panelZap) panelZap.style.display=isInsta?'none':'flex';
    if(panelInsta) panelInsta.style.display=isInsta?'flex':'none';
    ['atribTabZap','atribTabComSite','atribTabInsta'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('active'); });
    const activeId=currentTab==='com-site'?'atribTabComSite':currentTab==='insta'?'atribTabInsta':'atribTabZap';
    const active=document.getElementById(activeId); if(active) active.classList.add('active');
    const list=document.getElementById(isInsta?'atribInstaList':'atribList');
    const pag=document.getElementById(isInsta?'atribInstaPagination':'atribPagination');
    const totalBadge=document.getElementById(isInsta?'atribInstaFilaTotalBadge':'atribTotalBadge');
    if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// carregando atribuição do Supabase...</div>`;
    const {rows,total,error}=await fetchRows();
    if(totalBadge) totalBadge.textContent=`${total} lead${total!==1?'s':''}`;
    if(error && list){ list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error);text-align:center;padding:32px">// erro ao carregar: ${esc(error.message)}</div>`; return; }
    if(!rows.length){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead em ${esc(stage())}</div>`; if(pag) pag.innerHTML=''; return; }
    if(list) list.innerHTML='<div class="ext-list">'+rows.map(l=>`<div class="empresa-card">
      <div class="empresa-info">
        <div class="empresa-nome">${esc(l.company_name||'Sem nome')}</div>
        <div class="empresa-meta">
          <span style="display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px;color:${currentTab==='insta'?'var(--insta)':currentTab==='com-site'?'#5bb8f5':'var(--ok)'};background:rgba(255,255,255,0.04);border:1px solid var(--border2);border-radius:4px;padding:2px 7px">${currentTab==='insta'?'📸 INSTAGRAM':currentTab==='com-site'?'🌐 COM SITE':'💬 WHATSAPP'}</span>
          <span>📱 ${esc(l.phone||l.normalized_phone||'')}</span>
          ${l.website?`<span>🌐 ${esc(String(l.website).replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</span>`:''}
          ${l.city||l.state?`<span>${esc([l.city,l.state].filter(Boolean).join('/'))}</span>`:''}
          ${l.rating?`<span>⭐ ${esc(l.rating)} · ${esc(l.reviews_count||0)} avaliações</span>`:''}
        </div>
      </div>
      <div class="empresa-actions"><button class="btn btn-primary" style="font-size:9px;padding:5px 10px" onclick="switchPanel('pre-envio')">Planejar no pré-envio</button></div>
    </div>`).join('')+'</div>';
    const totalPages=Math.max(1,Math.ceil(total/PER_PAGE));
    if(pag) pag.innerHTML=`<div style="display:flex;justify-content:center;gap:6px;margin-top:12px;font-family:'DM Mono',monospace;font-size:10px"><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.max(1,page-1)})">←</button><span style="padding:8px;color:var(--muted)">Página ${page} de ${totalPages} · ${total} leads</span><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.min(totalPages,page+1)})">→</button></div>`;
  }
  window.setAtribTab=function(tab){ currentTab=tab; page=1; renderAtribuicaoPanelV31(); };
  window.atribGoPageV31=function(p){ page=Math.max(1,p); renderAtribuicaoPanelV31(); };
  window.renderAtribuicao=renderAtribuicaoPanelV31;
  window.renderAtribuicaoPanelV31=renderAtribuicaoPanelV31;
  const prev=window.switchPanel;
  window.switchPanel=function(name){
    if(name==='atribuicao'){
      document.querySelectorAll('.panel').forEach(el=>el.classList.toggle('active',el.id==='panel-atribuicao'));
      document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',(el.getAttribute('data-label')||'')==='Atribuição'));
      renderAtribuicaoPanelV31();
      if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31();
      return;
    }
    return prev?prev(name):undefined;
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{updateAtribCounts(); if(document.getElementById('panel-atribuicao')?.classList.contains('active')) renderAtribuicaoPanelV31();},1400));
})();


/* V31.4 — Correção final de navegação Envios.
   Evita que panel-pre-envio fique ativo quando o usuário abre WhatsApp/Instagram. */
(function(){
  const previousSwitchPanelV314 = window.switchPanel;
  function activateOnlyPanel(panelId, activeLabel){
    document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === panelId));
    document.querySelectorAll('.nav-item').forEach(el => {
      const label = el.getAttribute('data-label') || '';
      el.classList.toggle('active', label === activeLabel);
    });
  }
  window.switchPanel = function switchPanelV314(name){
    if (name === 'fila-zap' || name === 'whatsapp') {
      activateOnlyPanel('panel-fila-zap', 'WhatsApp');
      if (typeof window.renderFilaZap === 'function') window.renderFilaZap();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      else if (typeof window.updateBadges === 'function') window.updateBadges();
      return;
    }
    if (name === 'instagram') {
      activateOnlyPanel('panel-instagram', 'Instagram');
      if (typeof window.renderInstagram === 'function') window.renderInstagram();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      else if (typeof window.updateBadges === 'function') window.updateBadges();
      return;
    }
    if (name === 'pre-envio') {
      activateOnlyPanel('panel-pre-envio', 'Pré-envio');
      if (typeof window.renderPreEnvioPanelV31 === 'function') window.renderPreEnvioPanelV31();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      return;
    }
    if (name === 'ja-enviados') {
      activateOnlyPanel('panel-ja-enviados', 'Já enviados');
      if (typeof window.renderSentContactsPanelV31 === 'function') window.renderSentContactsPanelV31();
      if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      return;
    }
    return previousSwitchPanelV314 ? previousSwitchPanelV314(name) : undefined;
  };
})();

/* V31.5 — Navegação blindada Envios.
   Correção específica: quando sair de Pré-envio para WhatsApp, o painel Pré-envio
   ficava visível por estado/inline/cache legado. Aqui forçamos display + active. */
(function(){
  function forcePanel(panelId, activeLabel){
    document.querySelectorAll('.panel').forEach(function(el){
      const isActive = el.id === panelId;
      el.classList.toggle('active', isActive);
      if (isActive) {
        el.style.display = 'flex';
        if (panelId === 'panel-fila-zap') {
          el.style.flexDirection = 'row';
          el.style.padding = '0';
          el.style.overflow = 'hidden';
        } else {
          el.style.flexDirection = '';
          el.style.padding = '';
          el.style.overflow = '';
        }
      } else {
        el.style.display = 'none';
      }
    });
    document.querySelectorAll('.nav-item').forEach(function(el){
      const label = el.getAttribute('data-label') || '';
      el.classList.toggle('active', label === activeLabel);
    });
  }

  function openEnvioPanelV315(name){
    if (name === 'fila-zap' || name === 'whatsapp' || name === 'WhatsApp') {
      forcePanel('panel-fila-zap', 'WhatsApp');
      setTimeout(function(){
        forcePanel('panel-fila-zap', 'WhatsApp');
        if (typeof window.renderFilaZap === 'function') window.renderFilaZap();
        if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      }, 0);
      return true;
    }
    if (name === 'pre-envio' || name === 'Pré-envio') {
      forcePanel('panel-pre-envio', 'Pré-envio');
      setTimeout(function(){
        forcePanel('panel-pre-envio', 'Pré-envio');
        if (typeof window.renderPreEnvioPanelV31 === 'function') window.renderPreEnvioPanelV31();
        if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      }, 0);
      return true;
    }
    if (name === 'instagram' || name === 'Instagram') {
      forcePanel('panel-instagram', 'Instagram');
      setTimeout(function(){
        forcePanel('panel-instagram', 'Instagram');
        if (typeof window.renderInstagram === 'function') window.renderInstagram();
        if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      }, 0);
      return true;
    }
    if (name === 'ja-enviados' || name === 'Já enviados') {
      forcePanel('panel-ja-enviados', 'Já enviados');
      setTimeout(function(){
        forcePanel('panel-ja-enviados', 'Já enviados');
        if (typeof window.renderSentContactsPanelV31 === 'function') window.renderSentContactsPanelV31();
        if (typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
      }, 0);
      return true;
    }
    return false;
  }

  const prevSwitchPanelV315 = window.switchPanel;
  window.switchPanel = function switchPanelV315(name){
    if (openEnvioPanelV315(name)) return;
    return prevSwitchPanelV315 ? prevSwitchPanelV315(name) : undefined;
  };

  document.addEventListener('click', function(ev){
    const nav = ev.target && ev.target.closest ? ev.target.closest('.nav-item[data-label]') : null;
    if (!nav) return;
    const label = nav.getAttribute('data-label') || '';
    if (['Pré-envio','WhatsApp','Instagram','Já enviados'].includes(label)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      openEnvioPanelV315(label);
    }
  }, true);

  window.forceEnvioPanelV315 = openEnvioPanelV315;
})();

/* V31.5 — Correção final: navegação Envios, aprovação do pré-envio e Fila WhatsApp DB-first. */
(function(){
  const USER_ID_FALLBACK = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';
  function uid(){
    try {
      if (window.currentUser?.id) return window.currentUser.id;
      if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id;
      return localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;
    } catch(e){ return USER_ID_FALLBACK; }
  }
  function sb(){ try { return window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null); } catch(e){ return null; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function notifySafe(msg,type){ if (typeof window.notify === 'function') window.notify(msg,type); else console.log(msg); }
  function normalizeUrl(url){ const u = String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
  function displayPhone(lead){ return String(lead?.phone || lead?.normalized_phone || '').trim(); }
  function setOnlyPanel(panelId, label){
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === panelId));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', (n.getAttribute('data-label')||'') === label));
  }

  async function fetchFinalWhatsappItems(){
    const c = sb(); if(!c) return [];
    const { data, error } = await c
      .from('pre_dispatch_items')
      .select('id,lead_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,created_at,leads(company_name,phone,normalized_phone,website,city,state)')
      .eq('user_id', uid())
      .eq('status', 'ready_to_dispatch')
      .order('scheduled_date', { ascending:true })
      .order('chip_label', { ascending:true })
      .order('position', { ascending:true });
    if(error){ console.warn('[v31.5][whatsapp-final-fetch]', error.message); return []; }
    return data || [];
  }

  window.renderFilaZap = async function renderFilaZapDbFirstV315(){
    const panel = document.getElementById('panel-fila-zap');
    if(!panel) return;
    setOnlyPanel('panel-fila-zap','WhatsApp');
    panel.innerHTML = `<div class="page-header"><div><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// fila final aprovada no pré-envio · DB-first</div></div></div><div class="card"><div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:18px">// carregando fila final...</div></div>`;
    const rows = await fetchFinalWhatsappItems();
    const badge = document.getElementById('badge-fila-zap'); if(badge) badge.textContent = String(rows.length);
    if(!rows.length){
      panel.innerHTML = `<div class="page-header"><div><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// fila final aprovada no pré-envio</div></div></div><div class="card"><div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:36px;text-align:center">// nenhum lead aprovado foi enviado para a fila WhatsApp ainda</div></div>`;
      return;
    }
    const groups = rows.reduce((acc,r)=>{ const key=`${r.scheduled_date}||${r.chip_label||r.chip_instance||'chip'}`; (acc[key] ||= []).push(r); return acc; },{});
    panel.innerHTML = `<div class="page-header"><div><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// ${rows.length} lead(s) na fila final · prontos para disparo</div></div></div>
      <div class="card"><div class="card-title">Fila final WhatsApp</div>
      ${Object.entries(groups).map(([key,items])=>{ const [date,chip]=key.split('||'); return `<div style="margin:12px 0 18px">
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--accent);margin-bottom:8px">${esc(date)} · ${esc(chip)} · ${items.length}/120</div>
        <div class="ext-list">${items.map(r=>{ const l=r.leads||{}; return `<div class="empresa-card">
          <div class="empresa-info"><div class="empresa-nome">${esc(l.company_name||'Lead sem nome')}</div>
            <div class="empresa-meta" style="gap:8px">
              ${l.website ? `<a href="${esc(normalizeUrl(l.website))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;font-weight:700">Site</a>` : `<span style="color:var(--muted)">Sem site</span>`}
              <span style="color:var(--muted)">|</span>
              <button type="button" class="link-btn" style="background:none;border:0;color:var(--ok);font:inherit;font-weight:700;cursor:pointer;padding:0" onclick="copyPreEnvioWhatsappV31('${esc(displayPhone(l))}')">WhatsApp</button>
            </div></div>
          <div class="empresa-actions"><span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--ok);border:1px solid rgba(78,203,113,.3);border-radius:6px;padding:5px 8px">FILA FINAL</span></div>
        </div>`}).join('')}</div></div>`}).join('')}
      </div>`;
  };

  window.approvePreItemV31 = async function approvePreItemV315(id){
    const c = sb(); if(!c) return notifySafe('// Supabase indisponível','err');
    const now = new Date().toISOString();
    const { data, error } = await c
      .from('pre_dispatch_items')
      .update({ status:'approved', updated_at: now })
      .eq('user_id', uid())
      .eq('id', id)
      .select('id,lead_id,status')
      .maybeSingle();
    if(error) return notifySafe('// erro ao aprovar: '+error.message,'err');
    if(!data?.id) return notifySafe('// item não encontrado','warn');
    if(data.lead_id){
      await c.from('leads').update({ current_stage:'pre_send_approved', updated_at:now }).eq('user_id',uid()).eq('id',data.lead_id);
    }
    notifySafe('✓ aprovado');
    if(typeof window.renderPreEnvioListV31 === 'function') await window.renderPreEnvioListV31();
    if(typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
  };

  window.sendApprovedToFinalQueueV31 = async function sendApprovedToFinalQueueV315(dateIso){
    const c = sb(); if(!c) return notifySafe('// Supabase indisponível','err');
    const { data, error } = await c.from('pre_dispatch_items').select('id,lead_id').eq('user_id',uid()).eq('scheduled_date',dateIso).eq('status','approved');
    if(error) return notifySafe('// erro ao liberar fila: '+error.message,'err');
    if(!data?.length) return notifySafe('// nenhum lead aprovado para liberar','warn');
    const ids = data.map(x=>x.id);
    const leadIds = data.map(x=>x.lead_id).filter(Boolean);
    const now = new Date().toISOString();
    const { error: e1 } = await c.from('pre_dispatch_items').update({ status:'ready_to_dispatch', updated_at:now }).eq('user_id',uid()).in('id',ids);
    if(e1) return notifySafe('// erro ao mover para fila: '+e1.message,'err');
    if(leadIds.length){
      const { error: e2 } = await c.from('leads').update({ current_stage:'dispatch_queue', updated_at:now }).eq('user_id',uid()).in('id',leadIds);
      if(e2) console.warn('[v31.5][lead-dispatch-stage]', e2.message);
    }
    notifySafe(`✓ ${data.length} lead(s) enviados para a fila WhatsApp`);
    if(typeof window.renderPreEnvioListV31 === 'function') await window.renderPreEnvioListV31();
    if(typeof window.updateSafeBadgesV31 === 'function') window.updateSafeBadgesV31();
  };

  const previousSwitch = window.switchPanel;
  window.switchPanel = function switchPanelV315(name){
    if(name === 'fila-zap' || name === 'whatsapp') { window.renderFilaZap(); return; }
    if(name === 'pre-envio') { setOnlyPanel('panel-pre-envio','Pré-envio'); if(typeof window.renderPreEnvioPanelV31==='function') window.renderPreEnvioPanelV31(); if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); return; }
    if(name === 'instagram') { setOnlyPanel('panel-instagram','Instagram'); if(typeof window.renderInstagram==='function') window.renderInstagram(); if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); return; }
    if(name === 'ja-enviados') { setOnlyPanel('panel-ja-enviados','Já enviados'); if(typeof window.renderSentContactsPanelV31==='function') window.renderSentContactsPanelV31(); if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); return; }
    return previousSwitch ? previousSwitch(name) : undefined;
  };

  document.addEventListener('click', function(e){
    const btn = e.target.closest('.nav-item[data-label]');
    if(!btn) return;
    const label = btn.getAttribute('data-label');
    const map = {'Pré-envio':'pre-envio','WhatsApp':'fila-zap','Instagram':'instagram','Já enviados':'ja-enviados'};
    if(map[label]){ e.preventDefault(); e.stopPropagation(); window.switchPanel(map[label]); }
  }, true);

  const style = document.createElement('style');
  style.textContent = `
    #preEnvioList .empresa-nome{font-size:14px!important;line-height:1.25!important;font-weight:600!important;}
    #preEnvioList .empresa-meta,#preEnvioList .empresa-meta a,#preEnvioList .empresa-meta button{font-size:10px!important;line-height:1.25!important;}
    #panel-fila-zap .empresa-nome{font-size:14px!important;line-height:1.25!important;font-weight:600!important;}
    #panel-fila-zap .empresa-meta,#panel-fila-zap .empresa-meta a,#panel-fila-zap .empresa-meta button{font-size:10px!important;line-height:1.25!important;}
  `;
  document.head.appendChild(style);
})();
