/* V128 — Base final de Atribuição + Pré-envio por origem.
   - Intercepta no WINDOW antes dos listeners legados: não deixa redirect/sobrescrita antiga rodar.
   - Atribuição Instagram: Aprovar -> instagram_backlog. Nunca cria fila/dia direto.
   - Invalidar em qualquer aba da Atribuição: 6 - Outro automático, sem popup e sem redirect.
   - Pré-envio: remove botão único e cria filtros de preenchimento: WhatsApp, Com site + Agregadores, Geral.
   - Com site/Agregadores só entram se estiverem aprovados para fila.
*/
(function(){
  'use strict';
  const VERSION='20260621-V128-ATRIB-PREENVIO-BASE-FIX';
  const busy=new Set();

  function c(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function uid(){ return window.currentUser?.id || window.authUser?.id || localStorage.getItem('vs_auth_local_user_v423') || ''; }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function esc(v){ return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
  function css(v){ try{return CSS.escape(String(v));}catch(_){return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');} }
  function normPhone(v){ let d=String(v||'').replace(/\D/g,''); if(!d) return ''; if(d.startsWith('00')) d=d.slice(2); if(d.startsWith('55')) return d; if(d.length===10||d.length===11) return '55'+d; return d; }
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
  function igUrl(x){ const u=cleanIg(x); return u ? `https://www.instagram.com/${u}/` : ''; }

  function attrPanel(){ return document.getElementById('panel-atribuicao'); }
  function cardOf(el){ return el?.closest?.('[data-lead-id],.atrib-clean-card,.atrib-vfinal-card,.atrib-v64-card,.empresa-card,.lead-card,.atrib-insta-card,.atrib-insta-approve-card'); }
  function inputIn(card){ return card?.querySelector?.('input[id^="atrib-insta-url-"]'); }
  function leadIdFrom(el){
    const card=cardOf(el) || el;
    if(card?.dataset?.leadId) return String(card.dataset.leadId);
    const inp=inputIn(card) || (el?.matches?.('input[id^="atrib-insta-url-"]') ? el : null);
    if(inp?.id) return String(inp.id).replace(/^atrib-insta-url-/,'');
    const raw=String(el?.getAttribute?.('onclick')||'')+' '+String(el?.dataset?.leadId||'')+' '+String(card?.id||'');
    const m=raw.match(/([0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}|[A-Za-z0-9_-]{12,})/);
    return m ? m[1] : '';
  }

  async function getLead(id){
    const db=c(), user=uid(); if(!db||!user||!id) return null;
    const {data,error}=await db.from('leads').select('*').eq('user_id',user).eq('id',String(id)).maybeSingle();
    if(error) throw error;
    return data||null;
  }

  async function saveInvalidToBase(lead, source){
    const db=c(), user=uid(); if(!db||!user||!lead) return;
    const username=cleanIg(lead.instagram_username || lead.instagram_url || lead.instagram || '');
    const row={
      user_id:user,
      company_name:lead.company_name || 'Lead sem nome',
      phone:lead.phone || null,
      normalized_phone:normPhone(lead.normalized_phone||lead.phone||'') || null,
      website:lead.website || null,
      website_domain:lead.website_domain || null,
      instagram_url:igUrl(username) || lead.instagram_url || lead.instagram || null,
      instagram_username:username || null,
      maps_url:lead.maps_url || null,
      status:'invalidado',
      source:source || 'attribution',
      notes:'6 - Outro',
      last_contact_at:now(),
      raw_payload:{lead_id:lead.id,reason:'outro',reason_code:6,source:source||'attribution',origin:VERSION},
      street:lead.street || null,
      city:lead.city || null,
      state:lead.state || null,
      country_code:lead.country_code || null,
      category:lead.category || null,
      category_name:lead.category_name || lead.parent_category || lead.category || null,
      categories:Array.isArray(lead.categories) ? lead.categories : (lead.categories || []),
      rating:lead.rating ?? null,
      reviews_count:lead.reviews_count ?? null,
      last_channel:String(source||'').includes('instagram') ? 'instagram' : null,
      sent_channels:[],
      last_event_type:'invalidated',
      last_event_status:'invalidado',
      invalid_reason:'outro',
      invalid_source:source || 'attribution',
      invalidated_at:now(),
      updated_at:now()
    };
    const checks=[];
    if(row.normalized_phone) checks.push(['normalized_phone',row.normalized_phone]);
    if(row.instagram_username) checks.push(['instagram_username',row.instagram_username]);
    if(row.instagram_url) checks.push(['instagram_url',row.instagram_url]);
    if(row.maps_url) checks.push(['maps_url',row.maps_url]);
    let existing=null;
    for(const [field,val] of checks){
      try{ const {data}=await db.from('base_permanente').select('id').eq('user_id',user).eq(field,val).limit(1); if((data||[])[0]){ existing=data[0]; break; } }catch(_){ }
    }
    if(existing?.id) await db.from('base_permanente').update(row).eq('user_id',user).eq('id',existing.id);
    else await db.from('base_permanente').insert({...row,created_at:now()});
    try{
      await db.from('contact_events').insert({
        user_id:user, lead_id:String(lead.id), company_name:lead.company_name||null,
        normalized_phone:row.normalized_phone, website:lead.website||null, instagram_url:row.instagram_url, maps_url:lead.maps_url||null,
        channel:String(source||'').includes('instagram')?'instagram':'manual', source_instance:source||'attribution', event_type:'invalidated', status:'invalidado', sent_at:now(),
        metadata:{reason:'outro',reason_code:6,origin:VERSION}
      });
    }catch(_){ }
  }

  function sourceOf(card){
    const txt=String(card?.textContent||'').toLowerCase();
    if(inputIn(card)||txt.includes('instagram')) return 'attribution_instagram';
    if(txt.includes('agregador')||txt.includes('linktree')||txt.includes('beacons')) return 'attribution_agregadores';
    if(txt.includes('com site')||card?.querySelector?.('a[href^="http"]')) return 'attribution_com_site';
    if(txt.includes('whatsapp')) return 'attribution_whatsapp';
    return 'attribution';
  }

  async function invalidateLead(id,card){
    const db=c(), user=uid(); id=String(id||'').trim();
    if(!db||!user||!id) return notify('Supabase/auth indisponível.','err');
    const key='inv:'+id; if(busy.has(key)) return; busy.add(key);
    try{
      const lead=await getLead(id); if(!lead) return notify('Lead não encontrado.','warn');
      await saveInvalidToBase(lead, sourceOf(card));
      const crm={...(lead.crm_data||{}), invalidated:{reason:'outro',reason_code:6,at:now(),origin:VERSION}};
      const {error}=await db.from('leads').update({
        current_stage:'invalid', current_status:'invalid_manual', pipeline_status:'invalidated', status:'invalid',
        rejected_reason:'outro', rejected_at:now(), archived_at:now(), updated_at:now(), crm_data:crm
      }).eq('user_id',user).eq('id',id);
      if(error) throw error;
      document.querySelectorAll(`[data-lead-id="${css(id)}"],#atrib-insta-card-${css(id)}`).forEach(x=>x.remove());
      notify('✓ Lead invalidado como 6 - Outro.');
      try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); }catch(_){ }
    }catch(e){ notify('Erro ao invalidar: '+(e?.message||e),'err'); }
    finally{ busy.delete(key); }
  }

  async function approveInstagramBacklog(id,card){
    const db=c(), user=uid(); id=String(id||'').trim();
    if(!db||!user||!id) return notify('Supabase/auth indisponível.','err');
    const key='appig:'+id; if(busy.has(key)) return; busy.add(key);
    try{
      const input=inputIn(card) || document.getElementById('atrib-insta-url-'+id);
      const lead=await getLead(id); if(!lead) return notify('Lead não encontrado.','warn');
      const username=cleanIg(input?.value || input?.dataset?.instagramUsername || lead.instagram_username || lead.instagram_url || lead.instagram || '');
      if(!username){ if(input) input.style.borderColor='var(--error,#ff4d4d)'; return notify('Cole um Instagram válido com perfil real.','warn'); }
      const url=igUrl(username);
      try{
        const [q,b]=await Promise.all([
          db.from('instagram_dispatch_items').select('id,status,lead_id').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).neq('lead_id',id).limit(1),
          db.from('base_permanente').select('id,status').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).limit(1)
        ]);
        const row=(q.data||[])[0];
        if(row && !['error','failed','erro','invalidated','invalidado'].includes(String(row.status||'').toLowerCase())) return notify('Instagram já existe em fila/perfil: @'+username,'warn');
        if((b.data||[])[0]) return notify('Instagram já está na Base Permanente: @'+username,'warn');
      }catch(e){ console.warn('[v128 dup ig]',e?.message||e); }
      const {error}=await db.from('leads').update({
        instagram:'@'+username, instagram_url:url, instagram_username:username,
        current_stage:'instagram_backlog', current_status:'instagram_backlog', pipeline_status:'instagram_backlog',
        lead_channel:'instagram', status:'Aguardando alocação Instagram', updated_at:now(),
        crm_data:{...(lead.crm_data||{}), instagram_backlog:{username,url,at:now(),origin:VERSION}}
      }).eq('user_id',user).eq('id',id);
      if(error) throw error;
      document.querySelectorAll(`[data-lead-id="${css(id)}"],#atrib-insta-card-${css(id)}`).forEach(x=>x.remove());
      notify('✓ @'+username+' enviado para Backlog Instagram.');
      try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); }catch(_){ }
    }catch(e){ notify('Erro ao aprovar Instagram: '+(e?.message||e),'err'); }
    finally{ busy.delete(key); }
  }

  // CAPTURA NO WINDOW: roda antes dos listeners legados registrados no document.
  window.addEventListener('click',function(ev){
    const panel=attrPanel();
    const btn=ev.target?.closest?.('button,a,[role="button"]');
    if(!panel||!btn||!panel.contains(btn)) return;
    const txt=String(btn.textContent||btn.value||'').toLowerCase();
    const card=cardOf(btn); if(!card) return;
    if(txt.includes('invalidar')){
      const id=leadIdFrom(btn)||leadIdFrom(card); if(!id) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
      invalidateLead(id,card);
      return;
    }
    if(inputIn(card) && txt.includes('aprovar')){
      const id=leadIdFrom(btn)||leadIdFrom(card); if(!id) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
      approveInstagramBacklog(id,card);
    }
  },true);

  window.instagramV128ApproveBacklog=approveInstagramBacklog;
  window.instagramV128InvalidateAttribution=invalidateLead;
  window.approveInstagramAttributionV31=function(id){ const input=document.getElementById('atrib-insta-url-'+id); return approveInstagramBacklog(id, input?.closest?.('.empresa-card,.atrib-v64-card,.lead-card,[data-lead-id]')); };

  /* Pré-envio removido daqui: dono único agora é modules/pre-dispatch.js. */

  function patchAttributionButtons(){
    const panel=attrPanel(); if(!panel) return;
    panel.querySelectorAll('button,a,[role="button"]').forEach(btn=>{
      const t=String(btn.textContent||btn.value||'').toLowerCase();
      const card=cardOf(btn);
      if(t.includes('invalidar')){ btn.onclick=null; btn.removeAttribute('onclick'); btn.textContent='Invalidar lead'; }
      if(card && inputIn(card) && t.includes('aprovar')){ btn.onclick=null; btn.removeAttribute('onclick'); btn.textContent='Aprovar para backlog'; }
    });
  }

  function style(){
    if(document.getElementById('v128-style')) return;
    const st=document.createElement('style'); st.id='v128-style';
    st.textContent=`
      .v128-pre-source-box{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:4px}
      .v128-pre-source-label{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;color:var(--text)}
      .v128-pre-source-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .v128-pre-source-actions .btn{font-size:10px;padding:10px 14px;white-space:nowrap}
      #panel-atribuicao{overflow-x:hidden!important}
      #panel-atribuicao .empresa-card,#panel-atribuicao .atrib-v64-card{max-width:100%!important;overflow:hidden!important}
    `;
    document.head.appendChild(st);
  }

  function tick(){ style(); patchAttributionButtons(); }
  document.addEventListener('DOMContentLoaded',()=>{ tick(); setTimeout(tick,250); setTimeout(tick,900); });
  try{ new MutationObserver(()=>setTimeout(tick,60)).observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  setInterval(tick,1200);
  if(document.readyState!=='loading') setTimeout(tick,50);
  console.log('[v128] ativo',VERSION);
})();

