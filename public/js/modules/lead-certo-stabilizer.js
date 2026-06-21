/* Lead Certo V132 — estabilizador final sem ZZ.
   Objetivo: parar sobrescrita de legado e fechar ações críticas:
   - Pré-envio: voltar dia/item para atribuição com regra correta.
   - Atribuição: invalidar sempre 6 - Outro sem redirect.
   - Atribuição Instagram: aprovar -> backlog, sem fila direta/redirect.
   Este arquivo deve ser carregado por último. */
(function(){
  'use strict';
  const VERSION='20260621-V132-LEAD-CERTO-STABILIZER';
  const running=new Set();

  function db(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function uid(){ return window.currentUser?.id || window.authUser?.id || localStorage.getItem('vs_auth_local_user_v423') || ''; }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function escCss(v){ try{return CSS.escape(String(v));}catch(_){return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');} }
  function normPhone(v){ let d=String(v||'').replace(/\D/g,''); if(!d) return ''; if(d.startsWith('55')) return d; if(d.length===10||d.length===11) return '55'+d; return d; }
  function cleanIg(raw){
    let s=String(raw||'').trim().replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/^@+/,'');
    if(!s) return '';
    s=s.replace(/[?#].*$/,'');
    let v=s;
    try{ let ustr=s; if(/^instagram\.com\//i.test(ustr)) ustr='https://www.'+ustr; if(/^www\.instagram\.com\//i.test(ustr)) ustr='https://'+ustr; const u=new URL(ustr); if(String(u.hostname||'').replace(/^www\./i,'').toLowerCase()==='instagram.com') v=String(u.pathname||'').split('/').filter(Boolean)[0]||''; }catch(_){ v=s.replace(/^https?:\/\//i,'').replace(/^www\.instagram\.com\//i,'').replace(/^instagram\.com\//i,'').split('/')[0]; }
    v=String(v||'').trim().replace(/^@+/,'').split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
    const bad=new Set(['','instagram','instagram.com','www.instagram.com','www','com','p','reel','reels','stories','story','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if(bad.has(v) || v.length<2 || v.length>30 || /^\.+$/.test(v)) return '';
    return v;
  }
  function igUrl(x){ const u=cleanIg(x); return u ? `https://www.instagram.com/${u}/` : ''; }
  function leadStageFromItem(item,lead){
    const raw=item?.raw_payload||{};
    const original=raw.origin_stage || raw.from_stage || raw.previous_stage;
    if(original && !['pre_send','pre-envio','ready_to_dispatch'].includes(String(original))) return original;
    const type=String(item?.lead_type || lead?.lead_type || '').toLowerCase();
    const wt=String(lead?.website_type||'').toLowerCase();
    if(type.includes('agreg') || wt.includes('agreg')) return 'attribution_aggregator_approved';
    if(type.includes('site') || lead?.has_own_site || lead?.website) return 'attribution_site_approved';
    return 'attribution_whatsapp';
  }
  function cardOf(el){ return el?.closest?.('[data-lead-id],.empresa-card,.lead-card,.atrib-clean-card,.atrib-vfinal-card,.atrib-insta-card,.atrib-insta-approve-card'); }
  function leadIdFrom(el){ const c=cardOf(el); if(c?.dataset?.leadId) return String(c.dataset.leadId); const raw=String(el?.getAttribute?.('onclick')||'')+' '+String(c?.id||''); const m=raw.match(/([0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}|[A-Za-z0-9_-]{12,})/); return m?m[1]:''; }
  function inputIn(card){ return card?.querySelector?.('input[id^="atrib-insta-url-"]'); }

  async function saveInvalidToBase(lead,source){
    const c=db(), user=uid(); if(!c||!user||!lead) return;
    const username=cleanIg(lead.instagram_username||lead.instagram_url||lead.instagram||'');
    const row={
      user_id:user, company_name:lead.company_name||'Lead sem nome', phone:lead.phone||null, normalized_phone:normPhone(lead.normalized_phone||lead.phone||'')||null,
      website:lead.website||null, website_domain:lead.website_domain||null, instagram_url:igUrl(username)||lead.instagram_url||lead.instagram||null, instagram_username:username||null,
      maps_url:lead.maps_url||null, status:'invalidado', source:source||'attribution', notes:'6 - Outro', last_contact_at:now(), raw_payload:{lead_id:lead.id,reason:'outro',reason_code:6,origin:VERSION},
      street:lead.street||null, city:lead.city||null, state:lead.state||null, country_code:lead.country_code||null, category:lead.category||null, category_name:lead.category_name||lead.parent_category||lead.category||null,
      categories:Array.isArray(lead.categories)?lead.categories:(lead.categories||[]), rating:lead.rating??null, reviews_count:lead.reviews_count??null, last_channel:String(source||'').includes('instagram')?'instagram':null,
      sent_channels:[], last_event_type:'invalidated', last_event_status:'invalidado', invalid_reason:'outro', invalid_source:source||'attribution', invalidated_at:now(), updated_at:now()
    };
    let existing=null;
    for(const [field,val] of [['normalized_phone',row.normalized_phone],['instagram_username',row.instagram_username],['instagram_url',row.instagram_url],['maps_url',row.maps_url]]){
      if(!val) continue; try{ const {data}=await c.from('base_permanente').select('id').eq('user_id',user).eq(field,val).limit(1); if((data||[])[0]){ existing=data[0]; break; } }catch(_){ }
    }
    if(existing?.id) await c.from('base_permanente').update(row).eq('user_id',user).eq('id',existing.id); else await c.from('base_permanente').insert({...row,created_at:now()});
    try{ await c.from('contact_events').insert({user_id:user,lead_id:String(lead.id),company_name:lead.company_name||null,normalized_phone:row.normalized_phone,website:lead.website||null,instagram_url:row.instagram_url,maps_url:lead.maps_url||null,channel:row.last_channel||'manual',source_instance:source||'attribution',event_type:'invalidated',status:'invalidado',sent_at:now(),metadata:{reason:'outro',reason_code:6,origin:VERSION}}); }catch(_){ }
  }

  async function invalidateAttributionLead(id,source){
    const c=db(), user=uid(); id=String(id||'').trim(); if(!c||!user||!id) return notify('Supabase/auth indisponível.','err');
    const key='inv:'+id; if(running.has(key)) return; running.add(key);
    try{
      const {data:lead,error}=await c.from('leads').select('*').eq('user_id',user).eq('id',id).maybeSingle(); if(error) throw error; if(!lead) return notify('Lead não encontrado.','warn');
      await saveInvalidToBase(lead,source||'attribution');
      await c.from('pre_dispatch_items').delete().eq('user_id',user).eq('lead_id',id);
      await c.from('instagram_dispatch_items').update({status:'invalidated',error_message:'6 - Outro',updated_at:now(),last_action_at:now()}).eq('user_id',user).eq('lead_id',id).in('status',['scheduled','queued','review','error','failed']);
      const {error:e}=await c.from('leads').update({current_stage:'invalid',current_status:'invalid_manual',pipeline_status:'invalidated',status:'invalid',rejected_reason:'outro',rejected_at:now(),archived_at:now(),updated_at:now()}).eq('user_id',user).eq('id',id); if(e) throw e;
      document.querySelectorAll(`[data-lead-id="${escCss(id)}"],#atrib-insta-card-${escCss(id)}`).forEach(x=>x.remove());
      notify('✓ Lead invalidado como 6 - Outro.');
    }catch(e){ notify('Erro ao invalidar: '+(e?.message||e),'err'); }
    finally{ running.delete(key); }
  }

  async function approveInstagramToBacklog(id,rawIg){
    const c=db(), user=uid(); id=String(id||'').trim(); if(!c||!user||!id) return notify('Supabase/auth indisponível.','err');
    const key='igapp:'+id; if(running.has(key)) return; running.add(key);
    try{
      const {data:lead,error}=await c.from('leads').select('*').eq('user_id',user).eq('id',id).maybeSingle(); if(error) throw error; if(!lead) return notify('Lead não encontrado.','warn');
      const username=cleanIg(rawIg || lead.instagram_username || lead.instagram_url || lead.instagram || ''); if(!username) return notify('Cole um Instagram válido com perfil real.','warn');
      const url=igUrl(username);
      const {data:dup}=await c.from('instagram_dispatch_items').select('id,status').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).neq('lead_id',id).limit(1);
      if((dup||[]).some(x=>!['invalidated','invalidado','error','failed'].includes(String(x.status||'').toLowerCase()))) return notify('Instagram já existe em fila/backlog: @'+username,'warn');
      const {data:base}=await c.from('base_permanente').select('id,status').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).limit(1);
      if((base||[])[0]) return notify('Instagram já está na Base Permanente: @'+username,'warn');
      await c.from('leads').update({instagram_url:url,instagram_username:username,instagram:url,current_stage:'instagram_backlog',current_status:'instagram_confirmed',lead_channel:'instagram',updated_at:now()}).eq('user_id',user).eq('id',id);
      document.querySelectorAll(`[data-lead-id="${escCss(id)}"],#atrib-insta-card-${escCss(id)}`).forEach(x=>x.remove());
      notify('✓ Lead enviado para Backlog Instagram.');
    }catch(e){ notify('Erro ao aprovar Instagram: '+(e?.message||e),'err'); }
    finally{ running.delete(key); }
  }

  async function returnPreEnvioDayToAttributionV31(dateIso){
    const c=db(), user=uid(); if(!c||!user) return notify('Supabase/auth indisponível.','err');
    const date=String(dateIso||window.preCurrentDate||document.querySelector('.pre-day-card.active')?.dataset?.date||new Date().toISOString().slice(0,10)).slice(0,10);
    const key='retday:'+date; if(running.has(key)) return; running.add(key);
    try{
      const {data:items,error}=await c.from('pre_dispatch_items').select('id,lead_id,lead_type,raw_payload,leads(*)').eq('user_id',user).eq('scheduled_date',date);
      if(error) throw error;
      const rows=items||[]; if(!rows.length) return notify('// nenhum lead no pré-envio desse dia','warn');
      for(const item of rows){
        const lead=item.leads||{}; const stage=leadStageFromItem(item,lead);
        await c.from('leads').update({current_stage:stage,current_status: stage.includes('approved')?'approved_for_pre_dispatch':'new',updated_at:now()}).eq('user_id',user).eq('id',item.lead_id);
      }
      await c.from('pre_dispatch_items').delete().eq('user_id',user).in('id',rows.map(r=>r.id));
      notify(`✓ ${rows.length} lead(s) voltaram para Atribuição.`);
      try{ if(typeof window.renderPreEnvioPanelV31==='function') await window.renderPreEnvioPanelV31(); }catch(_){ }
      try{ if(typeof window.renderAtribuicaoPanelFinal==='function') await window.renderAtribuicaoPanelFinal(); }catch(_){ }
    }catch(e){ notify('Erro ao voltar para atribuição: '+(e?.message||e),'err'); }
    finally{ running.delete(key); }
  }

  async function returnPreEnvioItemToAttribution(id){
    const c=db(), user=uid(); id=String(id||'').trim(); if(!c||!user||!id) return notify('Supabase/auth indisponível.','err');
    const key='retitem:'+id; if(running.has(key)) return; running.add(key);
    try{
      const {data:item,error}=await c.from('pre_dispatch_items').select('id,lead_id,lead_type,raw_payload,leads(*)').eq('user_id',user).eq('id',id).maybeSingle(); if(error) throw error; if(!item) return notify('Item não encontrado.','warn');
      const stage=leadStageFromItem(item,item.leads||{});
      await c.from('leads').update({current_stage:stage,current_status:stage.includes('approved')?'approved_for_pre_dispatch':'new',updated_at:now()}).eq('user_id',user).eq('id',item.lead_id);
      await c.from('pre_dispatch_items').delete().eq('user_id',user).eq('id',id);
      document.querySelectorAll(`[data-pre-id="${escCss(id)}"],[data-item-id="${escCss(id)}"]`).forEach(x=>x.remove());
      notify('✓ Lead voltou para Atribuição.');
    }catch(e){ notify('Erro ao voltar item: '+(e?.message||e),'err'); }
    finally{ running.delete(key); }
  }

  // Expor nomes usados pelo legado, mas com regra correta.
  window.returnPreEnvioDayToAttributionV31=returnPreEnvioDayToAttributionV31;
  window.returnPreEnvioDayToAttribution=returnPreEnvioDayToAttributionV31;
  window.returnPreEnvioItemToAttribution=returnPreEnvioItemToAttribution;
  window.invalidateAttributionLeadV132=invalidateAttributionLead;
  window.approveInstagramAttributionV31=function(id){ const input=document.getElementById('atrib-insta-url-'+id); return approveInstagramToBacklog(id,input?.value); };
  window.approveInstagramAttributionSafe=function(id,ig){ return approveInstagramToBacklog(id,ig); };

  document.addEventListener('click',function(ev){
    const btn=ev.target?.closest?.('button,a,[role="button"]'); if(!btn) return;
    const text=String(btn.textContent||btn.value||'').toLowerCase();
    const panel=btn.closest('#panel-atribuicao,#panel-pre-envio,#preEnvioRoot,#panel-instagram');
    if(!panel) return;
    if(btn.matches('[data-pre-return-item]')){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); returnPreEnvioItemToAttribution(btn.dataset.preReturnItem); return; }
    if(text.includes('voltar') && text.includes('atribui')){
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      const date=btn.dataset.date || btn.closest('[data-date]')?.dataset?.date || window.preCurrentDate || document.querySelector('.pre-day-card.active')?.dataset?.date || new Date().toISOString().slice(0,10);
      returnPreEnvioDayToAttributionV31(date); return;
    }
    if(text.includes('invalidar')){
      const id=leadIdFrom(btn); if(!id) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      const source=panel.id==='panel-instagram'?'instagram':(inputIn(cardOf(btn))?'attribution_instagram':'attribution');
      invalidateAttributionLead(id,source); return;
    }
    if(text.includes('aprovar') && (text.includes('instagram') || text.includes('backlog') || inputIn(cardOf(btn)))){
      const id=leadIdFrom(btn); if(!id) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      const input=inputIn(cardOf(btn)) || document.getElementById('atrib-insta-url-'+id);
      approveInstagramToBacklog(id,input?.value); return;
    }
  },true);

  function killLegacyRedirects(){
    // Remove onclicks diretos perigosos, mantendo a captura acima como fonte da verdade.
    document.querySelectorAll('button,a,[role="button"]').forEach(btn=>{
      const on=String(btn.getAttribute('onclick')||'');
      if(/approveInstagram|invalidar|invalidate|returnPreEnvio|instagram_dispatch_items/i.test(on)) btn.removeAttribute('onclick');
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{ setTimeout(killLegacyRedirects,100); setTimeout(killLegacyRedirects,700); setTimeout(killLegacyRedirects,1500); });
  try{ new MutationObserver(()=>setTimeout(killLegacyRedirects,50)).observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  if(document.readyState!=='loading') setTimeout(killLegacyRedirects,50);
  console.log('[Lead Certo] estabilizador ativo',VERSION);
})();
