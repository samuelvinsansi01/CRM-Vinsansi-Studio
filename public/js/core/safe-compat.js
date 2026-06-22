/* Lead Certo — Safe Compatibility Layer v162
   Objetivo: remover crashes de módulos legados sem retomar fluxos antigos.
   Este arquivo só define funções ausentes que ainda são chamadas por arquivos antigos.
*/
(function(){
  const VERSION='20260622-V162-SAFE-COMPAT';
  const w=window;

  function readJson(keys, fallback={}){
    for(const k of keys){
      try{
        const raw=localStorage.getItem(k);
        if(raw){ const parsed=JSON.parse(raw); if(parsed && typeof parsed==='object') return parsed; }
      }catch(_){ }
    }
    return fallback;
  }

  if(typeof w.loadEvoConfig!=='function'){
    w.loadEvoConfig=function(){
      return readJson(['vs_evo_config_v2','vs_evo_config','vs_disparo_config','disparoConfig','evo_config'],{});
    };
  }
  if(typeof w.saveEvoConfig!=='function'){
    w.saveEvoConfig=function(cfg){
      try{
        const payload=cfg && typeof cfg==='object' ? cfg : (w.loadEvoConfig?w.loadEvoConfig():{});
        localStorage.setItem('vs_evo_config_v2',JSON.stringify(payload||{}));
        localStorage.setItem('vs_disparo_config',JSON.stringify(payload||{}));
      }catch(_){ }
    };
  }

  if(typeof w.hasStaticFinalSidebarV414!=='function'){
    w.hasStaticFinalSidebarV414=function(sidebar){
      try{
        const root=sidebar || document.querySelector('.sidebar');
        return !!(root && (root.dataset.staticFinal==='true' || root.querySelector('[data-static-final-sidebar="true"]')));
      }catch(_){ return false; }
    };
  }

  if(typeof w.renderManualValChips!=='function'){
    w.renderManualValChips=function(){
      // O importador atual usa chips do Supabase/Pré-envio. Função legada mantida apenas para evitar ReferenceError.
      const target=document.getElementById('manualValChips') || document.getElementById('valChips') || document.getElementById('importChips');
      if(target && !target.dataset.safeCompatFilled){
        target.dataset.safeCompatFilled='true';
      }
    };
  }

  if(typeof w.renderInstaTemplatesConfig!=='function'){
    w.renderInstaTemplatesConfig=function(){
      // Templates Instagram foram unificados em renderTemplatesConfig. Não renderizar seção duplicada.
      const el=document.getElementById('instaTemplatesList') || document.getElementById('instagramTemplatesList');
      if(el) el.innerHTML='<div style="font-family:DM Mono,monospace;font-size:10px;color:var(--muted)">// Templates do Instagram usam os mesmos templates por ramo/tipo.</div>';
    };
  }

  // Wrappers seguros para funções comuns chamadas por módulos antigos.
  ['renderInicio','renderExcluidos','updateBadges','renderRamoSelect','importPreview','checkHorarioDisparo','ensureWeekData','migrarChavesInstaWeek','sincronizarFilaComEnviados','recuperarValidacaoZapDoDia','limparImagensOlfas'].forEach(name=>{
    if(typeof w[name]!=='function') w[name]=function(){ return name==='ensureWeekData'?{days:{}}: name==='recuperarValidacaoZapDoDia'?0:undefined; };
  });

  console.log('[lead-certo][safe-compat]',VERSION);
})();
