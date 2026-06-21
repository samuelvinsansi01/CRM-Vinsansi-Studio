/* Lead Certo v136 — router final sem legado preso.
   Corrige efeito colateral da Fila WhatsApp: nenhum módulo pode deixar outras telas com display:none permanente.
*/
(function(){
  'use strict';
  const VERSION='20260621-LEAD-CERTO-ROUTER-FINAL-V136';
  const panels = ['audit','conversations','responses','chips','whatsappQueue','evolution','inicio','inbox','importar','validacao','atribuicao','pre-envio','instagram','fila-zap','ja-enviados','kanban','followups','acompanhamento','redirecionamentos','configuracoes','conta'];
  function normalizeName(name){
    const n=String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(['whatsapp','fila-zap','fila_whatsapp','zap','fila whatsapp'].includes(n)) return 'fila-zap';
    if(['preenvio','pre-envio','pre envio'].includes(n)) return 'pre-envio';
    if(['atribuicao','atribuicao instagram'].includes(n)) return 'atribuicao';
    if(['base permanente','ja-enviados','ja enviados'].includes(n)) return 'ja-enviados';
    return name;
  }
  function releasePanelStyles(){
    document.querySelectorAll('.panel').forEach(p=>{ p.style.display=''; });
  }
  function forcePanel(name){
    const target=normalizeName(name);
    panels.forEach(id=>{
      const el=document.getElementById('panel-'+id);
      if(!el) return;
      const on=id===target;
      el.classList.toggle('active',on);
      el.style.display='';
      if(on && id==='fila-zap') el.style.display='flex';
    });
    document.querySelectorAll('.nav-item').forEach(el=>{
      const label=el.getAttribute('data-label')||'';
      const map={'Início':'inicio','Caixa de Entrada':'inbox','Importar':'importar','Validação':'validacao','Atribuição':'atribuicao','Pré-envio':'pre-envio','WhatsApp':'fila-zap','Instagram':'instagram','Já enviados':'ja-enviados','Base Permanente':'ja-enviados','Fila WhatsApp':'fila-zap','Conversas':'conversations','Follow-ups':'followups','Kanban':'kanban','Acompanhamento':'acompanhamento','Acompanhamentos':'acompanhamento','Redirecionamentos':'redirecionamentos','Auditoria':'audit','Configurações':'configuracoes','Minha conta':'conta'};
      el.classList.toggle('active', map[label]===target);
    });
    return target;
  }
  function callRenderer(target){
    try{
      if(target==='inicio' && typeof window.renderInicio==='function') window.renderInicio();
      if(target==='importar' && typeof window.renderImportarPanel==='function') window.renderImportarPanel();
      if(target==='atribuicao' && typeof window.renderAtribuicao==='function') window.renderAtribuicao();
      if(target==='pre-envio'){
        if(typeof window.renderPreDispatchFinal==='function') window.renderPreDispatchFinal();
        else if(typeof window.renderPreEnvioPanelV31==='function') window.renderPreEnvioPanelV31();
      }
      if(target==='instagram'){
        if(typeof window.renderInstagramQueuePanel==='function') window.renderInstagramQueuePanel();
        else if(typeof window.refreshInstagramV94==='function') window.refreshInstagramV94();
        else if(typeof window.renderInstagram==='function') window.renderInstagram();
      }
      if(target==='fila-zap'){
        if(typeof window.renderFilaZapV73==='function') window.renderFilaZapV73();
        else if(typeof window.renderFilaZap==='function') window.renderFilaZap();
      }
      if(target==='ja-enviados' && typeof window.renderSentContactsPanelV31==='function') window.renderSentContactsPanelV31();
      if(target==='inbox' && typeof window.renderInboxV41==='function') window.renderInboxV41();
      if(target==='conversations' && typeof window.renderConversationsV38==='function') window.renderConversationsV38();
      if(target==='kanban' && typeof window.renderKanban==='function') window.renderKanban();
      if(target==='followups' && typeof window.renderFollowups==='function') window.renderFollowups();
      if(target==='acompanhamento' && typeof window.renderAcompanhamento==='function') window.renderAcompanhamento();
      if(target==='conta' && typeof window.renderMinhaContaV426==='function') window.renderMinhaContaV426();
      if(target==='configuracoes' && typeof window.renderConfiguracoes==='function') window.renderConfiguracoes();
      if(typeof window.updateBadges==='function') window.updateBadges();
    }catch(e){ console.warn('[router-final] renderer error', target, e); }
  }
  window.switchPanel=function(name){
    releasePanelStyles();
    const target=forcePanel(name);
    callRenderer(target);
    setTimeout(()=>{ releasePanelStyles(); if(target==='fila-zap'){ const el=document.getElementById('panel-fila-zap'); if(el) el.style.display='flex'; } },0);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    releasePanelStyles();
    const active=document.querySelector('.panel.active');
    if(active && active.id==='panel-fila-zap') active.style.display='flex';
  });
  console.log('[lead-certo][router-final]',VERSION);
})();
