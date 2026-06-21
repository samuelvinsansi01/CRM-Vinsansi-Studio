/* V78 — Hotfix navegação + fila final real
   Mantém Fila WhatsApp oculta quando outra tela está ativa e remove classes visuais da fila fora da rota. */
(function(){
  'use strict';
  const VERSION='20260618-V78-NAV-FILA-FINAL-REAL';

  function injectStyle(){
    if(document.getElementById('v78-nav-fila-final-real-style')) return;
    const st=document.createElement('style');
    st.id='v78-nav-fila-final-real-style';
    st.textContent=`
      #panel-fila-zap.v72-panel:not(.active),
      #panel-fila-zap.v73-panel:not(.active),
      #panel-fila-zap.v32-zap-panel:not(.active){display:none!important;}
      #panel-fila-zap.v72-panel.active,
      #panel-fila-zap.v73-panel.active{display:flex!important;}
    `;
    document.head.appendChild(st);
  }

  const PANEL_MAP={
    inicio:'panel-inicio', inbox:'panel-inbox', importar:'panel-importar', atribuicao:'panel-atribuicao',
    validacao:'panel-validacao', 'pre-envio':'panel-pre-envio', preenvio:'panel-pre-envio',
    whatsapp:'panel-fila-zap', 'fila-zap':'panel-fila-zap', zap:'panel-fila-zap', fila_whatsapp:'panel-fila-zap',
    instagram:'panel-instagram', 'ja-enviados':'panel-ja-enviados', jaenviados:'panel-ja-enviados',
    conversations:'panel-conversations', conversas:'panel-conversations', followups:'panel-followups',
    kanban:'panel-kanban', acompanhamento:'panel-acompanhamento', redirecionamentos:'panel-redirecionamentos',
    audit:'panel-audit', conta:'panel-conta', configuracoes:'panel-configuracoes', chips:'panel-chips',
    evolution:'panel-evolution', responses:'panel-responses', whatsappqueue:'panel-whatsappQueue'
  };
  const LABEL_TO_ROUTE={
    'Início':'inicio','Caixa de Entrada':'inbox','Importar':'importar','Atribuição':'atribuicao',
    'Pré-envio':'pre-envio','WhatsApp':'fila-zap','Instagram':'instagram','Já enviados':'ja-enviados',
    'Conversas':'conversations','Follow-ups':'followups','Kanban':'kanban','Acompanhamentos':'acompanhamento',
    'Redirecionamentos':'redirecionamentos','Auditoria':'audit','Minha conta':'conta','Configurações':'configuracoes'
  };
  function norm(v){return String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/_/g,'-');}
  function routeName(name){
    const raw=String(name||'').trim();
    if(LABEL_TO_ROUTE[raw]) return LABEL_TO_ROUTE[raw];
    const n=norm(raw);
    const aliases={preenvio:'pre-envio','pre-envio':'pre-envio',whatsapp:'fila-zap',zap:'fila-zap','fila-whatsapp':'fila-zap',configuracoes:'configuracoes',conversas:'conversations',jaenviados:'ja-enviados','ja-enviados':'ja-enviados'};
    return aliases[n]||n;
  }
  function setPanel(route){
    injectStyle();
    const r=routeName(route);
    const panelId=PANEL_MAP[r];
    if(!panelId) return false;
    document.querySelectorAll('.panel').forEach(p=>{
      const on=p.id===panelId;
      p.classList.toggle('active',on);
      p.style.display=on?'flex':'none';
      if(!on && p.id==='panel-fila-zap'){
        p.classList.remove('v32-zap-panel');
      }
      if(on && p.id!=='panel-fila-zap'){
        p.classList.remove('v32-zap-panel','v72-panel','v73-panel');
        p.style.flexDirection='column';
        p.style.width='100%';
        p.style.maxWidth='none';
        p.style.padding='24px 28px';
        p.style.overflow='auto';
        p.style.height='';
      }
    });
    document.querySelectorAll('.nav-item').forEach(n=>{
      const label=n.getAttribute('data-label')||'';
      n.classList.toggle('active', LABEL_TO_ROUTE[label]===r || (r==='fila-zap' && label==='WhatsApp'));
    });
    return r;
  }
  function renderFor(route){
    const r=setPanel(route);
    if(!r) return;
    try{
      if(r==='fila-zap' && typeof window.renderFilaZapV74==='function') return window.renderFilaZapV74();
      if(r==='pre-envio' && typeof window.renderPreEnvioPanelV31==='function') return window.renderPreEnvioPanelV31();
      if(r==='atribuicao' && typeof window.renderAtribuicaoPanelV31==='function') return window.renderAtribuicaoPanelV31();
      if(r==='instagram' && typeof window.renderInstagram==='function') return window.renderInstagram();
      if(r==='ja-enviados' && typeof window.renderSentContactsPanelV31==='function') return window.renderSentContactsPanelV31();
      if(r==='importar' && typeof window.renderImportHomeDashboard==='function') return window.renderImportHomeDashboard();
      if(r==='inicio' && typeof window.renderInicio==='function') return window.renderInicio();
      if(r==='conversations' && typeof window.renderConversations==='function') return window.renderConversations();
      if(r==='followups' && typeof window.renderFollowupsPanel==='function') return window.renderFollowupsPanel();
      if(r==='kanban' && typeof window.renderKanbanPanel==='function') return window.renderKanbanPanel();
      if(r==='configuracoes'){
        if(typeof window.renderConfiguracoes==='function') window.renderConfiguracoes();
        if(typeof window.renderWebhookUrlV34==='function') window.renderWebhookUrlV34();
        if(typeof window.renderRamosConfigV76==='function') window.renderRamosConfigV76();
        return;
      }
      if(r==='conta' && typeof window.renderMinhaContaV426==='function') return window.renderMinhaContaV426();
    }catch(e){console.error('[v78][render]',r,e);}
  }

  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){
    const r=routeName(name);
    if(PANEL_MAP[r]) return renderFor(r);
    return typeof prevSwitch==='function'?prevSwitch(name):undefined;
  };

  // Corrige qualquer estado visual antigo após navegação feita por listeners legados.
  document.addEventListener('click',function(e){
    const nav=e.target.closest?.('.nav-item[data-label]');
    if(!nav) return;
    const label=nav.getAttribute('data-label')||'';
    const route=LABEL_TO_ROUTE[label];
    if(!route) return;
    setTimeout(()=>renderFor(route),0);
  },false);

  document.addEventListener('DOMContentLoaded',()=>{injectStyle(); setTimeout(()=>{
    const active=document.querySelector('.panel.active');
    if(active && active.id!=='panel-fila-zap'){
      const fila=document.getElementById('panel-fila-zap');
      if(fila){fila.classList.remove('active','v32-zap-panel'); fila.style.display='none';}
    }
  },600);});
  window.__V78_NAV_FILA_FINAL_REAL__=VERSION;
  console.info('[v78][nav-fila-final-real] ativo',VERSION);
})();
