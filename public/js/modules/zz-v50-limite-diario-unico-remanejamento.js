/* V50 — Limite diário por chip como fonte única + capacidade restante + remanejamento de excesso
   - Pré-envio, validação e Fila WhatsApp passam a respeitar o total diário configurado em Configurações.
   - Remove campos duplicados (Qtd por chip / Meta válida por chip) e usa blocos × disparos por bloco.
   - Ao reduzir o limite, excesso não volta automaticamente; operador decide remanejar.
   - Excesso não validado volta para atribuição; aprovado/fila vai para próximo dia disponível do mesmo chip. */
(function(){
  'use strict';
  const VERSION = '20260617-v57-preenvio-limite-chip-delay-fixo';
  const USER_ID_FALLBACK = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const state = { selectedDate:null, selectedChip:'all', rendering:false };
  function publishSelection(){
    window.__selectedPreEnvioChipV50 = state.selectedChip || 'all';
    window.__selectedPreEnvioDateV50 = state.selectedDate || null;
  }

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined'&&currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;} }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function todayIso(){const d=new Date();d.setHours(0,0,0,0);return d.toISOString().slice(0,10);}
  function addDays(iso,days){const [y,m,d]=String(iso).split('-').map(Number);const x=new Date(y,m-1,d);x.setDate(x.getDate()+days);return x.toISOString().slice(0,10);}
  function weekDates(){const d=new Date();d.setHours(0,0,0,0);const start=new Date(d);start.setDate(d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>addDays(start.toISOString().slice(0,10),i));}
  function dayLabel(iso){try{const [y,m,d]=String(iso).split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.','');}catch(_){return iso;}}
  function chipKey(ch){return String(ch?.instance||ch?.chip_id||ch?.label||ch?.id||'').trim();}
  function chipTitle(ch){return String(ch?.label||ch?.chip_id||ch?.name||ch?.instance||'chip').trim();}
  function chipConnectionState(ch){return String(ch?.connection_state||ch?.connectionState||ch?.status||'').toLowerCase();}
  function isChipConnected(ch){return ['connected','open','online','conectado','ready'].includes(chipConnectionState(ch));}
  function isChipDisconnected(ch){return !isChipConnected(ch);}
  function cleanUrl(url){ const u=String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`; }
  function phoneOf(l){ return String(l?.normalized_phone||l?.phone||'').replace(/\D/g,''); }
  function mapsUrl(l){ return cleanUrl(l?.maps_url||l?.url||''); }
  function leadName(l){ return l?.company_name||l?.title||l?.nome||'Lead'; }
  function leadNameHtml(l){ const url=mapsUrl(l); const name=esc(leadName(l)); return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="pre-card-name-link">${name}</a>`:`<span>${name}</span>`; }
  function leadTypeFromLead(l){ return String(l?.website||'').trim()?'com-site':'sem-site'; }
  function stageForLead(l){ return leadTypeFromLead(l)==='com-site'?'attribution_site':'attribution_whatsapp'; }
  function isTerminalStatus(st){ return ['sent','enviado','responded','respondida','closed','fechada','no_response','nao_respondida'].includes(String(st||'').toLowerCase()); }
  function isUnvalidatedStatus(st){ return ['review','pending_review','validation_retry','validation_error','validation_pending','pending_validation',''].includes(String(st||'').toLowerCase()); }
  function isValidatedMovableStatus(st){ return ['approved','ready_to_dispatch','queued','dispatch_queue','waiting','not_sent','ready','em_fila'].includes(String(st||'').toLowerCase()); }
  function validStatus(st){ return ['approved','ready_to_dispatch','queued','dispatch_queue','waiting','not_sent','ready','sent','enviado'].includes(String(st||'').toLowerCase()); }

  function getDispatchConfig(){
    try{
      if(typeof window.getDispatchEditableConfigV49==='function') return window.getDispatchEditableConfigV49();
    }catch(_){ }
    try{ return JSON.parse(localStorage.getItem('vs_evo_config')||'{}')||{}; }catch(_){ return {}; }
  }
  function configDailyLimit(){
    const cfg=getDispatchConfig();
    const direct=Number(cfg.dailyLimit ?? cfg.daily_limit ?? cfg.limiteDiarioPorChip ?? cfg.limite_diario_por_chip ?? 0);
    if(Number.isFinite(direct) && direct>0) return Math.max(1,Math.round(direct));
    const blockSize=Number(cfg.loteTamanho ?? cfg.disparosPorBloco ?? cfg.block_size ?? 60) || 60;
    const blockCount=Number(cfg.blocoQuantidade ?? cfg.quantidadeBlocos ?? cfg.blocks_count ?? 1) || 1;
    return Math.max(1, Math.round(blockSize*blockCount));
  }
  function chipLimit(chip){
    const raw=Number(chip?.daily_limit ?? chip?.dailyLimit ?? chip?.raw_payload?.daily_limit ?? 0);
    if(Number.isFinite(raw) && raw>0) return Math.max(1,Math.round(raw));
    return configDailyLimit();
  }
  function dailyLimit(){ return configDailyLimit(); }
  window.getDailyLimitPerChipV50 = dailyLimit;
  window.getPreEnvioDailyTargetV50 = dailyLimit;
  window.getPreEnvioChipLimitV57 = chipLimit;

  function getSelectedDate(){
    const active = document.querySelector('#preWeekCards .pre-day-card.active')?.getAttribute('data-date');
    const rootDate = document.getElementById('preEnvioRoot')?.getAttribute('data-selected-date');
    const globalDate = window.__selectedPreEnvioDateV317;
    return String(state.selectedDate || active || rootDate || globalDate || todayIso()).slice(0,10);
  }
  function setSelectedDate(date){
    const value = String(date || '').slice(0,10) || todayIso();
    state.selectedDate = value;
    window.__selectedPreEnvioDateV317 = value;
    try { document.getElementById('preEnvioRoot')?.setAttribute('data-selected-date', value); } catch(e) {}
    return value;
  }

  async function getChips(){
    const c=sb(); if(!c) return [];
    const {data,error}=await c.from('whatsapp_instances')
      .select('id,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active,daily_limit,block_size,interval_seconds')
      .eq('user_id',uid()).order('label',{ascending:true});
    if(error){ console.warn('[v50][chips]',error.message); return []; }
    return (data||[]).filter(ch=>ch.active!==false && ch.instance);
  }
  async function countDayItems(date, chip='all'){
    const c=sb(); if(!c) return 0;
    let q=c.from('pre_dispatch_items').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('scheduled_date',date);
    if(chip && chip!=='all') q=q.eq('chip_instance',chip);
    const {count,error}=await q;
    if(error){ console.warn('[v50][count-day]',error.message); return 0; }
    return count||0;
  }
  async function dayCounts(dates){
    const c=sb(); if(!c) return {};
    const {data,error}=await c.from('pre_dispatch_items').select('scheduled_date').eq('user_id',uid()).in('scheduled_date',dates);
    if(error){ console.warn('[v50][day-counts]',error.message); return {}; }
    return (data||[]).reduce((a,r)=>{a[r.scheduled_date]=(a[r.scheduled_date]||0)+1;return a;},{});
  }
  async function getPreItems(date, chip='all'){
    const c=sb(); if(!c) return [];
    let q=c.from('pre_dispatch_items')
      .select('id,lead_id,user_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,raw_payload,updated_at,leads(id,company_name,phone,normalized_phone,website,maps_url,city,state,rating,reviews_count,current_stage)')
      .eq('user_id',uid()).eq('scheduled_date',date).order('chip_label',{ascending:true}).order('position',{ascending:true});
    if(chip && chip!=='all') q=q.eq('chip_instance',chip);
    const {data,error}=await q;
    if(error){ console.warn('[v50][get-pre-items]',error.message); return []; }
    return (data||[]).map(r=>({...r,lead:r.leads||{}}));
  }
  async function fetchAttributionLeads(limit, excludeIds=[]){
    const c=sb(); if(!c||limit<=0) return [];
    async function by(stage,lim){
      let q=c.from('leads').select('*').eq('user_id',uid()).eq('current_stage',stage).order('lead_score',{ascending:false}).order('created_at',{ascending:true}).limit(lim);
      if(excludeIds.length) q=q.not('id','in',`(${excludeIds.map(x=>`"${String(x).replace(/"/g,'')}"`).join(',')})`);
      const {data,error}=await q;
      if(error){ console.warn('[v50][fetch-attr]',stage,error.message); return []; }
      // V54: aqui são LEADS, não chips. Não exigir active/instance.
    return (data||[]);
    }
    const [sem,com]=await Promise.all([by('attribution_whatsapp',limit+80),by('attribution_site',limit+80)]);
    const out=[]; let a=0,b=0;
    while(out.length<limit && (a<sem.length||b<com.length)){
      if(a<sem.length) out.push(sem[a++]);
      if(out.length<limit && b<com.length) out.push(com[b++]);
    }
    return out.slice(0,limit);
  }
  async function attributionAvailableCount(){
    const c=sb(); if(!c) return 0;
    const [a,b]=await Promise.all([
      c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('current_stage','attribution_whatsapp'),
      c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('current_stage','attribution_site')
    ]);
    return Number(a.count||0)+Number(b.count||0);
  }
  async function fetchExcess(date, chip='all'){
    const chips=chip==='all' ? await getChips() : (await getChips()).filter(ch=>chipKey(ch)===chip || chipTitle(ch)===chip);
    const out=[];
    for(const ch of chips){
      const key=chipKey(ch); if(!key) continue;
      const limit=chipLimit(ch);
      const rows=(await getPreItems(date,key)).filter(r=>!isTerminalStatus(r.status));
      rows.sort((a,b)=>(Number(a.position||0)-Number(b.position||0))||String(a.id).localeCompare(String(b.id)));
      if(rows.length>limit) out.push({chip:ch,rows,excess:rows.slice(limit),count:rows.length,limit});
    }
    return out;
  }
  async function renderExcessBanner(date){
    const host=document.getElementById('v50ExcessHost'); if(!host) return;
    const groups=await fetchExcess(date,'all');
    const total=groups.reduce((s,g)=>s+g.excess.length,0);
    if(!total){ host.innerHTML=''; return; }
    host.innerHTML=`<div class="v50-excess-card"><div><strong>Excesso detectado: ${total} lead(s)</strong><span>O limite diário foi reduzido ou há mais leads que a capacidade atual. Leads aprovados/fila serão remanejados para o próximo dia disponível; não validados voltam para atribuição.</span></div><button class="btn btn-primary" onclick="remanejarExcessoPreEnvioV50('${esc(date)}','all')">Remanejar excesso</button></div>`;
  }

  async function renderPreEnvioPanelV50(){
    const root=document.getElementById('preEnvioRoot'); if(!root) return;
    if(state.rendering) return;
    state.rendering=true;
    try{
      const chips=await getChips();
      const dates=weekDates();
      if(!state.selectedDate || !dates.includes(state.selectedDate)){
        const active=document.querySelector('#preWeekCards .pre-day-card.active')?.dataset?.date || window.__selectedPreEnvioDateV317;
        state.selectedDate = active && dates.includes(active) ? active : (dates.includes(todayIso())?todayIso():dates[0]);
      }
      setSelectedDate(state.selectedDate);
      publishSelection();
      const limit=dailyLimit();
      const connectedChips=chips.filter(isChipConnected);
      const dailyCapacity=connectedChips.reduce((sum,ch)=>sum+chipLimit(ch),0);
      const counts=await dayCounts(dates);
      root.innerHTML=`
        <div class="page-header" style="flex-shrink:0">
          <div><div class="page-title">Pré-envio <span>semanal.</span></div><div class="page-sub">// planejamento por dia · limite diário por chip como fonte única · revisão manual · retorno automático à meia-noite</div></div>
        </div>
        <div id="preWeekCards" class="pre-week-cards">
          ${dates.map(d=>`<button class="pre-day-card ${d===state.selectedDate?'active':''}" data-date="${d}" onclick="setPreEnvioDateV31('${d}')"><span>${esc(dayLabel(d))}</span><strong>${counts[d]||0}/${dailyCapacity}</strong></button>`).join('')}
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">Criar pré-envio</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <div class="v50-limit-pill"><span>Limite diário por chip</span><strong>${limit}</strong><small>${esc(describeDispatchConfig())}</small></div>
            <button class="btn btn-primary" onclick="createPreSendBatchV31()">Preencher chip</button>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:10px">Dia selecionado: <b>${esc(dayLabel(state.selectedDate))}</b>. O sistema só preenche a capacidade restante de cada chip. Ex.: limite ${limit}; se o chip já tem 40, busca ${Math.max(0,limit-40)}.</div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">Revisar dia</div>
          <div class="chip-tabs" style="margin-bottom:12px" id="preChipTabs">${await chipTabsHtml(chips,state.selectedDate)}</div>
          <div id="v50ExcessHost"></div>
          <div id="preEnvioList"></div>
        </div>`;
      syncValidationTarget();
      if(typeof window.renderPreEnvioListV31==='function') await window.renderPreEnvioListV31();
      await renderExcessBanner(state.selectedDate);
      try{ if(typeof window.renderPreCompletionStatusV44==='function') await window.renderPreCompletionStatusV44(); }catch(_){ }
    } finally { state.rendering=false; }
  }
  function describeDispatchConfig(){
    const cfg=getDispatchConfig();
    const blockSize=Number(cfg.loteTamanho ?? 60)||60;
    const blockCount=Number(cfg.blocoQuantidade ?? 2)||2;
    const delay=Number(cfg.loteEsperaMin ?? 60)||0;
    return `${blockCount} bloco${blockCount>1?'s':''} × ${blockSize} · pausa ${delay}min`;
  }
  async function chipTabsHtml(chips,date){
    const all=await countDayItems(date,'all');
    const per=[];
    for(const ch of chips){ per.push({chip:ch,count:await countDayItems(date,chipKey(ch))}); }
    return `<button class="day-tab ${state.selectedChip==='all'?'active':''}" onclick="setPreEnvioChipV31('all')">Todos (${all})</button>` + per.map(({chip,count})=>{
      const connected=isChipConnected(chip);
      const cls=`day-tab ${state.selectedChip===chipKey(chip)?'active':''} ${connected?'':'disabled'}`;
      const title=connected?'Chip conectado':'Chip desconectado: reconecte para preencher/validar/disparar';
      return `<button class="${cls}" ${connected?`onclick="setPreEnvioChipV31('${esc(chipKey(chip))}')"`:'disabled'} title="${esc(title)}">${esc(chipTitle(chip))} (${count})${connected?'':' · off'}</button>`;
    }).join('');
  }
  async function syncValidationTarget(){
    let limit=dailyLimit();
    try{
      const selected=state.selectedChip||'all';
      const chips=await getChips();
      if(selected!=='all'){ const ch=chips.find(x=>chipKey(x)===selected||chipTitle(x)===selected); if(ch) limit=chipLimit(ch); }
      else if(chips.length){ limit=chipLimit(chips[0]); }
    }catch(_){ }
    let input=document.getElementById('v39ValidateTarget');
    if(!input){ input=document.createElement('input'); input.type='hidden'; input.id='v39ValidateTarget'; document.body.appendChild(input); }
    input.value=String(limit); input.setAttribute('max','500'); input.setAttribute('type','hidden');
    const grp=input.closest?.('.field-group'); if(grp) grp.style.display='none';
    document.querySelectorAll('label').forEach(label=>{ if((label.textContent||'').toLowerCase().includes('meta válida')) label.parentElement && (label.parentElement.style.display='none'); });
  }

  async function createPreSendBatchV50(){
    const c=sb(); if(!c) return notify('// Supabase indisponível','err');
    const date=setSelectedDate(getSelectedDate());
    publishSelection();
    const allChips=await getChips();
    const selected=state.selectedChip || 'all';
    const selectedChips=selected==='all' ? allChips : allChips.filter(ch=>chipKey(ch)===selected || chipTitle(ch)===selected);
    const chips=selectedChips.filter(isChipConnected);
    if(selectedChips.length && !chips.length) return notify('// chip desconectado. Reconecte antes de preencher/validar.','warn');
    if(!chips.length) return notify('// nenhum chip conectado encontrado','warn');
    let totalCreated=0;
    const exclude=[];
    const existingAll=await getPreItems(date,'all');
    existingAll.forEach(r=>{ if(r.lead_id) exclude.push(r.lead_id); });
    for(const chip of chips){
      const key=chipKey(chip);
      const limit=chipLimit(chip);
      const existing=await getPreItems(date,key);
      const remaining=Math.max(0,limit-existing.length);
      if(remaining<=0) continue;
      const leads=await fetchAttributionLeads(remaining,exclude);
      if(!leads.length) continue;
      leads.forEach(l=>exclude.push(l.id));
      const maxPos=Math.max(0,...existing.map(r=>Number(r.position||0)));
      const rows=leads.map((lead,i)=>({
        user_id:uid(), lead_id:lead.id, chip_instance:key, chip_label:String(chip.label||key), scheduled_date:date,
        lead_type:leadTypeFromLead(lead), status:'review', position:maxPos+i+1,
        raw_payload:{ origin_stage:lead.current_stage, generated_by:'v50_capacity_remaining', daily_limit:limit }
      }));
      const {error}=await c.from('pre_dispatch_items').insert(rows);
      if(error){ console.warn('[v50][create-pre-insert]',error.message); notify('Erro ao gerar para '+chipTitle(chip)+': '+error.message,'err'); continue; }
      await c.from('leads').update({current_stage:'pre_send',updated_at:new Date().toISOString()}).eq('user_id',uid()).in('id',leads.map(l=>l.id));
      totalCreated += leads.length;
    }
    if(!totalCreated) return notify('// nenhum lead novo gerado. O dia/chip pode estar completo ou não há leads na atribuição.','warn');
    notify(`✓ ${totalCreated} lead(s) gerados respeitando o limite do(s) chip(s)`);
    await renderPreEnvioPanelV50();
    try{ if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); }catch(_){ }
  }

  async function findNextAvailableDate(chip, startDate, limit){
    for(let i=1;i<=60;i++){
      const d=addDays(startDate,i);
      const count=await countDayItems(d,chip);
      if(count<limit) return {date:d,position:count+1};
    }
    return null;
  }
  async function remanejarExcesso(date, chip='all'){
    const c=sb(); if(!c) return notify('Supabase indisponível','err');
    const groups=await fetchExcess(date,chip);
    const total=groups.reduce((s,g)=>s+g.excess.length,0);
    if(!total) return notify('Nenhum excesso encontrado.','warn');
    if(!confirm(`Remanejar ${total} lead(s) em excesso de ${dayLabel(date)}?\n\nNão validados voltam para atribuição. Aprovados/fila vão para o próximo dia disponível do mesmo chip.`)) return;
    let returned=0,moved=0,skipped=0;
    for(const group of groups){
      const key=chipKey(group.chip);
      for(const item of group.excess){
        const st=String(item.status||'').toLowerCase();
        if(isTerminalStatus(st)){ skipped++; continue; }
        if(isUnvalidatedStatus(st)){
          const stage=stageForLead(item.lead||{});
          if(item.lead_id) await c.from('leads').update({current_stage:stage,current_status:'returned_by_daily_limit',status:'returned_by_daily_limit',updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',item.lead_id);
          await c.from('pre_dispatch_items').delete().eq('user_id',uid()).eq('id',item.id);
          returned++;
          continue;
        }
        if(isValidatedMovableStatus(st)){
          const slot=await findNextAvailableDate(key,date,chipLimit(group.chip));
          if(!slot){ skipped++; continue; }
          const payload={...(item.raw_payload||{}),v50_remanejamento:{from:date,to:slot.date,reason:'daily_limit_reduced',at:new Date().toISOString(),kept_status:item.status}};
          const {error}=await c.from('pre_dispatch_items').update({scheduled_date:slot.date,position:slot.position,raw_payload:payload,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',item.id);
          if(error){ console.warn('[v50][move-excess]',error.message); skipped++; continue; }
          if(item.lead_id) await c.from('leads').update({updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',item.lead_id);
          moved++;
          continue;
        }
        skipped++;
      }
    }
    notify(`✓ excesso tratado: ${moved} remanejado(s), ${returned} voltou/voltaram para atribuição, ${skipped} mantido(s)`);
    await renderPreEnvioPanelV50();
    try{ if(typeof window.renderFilaZap==='function') window.renderFilaZap(); }catch(_){ }
  }
  window.remanejarExcessoPreEnvioV50 = remanejarExcesso;
  window.renderPreEnvioPanelV50 = renderPreEnvioPanelV50;

  async function renderPreCompletionStatusV50(){
    syncValidationTarget();
    const el=document.getElementById('v39CompleteSummary'); if(!el) return;
    const date=state.selectedDate || document.querySelector('#preWeekCards .pre-day-card.active')?.dataset?.date || todayIso();
    const selected=state.selectedChip || 'all';
    const chips=(await getChips()).filter(ch=>selected==='all'||chipKey(ch)===selected||chipTitle(ch)===selected);
    const available=await attributionAvailableCount();
    if(!chips.length){ el.innerHTML='<div class="v39-empty" style="padding:10px">// nenhum chip ativo selecionado</div>'; return; }
    const cards=[];
    for(const chip of chips){
      const limit=chipLimit(chip);
      const rows=await getPreItems(date,chipKey(chip));
      // V93: separa capacidade ocupada da lista operacional do Pré-envio.
      // Itens em fila final/enviados/erro não aparecem mais na lista, mas continuam ocupando
      // a capacidade do chip naquele dia. Assim não aparece "faltam X" quando o chip já
      // está cheio na Fila WhatsApp.
      const invalidStatuses = new Set(['invalid','invalid_whatsapp','invalid_phone','rejected','cancelled','canceled','archived','removed']);
      const retryStatuses = new Set(['validation_retry','validation_error']);
      const finalStatuses = new Set(['ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled','sending','paused','sent','enviado','enviada','error','erro','failed']);
      const invalid=rows.filter(r=>invalidStatuses.has(String(r.status||'').toLowerCase()) || String(r.status||'').toLowerCase().startsWith('invalid')).length;
      const retry=rows.filter(r=>retryStatuses.has(String(r.status||'').toLowerCase())).length;
      const finalCount=rows.filter(r=>finalStatuses.has(String(r.status||'').toLowerCase())).length;
      const operationalCount=rows.length-finalCount-invalid;
      const occupied=rows.filter(r=>{
        const st=String(r.status||'').toLowerCase();
        return !invalidStatuses.has(st) && !st.startsWith('invalid') && st!=='removed' && st!=='cancelled' && st!=='canceled';
      }).length;
      const missing=Math.max(0,limit-occupied);
      const excess=Math.max(0,occupied-limit);
      const ok=missing===0 && excess===0;
      const fullFinal = occupied>=limit && finalCount>0 && operationalCount<=0;
      const subExtra = fullFinal ? ` · ${finalCount} na fila/enviados` : (finalCount?` · ${finalCount} na fila/enviados`:``);
      const connected=isChipConnected(chip);
      cards.push(`<div class="v39-complete-card ${connected?'':'v124-chip-disabled'}"><div><div class="v39-complete-title">${esc(chipTitle(chip))}${connected?'':' · desconectado'}</div><div class="v39-complete-sub">${esc(dayLabel(date))} · total ${rows.length} · em revisão ${Math.max(0,operationalCount)} · inválidos ${invalid} · retry ${retry}${subExtra} · base disponível ${available}${excess?` · excesso ${excess}`:''}${connected?'':' · não preenche enquanto estiver desconectado'}</div></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end"><div class="v39-complete-count ${connected?(ok?'ok':'warn'):'warn'}">${occupied}/${limit}${missing?' · faltam '+missing:''}${excess?' · excesso '+excess:''}</div>${(missing&&connected)?`<button class="v39-btn primary" onclick="completePreChipNowV44('${esc(chipKey(chip))}')">Completar agora</button>`:''}${(!connected)?`<button class="v39-btn" disabled>Reconecte o chip</button>`:''}${excess?`<button class="v39-btn danger" onclick="remanejarExcessoPreEnvioV50('${esc(date)}','${esc(chipKey(chip))}')">Remanejar</button>`:''}</div></div>`);
    }
    el.innerHTML=cards.join('');
    await renderExcessBanner(date);
  }

  function hookFilaLimit(){
    const prev=window.renderFilaZap;
    window.renderFilaZap = async function(){
      const out = typeof prev==='function' ? await prev.apply(this,arguments) : undefined;
      const limit=dailyLimit();
      document.querySelectorAll('.v39-chip-count, .chip-accordion-header div[style*="white-space:nowrap"]').forEach(el=>{
        el.textContent = el.textContent.replace(/\/(\d+)(\s*·|\))/g, `/${limit}$2`);
      });
      return out;
    };
    window.renderFilaZapV39 = window.renderFilaZap;
    window.renderFilaZapV33 = window.renderFilaZap;
    window.renderFilaZapV32 = window.renderFilaZap;
  }

  function install(){
    const prevRenderList=window.renderPreEnvioListV31;
    window.renderPreEnvioPanelV31=renderPreEnvioPanelV50;
    window.createPreSendBatchV31=createPreSendBatchV50;
    window.renderPreCompletionStatusV44=renderPreCompletionStatusV50;
    window.setPreEnvioDateV31=function(d){
      setSelectedDate(d);
      state.selectedChip='all';
      publishSelection();
      try {
        document.querySelectorAll('#preWeekCards .pre-day-card').forEach(btn=>btn.classList.toggle('active', btn.getAttribute('data-date')===state.selectedDate));
      } catch(e) {}
      renderPreEnvioPanelV50();
    };
    window.setPreEnvioChipV31=function(ch){ state.selectedChip=ch||'all'; publishSelection(); renderPreEnvioPanelV50(); };
    window.__V50_PREENVIO_LIMIT__=VERSION;
    const prevSave=window.saveDispatchEditableConfigV49;
    if(typeof prevSave==='function' && !prevSave.__v50wrapped){
      const wrapped=function(){ const cfg=prevSave.apply(this,arguments); syncValidationTarget(); setTimeout(()=>{ if(document.getElementById('panel-pre-envio')?.classList.contains('active')) renderPreEnvioPanelV50(); try{ if(typeof window.renderFilaZap==='function'&&document.getElementById('panel-fila-zap')?.classList.contains('active')) window.renderFilaZap(); }catch(_){ } },80); return cfg; };
      wrapped.__v50wrapped=true; window.saveDispatchEditableConfigV49=wrapped;
    }
    if(!window.__V50_FILA_LIMIT_HOOKED__){ window.__V50_FILA_LIMIT_HOOKED__=true; hookFilaLimit(); }
    setTimeout(()=>{ syncValidationTarget(); if(document.getElementById('panel-pre-envio')?.classList.contains('active')) renderPreEnvioPanelV50(); },250);
    setTimeout(()=>{ syncValidationTarget(); },1000);
  }
  document.addEventListener('DOMContentLoaded',()=>{ install(); setTimeout(install,500); setTimeout(install,1500); });
  if(document.readyState!=='loading') install();
})();
