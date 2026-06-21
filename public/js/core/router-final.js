/* Lead Certo — Router final estável.
   Dono único de troca de telas. Bloqueia redirects/clicks legados nos itens do menu
   e chama apenas o renderizador oficial de cada tela.
*/
(function(){
  'use strict';
  const VERSION='20260621-LEAD-CERTO-ROUTER-FINAL-V138';

  const routeByLabel={
    'Início':'inicio',
    'Caixa de Entrada':'inbox',
    'Importar':'importar',
    'Validação':'validacao',
    'Atribuição':'atribuicao',
    'Pré-envio':'pre-envio',
    'WhatsApp':'fila-zap',
    'Fila WhatsApp':'fila-zap',
    'Instagram':'instagram',
    'Fila Instagram':'instagram',
    'Base Permanente':'ja-enviados',
    'Já enviados':'ja-enviados',
    'Conversas':'conversations',
    'Follow-ups':'followups',
    'Kanban':'kanban',
    'Acompanhamentos':'acompanhamento',
    'Acompanhamento':'acompanhamento',
    'Redirecionamentos':'redirecionamentos',
    'Auditoria':'audit',
    'Configurações':'configuracoes',
    'Minha conta':'conta',
    'Chips':'chips',
    'Evolution':'evolution',
    'Respostas':'responses'
  };

  function normalizeText(v){
    return String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }
  function normalizeName(name){
    const n=normalizeText(name).replace(/_/g,'-');
    if(['whatsapp','fila-zap','fila whatsapp','zap'].includes(n)) return 'fila-zap';
    if(['preenvio','pre-envio','pre envio'].includes(n)) return 'pre-envio';
    if(['atribuicao','atribuicao instagram','base atribuicao'].includes(n)) return 'atribuicao';
    if(['instagram','fila instagram','insta','fila-insta'].includes(n)) return 'instagram';
    if(['base permanente','ja-enviados','ja enviados'].includes(n)) return 'ja-enviados';
    return String(name||'').trim();
  }
  function routeFromNav(el){
    if(!el) return '';
    const label=el.getAttribute('data-label') || '';
    if(routeByLabel[label]) return routeByLabel[label];
    const txt=(el.textContent||'').replace(/\s+/g,' ').trim();
    for(const [k,v] of Object.entries(routeByLabel)){
      if(normalizeText(txt).startsWith(normalizeText(k))) return v;
    }
    const on=String(el.getAttribute('onclick')||'');
    const m=on.match(/switchPanel\(['\"]([^'\"]+)['\"]\)/i);
    return m ? normalizeName(m[1]) : '';
  }
  function allPanelIds(){
    return Array.from(document.querySelectorAll('[id^="panel-"]')).map(el=>el.id.replace(/^panel-/,''));
  }
  function setActivePanel(name){
    const target=normalizeName(name);
    allPanelIds().forEach(id=>{
      const el=document.getElementById('panel-'+id);
      if(!el) return;
      const active=id===target;
      el.classList.toggle('active',active);
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
      el.style.display=active ? 'flex' : '';
      if(active){
        el.style.visibility='visible';
        el.style.opacity='1';
      }
    });
    document.querySelectorAll('.nav-item').forEach(el=>{
      const route=routeFromNav(el);
      if(route) el.classList.toggle('active', route===target);
    });
    try{ localStorage.setItem('lead_certo_active_panel',target); }catch(_){ }
    return target;
  }
  async function callRenderer(target){
    try{
      if(target==='inicio' && typeof window.renderInicio==='function') await window.renderInicio();
      else if(target==='importar' && typeof window.renderImportarPanel==='function') await window.renderImportarPanel();
      else if(target==='validacao' && typeof window.renderValidacaoPanel==='function') await window.renderValidacaoPanel();
      else if(target==='atribuicao'){
        if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31();
        else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao();
      }
      else if(target==='pre-envio'){
        if(typeof window.renderPreEnvioPanelV31==='function') await window.renderPreEnvioPanelV31();
        else if(typeof window.renderPreDispatchFinal==='function') await window.renderPreDispatchFinal();
      }
      else if(target==='instagram'){
        if(typeof window.renderInstagramQueuePanel==='function') await window.renderInstagramQueuePanel();
        else if(typeof window.refreshInstagramV94==='function') await window.refreshInstagramV94();
        else if(typeof window.renderInstagram==='function') await window.renderInstagram();
      }
      else if(target==='fila-zap'){
        if(typeof window.renderFilaZapV73==='function') await window.renderFilaZapV73();
        else if(typeof window.renderFilaZap==='function') await window.renderFilaZap();
      }
      else if(target==='ja-enviados' && typeof window.renderSentContactsPanelV31==='function') await window.renderSentContactsPanelV31();
      else if(target==='inbox' && typeof window.renderInboxV41==='function') await window.renderInboxV41();
      else if(target==='conversations' && typeof window.renderConversationsV38==='function') await window.renderConversationsV38();
      else if(target==='kanban' && typeof window.renderKanban==='function') await window.renderKanban();
      else if(target==='followups' && typeof window.renderFollowups==='function') await window.renderFollowups();
      else if(target==='acompanhamento' && typeof window.renderAcompanhamento==='function') await window.renderAcompanhamento();
      else if(target==='conta' && typeof window.renderMinhaContaV426==='function') await window.renderMinhaContaV426();
      else if(target==='configuracoes' && typeof window.renderConfiguracoes==='function') await window.renderConfiguracoes();
      else if(target==='chips' && typeof window.renderChipsPanel==='function') await window.renderChipsPanel();
      else if(target==='evolution' && typeof window.renderEvolution==='function') await window.renderEvolution();
      if(typeof window.updateBadges==='function') window.updateBadges();
    }catch(e){
      console.error('[lead-certo][router] erro ao renderizar',target,e);
    }
  }

  window.switchPanel=async function(name){
    const target=setActivePanel(name);
    await callRenderer(target);
    // Uma segunda passada curta neutraliza módulos antigos que tentam mudar display depois do clique.
    setTimeout(()=>setActivePanel(target),30);
    setTimeout(()=>setActivePanel(target),180);
    return target;
  };

  document.addEventListener('click',function(ev){
    const nav=ev.target.closest && ev.target.closest('.nav-item');
    if(!nav) return;
    const route=routeFromNav(nav);
    if(!route) return; // Busca, grupos, sair etc seguem normais.
    ev.preventDefault();
    ev.stopPropagation();
    if(ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    window.switchPanel(route);
  },true);

  document.addEventListener('DOMContentLoaded',()=>{
    let initial='inicio';
    try{ initial=localStorage.getItem('lead_certo_active_panel')||initial; }catch(_){ }
    const active=document.querySelector('.panel.active');
    if(active && active.id) initial=active.id.replace(/^panel-/,'');
    setActivePanel(initial);
    callRenderer(initial);
  });

  console.log('[lead-certo][router-final]',VERSION);
})();
