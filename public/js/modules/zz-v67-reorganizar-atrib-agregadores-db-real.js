/* V67 — Reorganização segura da Atribuição + visual da aba Agregadores (DB real)
   - Corrige visual da aba Agregadores para seguir o mesmo inline style das demais abas.
   - Reforça classificação de websites sociais/agregadores já existentes.
   - Adiciona botão para reorganizar todos os leads ainda na Atribuição, sem mexer em Pré-envio/Fila/CRM.
   - Preserva aprovações manuais quando o lead continuar sendo Com Site ou Agregador. */
(function(){
  'use strict';
  const VERSION='20260618-v67-reorganizar-atrib-agregadores-db-real';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const PAGE_SIZE=1000;
  const ATTR_STAGES=[
    'attribution_whatsapp','attribution_site','attribution_aggregator','attribution_instagram',
    'attribution_site_approved','attribution_aggregator_approved'
  ];

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined'&&currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;} }
  function notify(msg,type){ if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function cleanUrl(url){ const u=String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`; }
  function hostOf(value){
    const raw=String(value||'').trim(); if(!raw) return '';
    try { return new URL(cleanUrl(raw)).hostname.replace(/^www\./i,'').toLowerCase(); }
    catch(_) { return raw.replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].trim().toLowerCase(); }
  }
  function phoneDigits(v){ return String(v||'').replace(/\D/g,''); }
  function hasZap(lead){ return phoneDigits(lead.normalized_phone || lead.phone || lead.whatsapp || '').length >= 10; }
  function matches(host, domains){ return domains.some(d=>host===d || host.endsWith('.'+d)); }

  const INSTAGRAM_DOMAINS=['instagram.com','instagram.com.br','instagr.am'];
  const FACEBOOK_DOMAINS=['facebook.com','fb.com','m.facebook.com','web.facebook.com','facebook.com.br'];
  const WHATSAPP_DOMAINS=['wa.me','api.whatsapp.com','web.whatsapp.com','chat.whatsapp.com','whatsapp.com'];
  const AGGREGATOR_DOMAINS=[
    'bio.site','linktr.ee','beacons.ai','carrd.co','taplink.cc','msha.ke','campsite.bio','solo.to','about.me',
    'linkbio.co','lnk.bio','linkin.bio','linkfly.to','flow.page','popl.co','instabio.cc','allmylinks.com',
    'myurls.co','shor.by','bit.ly','tinyurl.com','encurtador.com.br','wa.link','heylink.me','contate.me',
    'linklist.bio','tap.bio','bio.link','bento.me','withkoji.com','komi.io','direct.me'
  ];

  function classifySiteValue(value){
    const site=String(value||'').trim();
    const host=hostOf(site);
    if(!host) return 'none';
    if(matches(host, FACEBOOK_DOMAINS)) return 'facebook';
    if(matches(host, WHATSAPP_DOMAINS)) return 'whatsapp';
    if(matches(host, INSTAGRAM_DOMAINS)) return 'instagram';
    if(matches(host, AGGREGATOR_DOMAINS)) return 'aggregator';
    return 'own_site';
  }

  const prevClassify=window.classifyWebsiteOpportunityV430;
  window.classifyWebsiteOpportunityV430=function classifyWebsiteOpportunityV66(item={}){
    const site = typeof window.extractSite==='function' ? window.extractSite(item) : (item.website || '');
    const kind=classifySiteValue(site);
    if(kind==='none') return { type:'none', websiteType:'none', websiteQuality:'missing', route:'attribution_whatsapp', site:'', reason:'sem site proprio' };
    if(kind==='facebook') return { type:'facebook', websiteType:'facebook', websiteQuality:'blocked', route:'skip', site, reason:'facebook não entra na prospecção' };
    if(kind==='whatsapp') return { type:'whatsapp', websiteType:'whatsapp', websiteQuality:'social', route:'attribution_whatsapp', site:'', reason:'link de WhatsApp não é site próprio' };
    if(kind==='instagram') return { type:'instagram', websiteType:'instagram', websiteQuality:'social', route:'attribution_instagram', site, reason:'website informado é Instagram' };
    if(kind==='aggregator') return { type:'aggregator', websiteType:'aggregator', websiteQuality:'aggregator', route:'attribution_aggregator', site, reason:'agregador/biolink exige revisão manual' };
    if(typeof prevClassify==='function'){
      try{
        const prev=prevClassify(item);
        if(prev && prev.type && !['none','instagram','facebook','whatsapp','aggregator'].includes(prev.type)) return prev;
      }catch(_){}
    }
    return { type:'commercial', websiteType:'commercial', websiteQuality:'commercial', route:'attribution_site', site, reason:'site comercial proprio' };
  };

  function desiredStage(lead){
    const approved=String(lead.current_stage||'').endsWith('_approved');
    const kind=classifySiteValue(lead.website || '');
    const zap=hasZap(lead);
    let target='attribution_instagram';
    let website_type=kind;
    let lead_type='instagram';
    let has_own_site=false;
    let invalid=false;
    let reason='';

    if(kind==='facebook'){
      invalid=true; target='invalidated'; reason='facebook como website'; lead_type='invalidado'; website_type='facebook';
    } else if(kind==='whatsapp'){
      target=zap?'attribution_whatsapp':'attribution_instagram'; lead_type=zap?'sem-site':'instagram'; website_type='whatsapp';
    } else if(kind==='instagram'){
      target='attribution_instagram'; lead_type='instagram'; website_type='instagram';
    } else if(kind==='aggregator'){
      target=zap ? (approved ? 'attribution_aggregator_approved' : 'attribution_aggregator') : 'attribution_instagram';
      lead_type=zap?'agregador':'instagram'; website_type='aggregator';
    } else if(kind==='own_site'){
      target=zap ? (approved ? 'attribution_site_approved' : 'attribution_site') : 'attribution_instagram';
      lead_type=zap?'com-site':'instagram'; website_type='commercial'; has_own_site=zap;
    } else {
      target=zap?'attribution_whatsapp':'attribution_instagram'; lead_type=zap?'sem-site':'instagram'; website_type='none';
    }
    return {target, lead_type, website_type, has_own_site, invalid, reason};
  }

  function applyTabStyle(btn, active){
    if(!btn) return;
    btn.className='';
    btn.style.background='none';
    btn.style.border='none';
    btn.style.borderBottom=`2px solid ${active?'var(--accent)':'transparent'}`;
    btn.style.color=active?'var(--accent)':'var(--muted)';
    btn.style.fontFamily="'DM Mono',monospace";
    btn.style.fontSize='10px';
    btn.style.padding='8px 18px';
    btn.style.cursor='pointer';
    btn.style.fontWeight='700';
    btn.style.transition='all 0.18s';
    btn.style.marginBottom='-1px';
  }
  function normalizeTabsVisual(){
    const ids=['atribTabZap','atribTabComSite','atribTabAgregadores','atribTabInsta'];
    ids.forEach(id=>applyTabStyle(document.getElementById(id), document.getElementById(id)?.classList.contains('active')));
  }
  function ensureReorganizeButton(){
    const header=document.querySelector('#panel-atribuicao .page-header');
    if(!header || document.getElementById('v67ReorganizarAtribBtn')) return;
    const wrap=document.createElement('div');
    wrap.style.display='flex'; wrap.style.gap='8px'; wrap.style.alignItems='center';
    wrap.innerHTML=`<button id="v67ReorganizarAtribBtn" class="btn btn-ghost" type="button" style="font-size:10px;padding:8px 12px">↻ Reorganizar leads</button>`;
    header.appendChild(wrap);
    document.getElementById('v67ReorganizarAtribBtn').addEventListener('click',()=>window.reorganizarLeadsAtribuicaoV67());
  }
  function addStyles(){
    if(document.getElementById('v67-atrib-styles')) return;
    const st=document.createElement('style'); st.id='v67-atrib-styles'; st.textContent=`
      #atribTabAgregadores{background:none!important;border:none!important;border-bottom:2px solid transparent!important;color:var(--muted)!important;font-family:'DM Mono',monospace!important;font-size:10px!important;padding:8px 18px!important;cursor:pointer!important;font-weight:700!important;transition:all .18s!important;margin-bottom:-1px!important;}
      #atribTabAgregadores.active{border-bottom-color:var(--accent)!important;color:var(--accent)!important;}
      .v67-reorg-running{opacity:.65;pointer-events:none;}
    `; document.head.appendChild(st);
  }

  async function fetchAllAttributionLeads(){
    const c=sb(); if(!c) return [];
    const rows=[];
    for(let from=0;;from+=PAGE_SIZE){
      const to=from+PAGE_SIZE-1;
      const {data,error}=await c.from('leads')
        .select('id,company_name,phone,normalized_phone,website,instagram_url,instagram,current_stage,lead_type,website_type,has_own_site,city,state,rating,reviews_count,category,category_name,categories,maps_url,raw_payload')
        .eq('user_id',uid()).in('current_stage',ATTR_STAGES).range(from,to);
      if(error){ throw error; }
      rows.push(...(data||[]));
      if(!data || data.length<PAGE_SIZE) break;
    }
    return rows;
  }
  async function insertBasePermanenteForFacebook(leads){
    const c=sb(); if(!c || !leads.length) return;
    const now=new Date().toISOString();
    const rows=leads.map(l=>({
      user_id:uid(), company_name:l.company_name || '', phone:l.phone || '', normalized_phone:l.normalized_phone || '', website:l.website || '',
      instagram_url:l.instagram_url || l.instagram || '', maps_url:l.maps_url || '', city:l.city || '', state:l.state || '',
      rating:l.rating ?? null, reviews_count:l.reviews_count ?? null, category:l.category || l.category_name || '', categories:l.categories || null,
      status:'invalidated', invalid_reason:'facebook como website', invalid_source:'reorganizar_atribuicao_v67', invalidated_at:now,
      source:'attribution_reorganizer_v67', raw_payload:l.raw_payload || null, created_at:now, updated_at:now
    }));
    // upsert por id não é possível aqui porque a base pode ter constraints diferentes; insert tolera erro sem quebrar reorganização.
    const {error}=await c.from('base_permanente').insert(rows);
    if(error) console.warn('[v67][base-permanente-facebook]',error.message);
  }

  window.reorganizarLeadsAtribuicaoV67=async function(){
    const c=sb(); if(!c) return notify('// Supabase indisponível','err');
    const ok=confirm('Reorganizar todos os leads que ainda estão na Atribuição?\n\nIsso não mexe em Pré-envio, Fila, Disparos ou Conversas.\nFacebook será invalidado e enviado para Base Permanente.');
    if(!ok) return;
    const btn=document.getElementById('v67ReorganizarAtribBtn');
    if(btn){ btn.classList.add('v67-reorg-running'); btn.textContent='reorganizando...'; }
    try{
      const leads=await fetchAllAttributionLeads();
      const updates=[]; const facebook=[];
      for(const lead of leads){
        const d=desiredStage(lead);
        if(d.invalid){ facebook.push(lead); }
        const patch={ current_stage:d.target, lead_type:d.lead_type, website_type:d.website_type, has_own_site:d.has_own_site, updated_at:new Date().toISOString() };
        // Evita update desnecessário quando já está tudo certo.
        if(String(lead.current_stage||'')!==String(patch.current_stage)||String(lead.lead_type||'')!==String(patch.lead_type)||String(lead.website_type||'')!==String(patch.website_type)||Boolean(lead.has_own_site)!==Boolean(patch.has_own_site)){
          updates.push({id:lead.id, patch});
        }
      }
      if(facebook.length) await insertBasePermanenteForFacebook(facebook);
      for(let i=0;i<updates.length;i+=100){
        const chunk=updates.slice(i,i+100);
        await Promise.all(chunk.map(u=>c.from('leads').update(u.patch).eq('user_id',uid()).eq('id',u.id)));
      }
      notify(`✓ Reorganização concluída: ${updates.length} lead(s) ajustados${facebook.length?` · ${facebook.length} facebook invalidado(s)`:''}`);
      if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31();
      if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true);
      else if(typeof window.updateBadges==='function') window.updateBadges();
    }catch(e){
      console.error('[v67][reorganizar]',e); notify('// erro ao reorganizar: '+(e.message||e),'err');
    }finally{
      if(btn){ btn.classList.remove('v67-reorg-running'); btn.textContent='↻ Reorganizar leads'; }
    }
  };

  const prevSet=window.setAtribTab;
  window.setAtribTab=function(tab){
    if(typeof prevSet==='function') prevSet(tab);
    setTimeout(normalizeTabsVisual,50);
  };

  function boot(){ addStyles(); ensureReorganizeButton(); normalizeTabsVisual(); }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,900));
  if(document.readyState!=='loading') setTimeout(boot,900);
  document.addEventListener('click',e=>{ if(e.target.closest?.('#atribTabZap,#atribTabComSite,#atribTabAgregadores,#atribTabInsta')) setTimeout(normalizeTabsVisual,30); },true);

  window.__V67_REORGANIZAR_ATRIB_AGREGADORES_DB_REAL__=VERSION;
})();
