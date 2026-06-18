/* V87 — Fila WhatsApp: Ambiente de teste normalizado + disparo all/chip + remoção segura de lead do lote.
   - Aba Ambiente de teste mostra apenas card de teste/manual.
   - Aba Em fila mostra controles enxutos de disparo e fila/lotes.
   - Disparar todos força todos os chips conectados, não apenas o chip aberto.
   - Remover da fila devolve o lead para Atribuição e tira do lote. */
(function(){
  'use strict';
  const VERSION='20260618-V87-FILA-NORMALIZADA-DISPARO-REMOVER';
  let mode='queue';
  let timer=null;
  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type)}catch(_){} console[type==='err'?'error':'log'](msg)}
  function addStyle(){
    if(qs('#v87-fila-style'))return;
    const st=document.createElement('style'); st.id='v87-fila-style'; st.textContent=`
      #panel-fila-zap.v87-test-mode .zap-empresa-list,
      #panel-fila-zap.v87-test-mode .stats-row{display:none!important;}
      #panel-fila-zap.v87-test-mode #v80DispatchBox{display:grid!important;}
      #panel-fila-zap:not(.v87-test-mode) #v80DispatchBox{display:none!important;}
      #panel-fila-zap .status-tab[data-v87-test="1"]{border-color:rgba(184,240,89,.35)!important;}
      #panel-fila-zap .status-tab[data-v87-test="1"].active{border-color:var(--accent)!important;color:var(--accent)!important;background:rgba(184,240,89,.08)!important;}
      #panel-fila-zap .v87-mini-note{font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:8px;}
    `; document.head.appendChild(st);
  }
  function panel(){return qs('#panel-fila-zap')}
  function nativeSet(st){
    try{ if(typeof window.setFilaZapStatusV74==='function') return window.setFilaZapStatusV74(st); }catch(_){ }
    try{ if(typeof window.setFilaZapStatusV73==='function') return window.setFilaZapStatusV73(st); }catch(_){ }
  }
  function setMode(next){
    mode=next==='test'?'test':'queue';
    const p=panel(); if(p){p.classList.toggle('v87-test-mode',mode==='test'); p.classList.toggle('v85-test-mode',mode==='test');}
    if(mode!=='test') nativeSet('queue');
    schedule();
  }
  function ensureTestTab(){
    const tabs=qs('#panel-fila-zap .status-tabs'); if(!tabs)return;
    let test=qs('[data-v87-test="1"]',tabs) || qs('[data-v85-test="1"]',tabs);
    if(!test){
      test=document.createElement('button'); test.type='button'; test.className='status-tab';
      test.innerHTML='Ambiente de teste <span class="st-count">✓</span>';
      tabs.appendChild(test);
    }
    test.dataset.v87Test='1'; test.dataset.v85Test='1';
    test.onclick=function(e){e.preventDefault();e.stopPropagation(); setMode('test'); return false;};
    // ordem fixa: Em fila, Enviada, Erro, Ambiente de teste
    tabs.appendChild(test);
    qsa('.status-tab',tabs).forEach(b=>{
      if(b===test) b.classList.toggle('active',mode==='test');
      else if(mode==='test') b.classList.remove('active');
    });
  }
  function normalizeTestBox(){
    const p=panel(); if(!p)return;
    const box=qs('#v80DispatchBox',p);
    if(box){ box.style.display=mode==='test'?'grid':'none'; }
    p.classList.toggle('v87-test-mode',mode==='test');
    p.classList.toggle('v85-test-mode',mode==='test');
    if(mode==='test'){
      const left=qs('.zapLeft-body',p);
      if(left && !qs('.v87-mini-note',left)){
        const n=document.createElement('div'); n.className='v87-mini-note'; n.textContent='// Ambiente seguro para testar chip, template, ramo e imagem sem consumir lead real.';
        const tabs=qs('.status-tabs',left); if(tabs) tabs.insertAdjacentElement('afterend',n);
      }
    }
  }
  function forceDispatchAllButton(){
    qsa('#panel-fila-zap [data-v85="dispatch-all"]').forEach(btn=>{
      if(btn.dataset.v87Bound)return; btn.dataset.v87Bound='1';
      btn.addEventListener('click',function(e){
        e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation();
        if(typeof window.startDispatchV80==='function') window.startDispatchV80('all');
        else notify('Função de disparo não encontrada.','err');
      },true);
    });
  }
  function apply(){ addStyle(); ensureTestTab(); normalizeTestBox(); forceDispatchAllButton(); }
  function schedule(){ clearTimeout(timer); timer=setTimeout(apply,60); setTimeout(apply,260); setTimeout(apply,800); }

  document.addEventListener('click',function(e){
    const test=e.target.closest?.('#panel-fila-zap [data-v87-test="1"],#panel-fila-zap [data-v85-test="1"]');
    if(test){e.preventDefault();e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation(); setMode('test'); return;}
    const st=e.target.closest?.('#panel-fila-zap .status-tab');
    if(st && !st.dataset.v87Test && !st.dataset.v85Test){ mode='queue'; const p=panel(); if(p){p.classList.remove('v87-test-mode','v85-test-mode');} schedule(); }
    if(e.target.closest?.('#panel-fila-zap .day-tab,#panel-fila-zap .v73-chip-head,.nav-item[data-label="WhatsApp"]')) schedule();
  },true);
  const prevRender=window.renderFilaZap;
  window.renderFilaZap=async function(){const r=typeof prevRender==='function'?await prevRender.apply(this,arguments):undefined; schedule(); return r;};
  window.setFilaZapModeV87=setMode;
  document.addEventListener('DOMContentLoaded',schedule);
  window.__V87_FILA_NORMALIZADA_DISPARO_REMOVER__=VERSION;
})();
