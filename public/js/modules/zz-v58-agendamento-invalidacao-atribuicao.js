/* V58 — Agendamento/manual de pré-envio + invalidação na Atribuição com site
   - Permite mover aprovados/prontos de um dia para outro sem perder chip, validação ou status.
   - Botão na tela de Pré-envio: "Mover aprovados para outro dia".
   - Botão na Atribuição > Com site: "Invalidar lead", salvando na Base Permanente.
   - Não cria tabela nova; usa leads, pre_dispatch_items, base_permanente e contact_events existentes. */
(function(){
  'use strict';
  const VERSION='20260617-v58-agendamento-invalidacao-atribuicao';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined'&&currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;} }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function digits(v){ return String(v||'').replace(/\D/g,''); }
  function normPhone(v){ let d=digits(v); if(!d) return ''; if(d.startsWith('00')) d=d.slice(2); if(d.startsWith('55')) return d; if(d.length===10||d.length===11) return '55'+d; return d; }
  function cleanUrl(v){ const x=String(v||'').trim(); if(!x) return ''; return /^https?:\/\//i.test(x)?x:`https://${x}`; }
  function normalizeInstagram(v){ let s=String(v||'').trim(); if(!s) return ''; if(s.startsWith('@')) s=`https://instagram.com/${s.slice(1)}`; if(/^instagram\.com\//i.test(s)) s='https://'+s; return cleanUrl(s).replace(/\/$/,''); }
  function todayIso(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
  function addDays(iso,days){ const [y,m,d]=String(iso||todayIso()).slice(0,10).split('-').map(Number); const x=new Date(y,m-1,d); x.setDate(x.getDate()+days); return x.toISOString().slice(0,10); }
  function dayLabel(iso){ try{const [y,m,d]=String(iso).slice(0,10).split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.','');}catch(_){return iso;} }
  function chipKey(ch){ return String(ch?.instance||ch?.chip_id||ch?.label||ch?.id||'').trim(); }
  function chipTitle(ch){ return String(ch?.label||ch?.chip_id||ch?.name||ch?.instance||'chip').trim(); }
  function getSelectedDate(){ return String(window.__selectedPreEnvioDateV50 || window.__selectedPreEnvioDateV317 || document.getElementById('preEnvioRoot')?.getAttribute('data-selected-date') || document.querySelector('#preWeekCards .pre-day-card.active')?.getAttribute('data-date') || todayIso()).slice(0,10); }
  function getSelectedChip(){ return String(window.__selectedPreEnvioChipV50 || 'all'); }
  function dailyLimit(){ try{ if(typeof window.getDailyLimitPerChipV50==='function') return Number(window.getDailyLimitPerChipV50())||120; }catch(_){} try{ const cfg=JSON.parse(localStorage.getItem('vs_evo_config')||'{}'); return Number(cfg.dailyLimit||cfg.daily_limit||cfg.limiteDiarioPorChip)||120; }catch(_){ return 120; } }
  function chipLimit(chip){ try{ if(typeof window.getPreEnvioChipLimitV57==='function') return Number(window.getPreEnvioChipLimitV57(chip))||dailyLimit(); }catch(_){} return Number(chip?.daily_limit||chip?.dailyLimit)||dailyLimit(); }
  function movableStatus(st){ return ['approved','ready_to_dispatch','queued','dispatch_queue','waiting','not_sent','ready','em_fila'].includes(String(st||'').toLowerCase()); }
  function reasonLabel(reason){ return ({site_muito_bom:'Site muito bom',instagram_muito_bom:'Instagram muito bom',empresa_grande:'Empresa grande',concorrente:'Concorrente',fora_do_perfil:'Fora do perfil',invalid_phone:'Número inválido',invalid_manual:'Inválido manual',outro:'Outro'})[reason] || reason || 'Inválido'; }
  function chooseReason(defaultReason='site_muito_bom'){
    const raw=prompt('Motivo da invalidação:\n\n1 - Site muito bom\n2 - Instagram muito bom\n3 - Empresa grande\n4 - Concorrente\n5 - Fora do perfil\n6 - Outro','1');
    if(raw===null) return null;
    const map={1:'site_muito_bom',2:'instagram_muito_bom',3:'empresa_grande',4:'concorrente',5:'fora_do_perfil',6:'outro'};
    return map[String(raw).trim()] || defaultReason;
  }
  async function getChips(){
    const c=sb(); if(!c) return [];
    const {data,error}=await c.from('whatsapp_instances').select('id,chip_id,label,name,instance,active,daily_limit').eq('user_id',uid()).order('label',{ascending:true});
    if(error){ console.warn('[v58][chips]',error.message); return []; }
    return (data||[]).filter(ch=>ch.active!==false && ch.instance);
  }
  async function countDayChip(date,chip){
    const c=sb(); if(!c) return 0;
    const {count,error}=await c.from('pre_dispatch_items').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('scheduled_date',date).eq('chip_instance',chip);
    if(error){ console.warn('[v58][count-day-chip]',error.message); return 0; }
    return count||0;
  }
  async function getMovableItems(date, chip='all'){
    const c=sb(); if(!c) return [];
    let q=c.from('pre_dispatch_items')
      .select('id,lead_id,user_id,chip_instance,chip_label,scheduled_date,status,position,raw_payload,leads(id,company_name,phone,normalized_phone,website,maps_url,instagram_url,city,state,rating,reviews_count,current_stage,crm_data,raw_payload)')
      .eq('user_id',uid()).eq('scheduled_date',date).order('chip_label',{ascending:true}).order('position',{ascending:true});
    if(chip && chip!=='all') q=q.eq('chip_instance',chip);
    const {data,error}=await q;
    if(error){ console.warn('[v58][movable-items]',error.message); notify('// erro ao buscar aprovados: '+error.message,'err'); return []; }
    return (data||[]).filter(r=>movableStatus(r.status));
  }
  function groupByChip(rows){ return rows.reduce((acc,r)=>{ const k=String(r.chip_instance||''); if(!acc[k]) acc[k]=[]; acc[k].push(r); return acc; },{}); }

  async function moveApprovedToDateV58(fromDateArg, chipArg){
    const c=sb(); if(!c) return notify('Supabase indisponível','err');
    const fromDate=String(fromDateArg||getSelectedDate()).slice(0,10);
    const selected=chipArg || getSelectedChip() || 'all';
    const defaultDest=addDays(fromDate,1);
    const destRaw=prompt(`Mover aprovados/prontos de ${dayLabel(fromDate)} para qual data?\n\nUse AAAA-MM-DD.`, defaultDest);
    if(destRaw===null) return;
    const dest=String(destRaw||'').trim().slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dest)) return notify('// data inválida. Use AAAA-MM-DD.','warn');
    if(dest===fromDate) return notify('// escolha uma data diferente da origem.','warn');
    const rows=await getMovableItems(fromDate,selected);
    if(!rows.length) return notify('// nenhum lead aprovado/pronto para mover nesta seleção.','warn');
    const chips=await getChips();
    const chipsByKey=Object.fromEntries(chips.map(ch=>[chipKey(ch),ch]));
    const grouped=groupByChip(rows);
    const preview=[];
    let movableTotal=0;
    for(const [key,items] of Object.entries(grouped)){
      const ch=chipsByKey[key] || {instance:key,label:key};
      const limit=chipLimit(ch);
      const existing=await countDayChip(dest,key);
      const available=Math.max(0,limit-existing);
      const move=Math.min(available,items.length);
      movableTotal+=move;
      preview.push(`${chipTitle(ch)}: ${move}/${items.length} mover · destino ${existing}/${limit}${items.length>available?' · sem vaga '+(items.length-available):''}`);
    }
    if(!movableTotal) return notify('// destino sem vagas para os chips selecionados.','warn');
    const ok=confirm(`Remanejar para ${dayLabel(dest)}?\n\n${preview.join('\n')}\n\nStatus, chip e validação serão mantidos. Só a data/posição será alterada.`);
    if(!ok) return;
    let moved=0, skipped=0;
    for(const [key,items] of Object.entries(grouped)){
      const ch=chipsByKey[key] || {instance:key,label:key};
      const limit=chipLimit(ch);
      let pos=await countDayChip(dest,key);
      let available=Math.max(0,limit-pos);
      for(const item of items){
        if(available<=0){ skipped++; continue; }
        pos += 1; available -= 1;
        const payload={...(item.raw_payload||{}),v58_remanejamento:{from:fromDate,to:dest,reason:'manual_schedule_to_dispatch_day',kept_status:item.status,chip:key,at:now()}};
        const {error}=await c.from('pre_dispatch_items').update({scheduled_date:dest,position:pos,raw_payload:payload,updated_at:now()}).eq('user_id',uid()).eq('id',item.id);
        if(error){ console.warn('[v58][move-day]',error.message); skipped++; continue; }
        moved++;
      }
    }
    notify(`✓ ${moved} lead(s) movido(s) para ${dayLabel(dest)}${skipped?` · ${skipped} sem vaga`:''}`);
    try{ if(typeof window.renderPreEnvioPanelV50==='function') await window.renderPreEnvioPanelV50(); else if(typeof window.renderPreEnvioPanelV31==='function') await window.renderPreEnvioPanelV31(); }catch(_){ }
    try{ if(typeof window.renderFilaZap==='function' && document.getElementById('panel-fila-zap')?.classList.contains('active')) await window.renderFilaZap(); }catch(_){ }
  }

  async function getLead(id){ const c=sb(); if(!c||!id) return null; const {data,error}=await c.from('leads').select('*').eq('user_id',uid()).eq('id',id).maybeSingle(); if(error){ console.warn('[v58][getLead]',error.message); return null; } return data||null; }
  function baseRowFromLead(lead, reason, source){
    return {
      user_id:uid(), company_name:lead?.company_name || lead?.title || 'Lead sem nome', normalized_phone:normPhone(lead?.normalized_phone||lead?.phone||'')||null,
      website:lead?.website||null, instagram_url:normalizeInstagram(lead?.instagram_url||lead?.instagram||'')||null, maps_url:lead?.maps_url||lead?.url||null,
      status:'invalido', notes:`${reasonLabel(reason)} · origem: ${source}`, invalid_reason:reason||'invalid_manual', invalid_source:source||'attribution_site', invalidated_at:now(),
      street:lead?.street||null, city:lead?.city||null, state:lead?.state||null, country_code:lead?.country_code||null, category:lead?.category||null, category_name:lead?.category_name||lead?.category||null,
      categories:Array.isArray(lead?.categories)?lead.categories:(lead?.categories||[]), rating:lead?.rating??null, reviews_count:lead?.reviews_count??null, raw_payload:lead?.raw_payload||{}, updated_at:now()
    };
  }
  async function findBase(row){
    const c=sb(); if(!c) return null;
    const checks=[]; if(row.normalized_phone) checks.push(['normalized_phone',row.normalized_phone]); if(row.website) checks.push(['website',row.website]); if(row.instagram_url) checks.push(['instagram_url',row.instagram_url]); if(row.maps_url) checks.push(['maps_url',row.maps_url]);
    for(const [field,value] of checks){ const {data,error}=await c.from('base_permanente').select('*').eq('user_id',uid()).eq(field,value).limit(1); if(!error && data?.length) return data[0]; }
    return null;
  }
  function fillOnlyEmpty(existing,row){
    const patch={status:'invalido',invalid_reason:row.invalid_reason,invalid_source:row.invalid_source,invalidated_at:row.invalidated_at,notes:existing?.notes?existing.notes:row.notes,updated_at:now()};
    ['company_name','normalized_phone','website','instagram_url','maps_url','street','city','state','country_code','category','category_name','rating','reviews_count'].forEach(k=>{ if((existing?.[k]===null||existing?.[k]===undefined||existing?.[k]==='') && row[k]) patch[k]=row[k]; });
    if((!existing?.categories || JSON.stringify(existing.categories)==='[]') && row.categories) patch.categories=row.categories;
    if((!existing?.raw_payload || JSON.stringify(existing.raw_payload)==='{}') && row.raw_payload) patch.raw_payload=row.raw_payload;
    return patch;
  }
  async function saveInvalidToBase(lead,reason,source){
    const c=sb(); if(!c||!lead) return null;
    const row=baseRowFromLead(lead,reason,source);
    const existing=await findBase(row);
    if(existing?.id){ const {data,error}=await c.from('base_permanente').update(fillOnlyEmpty(existing,row)).eq('user_id',uid()).eq('id',existing.id).select('*').maybeSingle(); if(error) throw error; return data; }
    const {data,error}=await c.from('base_permanente').insert({...row,created_at:now()}).select('*').maybeSingle(); if(error) throw error; return data;
  }
  async function recordInvalidEvent(lead,reason,source){
    const c=sb(); if(!c||!lead) return;
    try{ await c.from('contact_events').insert({user_id:uid(),lead_id:lead.id,company_name:lead.company_name,normalized_phone:normPhone(lead.normalized_phone||lead.phone||'')||null,website:lead.website||null,instagram_url:normalizeInstagram(lead.instagram_url||lead.instagram||'')||null,maps_url:lead.maps_url||lead.url||null,channel:'manual',source_account:source,event_type:'invalidated',status:'invalido',sent_at:now(),metadata:{reason,source,origin:'v58_attribution_invalidation'}}); }catch(e){ console.warn('[v58][invalid-event]',e?.message||e); }
  }
  async function invalidarLeadAtribuicaoV58(leadId){
    const c=sb(); if(!c) return notify('Supabase indisponível','err');
    const reason=chooseReason('site_muito_bom'); if(!reason) return;
    const lead=await getLead(leadId); if(!lead) return notify('Lead não encontrado','warn');
    await saveInvalidToBase(lead,reason,'attribution_site');
    await recordInvalidEvent(lead,reason,'attribution_site');
    await c.from('leads').update({current_stage:'invalid',current_status:'invalid_manual',status:'invalid',updated_at:now(),crm_data:{...(lead.crm_data||{}),invalidated:{reason,source:'attribution_site',at:now()}}}).eq('user_id',uid()).eq('id',lead.id);
    const card=document.querySelector(`[data-lead-id="${CSS.escape(leadId)}"]`); if(card) card.remove();
    notify(`✓ lead invalidado e salvo na Base Permanente (${reasonLabel(reason)})`);
    try{ if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31(); }catch(_){ }
    try{ if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); }catch(_){ }
  }

  function injectMoveButton(){
    const panel=document.getElementById('panel-pre-envio'); if(!panel) return;
    const btnFinal=[...panel.querySelectorAll('button')].find(b=>(b.textContent||'').includes('Enviar aprovados para fila final'));
    if(!btnFinal || panel.querySelector('#v58MoveApprovedDayBtn')) return;
    const btn=document.createElement('button');
    btn.id='v58MoveApprovedDayBtn'; btn.className='btn btn-ghost';
    btn.style.cssText='font-size:10px;padding:8px 12px;margin-left:8px;border-color:rgba(181,255,74,.35);color:var(--lime,#b5ff4a)';
    btn.textContent='Mover aprovados para outro dia';
    btn.onclick=function(e){ e.preventDefault(); e.stopPropagation(); moveApprovedToDateV58(getSelectedDate(),getSelectedChip()); return false; };
    btnFinal.parentElement.insertBefore(btn, btnFinal);
  }
  function injectAttributionInvalidButtons(){
    const panel=document.getElementById('panel-atribuicao'); if(!panel) return;
    panel.querySelectorAll('.atrib-clean-card[data-lead-id], .atrib-vfinal-card[data-lead-id]').forEach(card=>{
      if(card.querySelector('.v58-invalid-atrib')) return;
      const txt=(card.textContent||'').toUpperCase();
      if(!txt.includes('COM SITE')) return;
      const id=card.getAttribute('data-lead-id'); if(!id) return;
      let actions=card.querySelector('.empresa-actions');
      if(!actions){ actions=document.createElement('div'); actions.className='empresa-actions'; card.appendChild(actions); }
      const btn=document.createElement('button');
      btn.className='btn btn-ghost v58-invalid-atrib';
      btn.style.cssText='font-size:9px;padding:6px 10px;border-color:rgba(255,80,80,.45);color:var(--error);white-space:nowrap';
      btn.textContent='Invalidar lead';
      btn.onclick=function(e){ e.preventDefault(); e.stopPropagation(); invalidarLeadAtribuicaoV58(id); return false; };
      actions.appendChild(btn);
    });
  }
  function inject(){ injectMoveButton(); injectAttributionInvalidButtons(); }

  window.moveApprovedPreEnvioToDateV58=moveApprovedToDateV58;
  window.invalidarLeadAtribuicaoV58=invalidarLeadAtribuicaoV58;
  window.__V58_AGENDAMENTO_INVALIDACAO__=VERSION;

  document.addEventListener('DOMContentLoaded',()=>{ setInterval(inject,700); setTimeout(inject,250); setTimeout(inject,1200); });
  document.addEventListener('click',()=>setTimeout(inject,250),true);
  if(document.readyState!=='loading') setTimeout(inject,100);
})();
