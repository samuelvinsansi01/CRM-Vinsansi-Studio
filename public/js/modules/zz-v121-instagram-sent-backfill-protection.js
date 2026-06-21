/* V121 — Instagram enviado protegido na base + limpeza real do Backlog.
   Problema corrigido:
   - Antes, envios antigos do Instagram podiam ter ficado apenas como instagram_dispatch_items.status='sent',
     sem gravar base_permanente/contact_events/sent_contacts e sem arquivar o lead.
   - Resultado: esses leads continuavam aparecendo no Backlog/Atribuição Instagram e podiam voltar para fila.
   Solução:
   - Backfill automático dos itens Instagram já enviados para base_permanente/contact_events/sent_contacts.
   - Arquiva o lead como instagram_sent.
   - Roda antes de abrir Instagram, antes de preencher perfil e antes de renderizar Atribuição.
*/
(function(){
  const VERSION='20260621-v121-instagram-sent-backfill-protection';
  let running=null;
  let lastRun=0;
  const TTL=30000;

  function sb(){ try { return window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null); } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || (typeof currentUser !== 'undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || null; } catch(e){ return null; } }
  function clean(v){ return String(v||'').trim(); }
  function digits(v){ return String(v||'').replace(/\D/g,''); }
  function igUser(v){
    let s=clean(v).toLowerCase();
    if(!s) return '';
    s=s.replace(/^@+/,'');
    try{
      if(/^https?:\/\//i.test(s) || /^www\./i.test(s) || /^instagram\.com\//i.test(s)){
        const u=new URL(/^https?:\/\//i.test(s)?s:'https://'+s.replace(/^www\./i,''));
        const host=(u.hostname||'').replace(/^www\./,'');
        if(!host.endsWith('instagram.com')) return '';
        const parts=u.pathname.split('/').filter(Boolean);
        const first=(parts[0]||'').toLowerCase();
        if(!first || ['p','reel','reels','tv','explore','stories','accounts','direct'].includes(first)) return '';
        s=first;
      }
    }catch(_){ }
    s=s.split(/[/?#&\s]/)[0].replace(/^@+/,'').trim();
    if(!/^[a-z0-9._]{2,30}$/.test(s)) return '';
    if(['instagram','www','explore','reels','reel','p','stories','direct','accounts'].includes(s)) return '';
    return s;
  }
  function igUrl(u){ const v=igUser(u); return v ? `https://instagram.com/${v}` : null; }
  function safeJson(x){ return (x && typeof x==='object') ? x : {}; }

  async function findBase(c,user,phone,ig){
    const ors=[];
    if(phone) ors.push(`normalized_phone.eq.${phone}`);
    if(ig) ors.push(`instagram_username.eq.${ig}`);
    if(!ors.length) return null;
    const r=await c.from('base_permanente').select('id').eq('user_id',user).or(ors.join(',')).limit(1);
    if(r.error) return null;
    return r.data?.[0]?.id || null;
  }

  async function putBaseForSent(c,user,item,lead,when){
    const phone=digits(lead?.normalized_phone || lead?.phone || item?.normalized_phone || item?.phone || '');
    const ig=igUser(item?.instagram_username || item?.instagram_url || lead?.instagram_username || lead?.instagram_url || lead?.instagram || '');
    if(!phone && !ig) return null;
    const payload={
      user_id:user,
      company_name:lead?.company_name || item?.company_name || 'Lead Instagram',
      phone:lead?.phone || null,
      normalized_phone:phone || null,
      website:lead?.website || null,
      website_domain:lead?.website_domain || null,
      instagram_url:ig ? igUrl(ig) : (lead?.instagram_url || item?.instagram_url || null),
      instagram_username:ig || lead?.instagram_username || null,
      category:lead?.category || null,
      category_name:lead?.category_name || item?.parent_category || null,
      categories:Array.isArray(lead?.categories) ? lead.categories : (lead?.categories || []),
      city:lead?.city || null,
      state:lead?.state || null,
      country_code:lead?.country_code || 'BR',
      rating:lead?.rating || null,
      reviews_count:lead?.reviews_count || null,
      maps_url:lead?.maps_url || null,
      source:'instagram_backfill_sent',
      last_channel:'instagram',
      last_event_type:'instagram_sent',
      last_event_status:'sent',
      instagram_sent_at:when,
      last_contact_at:when,
      status:'instagram_sent',
      sent_channels:['instagram'],
      raw_payload:{...safeJson(lead?.raw_payload), instagram_dispatch_item_id:item?.id||null, lead_id:item?.lead_id||lead?.id||null, backfill:true},
      updated_at:new Date().toISOString()
    };
    let baseId=await findBase(c,user,phone,ig);
    if(baseId){
      const u=await c.from('base_permanente').update(payload).eq('user_id',user).eq('id',baseId);
      if(u.error) throw u.error;
    }else{
      const ins=await c.from('base_permanente').insert({...payload, created_at:new Date().toISOString()}).select('id').maybeSingle();
      if(ins.error) throw ins.error;
      baseId=ins.data?.id || null;
    }
    try{
      await c.from('contact_events').insert({
        user_id:user,
        lead_id:String(item?.lead_id || lead?.id || ''),
        base_permanente_id:baseId,
        company_name:payload.company_name,
        normalized_phone:phone || null,
        website:payload.website,
        instagram_url:payload.instagram_url,
        maps_url:payload.maps_url,
        channel:'instagram',
        source_account:item?.profile_username || null,
        source_instance:item?.profile_id || null,
        event_type:'sent',
        status:'sent',
        message_template:item?.template_id || null,
        sent_at:when,
        metadata:{instagram_dispatch_item_id:item?.id||null, backfill:true}
      });
    }catch(e){ console.warn('[v121][contact_events]', e?.message||e); }
    if(phone){
      try{
        await c.from('sent_contacts').upsert({
          user_id:user,
          lead_id:String(item?.lead_id || lead?.id || ''),
          company_name:payload.company_name,
          phone:lead?.phone || phone,
          normalized_phone:phone,
          block_type:'already_sent',
          source:'instagram_backfill_sent',
          reason:'instagram_sent',
          active:true,
          dispatched_at:when,
          raw_payload:{instagram_dispatch_item_id:item?.id||null, instagram_username:ig||null, backfill:true}
        },{onConflict:'user_id,normalized_phone'});
      }catch(e){ console.warn('[v121][sent_contacts]', e?.message||e); }
    }
    return baseId;
  }

  async function runBackfill(force=false){
    const nowTs=Date.now();
    if(!force && nowTs-lastRun<TTL) return {ok:true, skipped:true};
    if(running) return running;
    running=(async()=>{
      const c=sb(), user=uid();
      if(!c||!user) return {ok:false, reason:'no_client'};
      lastRun=Date.now();
      const q=await c.from('instagram_dispatch_items')
        .select('id,lead_id,user_id,status,sent_at,last_action_at,profile_id,profile_username,company_name,instagram_username,instagram_url,parent_category,template_id,message_1,message_2')
        .eq('user_id',user)
        .in('status',['sent','enviado'])
        .limit(1000);
      if(q.error){ console.warn('[v121][sent-items]', q.error.message); return {ok:false,error:q.error}; }
      const items=q.data||[];
      if(!items.length) return {ok:true,count:0};
      const leadIds=[...new Set(items.map(x=>String(x.lead_id||'')).filter(Boolean))];
      let leadsById={};
      if(leadIds.length){
        const lr=await c.from('leads').select('*').eq('user_id',user).in('id',leadIds);
        if(!lr.error) (lr.data||[]).forEach(l=>{ leadsById[String(l.id)]=l; });
      }
      let changed=0;
      for(const item of items){
        const lead=leadsById[String(item.lead_id||'')] || {};
        const when=item.sent_at || item.last_action_at || new Date().toISOString();
        try{
          await putBaseForSent(c,user,item,lead,when);
          if(item.lead_id){
            await c.from('leads').update({
              current_stage:'archived',
              current_status:'instagram_sent',
              status:'Enviada Instagram',
              archived_at:when,
              updated_at:new Date().toISOString()
            }).eq('user_id',user).eq('id',String(item.lead_id));
          }
          changed++;
        }catch(e){ console.warn('[v121][backfill-item]', item.id, e?.message||e); }
      }
      if(changed) console.info(`[v121] ${changed} envios antigos do Instagram protegidos na base.`);
      return {ok:true,count:changed};
    })().finally(()=>{ running=null; });
    return running;
  }

  window.instagramV121BackfillSentProtection=runBackfill;

  const prevRenderInstagram=window.renderInstagram;
  window.renderInstagram=async function renderInstagramV121(){
    try{ await runBackfill(false); }catch(e){ console.warn('[v121][renderInstagram]', e?.message||e); }
    return typeof prevRenderInstagram==='function' ? prevRenderInstagram.apply(this,arguments) : undefined;
  };

  const prevFill=window.instagramV94FillProfile;
  window.instagramV94FillProfile=async function fillProfileV121(){
    try{ await runBackfill(true); }catch(e){ console.warn('[v121][fillProfile]', e?.message||e); }
    return typeof prevFill==='function' ? prevFill.apply(this,arguments) : undefined;
  };

  const prevAtrib=window.renderAtribuicaoPanelV31;
  window.renderAtribuicaoPanelV31=async function renderAtribV121(){
    try{ await runBackfill(false); }catch(e){ console.warn('[v121][atrib]', e?.message||e); }
    return typeof prevAtrib==='function' ? prevAtrib.apply(this,arguments) : undefined;
  };
  window.renderAtribuicao=window.renderAtribuicaoPanelV31;

  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>runBackfill(false),1800));
  window.__V121_INSTAGRAM_SENT_BACKFILL__=VERSION;
})();
