/* V45 — Invalidação comercial/manual + remoção imediata do pré-envio
   - Lead inválido no WhatsApp sai imediatamente do pré-envio e vai para Atribuição Instagram.
   - Pré-envio ganha botão "Invalidar lead" para descartar por motivo comercial.
   - Atribuição Instagram ganha botão "Invalidar lead".
   - Lead invalidado vai para Base Permanente como status=invalido e não volta em nova importação.
*/
(function(){
  'use strict';
  const VERSION='20260616-v45-invalidacao-pre-instagram';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined'&&currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;} }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function digits(v){ return String(v||'').replace(/\D/g,''); }
  function normPhone(v){ let d=digits(v); if(!d) return ''; if(d.startsWith('00')) d=d.slice(2); if(d.startsWith('55')) return d; if(d.length===10||d.length===11) return '55'+d; return d; }
  function cleanUrl(v){ const x=String(v||'').trim(); if(!x) return ''; return /^https?:\/\//i.test(x)?x:`https://${x}`; }
  function normalizeInstagram(v){
    let s=String(v||'').trim(); if(!s) return '';
    if(s.startsWith('@')) s=`https://instagram.com/${s.slice(1)}`;
    if(/^instagram\.com\//i.test(s)) s='https://'+s;
    return cleanUrl(s).replace(/\/$/,'');
  }
  function reasonLabel(reason){
    return ({
      site_muito_bom:'Site muito bom',
      instagram_muito_bom:'Instagram muito bom',
      empresa_grande:'Empresa grande',
      concorrente:'Concorrente',
      fora_do_perfil:'Fora do perfil',
      invalid_phone:'Número inválido',
      invalid_manual:'Inválido manual',
      outro:'Outro'
    })[reason] || reason || 'Inválido';
  }
  function chooseReason(defaultReason='fora_do_perfil'){
    const raw=prompt('Motivo da invalidação:\n\n1 - Site muito bom\n2 - Instagram muito bom\n3 - Empresa grande\n4 - Concorrente\n5 - Fora do perfil\n6 - Outro', '5');
    if(raw===null) return null;
    const map={1:'site_muito_bom',2:'instagram_muito_bom',3:'empresa_grande',4:'concorrente',5:'fora_do_perfil',6:'outro'};
    return map[String(raw).trim()] || defaultReason;
  }
  async function getLead(leadId){
    const c=sb(); if(!c||!leadId) return null;
    const {data,error}=await c.from('leads').select('*').eq('user_id',uid()).eq('id',leadId).maybeSingle();
    if(error){ console.warn('[v45][getLead]',error.message); return null; }
    return data||null;
  }
  function baseRowFromLead(lead, status, reason, source){
    const phone=normPhone(lead?.normalized_phone || lead?.phone || '');
    return {
      user_id:uid(),
      company_name:lead?.company_name || lead?.title || 'Lead sem nome',
      normalized_phone:phone || null,
      website:lead?.website || null,
      instagram_url:normalizeInstagram(lead?.instagram_url || lead?.instagram || '') || null,
      maps_url:lead?.maps_url || lead?.url || null,
      status:status || 'invalido',
      notes:`${reasonLabel(reason)} · origem: ${source || 'manual'}`,
      invalid_reason:reason || 'invalid_manual',
      invalid_source:source || 'manual',
      invalidated_at:now(),
      street:lead?.street || null,
      city:lead?.city || null,
      state:lead?.state || null,
      country_code:lead?.country_code || null,
      category:lead?.category || null,
      category_name:lead?.category_name || lead?.category || null,
      categories:Array.isArray(lead?.categories) ? lead.categories : (lead?.categories || []),
      rating:lead?.rating ?? null,
      reviews_count:lead?.reviews_count ?? null,
      raw_payload:lead?.raw_payload || {},
      updated_at:now()
    };
  }
  async function findBaseRecord(row){
    const c=sb(); if(!c) return null;
    const checks=[];
    if(row.normalized_phone) checks.push(['normalized_phone',row.normalized_phone]);
    if(row.website) checks.push(['website',row.website]);
    if(row.instagram_url) checks.push(['instagram_url',row.instagram_url]);
    if(row.maps_url) checks.push(['maps_url',row.maps_url]);
    for(const [field,value] of checks){
      const {data,error}=await c.from('base_permanente').select('*').eq('user_id',uid()).eq(field,value).limit(1);
      if(!error && data && data.length) return data[0];
    }
    return null;
  }
  function fillOnlyEmpty(existing,row){
    const patch={
      status:'invalido',
      invalid_reason:row.invalid_reason,
      invalid_source:row.invalid_source,
      invalidated_at:row.invalidated_at,
      notes: existing?.notes ? existing.notes : row.notes,
      updated_at:now()
    };
    ['company_name','normalized_phone','website','instagram_url','maps_url','street','city','state','country_code','category','category_name','rating','reviews_count'].forEach(k=>{
      if((existing?.[k]===null || existing?.[k]===undefined || existing?.[k]==='') && row[k]) patch[k]=row[k];
    });
    if((!existing?.categories || JSON.stringify(existing.categories)==='[]') && row.categories) patch.categories=row.categories;
    if((!existing?.raw_payload || JSON.stringify(existing.raw_payload)==='{}') && row.raw_payload) patch.raw_payload=row.raw_payload;
    return patch;
  }
  async function saveInvalidToBase(lead, reason='invalid_manual', source='manual'){
    const c=sb(); if(!c||!lead) return null;
    const row=baseRowFromLead(lead,'invalido',reason,source);
    const existing=await findBaseRecord(row);
    if(existing?.id){
      const patch=fillOnlyEmpty(existing,row);
      const {data,error}=await c.from('base_permanente').update(patch).eq('user_id',uid()).eq('id',existing.id).select('*').maybeSingle();
      if(error){ console.warn('[v45][base-update]',error.message); throw error; }
      return data;
    }
    const {data,error}=await c.from('base_permanente').insert({...row,created_at:now()}).select('*').maybeSingle();
    if(error){ console.warn('[v45][base-insert]',error.message); throw error; }
    return data;
  }
  async function recordInvalidEvent(lead, reason, source){
    const c=sb(); if(!c||!lead) return;
    try{
      await c.from('contact_events').insert({
        user_id:uid(), lead_id:lead.id, company_name:lead.company_name, normalized_phone:normPhone(lead.normalized_phone||lead.phone||'')||null,
        website:lead.website||null, instagram_url:normalizeInstagram(lead.instagram_url||lead.instagram||'')||null, maps_url:lead.maps_url||lead.url||null,
        channel:'manual', source_account:source||'manual', event_type:'invalidated', status:'invalido', sent_at:now(), metadata:{reason,source}
      });
    }catch(e){ console.warn('[v45][contact-event-invalid]',e?.message||e); }
  }
  async function removePreItem(id){
    const c=sb(); if(!c||!id) return;
    await c.from('pre_dispatch_items').delete().eq('user_id',uid()).eq('id',id);
  }
  async function renderAll(){
    try{ if(typeof window.renderPreEnvioListV31==='function') await window.renderPreEnvioListV31(); }catch(_){ }
    try{ if(typeof window.renderPreCompletionStatusV44==='function') await window.renderPreCompletionStatusV44(); }catch(_){ }
    try{ if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); }catch(_){ }
    try{ if(typeof window.renderAtribuicaoPanelV31==='function' && document.getElementById('panel-atribuicao')?.classList.contains('active')) await window.renderAtribuicaoPanelV31(); }catch(_){ }
  }

  async function movePreToInstagramAttribution(id, reason='manual_sem_whatsapp'){
    const c=sb(); if(!c) return notify('Supabase indisponível','err');
    const {data:item,error}=await c.from('pre_dispatch_items').select('id,lead_id,raw_payload').eq('user_id',uid()).eq('id',id).maybeSingle();
    if(error||!item?.lead_id) return notify('Item não encontrado no pré-envio','warn');
    await c.from('leads').update({current_stage:'attribution_instagram',current_status:'whatsapp_invalid',status:'whatsapp_invalid',updated_at:now(),crm_data:{whatsapp_validation:{status:'invalid',reason,moved_to:'attribution_instagram',removed_from_pre_envio:true,at:now()}}}).eq('user_id',uid()).eq('id',item.lead_id);
    await removePreItem(id);
    notify('✓ removido do pré-envio e enviado para Atribuição Instagram');
    await renderAll();
  }
  async function invalidatePreLead(id, reason='invalid_manual'){
    const c=sb(); if(!c) return notify('Supabase indisponível','err');
    const {data:item,error}=await c.from('pre_dispatch_items').select('id,lead_id').eq('user_id',uid()).eq('id',id).maybeSingle();
    if(error||!item?.lead_id) return notify('Item não encontrado no pré-envio','warn');
    const lead=await getLead(item.lead_id);
    if(!lead) return notify('Lead não encontrado','warn');
    await saveInvalidToBase(lead,reason,'pre_envio');
    await recordInvalidEvent(lead,reason,'pre_envio');
    await c.from('leads').update({current_stage:'invalid',current_status:'invalid_manual',status:'invalid',updated_at:now(),crm_data:{...(lead.crm_data||{}),invalidated:{reason,source:'pre_envio',at:now()}}}).eq('user_id',uid()).eq('id',lead.id);
    await removePreItem(id);
    notify(`✓ lead invalidado e salvo na Base Permanente (${reasonLabel(reason)})`);
    await renderAll();
  }
  async function invalidateInstagramAttribution(leadId, reason='invalid_manual'){
    const c=sb(); if(!c) return notify('Supabase indisponível','err');
    const lead=await getLead(leadId);
    if(!lead) return notify('Lead não encontrado','warn');
    await saveInvalidToBase(lead,reason,'attribution_instagram');
    await recordInvalidEvent(lead,reason,'attribution_instagram');
    await c.from('leads').update({current_stage:'invalid',current_status:'invalid_manual',status:'invalid',updated_at:now(),crm_data:{...(lead.crm_data||{}),invalidated:{reason,source:'attribution_instagram',at:now()}}}).eq('user_id',uid()).eq('id',lead.id);
    const card=document.querySelector(`[data-lead-id="${CSS.escape(leadId)}"]`); if(card) card.remove();
    notify(`✓ lead invalidado e salvo na Base Permanente (${reasonLabel(reason)})`);
    await renderAll();
  }

  const oldInvalidatePre=window.invalidatePreItemV31;
  window.invalidatePreItemV31=async function(id, reason){
    const r=String(reason||'');
    if(r==='invalid_whatsapp') return movePreToInstagramAttribution(id,'manual_sem_whatsapp');
    if(r==='invalid_phone') return invalidatePreLead(id,'invalid_phone');
    return typeof oldInvalidatePre==='function' ? oldInvalidatePre(id,reason) : invalidatePreLead(id,r||'invalid_manual');
  };
  window.invalidarLeadPreV45=async function(id){
    const reason=chooseReason('fora_do_perfil'); if(!reason) return;
    return invalidatePreLead(id,reason);
  };
  // V124: na Atribuição Instagram, Invalidar é direto como 6 - Outro, sem popup.
  window.invalidarLeadInstagramAtribV45=async function(leadId){
    return invalidateInstagramAttribution(leadId,'outro');
  };

  function injectButtons(){
    // Pré-envio: botão comercial de invalidação manual.
    document.querySelectorAll('.pre-card-item[data-pre-id]').forEach(card=>{
      if(card.querySelector('.v45-invalid-pre')) return;
      const id=card.getAttribute('data-pre-id');
      const actions=card.querySelector('.empresa-actions');
      if(actions&&id){
        const btn=document.createElement('button');
        btn.className='btn btn-ghost v45-invalid-pre';
        btn.style.cssText='font-size:9px;padding:5px 9px;border-color:rgba(255,80,80,.45);color:var(--error)';
        btn.textContent='Invalidar lead';
        btn.onclick=()=>window.invalidarLeadPreV45(id);
        actions.appendChild(btn);
      }
    });
    // Atribuição Instagram: botão para invalidar e jogar para Base Permanente.
    document.querySelectorAll('.atrib-insta-card[data-lead-id], .atrib-insta-approve-card[data-lead-id]').forEach(card=>{
      if(card.querySelector('.v45-invalid-insta')) return;
      const id=card.getAttribute('data-lead-id');
      const actions=card.querySelector('.empresa-actions') || card.querySelector('.atrib-insta-input-wrap');
      if(actions&&id){
        const btn=document.createElement('button');
        btn.className='btn btn-ghost v45-invalid-insta';
        btn.style.cssText='font-size:9px;padding:6px 10px;border-color:rgba(255,80,80,.45);color:var(--error);white-space:nowrap';
        btn.textContent='Invalidar lead';
        btn.onclick=()=>window.invalidarLeadInstagramAtribV45(id);
        actions.appendChild(btn);
      }
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{
    setInterval(injectButtons,700);
    setTimeout(injectButtons,300);
    setTimeout(injectButtons,1200);
  });
  document.addEventListener('click',()=>setTimeout(injectButtons,250),true);

  window.__V45_INVALIDACAO_PRE_INSTAGRAM__=VERSION;
})();
