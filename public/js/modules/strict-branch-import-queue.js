/* V86 — Segurança de ramo estrito: importação + fila não criam ramo automaticamente.
   - Se categoria/subcategoria do lead não bater com ramo cadastrado, não passa na importação.
   - A fila/disparo bloqueia lead fora dos ramos cadastrados.
   - Não altera banco, não mexe em pré-envio/conversas/base permanente. */
(function(){
  'use strict';
  const VERSION='20260618-V86-RAMO-ESTRITO-IMPORTACAO-FILA';

  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
  function slug(v){return norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'geral';}
  function unique(arr){return [...new Set((arr||[]).map(x=>String(x||'').trim()).filter(Boolean))];}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function getImportRules(){try{return JSON.parse(localStorage.getItem('vs_import_rules_v108')||'{}')||{};}catch(_){return {};}}

  const MOVEIS=['marcenaria','marceneiro','moveleiro','moveis planejados','móveis planejados','movelaria','moveis sob medida','móveis sob medida','carpintaria','armarios planejados','armários planejados','cozinhas planejadas','dormitorios planejados','dormitórios planejados','moveis','móveis','loja de marcenaria','loja de móveis planejados','loja de moveis planejados'];

  function readRamos(){try{return (typeof window.getRamos==='function'?window.getRamos():getRamos())||[];}catch(_){return [];}}
  function normalizeRamo(r){
    const hay=norm([r?.id,r?.nome,...(Array.isArray(r?.keywords)?r.keywords:[])].join(' '));
    if(hay.includes('marcenaria')||hay.includes('marceneiro')||hay.includes('moveleiro')||hay.includes('movelaria')||hay.includes('moveis planejados')||hay.includes('moveis sob medida')){
      return {id:r?.id||'moveis-planejados',nome:'Móveis Planejados',keywords:unique([...(Array.isArray(r?.keywords)?r.keywords:[]),...MOVEIS])};
    }
    return {...r,id:r?.id||slug(r?.nome||'ramo'),nome:r?.nome||'Ramo',keywords:unique(Array.isArray(r?.keywords)?r.keywords:[])};
  }
  function getRamos(){return readRamos().map(normalizeRamo);}

  function categoryListFromItem(item={}){
    const out=[];
    ['category','categoryName','category_name','categoria','mainCategory','primaryCategory'].forEach(k=>{if(item[k])out.push(String(item[k]));});
    const cats=item.categories||item.categoryList||item.subcategories;
    if(Array.isArray(cats)) cats.forEach(c=>out.push(typeof c==='string'?c:(c?.name||c?.title||c?.category||'')));
    else if(typeof cats==='string'){
      try{const p=JSON.parse(cats); if(Array.isArray(p))p.forEach(c=>out.push(typeof c==='string'?c:(c?.name||c?.title||''))); else out.push(cats);}catch(_){cats.split(/[;,|]/).forEach(c=>out.push(c));}
    }
    return unique(out);
  }
  function categoryListFromLead(l={}){
    const out=[];
    ['category_name','category','categoria','parent_category'].forEach(k=>{if(l&&l[k])out.push(String(l[k]));});
    const cats=l?.categories;
    if(Array.isArray(cats))cats.forEach(c=>out.push(String(c)));
    else if(typeof cats==='string'){
      try{const p=JSON.parse(cats); if(Array.isArray(p))p.forEach(c=>out.push(String(c))); else out.push(cats);}catch(_){cats.split(/[;,|]/).forEach(c=>out.push(c));}
    }
    const raw=l?.raw_payload||{};
    ['category','category_name','categoria','categories'].forEach(k=>{const v=raw[k]; if(Array.isArray(v))v.forEach(x=>out.push(typeof x==='string'?x:(x?.name||x?.title||''))); else if(v)out.push(String(v));});
    return unique(out);
  }
  function matchRamoByCategories(cats=[]){
    const catsNorm=cats.map(norm).filter(Boolean);
    const hay=norm(cats.join(' '));
    if(!catsNorm.length) return null;
    const moveisKeys=MOVEIS.map(norm);
    if(moveisKeys.some(k=>catsNorm.includes(k)||hay.includes(k))) return {id:'marcenaria',nome:'Móveis Planejados',unknown:false};
    for(const r of getRamos()){
      const keys=[r.nome,...(Array.isArray(r.keywords)?r.keywords:[])].map(norm).filter(Boolean);
      if(keys.some(k=>catsNorm.includes(k)||hay.includes(k))) return {id:r.id||slug(r.nome),nome:r.nome,unknown:false};
    }
    return null;
  }

  window.resolveLeadParentRamoStrictV86=function(lead){
    const ramo=matchRamoByCategories(categoryListFromLead(lead));
    return ramo||{id:'__fora_do_ramo__',nome:'Fora do ramo',unknown:true};
  };
  window.isLeadWithinConfiguredRamoV86=function(lead){return !window.resolveLeadParentRamoStrictV86(lead).unknown;};
  window.isApifyItemWithinConfiguredRamoV86=function(item){return !!matchRamoByCategories(categoryListFromItem(item));};

  const prevAnalyze=window.analyzeApifyLeadV430;
  if(typeof prevAnalyze==='function'){
    window.analyzeApifyLeadV430=function(item,databaseIndex,payloadIndex,phase){
      const analysis=prevAnalyze.apply(this,arguments)||{};
      try{
        const ramo=matchRamoByCategories(categoryListFromItem(item));
        analysis.ramoMatch=!!ramo;
        analysis.parent_ramo=ramo||null;
        const reason=String(analysis.reason||'').toLowerCase();
        const protectedSkip=analysis.route==='skip' && (reason.includes('duplicado')||reason.includes('existente')||reason.includes('base permanente')||reason.includes('sent_contacts')||reason.includes('sem nome'));
        const rules=getImportRules();
        const strictRamos=rules.useRegisteredRamosOnly!==false;
        const allowUnmatched=rules.allowUnmatchedCategories===true;
        if(!ramo && !protectedSkip && strictRamos && !allowUnmatched){
          analysis.route='skip';
          analysis.reason='fora do ramo';
        }
      }catch(e){console.warn('[v86][analyze strict]',e?.message||e);}
      return analysis;
    };
  }

  const prevPreview=window.importPreview;
  if(typeof prevPreview==='function'){
    window.importPreview=function(){
      const out=prevPreview.apply(this,arguments);
      // aviso genérico removido: a tela de regras agora usa feedback específico por campo
      return out;
    };
  }



  function dbV149(){return window.sbClient||window.supabaseClient||window.supabase||null;}
  function uidV149(){return window.currentUser?.id||window.authUser?.id||localStorage.getItem('vs_auth_local_user_v423')||'';}
  function nowV149(){return new Date().toISOString();}
  function digitsV149(v){return String(v||'').replace(/\D/g,'');}
  function normPhoneV149(v){let d=digitsV149(v); if(!d)return ''; if(d.startsWith('55'))return d; if(d.length===10||d.length===11)return '55'+d; return d;}
  function cleanUrlV149(url){const u=String(url||'').trim(); if(!u)return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`;}
  function domainV149(url){try{return new URL(cleanUrlV149(url)).hostname.replace(/^www\./,'');}catch(_){return null;}}
  async function upsertInvalidBaseV149(lead,source){
    const c=dbV149(), user=uidV149(); if(!c||!user||!lead)return;
    const normalized_phone=normPhoneV149(lead.normalized_phone||lead.phone||'')||null;
    const website_domain=lead.website_domain||domainV149(lead.website)||null;
    const row={
      user_id:user,
      company_name:lead.company_name||'Lead sem nome',
      phone:lead.phone||null,
      normalized_phone,
      website:lead.website||null,
      website_domain,
      instagram_url:lead.instagram_url||lead.instagram||null,
      instagram_username:lead.instagram_username||null,
      maps_url:lead.maps_url||null,
      status:'invalidado',
      source:source||'branch_guard',
      notes:'Fora do perfil/ramo cadastrado',
      last_contact_at:nowV149(),
      raw_payload:{lead_id:lead.id,reason:'fora_do_ramo',reason_code:'out_of_profile',source:source||'branch_guard',origin:'V149-BRANCH-GUARD'},
      street:lead.street||null,
      city:lead.city||null,
      state:lead.state||null,
      country_code:lead.country_code||null,
      category:lead.category||null,
      category_name:lead.category_name||lead.parent_category||lead.category||null,
      categories:Array.isArray(lead.categories)?lead.categories:(lead.categories||[]),
      rating:lead.rating??null,
      reviews_count:lead.reviews_count??null,
      last_event_type:'invalidated',
      last_event_status:'fora_do_ramo',
      invalid_reason:'fora_do_ramo',
      invalid_source:source||'branch_guard',
      invalidated_at:nowV149(),
      updated_at:nowV149()
    };
    try{
      let existing=null;
      const checks=[];
      if(normalized_phone) checks.push(['normalized_phone',normalized_phone]);
      if(lead.instagram_username) checks.push(['instagram_username',lead.instagram_username]);
      if(lead.maps_url) checks.push(['maps_url',lead.maps_url]);
      if(website_domain) checks.push(['website_domain',website_domain]);
      for(const [field,val] of checks){
        const {data}=await c.from('base_permanente').select('id').eq('user_id',user).eq(field,val).limit(1);
        if((data||[])[0]){existing=data[0];break;}
      }
      if(existing?.id) await c.from('base_permanente').update(row).eq('user_id',user).eq('id',existing.id);
      else await c.from('base_permanente').insert({...row,created_at:nowV149()});
    }catch(e){console.warn('[branch-guard][base]',e?.message||e);}
    try{
      await c.from('contact_events').insert({user_id:user,lead_id:String(lead.id),company_name:lead.company_name||null,normalized_phone,website:lead.website||null,instagram_url:lead.instagram_url||lead.instagram||null,maps_url:lead.maps_url||null,channel:'system',source_instance:source||'branch_guard',event_type:'invalidated',status:'fora_do_ramo',sent_at:nowV149(),metadata:{reason:'fora_do_ramo',origin:'V149-BRANCH-GUARD'}});
    }catch(_){ }
  }
  async function invalidateOutOfBranchLeadV149(lead,source,preDispatchItemId){
    const c=dbV149(), user=uidV149(); if(!c||!user||!lead?.id)return false;
    if(!window.resolveLeadParentRamoStrictV86(lead).unknown) return false;
    try{await upsertInvalidBaseV149(lead,source||'branch_guard');}catch(_){ }
    try{
      await c.from('leads').update({current_stage:'invalid',current_status:'out_of_profile',pipeline_status:'invalidated',status:'invalid',rejected_reason:'fora_do_ramo',rejected_at:nowV149(),archived_at:nowV149(),updated_at:nowV149()}).eq('user_id',user).eq('id',String(lead.id));
    }catch(e){console.warn('[branch-guard][lead]',e?.message||e);}
    try{
      let q=c.from('pre_dispatch_items').update({status:'invalid',invalid_reason:'fora_do_ramo',updated_at:nowV149()}).eq('user_id',user);
      if(preDispatchItemId) q=q.eq('id',preDispatchItemId); else q=q.eq('lead_id',String(lead.id)).in('status',['review','approved','validation_retry','ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled','sending']);
      await q;
    }catch(e){console.warn('[branch-guard][pre-item]',e?.message||e);}
    return true;
  }
  async function sweepOutOfBranchLeadsV149(scope){
    const c=dbV149(), user=uidV149(); if(!c||!user)return {checked:0,invalidated:0};
    const stages=['attribution_whatsapp','attribution_site','attribution_site_approved','attribution_agregadores','attribution_aggregator','attribution_agregadores_approved','attribution_aggregator_approved','pre_send','dispatch_queue'];
    let q=c.from('leads').select('id,company_name,phone,normalized_phone,website,website_domain,instagram_url,instagram_username,instagram,maps_url,current_stage,current_status,pipeline_status,status,category,category_name,parent_category,categories,raw_payload,city,state,rating,reviews_count').eq('user_id',user).in('current_stage',stages).limit(800);
    if(scope==='attribution') q=q.in('current_stage',stages.filter(x=>x.startsWith('attribution')));
    const {data,error}=await q; if(error){console.warn('[branch-guard][sweep]',error.message);return {checked:0,invalidated:0,error};}
    let invalidated=0;
    for(const lead of data||[]){ if(window.resolveLeadParentRamoStrictV86(lead).unknown){ if(await invalidateOutOfBranchLeadV149(lead,'branch_sweep')) invalidated++; } }
    return {checked:(data||[]).length,invalidated};
  }
  window.invalidateOutOfBranchLeadV149=invalidateOutOfBranchLeadV149;
  window.sweepOutOfBranchLeadsV149=sweepOutOfBranchLeadsV149;
  window.recordOutOfBranchImportV149=async function(lead){
    if(!lead) return false;
    const normalized={
      id:lead.id||lead.lead_id||('import-'+Date.now()),
      company_name:lead.company_name||lead.nome||lead.title||'Lead sem nome',
      phone:lead.phone||lead.whatsapp||lead.telefone||null,
      normalized_phone:lead.normalized_phone||lead.normalizedPhone||null,
      website:lead.website||lead.site||null,
      instagram_url:lead.instagram_url||lead.instagram||null,
      instagram_username:lead.instagram_username||null,
      maps_url:lead.maps_url||lead.googleUrl||lead.mapsUrl||null,
      category:lead.category||lead.categoria||null,
      category_name:lead.category_name||lead.categoryName||lead.categoria||null,
      categories:lead.categories||[],
      city:lead.city||lead.cidade||null,
      state:lead.state||lead.estado||null,
      rating:lead.rating||lead.nota||null,
      reviews_count:lead.reviews_count||lead.reviewsCount||lead.avaliacoes||null,
      raw_payload:lead.raw_payload||lead.raw||lead
    };
    await upsertInvalidBaseV149(normalized,'import_out_of_profile');
    return true;
  };


    console.log('[v86][ramo-estrito] ativo',VERSION);
})();
