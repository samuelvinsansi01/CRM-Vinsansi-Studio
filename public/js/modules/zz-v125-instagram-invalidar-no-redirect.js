/* V125 — Instagram: invalidar sem redirect e matar handlers legados na Atribuição.
   Regra definitiva:
   Atribuição Instagram -> Aprovar para backlog.
   Invalidar na Atribuição Instagram -> 6/Outro automático, salva proteção e permanece na Atribuição.
*/
(function(){
  'use strict';
  const VERSION='20260621-V125-INSTA-INVALIDAR-NO-REDIRECT';
  const busy=new Set();

  function sb(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function uid(){ return window.currentUser?.id || window.authUser?.id || ''; }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function escSel(v){ try{return CSS.escape(String(v));}catch(_){return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');} }
  function cardOf(el){ return el?.closest?.('[data-lead-id],.atrib-insta-card,.atrib-insta-approve-card,.empresa-card,.lead-card'); }
  function cleanIg(raw){
    let s=String(raw||'').trim().replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/^@+/,'');
    if(!s) return '';
    s=s.replace(/[?#].*$/,'');
    let v=s;
    try{
      let ustr=s;
      if(/^instagram\.com\//i.test(ustr)) ustr='https://www.'+ustr;
      if(/^www\.instagram\.com\//i.test(ustr)) ustr='https://'+ustr;
      const u=new URL(ustr);
      if(String(u.hostname||'').replace(/^www\./i,'').toLowerCase()==='instagram.com') v=String(u.pathname||'').split('/').filter(Boolean)[0]||'';
    }catch(_){
      v=s.replace(/^https?:\/\//i,'').replace(/^www\.instagram\.com\//i,'').replace(/^instagram\.com\//i,'').split('/')[0];
    }
    v=String(v||'').trim().replace(/^@+/,'').split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
    const bad=new Set(['','instagram','instagram.com','www.instagram.com','www','com','p','reel','reels','stories','story','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if(bad.has(v) || v.length<2 || v.length>30 || /^\.+$/.test(v)) return '';
    return v;
  }
  function igUrl(v){ const u=cleanIg(v); return u ? `https://www.instagram.com/${u}/` : ''; }

  async function getLead(id){
    const c=sb(), user=uid(); if(!c||!user||!id) return null;
    const {data,error}=await c.from('leads').select('*').eq('user_id',user).eq('id',id).maybeSingle();
    if(error) throw error;
    return data;
  }

  async function saveInvalidProtection(lead, source){
    const c=sb(), user=uid(); if(!c||!user||!lead) return;
    const username=cleanIg(lead.instagram_username || lead.instagram_url || lead.instagram || '');
    const url=igUrl(username || lead.instagram_url || lead.instagram || '');
    const baseRow={
      user_id:user,
      company_name:lead.company_name || lead.nome || null,
      phone:lead.phone || null,
      normalized_phone:lead.normalized_phone || null,
      website:lead.website || null,
      instagram_url:url || lead.instagram_url || lead.instagram || null,
      instagram_username:username || null,
      maps_url:lead.maps_url || lead.googleUrl || null,
      status:'invalidado',
      source:'instagram',
      notes:'6 - Outro',
      last_contact_at:now(),
      raw_payload:{ lead_id:lead.id, source, reason:'outro', reason_code:6, original:lead.raw_payload || {} },
      street:lead.street || null,
      city:lead.city || null,
      state:lead.state || null,
      country_code:lead.country_code || null,
      category:lead.category || null,
      category_name:lead.category_name || lead.parent_category || null,
      categories:lead.categories || [],
      rating:lead.rating || null,
      reviews_count:lead.reviews_count || null,
      last_channel:'instagram',
      source_account:null,
      source_instance:null,
      sent_channels:[],
      last_event_type:'invalidated',
      last_event_status:'invalidado',
      invalid_reason:'outro',
      invalid_source:source || 'attribution_instagram',
      invalidated_at:now(),
      updated_at:now()
    };

    // Evita erro de unique por índices parciais/expressionais: busca antes por identidade disponível.
    let found=null;
    try{
      let or=[];
      if(username) or.push(`instagram_username.eq.${username}`);
      if(url) or.push(`instagram_url.eq.${url}`);
      if(lead.normalized_phone) or.push(`normalized_phone.eq.${lead.normalized_phone}`);
      if(lead.maps_url) or.push(`maps_url.eq.${String(lead.maps_url).replace(/,/g,'%2C')}`);
      if(or.length){
        const {data}=await c.from('base_permanente').select('id').eq('user_id',user).or(or.join(',')).limit(1);
        found=(data||[])[0]||null;
      }
    }catch(e){ console.warn('[v125 base lookup]',e?.message||e); }

    if(found?.id){
      const {error}=await c.from('base_permanente').update(baseRow).eq('user_id',user).eq('id',found.id);
      if(error) console.warn('[v125 base update]',error.message);
    }else{
      const {error}=await c.from('base_permanente').insert(baseRow);
      if(error) console.warn('[v125 base insert]',error.message);
    }

    try{
      await c.from('contact_events').insert({
        user_id:user,
        lead_id:String(lead.id),
        company_name:baseRow.company_name,
        normalized_phone:baseRow.normalized_phone,
        website:baseRow.website,
        instagram_url:baseRow.instagram_url,
        maps_url:baseRow.maps_url,
        channel:'instagram',
        source_account:null,
        source_instance:null,
        event_type:'invalidated',
        status:'invalidado',
        message_template:null,
        sent_at:now(),
        metadata:{ reason:'outro', reason_code:6, source:source || 'attribution_instagram' }
      });
    }catch(e){ console.warn('[v125 contact event]', e?.message||e); }
  }

  async function invalidateAttributionInstagram(leadId){
    const id=String(leadId||'').trim();
    const c=sb(), user=uid();
    if(!c||!user||!id) return notify('Supabase/auth indisponível.', 'err');
    if(busy.has(id)) return;
    busy.add(id);
    try{
      const lead=await getLead(id);
      if(!lead) return notify('Lead não encontrado.', 'warn');
      await saveInvalidProtection(lead,'attribution_instagram');
      const crm={...(lead.crm_data||{}), invalidated:{ reason:'outro', reason_code:6, source:'attribution_instagram', at:now() }};
      const {error}=await c.from('leads').update({
        current_stage:'invalid',
        current_status:'invalid_manual',
        pipeline_status:'invalidated',
        status:'invalid',
        rejected_reason:'outro',
        rejected_at:now(),
        archived_at:now(),
        updated_at:now(),
        crm_data:crm
      }).eq('user_id',user).eq('id',id);
      if(error) throw error;
      document.querySelectorAll(`[data-lead-id="${escSel(id)}"],#atrib-insta-card-${escSel(id)}`).forEach(el=>el.remove());
      notify('✓ Lead invalidado como 6 - Outro.');
      // Atualiza apenas contadores/lista da Atribuição. NÃO abre Instagram e NÃO redireciona.
      try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); }catch(_){ }
      try{ if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); }catch(_){ }
      setTimeout(normalizeAttributionInstagramUI,80);
    }catch(e){
      notify('Erro ao invalidar lead: '+(e?.message||e), 'err');
    }finally{ busy.delete(id); }
  }

  function isInstagramAttributionButton(btn){
    const panel=document.getElementById('panel-atribuicao');
    if(!panel?.contains(btn)) return false;
    const card=cardOf(btn);
    if(!card) return false;
    return !!(card.querySelector?.('input[id^="atrib-insta-url-"]') || card.classList.contains('atrib-insta-card') || card.classList.contains('atrib-insta-approve-card'));
  }

  function normalizeAttributionInstagramUI(){
    const panel=document.getElementById('panel-atribuicao');
    if(!panel) return;
    panel.querySelectorAll('.atrib-insta-card,.atrib-insta-approve-card,[data-lead-id]').forEach(card=>{
      if(!card.querySelector?.('input[id^="atrib-insta-url-"]')) return;
      card.style.maxWidth='100%';
      card.style.overflowX='hidden';
      card.querySelectorAll('button,a,[role="button"]').forEach(btn=>{
        const t=String(btn.textContent||btn.value||'').toLowerCase().trim();
        const isFila=t.includes('aprovar') && t.includes('fila');
        if(isFila) btn.remove();
        if(t.includes('invalidar')){
          btn.type='button';
          btn.onclick=null;
          btn.classList.add('ig-v125-invalidar-outro');
          btn.textContent='Invalidar lead';
          btn.title='Invalidar como 6 - Outro';
        }
      });
    });
  }

  // Captura antes dos onclicks legados: invalidar nunca abre prompt e nunca chama redirect.
  document.addEventListener('click', function(ev){
    const btn=ev.target?.closest?.('button,a,[role="button"]');
    if(!btn || !isInstagramAttributionButton(btn)) return;
    const t=String(btn.textContent||btn.value||'').toLowerCase();
    if(!t.includes('invalidar')) return;
    const card=cardOf(btn);
    const leadId=card?.dataset?.leadId || String(card?.id||'').replace(/^atrib-insta-card-/,'');
    if(!leadId) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    invalidateAttributionInstagram(leadId);
  }, true);

  window.invalidarLeadInstagramAtribV45=invalidateAttributionInstagram;
  window.instagramV125InvalidateAttribution=invalidateAttributionInstagram;

  document.addEventListener('DOMContentLoaded',()=>{
    normalizeAttributionInstagramUI();
    setTimeout(normalizeAttributionInstagramUI,250);
    setTimeout(normalizeAttributionInstagramUI,900);
  });
  setInterval(()=>{
    if(document.getElementById('panel-atribuicao')?.classList.contains('active')) normalizeAttributionInstagramUI();
  },700);

  window.__V125_INSTAGRAM_INVALIDAR_NO_REDIRECT__=VERSION;
})();
