/* V126 — Atribuição: invalidar universal como 6/Outro e aprovar Instagram para Backlog.
   Objetivo: uma única camada final para a Base de Atribuição.
   - Invalidar em QUALQUER aba da Atribuição: sem prompt, motivo 6 - Outro, sem redirect.
   - Aprovar na aba Instagram: vai para instagram_backlog, sem criar item direto na fila/dia e sem redirect.
   - Não mexe em Pré-envio, Fila WhatsApp ou Fila Instagram.
*/
(function(){
  'use strict';
  const VERSION='20260621-V126-ATRIBUICAO-INVALIDAR-APROVAR-BASE';
  const locks=new Set();

  function sb(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function uid(){ return window.currentUser?.id || window.authUser?.id || localStorage.getItem('vs_auth_local_user_v423') || ''; }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function escSel(v){ try{return CSS.escape(String(v));}catch(_){return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');} }
  function attrPanel(){ return document.getElementById('panel-atribuicao'); }
  function cardOf(el){ return el?.closest?.('[data-lead-id],.atrib-clean-card,.atrib-vfinal-card,.atrib-v64-card,.empresa-card,.lead-card,.atrib-insta-card,.atrib-insta-approve-card'); }
  function leadIdFrom(el){
    const card=cardOf(el);
    if(card?.dataset?.leadId) return String(card.dataset.leadId);
    const inp=card?.querySelector?.('input[id^="atrib-insta-url-"]') || el?.closest?.('input[id^="atrib-insta-url-"]');
    if(inp?.id) return String(inp.id).replace(/^atrib-insta-url-/,'');
    const idText=String(card?.id||'');
    if(idText.includes('atrib-insta-card-')) return idText.replace(/^atrib-insta-card-/,'');
    const raw=String(el?.getAttribute?.('onclick')||'') + ' ' + String(el?.dataset?.leadId||'');
    const m=raw.match(/['\"]([0-9a-fA-F-]{12,}|[A-Za-z0-9_-]{12,})['\"]/);
    return m ? m[1] : '';
  }
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
  function normPhone(v){ let d=String(v||'').replace(/\D/g,''); if(!d) return ''; if(d.startsWith('00')) d=d.slice(2); if(d.startsWith('55')) return d; if(d.length===10||d.length===11) return '55'+d; return d; }
  function reasonLabel(){ return 'Outro'; }

  async function getLead(id){
    const c=sb(), user=uid(); if(!c||!user||!id) return null;
    const {data,error}=await c.from('leads').select('*').eq('user_id',user).eq('id',String(id)).maybeSingle();
    if(error) throw error;
    return data||null;
  }

  function baseRowFromLead(lead, source){
    const username=cleanIg(lead?.instagram_username || lead?.instagram_url || lead?.instagram || '');
    const url=igUrl(username || lead?.instagram_url || lead?.instagram || '');
    const phone=normPhone(lead?.normalized_phone || lead?.phone || '');
    return {
      user_id:uid(),
      company_name:lead?.company_name || lead?.nome || 'Lead sem nome',
      phone:lead?.phone || null,
      normalized_phone:phone || null,
      website:lead?.website || null,
      website_domain:lead?.website_domain || null,
      instagram_url:url || lead?.instagram_url || lead?.instagram || null,
      instagram_username:username || null,
      maps_url:lead?.maps_url || lead?.googleUrl || null,
      status:'invalidado',
      source:source || 'attribution',
      notes:'6 - Outro',
      last_contact_at:now(),
      raw_payload:{lead_id:lead?.id, source:source || 'attribution', reason:'outro', reason_code:6, original:lead?.raw_payload || {}},
      street:lead?.street || null,
      city:lead?.city || null,
      state:lead?.state || null,
      country_code:lead?.country_code || null,
      category:lead?.category || null,
      category_name:lead?.category_name || lead?.parent_category || lead?.category || null,
      categories:Array.isArray(lead?.categories) ? lead.categories : (lead?.categories || []),
      rating:lead?.rating ?? null,
      reviews_count:lead?.reviews_count ?? null,
      last_channel:String(source||'').includes('instagram') ? 'instagram' : null,
      sent_channels:[],
      last_event_type:'invalidated',
      last_event_status:'invalidado',
      invalid_reason:'outro',
      invalid_source:source || 'attribution',
      invalidated_at:now(),
      updated_at:now()
    };
  }

  async function saveBase(row){
    const c=sb(), user=uid(); if(!c||!user) return;
    let existing=null;
    const checks=[];
    if(row.normalized_phone) checks.push(['normalized_phone',row.normalized_phone]);
    if(row.instagram_username) checks.push(['instagram_username',row.instagram_username]);
    if(row.instagram_url) checks.push(['instagram_url',row.instagram_url]);
    if(row.maps_url) checks.push(['maps_url',row.maps_url]);
    if(row.website_domain) checks.push(['website_domain',row.website_domain]);
    if(row.website) checks.push(['website',row.website]);
    for(const [field,value] of checks){
      try{
        const {data}=await c.from('base_permanente').select('id').eq('user_id',user).eq(field,value).limit(1);
        if((data||[])[0]){ existing=data[0]; break; }
      }catch(_){ }
    }
    if(existing?.id){
      const {error}=await c.from('base_permanente').update(row).eq('user_id',user).eq('id',existing.id);
      if(error) console.warn('[v126][base update]',error.message);
      return;
    }
    const {error}=await c.from('base_permanente').insert({...row,created_at:now()});
    if(error) console.warn('[v126][base insert]',error.message);
  }

  async function recordEvent(lead, source){
    const c=sb(), user=uid(); if(!c||!user||!lead) return;
    try{
      const username=cleanIg(lead.instagram_username || lead.instagram_url || lead.instagram || '');
      await c.from('contact_events').insert({
        user_id:user,
        lead_id:String(lead.id),
        company_name:lead.company_name || null,
        normalized_phone:normPhone(lead.normalized_phone||lead.phone||'') || null,
        website:lead.website || null,
        instagram_url:igUrl(username) || lead.instagram_url || lead.instagram || null,
        maps_url:lead.maps_url || null,
        channel:String(source||'').includes('instagram') ? 'instagram' : 'manual',
        source_account:null,
        source_instance:source || 'attribution',
        event_type:'invalidated',
        status:'invalidado',
        sent_at:now(),
        metadata:{reason:'outro',reason_code:6,source:source||'attribution',origin:VERSION}
      });
    }catch(e){ console.warn('[v126][event]',e?.message||e); }
  }

  function inferSource(card){
    const txt=String(card?.textContent||'').toLowerCase();
    if(card?.querySelector?.('input[id^="atrib-insta-url-"]') || txt.includes('instagram')) return 'attribution_instagram';
    if(txt.includes('agregador') || txt.includes('linktree') || txt.includes('beacons')) return 'attribution_agregadores';
    if(txt.includes('com site') || card?.querySelector?.('a[href^="http"]')) return 'attribution_com_site';
    if(txt.includes('whatsapp')) return 'attribution_whatsapp';
    return 'attribution';
  }

  async function invalidateAttributionLead(leadId, source){
    const id=String(leadId||'').trim();
    const c=sb(), user=uid();
    if(!c||!user||!id) return notify('Supabase/auth indisponível.', 'err');
    const key='invalid|'+id;
    if(locks.has(key)) return;
    locks.add(key);
    try{
      const lead=await getLead(id);
      if(!lead) return notify('Lead não encontrado.', 'warn');
      await saveBase(baseRowFromLead(lead, source || 'attribution'));
      await recordEvent(lead, source || 'attribution');
      const crm={...(lead.crm_data||{}), invalidated:{reason:'outro',reason_code:6,source:source||'attribution',at:now(),origin:VERSION}};
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
      updateOnlyAttribution();
    }catch(e){
      notify('Erro ao invalidar lead: '+(e?.message||e), 'err');
    }finally{ locks.delete(key); }
  }

  function inputFor(id,card){ return card?.querySelector?.('input[id^="atrib-insta-url-"]') || document.getElementById('atrib-insta-url-'+id); }
  function isInstagramAttributionCard(card){ return !!(card?.querySelector?.('input[id^="atrib-insta-url-"]') || String(card?.textContent||'').toLowerCase().includes('instagram')); }
  function hasRegisteredRamo(lead){
    try{
      if(typeof window.hasRegisteredRamoForLeadV86==='function') return window.hasRegisteredRamoForLeadV86(lead);
      if(typeof window.resolveRamoForLeadV76==='function') return !!window.resolveRamoForLeadV76(lead);
      const raw=(lead?.parent_category || lead?.category_name || lead?.category || '').toString().trim().toLowerCase();
      if(!raw) return false;
      const ramos=(typeof window.getRamos==='function' ? window.getRamos() : (window.RAMOS || [])) || [];
      return !ramos.length || ramos.some(r=>{
        const vals=[r.id,r.nome,r.name,r.label,r.parent,r.parent_category].map(x=>String(x||'').toLowerCase());
        return vals.includes(raw) || vals.some(v=>v && (raw.includes(v)||v.includes(raw)));
      });
    }catch(_){ return true; }
  }

  async function approveInstagramToBacklog(leadId, sourceCard){
    const id=String(leadId||'').trim();
    const c=sb(), user=uid();
    if(!c||!user||!id) return notify('Supabase/auth indisponível.', 'err');
    const key='approve|'+id;
    if(locks.has(key)) return;
    locks.add(key);
    try{
      const input=inputFor(id, sourceCard);
      const lead=await getLead(id);
      if(!lead) return notify('Lead não encontrado.', 'warn');
      let username=cleanIg(input?.value || input?.dataset?.instagramUsername || lead.instagram_username || lead.instagram_url || lead.instagram || '');
      if(!username){
        if(input) input.style.borderColor='var(--error,#ff4d4d)';
        return notify('Cole um Instagram válido com perfil real. Ex: instagram.com/perfil ou @perfil.', 'warn');
      }
      if(!hasRegisteredRamo(lead)){
        return notify('Lead bloqueado: categoria/subcategoria não cadastrada nos ramos da plataforma.', 'warn');
      }
      const url=igUrl(username);
      // Bloqueio global contra duplicidade ativa/base.
      try{
        const [q,b]=await Promise.all([
          c.from('instagram_dispatch_items').select('id,status,company_name,profile_username').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).neq('lead_id',String(id)).limit(1),
          c.from('base_permanente').select('id,status,company_name').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).limit(1)
        ]);
        const dup=(q.data||[])[0];
        if(dup && !['error','failed','erro','invalidated','invalidado'].includes(String(dup.status||'').toLowerCase())) return notify('Instagram já existe em outra fila/perfil: @'+username, 'warn');
        if((b.data||[])[0]) return notify('Instagram já está na Base Permanente: @'+username, 'warn');
      }catch(e){ console.warn('[v126][dup-check]', e?.message||e); }
      const {error}=await c.from('leads').update({
        instagram:'@'+username,
        instagram_url:url,
        instagram_username:username,
        current_stage:'instagram_backlog',
        current_status:'instagram_backlog',
        status:'Aguardando alocação Instagram',
        lead_channel:'instagram',
        pipeline_status:'instagram_backlog',
        updated_at:now(),
        crm_data:{...(lead.crm_data||{}), instagram_backlog:{username,url,at:now(),origin:VERSION}}
      }).eq('user_id',user).eq('id',id);
      if(error) throw error;
      if(input){ input.value=url; input.dataset.instagramUsername=username; input.style.borderColor='var(--ok,#a6ff3d)'; }
      document.querySelectorAll(`[data-lead-id="${escSel(id)}"],#atrib-insta-card-${escSel(id)}`).forEach(el=>el.remove());
      notify('✓ @'+username+' enviado para Backlog Instagram. Aloque pelo botão Preencher perfil no dia desejado.');
      updateOnlyAttribution();
    }catch(e){
      notify('Erro ao aprovar para backlog: '+(e?.message||e), 'err');
    }finally{ locks.delete(key); }
  }

  function updateOnlyAttribution(){
    // Não abre fila, não navega e não chama renderInstagram.
    try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); }catch(_){ }
    try{ if(typeof window.updateSafeBadgesV31==='function') window.updateSafeBadgesV31(); }catch(_){ }
    try{ if(typeof window.updateBadges==='function') window.updateBadges(); }catch(_){ }
  }

  function normalizeAttributionButtons(){
    const panel=attrPanel(); if(!panel) return;
    panel.style.overflowX='hidden';
    panel.querySelectorAll('[data-lead-id],.atrib-clean-card,.atrib-vfinal-card,.atrib-v64-card,.empresa-card,.atrib-insta-card,.atrib-insta-approve-card').forEach(card=>{
      card.style.maxWidth='100%';
      card.style.overflowX='hidden';
      card.querySelectorAll('button,a,[role="button"]').forEach(btn=>{
        const t=String(btn.textContent||btn.value||'').toLowerCase().trim();
        if(t.includes('invalidar')){
          btn.type='button';
          btn.onclick=null;
          btn.removeAttribute('onclick');
          btn.textContent='Invalidar lead';
          btn.classList.add('v126-invalidar-outro');
          btn.title='Invalidar como 6 - Outro';
        }
        if(isInstagramAttributionCard(card) && t.includes('aprovar')){
          const isBacklog=t.includes('backlog') || t.includes('fila');
          if(isBacklog){
            btn.type='button';
            btn.onclick=null;
            btn.removeAttribute('onclick');
            btn.textContent='Aprovar para backlog';
            btn.classList.add('v126-approve-insta-backlog');
            btn.title='Enviar para Backlog Instagram, sem alocar no dia';
          }
        }
      });
    });
  }

  // Delegação final: invalidar em todas as abas da Base de Atribuição.
  document.addEventListener('click', function(ev){
    const panel=attrPanel();
    const btn=ev.target?.closest?.('button,a,[role="button"]');
    if(!panel || !btn || !panel.contains(btn)) return;
    const text=String(btn.textContent||btn.value||'').toLowerCase();
    const card=cardOf(btn);
    if(!card) return;

    if(text.includes('invalidar')){
      const leadId=leadIdFrom(btn) || leadIdFrom(card);
      if(!leadId) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
      invalidateAttributionLead(leadId, inferSource(card));
      return;
    }

    // Aprovar somente no fluxo Instagram -> Backlog.
    if(isInstagramAttributionCard(card) && text.includes('aprovar') && (text.includes('backlog') || text.includes('fila'))){
      const leadId=leadIdFrom(btn) || leadIdFrom(card);
      if(!leadId) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
      approveInstagramToBacklog(leadId, card);
    }
  }, true);

  // Overrides para onclicks legados que ainda possam ser chamados por HTML antigo.
  window.invalidarLeadAtribuicaoV58=function(leadId){ return invalidateAttributionLead(leadId,'attribution'); };
  window.invalidarLeadInstagramAtribV45=function(leadId){ return invalidateAttributionLead(leadId,'attribution_instagram'); };
  window.instagramV126InvalidateAttribution=invalidateAttributionLead;
  window.instagramV126ApproveToBacklog=approveInstagramToBacklog;
  window.instagramV122ApproveToBacklog=approveInstagramToBacklog;
  window.instagramV108ApproveToDispatchQueue=approveInstagramToBacklog;
  window.instagramV117ApproveDirect=approveInstagramToBacklog;
  window.instagramV118ApproveNow=approveInstagramToBacklog;
  window.instagramV102ApproveForQueue=approveInstagramToBacklog;
  const prevAprovar=window.aprovarLeadAtribuicaoParaFilaV65;
  window.aprovarLeadAtribuicaoParaFilaV65=function(id,tab){
    const t=String(tab||'').toLowerCase();
    if(t.includes('insta') || document.getElementById('atrib-insta-url-'+id)) return approveInstagramToBacklog(id);
    return typeof prevAprovar==='function' ? prevAprovar.apply(this,arguments) : undefined;
  };

  function injectStyle(){
    if(document.getElementById('v126-atrib-base-style')) return;
    const st=document.createElement('style'); st.id='v126-atrib-base-style';
    st.textContent=`
      #panel-atribuicao,#atribPanelInsta{overflow-x:hidden!important;}
      #panel-atribuicao [data-lead-id],#panel-atribuicao .empresa-card,#panel-atribuicao .atrib-v64-card{max-width:100%!important;overflow:hidden!important;}
      #panel-atribuicao .v126-approve-insta-backlog{background:var(--accent,#b5ff4a)!important;color:#0b0b0f!important;border-color:var(--accent,#b5ff4a)!important;white-space:nowrap!important;}
    `;
    document.head.appendChild(st);
  }

  document.addEventListener('DOMContentLoaded',()=>{ injectStyle(); normalizeAttributionButtons(); setTimeout(normalizeAttributionButtons,250); setTimeout(normalizeAttributionButtons,900); });
  setInterval(()=>{ if(attrPanel()?.classList.contains('active')) normalizeAttributionButtons(); },700);
  if(document.readyState!=='loading'){ injectStyle(); setTimeout(normalizeAttributionButtons,100); }

  window.__V126_ATRIBUICAO_INVALIDAR_APROVAR_BASE__=VERSION;
})();
