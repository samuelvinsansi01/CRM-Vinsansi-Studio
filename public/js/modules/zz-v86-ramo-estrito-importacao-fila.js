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

  console.log('[v86][ramo-estrito] ativo',VERSION);
})();
