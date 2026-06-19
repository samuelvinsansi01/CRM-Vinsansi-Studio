/* V65 — Agregadores + aprovação manual para Pré-envio
   - Nova aba Atribuição: Agregadores.
   - Importação separa site próprio, agregador, Instagram, WhatsApp e Facebook.
   - Com Site e Agregadores só entram no Pré-envio depois de aprovados.
   - Aprovar para fila NÃO tira o lead da aba; mantém current_stage original e marca pipeline_status.
   - Pré-envio preenche por prioridade: Com Site aprovados → Agregadores aprovados → WhatsApp puro.
   - Não cria tabela nova; usa pipeline_status para aprovação manual. */
(function(){
  'use strict';
  const VERSION='20260618-v65-agregadores-aprovacao-preenvio';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const PER_PAGE=50;
  let currentTab='zap';
  let page=1;

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
  function shortHost(value){ return hostOf(value) || String(value||'').trim(); }
  function phoneDigits(v){ return String(v||'').replace(/\D/g,''); }
  function phoneHref(v){ const d=phoneDigits(v); if(d.length<10) return ''; return `https://wa.me/${d.startsWith('55')?d:'55'+d}`; }
  function normalizeUrlIdentity(value){ return typeof window.normalizeIdentityUrlV430==='function' ? window.normalizeIdentityUrlV430(value) : String(value||'').trim().replace(/\/+$/,'').toLowerCase(); }
  function normalizeSiteIdentity(value){ return typeof window.normalizeIdentitySiteV430==='function' ? window.normalizeIdentitySiteV430(value) : hostOf(value); }
  function normalizeInstagramIdentity(value){ return typeof window.normalizeIdentityInstagramV430==='function' ? window.normalizeIdentityInstagramV430(value) : String(value||'').trim().toLowerCase(); }
  function normalizePhoneIdentity(value){ return typeof window.normalizeImportPhoneV430==='function' ? window.normalizeImportPhoneV430(value) : phoneDigits(value); }

  const AGGREGATOR_DOMAINS = [
    'bio.site','linktr.ee','beacons.ai','carrd.co','taplink.cc','msha.ke','campsite.bio','solo.to','about.me',
    'linkbio.co','lnk.bio','linkin.bio','linkfly.to','flow.page','popl.co','instabio.cc','allmylinks.com',
    'myurls.co','shor.by','bit.ly','tinyurl.com','encurtador.com.br','wa.link'
  ];
  const FACEBOOK_DOMAINS = ['facebook.com','fb.com','m.facebook.com','web.facebook.com'];
  const WHATSAPP_DOMAINS = ['wa.me','api.whatsapp.com','web.whatsapp.com','chat.whatsapp.com','whatsapp.com'];

  function domainMatches(host, domains){ return domains.some(d=>host===d || host.endsWith('.'+d)); }
  function isAggregatorSiteV65(value=''){ const h=hostOf(value); return !!h && domainMatches(h, AGGREGATOR_DOMAINS); }
  function isFacebookSiteV65(value=''){ const h=hostOf(value); return !!h && domainMatches(h, FACEBOOK_DOMAINS); }
  function isWhatsappSiteV65(value=''){ const h=hostOf(value); return !!h && domainMatches(h, WHATSAPP_DOMAINS); }
  function isInstagramSiteV65(value=''){
    if(typeof window.isInstagramWebsiteV430==='function') return window.isInstagramWebsiteV430(value);
    const h=hostOf(value); return h==='instagram.com' || h.endsWith('.instagram.com');
  }
  function isWixsiteV65(value=''){
    if(typeof window.isWixsiteWebsiteV430==='function') return window.isWixsiteWebsiteV430(value);
    const h=hostOf(value); return h==='wixsite.com' || h.endsWith('.wixsite.com');
  }

  // 1) Classificação de website reforçada.
  const previousClassify=window.classifyWebsiteOpportunityV430;
  window.classifyWebsiteOpportunityV430=function classifyWebsiteOpportunityV65(item={}){
    const site = typeof window.extractSite==='function' ? window.extractSite(item) : (item.website || item.site || '');
    if(!site) return { type:'none', websiteType:'none', websiteQuality:'missing', route:'attribution_whatsapp', site:'', reason:'sem site proprio' };
    if(isFacebookSiteV65(site)) return { type:'facebook', websiteType:'facebook', websiteQuality:'blocked', route:'skip', site, reason:'facebook não entra na prospecção' };
    if(isWhatsappSiteV65(site)) return { type:'whatsapp', websiteType:'whatsapp', websiteQuality:'social', route:'attribution_whatsapp', site:'', reason:'link de WhatsApp não é site próprio' };
    if(isInstagramSiteV65(site)) return { type:'instagram', websiteType:'instagram', websiteQuality:'social', route:'attribution_instagram', site, reason:'instagram sem site próprio' };
    if(isAggregatorSiteV65(site)) return { type:'aggregator', websiteType:'aggregator', websiteQuality:'aggregator', route:'attribution_aggregator', site, reason:'agregador/biolink exige revisão manual' };
    if(isWixsiteV65(site)) return { type:'wixsite', websiteType:'wixsite', websiteQuality:'weak', route:'attribution_site', site, reason:'wixsite passa como com site para revisão' };
    if(typeof window.isExcludedDomain==='function' && window.isExcludedDomain(site)) return { type:'excluded', websiteType:'excluded', websiteQuality:'blocked', route:'skip', site, reason:'dominio excluido manualmente' };
    if(typeof window.isSiteBlocklisted==='function' && window.isSiteBlocklisted(site)) return { type:'external', websiteType:'external', websiteQuality:'weak', route:'attribution_whatsapp', site:'', reason:'link externo sem site proprio' };
    if(typeof previousClassify==='function') {
      try {
        const prev=previousClassify(item);
        if(prev && prev.type==='commercial') return prev;
      } catch(_) {}
    }
    return { type:'commercial', websiteType:'commercial', websiteQuality:'commercial', route:'attribution_site', site, reason:'site comercial proprio' };
  };
  window.isAggregatorSiteV65=isAggregatorSiteV65;

  // 2) Análise da importação: rotas novas.
  const previousAnalyze=window.analyzeApifyLeadV430;
  window.analyzeApifyLeadV430=function analyzeApifyLeadV65(item={}, databaseIndex=null, payloadIndex=null, phase='preview'){
    const analysis = typeof previousAnalyze==='function'
      ? previousAnalyze(item,databaseIndex,payloadIndex,phase)
      : {};
    try {
      const name = typeof window.extractName==='function' ? window.extractName(item) : (item.title || item.name || item.companyName || '');
      const website = window.classifyWebsiteOpportunityV430(item);
      const hasPhone = typeof window.hasValidPhone==='function' ? window.hasValidPhone(item) : phoneDigits(item.phone || item.whatsapp).length >= 10;
      const instagram = typeof window.extractInstagram==='function' ? window.extractInstagram(item) : (item.instagram || item.instagram_url || '');
      const alreadyImported = !!analysis.alreadyImported;
      const payloadDuplicate = !!analysis.payloadDuplicate;
      const ramoMatch = analysis.ramoMatch !== false;
      const qualification = analysis.qualification || (typeof window.getApifyQualificationV430==='function' ? window.getApifyQualificationV430(item) : {approved:true,rating:0,reviews:0});

      analysis.name = analysis.name || name;
      analysis.website = website;
      analysis.hasPhone = hasPhone;
      analysis.instagram = analysis.instagram || instagram;
      analysis.qualification = qualification;

      if(!analysis.name){ analysis.route='skip'; analysis.reason='sem nome'; }
      else if(alreadyImported){ /* preserva motivo antigo */ }
      else if(payloadDuplicate){ /* preserva motivo antigo */ }
      else if(!ramoMatch){ analysis.route='skip'; analysis.reason='fora do ramo'; }
      else if(!qualification.approved){ analysis.route='skip'; analysis.reason='abaixo da qualificacao'; }
      else if(website.route==='skip'){ analysis.route='skip'; analysis.reason=website.reason; }
      else if(hasPhone && website.type==='commercial'){ analysis.route='attribution_site'; analysis.reason=website.reason; }
      else if(hasPhone && website.type==='aggregator'){ analysis.route='attribution_aggregator'; analysis.reason=website.reason; }
      else if(hasPhone && website.type==='instagram'){ analysis.route='attribution_instagram'; analysis.reason='site informado é Instagram'; }
      else if(hasPhone){ analysis.route='attribution_whatsapp'; analysis.reason=website.reason || 'com WhatsApp e sem site próprio'; }
      else if(website.type==='aggregator'){ analysis.route='attribution_instagram'; analysis.reason='sem WhatsApp e apenas agregador'; }
      else if(instagram || website.type==='instagram'){ analysis.route='attribution_instagram'; analysis.reason='sem telefone whatsapp validado'; }
      else { analysis.route='skip'; analysis.reason='sem telefone e sem instagram'; }

      if(typeof window.qualificationLogV430==='function') window.qualificationLogV430('qualification-v65-route', { phase, name:analysis.name, route:analysis.route, reason:analysis.reason, websiteType:website.type, hasPhone });
    } catch(err) {
      console.warn('[v65][analyze]',err?.message||err);
    }
    return analysis;
  };

  // 3) Preview/importação reconhecem agregadores como aprovados.
  const prevIsWhatsappRoute=window.isWhatsappImportRouteV31;
  window.isWhatsappImportRouteV31=function(route=''){
    return route==='attribution_whatsapp' || route==='attribution_site' || route==='attribution_aggregator' || (typeof prevIsWhatsappRoute==='function' && prevIsWhatsappRoute(route));
  };
  const prevStats=window.getImportStatsV430;
  window.getImportStatsV430=function getImportStatsV65(analyses=[]){
    const base=typeof prevStats==='function' ? prevStats(analyses) : {};
    const list=Array.isArray(analyses)?analyses:[];
    const aggregator=list.filter(x=>x.route==='attribution_aggregator').length;
    const com=list.filter(x=>x.route==='attribution_site').length;
    const zap=list.filter(x=>x.route==='attribution_whatsapp').length;
    const insta=list.filter(x=>x.route==='attribution_instagram').length;
    return { ...base, aggregators:aggregator, agregadores:aggregator, comSite:com, whatsappSemSite:zap, semSite:zap, instagramBacklog:insta, validWhatsapp:zap+com+aggregator, approved:zap+com+aggregator+insta };
  };

  const prevBuild=window.buildImportedLeadV430;
  window.buildImportedLeadV430=function buildImportedLeadV65(analysis, route){
    const lead=typeof prevBuild==='function' ? prevBuild(analysis, route) : {};
    const r=route || analysis?.route || lead.stage || '';
    const website=analysis?.website || {};
    if(r==='attribution_aggregator'){
      lead.site=website.site || analysis?.website?.site || lead.site || analysis?.item?.website || '';
      lead.website=lead.site;
      lead.has_own_site=false;
      lead.tipo='agregador';
      lead.canal='pendente';
      lead.stage='attribution_aggregator';
      lead.website_type='aggregator';
      lead.website_quality='aggregator';
      lead.qualification_reason=analysis?.reason || 'agregador/biolink exige revisão manual';
    }
    if(r==='attribution_whatsapp' && website.type==='whatsapp'){
      lead.site=''; lead.website=''; lead.has_own_site=false; lead.tipo='sem-site'; lead.stage='attribution_whatsapp'; lead.website_type='whatsapp';
    }
    if(r==='attribution_site'){
      lead.tipo='com-site'; lead.stage='attribution_site'; lead.has_own_site=true;
    }
    return lead;
  };

  // 4) Atribuição: adiciona aba Agregadores e aprovação manual.
  function tabStage(){
    if(currentTab==='com-site') return 'attribution_site';
    if(currentTab==='agregadores') return 'attribution_aggregator';
    if(currentTab==='insta') return 'attribution_instagram';
    return 'attribution_whatsapp';
  }
  function tabStages(){
    // Compatibilidade: versões antigas moviam o lead aprovado para *_approved.
    // A regra nova mantém o lead na aba original e usa pipeline_status=approved_for_queue.
    if(currentTab==='com-site') return ['attribution_site','attribution_site_approved'];
    if(currentTab==='agregadores') return ['attribution_aggregator','attribution_aggregator_approved'];
    if(currentTab==='insta') return ['attribution_instagram'];
    return ['attribution_whatsapp'];
  }
  function tabBadge(){
    if(currentTab==='com-site') return '<span class="atrib-v64-badge site">🌐 COM SITE</span>';
    if(currentTab==='agregadores') return '<span class="atrib-v64-badge aggregator">🔗 AGREGADOR</span>';
    if(currentTab==='insta') return '<span class="atrib-v64-badge insta">📸 INSTAGRAM</span>';
    return '<span class="atrib-v64-badge zap">💬 ZAP</span>';
  }
  function linkSite(l){ if(!l.website) return ''; return `<a class="atrib-v64-link site" href="${esc(cleanUrl(l.website))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🌐 ${esc(shortHost(l.website))}</a>`; }
  function linkZap(l){ const p=l.phone||l.normalized_phone||''; const href=phoneHref(p); if(!href) return ''; return `<a class="atrib-v64-link zap" href="${esc(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">💬 WhatsApp</a>`; }
  function linkInsta(l){ const u=l.instagram_url || l.instagram || ''; if(!u) return ''; return `<a class="atrib-v64-link insta" href="${esc(cleanUrl(String(u).startsWith('@')?'instagram.com/'+String(u).slice(1):u))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📸 Instagram</a>`; }
  function mapsUrl(l){ return cleanUrl(l.maps_url || l.googleUrl || l.mapsUrl || ''); }
  function nameHtml(l){ const name=esc(l.company_name || l.nome || l.name || 'Lead sem nome'); const maps=mapsUrl(l); return maps?`<a href="${esc(maps)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${name}</a>`:`<span>${name}</span>`; }
  async function countStage(stage){ const c=sb(); if(!c) return 0; const {count,error}=await c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid()).eq('current_stage',stage); if(error){console.warn('[v65][count]',stage,error.message); return 0;} return count||0; }
  async function countStages(stages){
    const c=sb(); if(!c) return 0;
    const arr=Array.isArray(stages)?stages:[stages];
    const {count,error}=await c.from('leads').select('id',{count:'exact',head:true}).eq('user_id',uid()).in('current_stage',arr);
    if(error){console.warn('[v65][count-stages]',arr,error.message); return 0;}
    return count||0;
  }
  async function refreshCounts(){
    const [w,s,a,i,ib]=await Promise.all([countStage('attribution_whatsapp'),countStages(['attribution_site','attribution_site_approved']),countStages(['attribution_aggregator','attribution_aggregator_approved']),countStage('attribution_instagram'),countStage('instagram_backlog')]);
    const setTxt=(id,v)=>document.querySelectorAll('#'+CSS.escape(id)).forEach(el=>{el.textContent=v;});
    setTxt('atribTabZapCount',`(${w})`); setTxt('atribTabComSiteCount',`(${s})`); setTxt('atribTabAgregadoresCount',`(${a})`); setTxt('atribTabInstaCount',`(${i})`); setTxt('badge-atribuicao',String(w+s+a+i)); setTxt('badge-instagram',String(ib));
  }
  function ensureAggregatorTab(){
    const com=document.getElementById('atribTabComSite');
    if(!com || document.getElementById('atribTabAgregadores')) return;
    const btn=document.createElement('button');
    btn.id='atribTabAgregadores';
    btn.className='nav-tab';
    btn.type='button';
    btn.setAttribute('onclick',"setAtribTab('agregadores')");
    btn.innerHTML='🔗 Agregadores <span id="atribTabAgregadoresCount" style="opacity:0.6;font-weight:400"></span>';
    com.insertAdjacentElement('afterend',btn);
  }
  async function fetchRows(){
    const c=sb(); if(!c) return {rows:[],total:0};
    const inputId=currentTab==='insta'?'atribInstaBusca':'atribBusca';
    const qv=(document.getElementById(inputId)?.value||'').trim().replaceAll('%','');
    let q=c.from('leads')
      .select('id,company_name,phone,normalized_phone,website,maps_url,instagram,instagram_url,city,state,rating,reviews_count,lead_score,current_stage,created_at,lead_type,website_type,pipeline_status',{count:'exact'})
      .eq('user_id',uid()).in('current_stage',tabStages())
      .order('lead_score',{ascending:false}).order('created_at',{ascending:true});
    if(qv) q=q.or(`company_name.ilike.%${qv}%,phone.ilike.%${qv}%,normalized_phone.ilike.%${qv}%,website.ilike.%${qv}%,instagram_url.ilike.%${qv}%`);
    const from=(page-1)*PER_PAGE;
    const {data,count,error}=await q.range(from,from+PER_PAGE-1);
    return {rows:data||[],total:count||0,error};
  }
  function card(l){
    const isInsta=currentTab==='insta';
    const canApprove=currentTab==='com-site' || currentTab==='agregadores';
    const links=[linkSite(l),linkZap(l),linkInsta(l)].filter(Boolean).join('');
    const instaInput=isInsta ? `<div class="atrib-v64-insta-input-wrap"><input id="atrib-insta-url-${esc(l.id)}" class="atrib-insta-url-input" type="text" placeholder="Cole o Instagram aqui" value="${esc(l.instagram_url||'')}" onpaste="setTimeout(()=>approveInstagramAttributionV31('${esc(l.id)}'),80)" onchange="approveInstagramAttributionV31('${esc(l.id)}')" onkeydown="if(event.key==='Enter') approveInstagramAttributionV31('${esc(l.id)}')"></div>` : '';
    const approved = String(l.pipeline_status||'')==='approved_for_queue' || String(l.current_stage||'').endsWith('_approved');
    const approveBtn=canApprove
      ? (approved
        ? `<button class="btn btn-ghost v65-approve-queue is-approved" style="font-size:9px;padding:6px 10px;white-space:nowrap;border-color:rgba(174,255,70,.45);color:var(--accent);" disabled>✓ Aprovado para fila</button>`
        : `<button class="btn btn-primary v65-approve-queue" style="font-size:9px;padding:6px 10px;white-space:nowrap" onclick="event.preventDefault();event.stopPropagation();aprovarLeadAtribuicaoParaFilaV65('${esc(l.id)}','${esc(currentTab)}');return false;">✓ Aprovar para fila</button>`)
      : '';
    const invalidFn = currentTab==='insta' ? 'invalidarLeadInstagramBaseV47' : 'invalidarLeadAtribuicaoV58';
    const canInvalid = (currentTab==='com-site'||currentTab==='agregadores'||currentTab==='insta') && typeof window[invalidFn]==='function';
    const invalidBtn=canInvalid
      ? `<button class="btn btn-ghost v58-invalid-atrib" style="font-size:9px;padding:6px 10px;border-color:rgba(255,80,80,.45);color:var(--error);white-space:nowrap" onclick="event.preventDefault();event.stopPropagation();window['${invalidFn}']('${esc(l.id)}');return false;">Invalidar lead</button>` : '';
    return `<div class="empresa-card atrib-v64-card" data-lead-id="${esc(l.id)}"><div class="empresa-info atrib-v64-info"><div class="empresa-nome atrib-v64-name">${nameHtml(l)}</div><div class="empresa-meta atrib-v64-meta">${tabBadge()}${links || '<span class="atrib-v64-muted">Sem link salvo</span>'}</div></div>${instaInput}<div class="empresa-actions atrib-v64-actions"><button class="btn btn-ghost" style="font-size:9px;padding:6px 10px" onclick="event.stopPropagation();openLeadDrawer('${esc(l.id)}')">Ficha</button>${approveBtn}${invalidBtn}</div></div>`;
  }
  function applyStyles(){
    if(!document.getElementById('v64-atrib-styles') && window.renderAtribuicaoPanelV31) {}
    if(document.getElementById('v65-atrib-styles')) return;
    const st=document.createElement('style'); st.id='v65-atrib-styles'; st.textContent=`
      .atrib-v64-badge.aggregator{color:#d7a8ff;border-color:rgba(215,168,255,.35);background:rgba(215,168,255,.08)}
      #atribTabAgregadores.active{color:var(--accent)!important;border-bottom-color:var(--accent)!important;}
    `; document.head.appendChild(st);
  }
  async function renderAtribuicaoV65(){
    ensureAggregatorTab(); applyStyles(); await refreshCounts();
    ['atribTabZap','atribTabComSite','atribTabAgregadores','atribTabInsta'].forEach(id=>document.getElementById(id)?.classList.remove('active'));
    const activeId=currentTab==='com-site'?'atribTabComSite':currentTab==='agregadores'?'atribTabAgregadores':currentTab==='insta'?'atribTabInsta':'atribTabZap';
    document.getElementById(activeId)?.classList.add('active');
    const isInsta=currentTab==='insta';
    const panelZap=document.getElementById('atribPanelZap'); const panelInsta=document.getElementById('atribPanelInsta');
    if(panelZap) panelZap.style.display=isInsta?'none':'flex'; if(panelInsta) panelInsta.style.display=isInsta?'flex':'none';
    const list=document.getElementById(isInsta?'atribInstaList':'atribList'); const pag=document.getElementById(isInsta?'atribInstaPagination':'atribPagination'); const badgeEl=document.getElementById(isInsta?'atribInstaFilaTotalBadge':'atribTotalBadge');
    if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// carregando...</div>`;
    const {rows,total,error}=await fetchRows();
    if(badgeEl) badgeEl.textContent=`${total} lead${total!==1?'s':''}`;
    if(error){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--error);text-align:center;padding:32px">// erro: ${esc(error.message)}</div>`; return; }
    if(!rows.length){ if(list) list.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhum lead em ${esc(tabStage())}</div>`; if(pag) pag.innerHTML=''; return; }
    if(list) list.innerHTML='<div class="ext-list atrib-v64-list">'+rows.map(card).join('')+'</div>';
    const totalPages=Math.max(1,Math.ceil(total/PER_PAGE)); if(page>totalPages) page=totalPages;
    if(pag) pag.innerHTML=`<div style="display:flex;justify-content:center;gap:6px;margin-top:12px;font-family:'DM Mono',monospace;font-size:10px"><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.max(1,page-1)})">←</button><span style="padding:8px;color:var(--muted)">Página ${page} de ${totalPages} · ${total} leads</span><button class="btn btn-ghost" onclick="atribGoPageV31(${Math.min(totalPages,page+1)})">→</button></div>`;
  }
  window.aprovarLeadAtribuicaoParaFilaV65=async function(id,tab){
    const c=sb(); if(!c) return notify('// Supabase indisponível','err');
    const baseStage = tab==='agregadores' ? 'attribution_aggregator' : 'attribution_site';
    const type = tab==='agregadores' ? 'agregador' : 'com-site';
    // Regra nova: aprovar para fila apenas sinaliza o lead. Ele continua visível na aba de Atribuição.
    // Compatibilidade: se uma versão anterior já moveu para *_approved, traz de volta para a aba base.
    const {error}=await c.from('leads').update({ current_stage:baseStage, lead_type:type, pipeline_status:'approved_for_queue', updated_at:new Date().toISOString() }).eq('user_id',uid()).eq('id',id);
    if(error) return notify('// erro ao aprovar lead: '+error.message,'err');
    notify('✓ Lead sinalizado para o Pré-envio e mantido na Atribuição');
    await renderAtribuicaoV65();
    if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true);
  };
  window.setAtribTab=function(tab){ currentTab=(tab==='com-site'||tab==='insta'||tab==='agregadores')?tab:'zap'; page=1; renderAtribuicaoV65(); };
  window.atribGoPageV31=function(p){ page=Math.max(1,Number(p)||1); renderAtribuicaoV65(); };
  window.renderAtribuicaoPanelV31=renderAtribuicaoV65;
  window.renderAtribuicao=renderAtribuicaoV65;

  // 5) Pré-envio: puxa aprovados de Com Site/Agregadores antes de WhatsApp puro.
  async function fetchChipsV65(){
    const c=sb(); if(!c) return [];
    const {data,error}=await c.from('whatsapp_instances').select('id,instance,label,name,chip_id,daily_limit,active,status').eq('user_id',uid()).eq('active',true).order('created_at',{ascending:true});
    if(error){ console.warn('[v65][chips]',error.message); return []; }
    return (data||[]).filter(ch=>ch.instance || ch.label || ch.chip_id).map(ch=>({ ...ch, instance:String(ch.instance || ch.chip_id || ch.label), label:String(ch.label || ch.name || ch.instance || ch.chip_id) }));
  }
  async function fetchStageLeads(stage, limit, excludeIds=[]){
    const c=sb(); if(!c || limit<=0) return [];
    let q=c.from('leads').select('id,company_name,phone,normalized_phone,website,maps_url,current_stage,created_at,lead_score,rating,reviews_count,lead_type,website_type,pipeline_status').eq('user_id',uid()).eq('current_stage',stage).order('lead_score',{ascending:false}).order('created_at',{ascending:true}).limit(limit + 50);
    if(excludeIds.length) q=q.not('id','in',`(${excludeIds.map(x=>`"${String(x).replace(/"/g,'')}"`).join(',')})`);
    const {data,error}=await q;
    if(error){ console.warn('[v65][fetch-stage]',stage,error.message); return []; }
    return (data||[]).slice(0,limit);
  }
  async function fetchApprovedAttributionLeads(baseStage, legacyApprovedStage, limit, excludeIds=[]){
    const c=sb(); if(!c || limit<=0) return [];
    const stages=[baseStage,legacyApprovedStage].filter(Boolean);
    let q=c.from('leads').select('id,company_name,phone,normalized_phone,website,maps_url,current_stage,created_at,lead_score,rating,reviews_count,lead_type,website_type,pipeline_status').eq('user_id',uid()).in('current_stage',stages).or(`pipeline_status.eq.approved_for_queue,current_stage.eq.${legacyApprovedStage}`).order('lead_score',{ascending:false}).order('created_at',{ascending:true}).limit(limit + 50);
    if(excludeIds.length) q=q.not('id','in',`(${excludeIds.map(x=>`"${String(x).replace(/"/g,'')}"`).join(',')})`);
    const {data,error}=await q;
    if(error){ console.warn('[v65][fetch-approved-stage]',baseStage,error.message); return []; }
    return (data||[]).slice(0,limit);
  }
  async function fetchPriorityLeads(limit, excludeIds=[]){
    let remain=Number(limit)||0; const out=[]; const excluded=[...excludeIds];
    const groups=[
      ()=>fetchApprovedAttributionLeads('attribution_site','attribution_site_approved',remain,excluded),
      ()=>fetchApprovedAttributionLeads('attribution_aggregator','attribution_aggregator_approved',remain,excluded),
      ()=>fetchStageLeads('attribution_whatsapp',remain,excluded)
    ];
    for(const getRows of groups){
      if(remain<=0) break;
      const rows=await getRows();
      out.push(...rows); rows.forEach(r=>excluded.push(r.id)); remain=limit-out.length;
    }
    return out.slice(0,limit);
  }
  function leadType(l){
    const st=String(l.current_stage||'');
    if(st.includes('aggregator')) return 'agregador';
    if(st.includes('site') || String(l.website||'').trim()) return 'com-site';
    return 'sem-site';
  }
  function activePreDate(){
    return (document.querySelector('#preWeekCards .pre-day-card.active')?.getAttribute('data-date') || document.getElementById('preEnvioRoot')?.getAttribute('data-selected-date') || window.__selectedPreEnvioDateV317 || new Date().toISOString().slice(0,10)).slice(0,10);
  }
  function activeChip(){ return window.__selectedPreEnvioChipV50 || window.__selectedPreEnvioChipV317 || 'all'; }
  window.createPreSendBatchV31=async function createPreSendBatchV65(){
    const c=sb(); if(!c) return notify('// Supabase indisponível','err');
    const targetDate=activePreDate();
    const allChips=await fetchChipsV65();
    if(!allChips.length) return notify('// nenhum chip ativo encontrado','warn');
    const selected=activeChip();
    const chips=(selected && selected!=='all') ? allChips.filter(ch=>String(ch.instance)===String(selected)||String(ch.label)===String(selected)||String(ch.chip_id)===String(selected)) : allChips;
    if(!chips.length) return notify('// chip selecionado não encontrado ou inativo','warn');
    let totalCreated=0; const alreadyAll=[];
    for(const chip of chips){
      const limit=Number(chip.daily_limit || 120) || 120;
      const {data:existing,error:exErr}=await c.from('pre_dispatch_items').select('lead_id').eq('user_id',uid()).eq('scheduled_date',targetDate).eq('chip_instance',chip.instance);
      if(exErr){ console.warn('[v65][existing-pre]',exErr.message); continue; }
      const existingIds=(existing||[]).map(x=>x.lead_id).filter(Boolean);
      alreadyAll.push(...existingIds);
      const need=Math.max(0,limit-existingIds.length);
      if(need<=0) continue;
      const leads=await fetchPriorityLeads(need, alreadyAll);
      if(!leads.length) continue;
      alreadyAll.push(...leads.map(l=>l.id));
      const rows=leads.map((lead,i)=>({ user_id:uid(), lead_id:lead.id, chip_instance:chip.instance, chip_label:String(chip.label||chip.instance), scheduled_date:targetDate, lead_type:leadType(lead), status:'review', position:(existingIds.length+i+1), raw_payload:{ origin_stage:lead.current_stage, approved_in_attribution: ['attribution_site_approved','attribution_aggregator_approved'].includes(String(lead.current_stage||'')), priority_source:lead.current_stage } }));
      const {error:insErr}=await c.from('pre_dispatch_items').insert(rows);
      if(insErr){ console.warn('[v65][insert-pre]',insErr.message); continue; }
      await c.from('leads').update({ current_stage:'pre_send', updated_at:new Date().toISOString() }).eq('user_id',uid()).in('id',leads.map(l=>l.id));
      totalCreated+=leads.length;
    }
    if(!totalCreated) return notify('// nenhum lead novo preenchido. Verifique aprovados em Com Site/Agregadores ou leads WhatsApp disponíveis.','warn');
    notify(`✓ ${totalCreated} lead(s) preenchidos no pré-envio de ${targetDate}${selected!=='all'?' · chip '+selected:''}`);
    if(typeof window.renderPreEnvioPanelV31==='function') await window.renderPreEnvioPanelV31();
    if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true);
  };

  // 6) Badges de menu incluindo agregadores.
  async function refreshMenuBadgesV65(force=false){
    const [w,s,a,i,ib,base,pre,queue]=await Promise.all([
      countStage('attribution_whatsapp'),countStages(['attribution_site','attribution_site_approved']),countStages(['attribution_aggregator','attribution_aggregator_approved']),countStage('attribution_instagram'),countStage('instagram_backlog'),
      (async()=>{ const c=sb(); if(!c)return 0; const {count}=await c.from('base_permanente').select('id',{count:'exact',head:true}).eq('user_id',uid()); return count||0; })(),
      (async()=>{ const c=sb(); if(!c)return 0; const {count}=await c.from('pre_dispatch_items').select('id',{count:'exact',head:true}).eq('user_id',uid()).in('status',['review','pending_review','validation_retry','validation_error']); return count||0; })(),
      (async()=>{ const c=sb(); if(!c)return 0; const {count}=await c.from('pre_dispatch_items').select('id',{count:'exact',head:true}).eq('user_id',uid()).in('status',['approved','ready_to_dispatch','queued','dispatch_queue','waiting','not_sent','ready','pending','scheduled']); return count||0; })()
    ]);
    const setN=(id,v)=>document.querySelectorAll('#'+CSS.escape(id)).forEach(el=>{el.textContent=String(v);});
    setN('badge-atribuicao',w+s+a+i); setN('badge-pre-envio',pre); setN('badge-fila-zap',queue); setN('badge-instagram',ib); setN('badge-ja-enviados',base);
    document.querySelectorAll('#atribTabZapCount').forEach(el=>el.textContent=`(${w})`); document.querySelectorAll('#atribTabComSiteCount').forEach(el=>el.textContent=`(${s})`); document.querySelectorAll('#atribTabAgregadoresCount').forEach(el=>el.textContent=`(${a})`); document.querySelectorAll('#atribTabInstaCount').forEach(el=>el.textContent=`(${i})`);
  }
  window.updateMenuBadgesTotalsV65=refreshMenuBadgesV65;
  const prevUpdateBadges=window.updateBadges;
  window.updateBadges=function(){ try{ if(typeof prevUpdateBadges==='function') prevUpdateBadges.apply(this,arguments); }catch(e){} refreshMenuBadgesV65(false); };

  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('#atribTabZap,#atribTabComSite,#atribTabAgregadores,#atribTabInsta');
    if(btn){ e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); const id=btn.id; window.setAtribTab(id==='atribTabComSite'?'com-site':id==='atribTabAgregadores'?'agregadores':id==='atribTabInsta'?'insta':'zap'); return; }
  },true);
  document.addEventListener('DOMContentLoaded',()=>{ ensureAggregatorTab(); applyStyles(); setTimeout(()=>refreshMenuBadgesV65(true),700); if(document.getElementById('panel-atribuicao')?.classList.contains('active')) renderAtribuicaoV65(); });
  if(document.readyState!=='loading') setTimeout(()=>{ ensureAggregatorTab(); applyStyles(); refreshMenuBadgesV65(true); if(document.getElementById('panel-atribuicao')?.classList.contains('active')) renderAtribuicaoV65(); },600);

  window.__V65_AGREGADORES_APROVACAO_PREENVIO__=VERSION;
})();