/* Pré-envio semanal removido deste arquivo: sem normalizador/observer duplicado. */
/* Lead Certo — Atribuição: agregadores restaurados */
/* V130 — Atribuição consolidada com Agregadores restaurado.
   - Restaura a aba Agregadores sem reativar patches antigos.
   - Um único render final para WhatsApp, Com site, Agregadores e Instagram.
   - Com site/Agregadores podem ser aprovados para o Pré-envio.
   - Instagram aprova apenas para Backlog Instagram; não aloca no dia e não redireciona.
   - Invalidar continua usando a regra final: 6 - Outro automático, sem popup.
*/
(function(){
  'use strict';
  const VERSION='20260621-V130-ATRIB-AGREGADORES-CONSOLIDADO';
  const PER_PAGE=30;
  let currentTab='zap';
  let page=1;
  let rendering=false;

  function db(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function userId(){ return window.currentUser?.id || window.authUser?.id || localStorage.getItem('vs_auth_local_user_v423') || ''; }
  function esc(v){ return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function cleanUrl(url){ const u=String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
  function shortSite(url){ try{return new URL(cleanUrl(url)).hostname.replace(/^www\./,'');}catch(_){return String(url||'').replace(/^https?:\/\/(www\.)?/,'').split('/')[0];} }
  function mapsLink(l){ return cleanUrl(l?.maps_url || l?.googleUrl || l?.mapsUrl || l?.url || ''); }
  function nameLink(l){ const name=esc(l?.company_name || l?.nome || 'Sem nome'); const m=mapsLink(l); return m ? `<a href="${esc(m)}" target="_blank" rel="noopener noreferrer" class="lead-google-link">${name}</a>` : `<span>${name}</span>`; }
  function panel(){ return document.getElementById('panel-atribuicao'); }
  function normalList(){ return document.getElementById('atribList'); }
  function instaList(){ return document.getElementById('atribInstaList') || document.getElementById('atribList'); }
  function normalPag(){ return document.getElementById('atribPagination'); }
  function instaPag(){ return document.getElementById('atribInstaPagination') || document.getElementById('atribPagination'); }
  function setTxt(id,val){ const el=document.getElementById(id); if(el) el.textContent=val; }
  function stageSets(tab){
    if(tab==='com-site') return ['attribution_site','attribution_site_approved'];
    if(tab==='agregadores') return ['attribution_aggregator','attribution_aggregator_approved','attribution_agregadores','attribution_agregadores_approved'];
    if(tab==='insta') return ['attribution_instagram'];
    return ['attribution_whatsapp'];
  }
  function isApproved(l){ return String(l.pipeline_status||'')==='approved_for_queue' || String(l.current_stage||'').endsWith('_approved'); }
  function approvedStageFor(tab){ return tab==='agregadores' ? 'attribution_agregadores_approved' : 'attribution_site_approved'; }
  function sourceLabel(tab){ return tab==='agregadores'?'Agregadores':tab==='com-site'?'Com site':tab==='insta'?'Instagram':'WhatsApp'; }

  function ensureAggregatorTab(){
    const com=document.getElementById('atribTabComSite');
    const insta=document.getElementById('atribTabInsta');
    if(!com || document.getElementById('atribTabAgregadores')) return;
    const btn=com.cloneNode(true);
    btn.id='atribTabAgregadores';
    btn.setAttribute('onclick',"setAtribTab('agregadores')");
    btn.innerHTML='🔗 Agregadores <span id="atribTabAgregadoresCount" style="opacity:0.6;font-weight:400"></span>';
    btn.style.borderBottomColor='transparent';
    btn.style.color='var(--muted)';
    (insta || com).parentNode.insertBefore(btn, insta || com.nextSibling);
  }

  async function countStages(stages){
    const c=db(), uid=userId(); if(!c||!uid) return 0;
    const {count,error}=await c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid).in('current_stage',stages);
    if(error){ console.warn('[v130 count]',stages,error.message); return 0; }
    return count||0;
  }
  async function refreshCounts(){
    ensureAggregatorTab();
    const [w,s,a,i,ib]=await Promise.all([
      countStages(stageSets('zap')),
      countStages(stageSets('com-site')),
      countStages(stageSets('agregadores')),
      countStages(stageSets('insta')),
      countStages(['instagram_backlog'])
    ]);
    setTxt('atribTabZapCount',`(${w})`);
    setTxt('atribTabComSiteCount',`(${s})`);
    setTxt('atribTabAgregadoresCount',`(${a})`);
    setTxt('atribTabInstaCount',`(${i})`);
    setTxt('badge-atribuicao',String(w+s+a+i));
    setTxt('badge-instagram',String(ib));
  }

  async function fetchRows(tab){
    const c=db(), uid=userId(); if(!c||!uid) return {rows:[],total:0};
    const qv=(document.getElementById(tab==='insta'?'atribInstaBusca':'atribBusca')?.value||'').trim().replaceAll('%','');
    let q=c.from('leads').select('id,company_name,phone,normalized_phone,website,website_type,maps_url,instagram_url,instagram_username,instagram,city,state,rating,reviews_count,lead_score,current_stage,current_status,pipeline_status,created_at,category,category_name,parent_category',{count:'exact'})
      .eq('user_id',uid).in('current_stage',stageSets(tab)).order('lead_score',{ascending:false}).order('created_at',{ascending:true});
    if(qv) q=q.or(`company_name.ilike.%${qv}%,phone.ilike.%${qv}%,normalized_phone.ilike.%${qv}%,website.ilike.%${qv}%,instagram_url.ilike.%${qv}%`);
    const from=(page-1)*PER_PAGE;
    const {data,count,error}=await q.range(from,from+PER_PAGE-1);
    return {rows:data||[],total:count||0,error};
  }

  function metaCommon(l){
    return `${l.city||l.state?`<span>${esc([l.city,l.state].filter(Boolean).join('/'))}</span>`:''}${l.rating?`<span>⭐ ${esc(l.rating)} · ${esc(l.reviews_count||0)} avaliações</span>`:''}`;
  }
  function renderNormalCard(l,tab){
    const approved=isApproved(l);
    const isAgg=tab==='agregadores';
    const isSite=tab==='com-site';
    const badge=isAgg?'<span class="atrib-clean-badge agg">🔗 AGREGADOR</span>':isSite?'<span class="atrib-clean-badge site">🌐 COM SITE</span>':'<span class="atrib-clean-badge zap">💬 ZAP</span>';
    const site=l.website?`<span class="atrib-clean-site">${esc(shortSite(l.website))}</span>`:'';
    const approveBtn=(isAgg||isSite) ? (approved
      ? `<span class="v130-approved-pill">✓ Aprovado</span>`
      : `<button class="btn btn-primary v130-approve-attr" data-v130-approve="${esc(tab)}" data-lead-id="${esc(l.id)}">✓ Aprovar</button>`) : '';
    return `<div class="empresa-card atrib-clean-card" data-lead-id="${esc(l.id)}">
      <div class="empresa-info">
        <div class="empresa-nome atrib-clean-name">${nameLink(l)}</div>
        <div class="empresa-meta atrib-clean-meta">${badge}${site}${l.phone||l.normalized_phone?`<span>📱 ${esc(l.phone||l.normalized_phone)}</span>`:''}${metaCommon(l)}</div>
      </div>
      <div class="empresa-actions v130-actions">${approveBtn}<button class="btn btn-ghost">Ficha</button><button class="btn btn-danger v130-invalidar" data-lead-id="${esc(l.id)}">Invalidar lead</button></div>
    </div>`;
  }
  function renderInstaCard(l){
    const raw=l.instagram_url || l.instagram_username || l.instagram || '';
    return `<div class="empresa-card atrib-clean-card atrib-insta-card" data-lead-id="${esc(l.id)}" id="atrib-insta-card-${esc(l.id)}">
      <div class="empresa-info">
        <div class="empresa-nome atrib-clean-name">${nameLink(l)}</div>
        <div class="empresa-meta atrib-clean-meta"><span class="atrib-clean-badge insta">📸 INSTAGRAM</span>${metaCommon(l)}</div>
      </div>
      <div class="atrib-insta-input-wrap"><input id="atrib-insta-url-${esc(l.id)}" class="atrib-insta-url-input" value="${esc(raw)}" placeholder="Cole o Instagram aqui"></div>
      <div class="empresa-actions v130-actions"><button class="btn btn-primary v130-ig-backlog" data-lead-id="${esc(l.id)}">Aprovar para backlog</button><button class="btn btn-ghost">Ficha</button><button class="btn btn-danger v130-invalidar" data-lead-id="${esc(l.id)}">Invalidar lead</button></div>
    </div>`;
  }
  function updateTabsVisual(){
    ensureAggregatorTab();
    const map={zap:'atribTabZap','com-site':'atribTabComSite',agregadores:'atribTabAgregadores',insta:'atribTabInsta'};
    Object.entries(map).forEach(([tab,id])=>{ const el=document.getElementById(id); if(!el) return; const active=tab===currentTab; el.classList.toggle('active',active); el.style.borderBottomColor=active?'var(--accent)':'transparent'; el.style.color=active?'var(--accent)':'var(--muted)'; });
  }

  async function render(){
    if(rendering) return;
    rendering=true;
    try{
      ensureAggregatorTab();
      const isInsta=currentTab==='insta';
      const panelZap=document.getElementById('atribPanelZap');
      const panelInsta=document.getElementById('atribPanelInsta');
      if(panelZap) panelZap.style.display=isInsta?'none':'flex';
      if(panelInsta) panelInsta.style.display=isInsta?'flex':'none';
      updateTabsVisual();
      await refreshCounts();
      const list=isInsta?instaList():normalList();
      const pag=isInsta?instaPag():normalPag();
      if(list) list.innerHTML='<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// carregando...</div>';
      const {rows,total,error}=await fetchRows(currentTab);
      const badge=document.getElementById(isInsta?'atribInstaFilaTotalBadge':'atribTotalBadge');
      if(badge) badge.textContent=`${total} lead${total!==1?'s':''}`;
      if(error){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error);text-align:center;padding:32px">// erro: ${esc(error.message)}</div>`; return; }
      if(!rows.length){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead em ${esc(sourceLabel(currentTab))}</div>`; if(pag) pag.innerHTML=''; return; }
      if(list) list.innerHTML=`<div class="ext-list atrib-v130-list">${rows.map(l=>isInsta?renderInstaCard(l):renderNormalCard(l,currentTab)).join('')}</div>`;
      const pages=Math.max(1,Math.ceil(total/PER_PAGE)); if(page>pages) page=pages;
      if(pag) pag.innerHTML=`<div style="display:flex;justify-content:center;gap:6px;margin-top:12px;font-family:'DM Mono',monospace;font-size:10px"><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.max(1,page-1)})">←</button><span style="padding:8px;color:var(--muted)">Página ${page} de ${pages} · ${total} leads</span><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.min(pages,page+1)})">→</button></div>`;
    } finally { rendering=false; }
  }

  async function approveForPreenvio(id,tab){
    const c=db(), uid=userId(); if(!c||!uid||!id) return;
    const stage=approvedStageFor(tab);
    const {error}=await c.from('leads').update({current_stage:stage,pipeline_status:'approved_for_queue',current_status:'approved_for_queue',updated_at:new Date().toISOString()}).eq('user_id',uid).eq('id',String(id));
    if(error) return notify('// erro ao aprovar: '+error.message,'err');
    notify('✓ Lead aprovado para Pré-envio.');
    await render();
  }
  function invalidate(id,card){
    if(typeof window.instagramV128InvalidateAttribution==='function') return window.instagramV128InvalidateAttribution(id,card);
    notify('// função final de invalidar não encontrada.','err');
  }
  function approveIg(id,card){
    if(typeof window.instagramV128ApproveBacklog==='function') return window.instagramV128ApproveBacklog(id,card);
    if(typeof window.approveInstagramAttributionV31==='function') return window.approveInstagramAttributionV31(id);
    notify('// função final de aprovar Instagram não encontrada.','err');
  }

  function handleClick(ev){
    const p=panel(); if(!p||!p.contains(ev.target)) return;
    const tabBtn=ev.target.closest?.('#atribTabZap,#atribTabComSite,#atribTabAgregadores,#atribTabInsta');
    if(tabBtn){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); const id=tabBtn.id; setTab(id==='atribTabComSite'?'com-site':id==='atribTabAgregadores'?'agregadores':id==='atribTabInsta'?'insta':'zap'); return; }
    const card=ev.target.closest?.('[data-lead-id]');
    if(!card) return;
    const invalid=ev.target.closest?.('.v130-invalidar');
    if(invalid){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); invalidate(card.dataset.leadId,card); return; }
    const app=ev.target.closest?.('.v130-approve-attr');
    if(app){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); approveForPreenvio(card.dataset.leadId,app.dataset.v130Approve||currentTab); return; }
    const ig=ev.target.closest?.('.v130-ig-backlog');
    if(ig){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); approveIg(card.dataset.leadId,card); return; }
  }
  function setTab(tab){ currentTab=(tab==='com-site'||tab==='agregadores'||tab==='insta')?tab:'zap'; page=1; render(); }
  function style(){
    if(document.getElementById('v130-atrib-style')) return;
    const st=document.createElement('style'); st.id='v130-atrib-style'; st.textContent=`
      #atribTabAgregadores{background:none!important;border:none!important;border-bottom:2px solid transparent!important;color:var(--muted);font-family:'DM Mono',monospace!important;font-size:10px!important;padding:8px 18px!important;cursor:pointer!important;font-weight:700!important;transition:all .18s!important;margin-bottom:-1px!important}
      #atribTabAgregadores.active{border-bottom-color:var(--accent)!important;color:var(--accent)!important}
      .atrib-v130-list .empresa-card{min-height:64px!important;padding:13px 16px!important;align-items:center!important;overflow:visible!important}
      .atrib-clean-name,.atrib-clean-name a{font-size:14px!important;line-height:1.25!important;font-weight:800!important;color:var(--text)!important;text-decoration:none!important}
      .atrib-clean-meta{font-size:10px!important;gap:10px!important;color:var(--text2)!important;display:flex!important;align-items:center!important;flex-wrap:wrap!important}
      .atrib-clean-badge{display:inline-flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;font-size:8px!important;background:rgba(255,255,255,.04);border:1px solid var(--border2);border-radius:4px;padding:2px 7px}.atrib-clean-badge.insta{color:var(--insta)!important;border-color:rgba(225,48,108,.3)!important;background:rgba(225,48,108,.08)!important}.atrib-clean-badge.agg{color:#d6a8ff!important;border-color:rgba(214,168,255,.35)!important;background:rgba(214,168,255,.08)!important}.atrib-clean-badge.site{color:#5bb8f5!important;border-color:rgba(91,184,245,.35)!important;background:rgba(91,184,245,.08)!important}.atrib-clean-badge.zap{color:var(--ok)!important;border-color:rgba(78,203,113,.35)!important;background:rgba(78,203,113,.08)!important}
      .v130-actions{display:flex!important;gap:8px!important;align-items:center!important;flex-wrap:nowrap!important}.v130-actions .btn{font-size:9px!important;padding:7px 12px!important;white-space:nowrap!important}.v130-approved-pill{font-family:'DM Mono',monospace;font-size:9px;color:var(--accent);border:1px solid var(--accent-border);background:var(--accent-dim);border-radius:999px;padding:6px 10px;white-space:nowrap}
      .atrib-insta-input-wrap{min-width:260px;max-width:420px;flex:0 0 36%}.atrib-insta-url-input{width:100%;background:rgba(225,48,108,.06);border:1px solid rgba(225,48,108,.28);border-radius:8px;color:var(--text);font-family:'DM Mono',monospace;font-size:10px;padding:8px 10px;outline:none}.atrib-insta-url-input:focus{border-color:var(--insta);box-shadow:0 0 0 1px rgba(225,48,108,.14)}
      #panel-atribuicao{overflow-x:hidden!important}#atribList,#atribInstaList{overflow-x:hidden!important}.atrib-v130-list{overflow-x:hidden!important}
    `; document.head.appendChild(st);
  }

  window.setAtribTab=setTab;
  window.atribGoPageV31=function(p){ page=Math.max(1,Number(p)||1); render(); };
  window.renderAtribuicao=render;
  window.renderAtribuicaoPanelV31=render;
  window.renderAtribuicaoPanelFinalV130=render;

  // Lead Certo v139: navegação pertence somente ao core/router-final.js.
  // Este módulo só exporta renderAtribuicao/renderAtribuicaoPanelV31.

  document.addEventListener('click',handleClick,true);
  document.addEventListener('DOMContentLoaded',()=>{ style(); ensureAggregatorTab(); setTimeout(()=>{ refreshCounts(); if(panel()?.classList.contains('active')) render(); },450); setTimeout(()=>{ refreshCounts(); if(panel()?.classList.contains('active')) render(); },1300); });
  try{ new MutationObserver(()=>{ style(); ensureAggregatorTab(); updateTabsVisual(); }).observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  setInterval(()=>{ refreshCounts(); if(panel()?.classList.contains('active')) updateTabsVisual(); },2500);
  if(document.readyState!=='loading') setTimeout(()=>{ style(); ensureAggregatorTab(); refreshCounts(); if(panel()?.classList.contains('active')) render(); },80);
  console.log('[v130] ativo',VERSION);
})();
