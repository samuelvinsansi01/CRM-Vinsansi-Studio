/* V89 — Fila WhatsApp: layout final do Ambiente de Teste + ações no aside direito.
   - Aba Ambiente de teste fica depois de Erro.
   - Ambiente de teste mostra somente o card de teste, sem listagem de leads.
   - Ações de disparo dos chips ficam no topo do aside direito, acima dos chips.
   - Não altera regra de disparo, Supabase, pré-envio ou fila. */
(function(){
  'use strict';
  const VERSION='20260618-V89-FILA-TESTE-ASIDE-FINAL';
  let mode='queue';
  let timer=null;

  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function panel(){return qs('#panel-fila-zap')}
  function addStyle(){
    if(qs('#v89-fila-style'))return;
    const st=document.createElement('style');
    st.id='v89-fila-style';
    st.textContent=`
      /* Ambiente de teste: NÃO esconder aside direito; esconder apenas listas e stats da esquerda */
      #panel-fila-zap.v89-test-mode .zapRight{display:block!important;visibility:visible!important;opacity:1!important;}
      #panel-fila-zap.v89-test-mode .zap-empresa-list,
      #panel-fila-zap.v89-test-mode .stats-row{display:none!important;}
      #panel-fila-zap.v89-test-mode #v80DispatchBox{display:grid!important;margin-top:18px!important;}
      #panel-fila-zap:not(.v89-test-mode) #v80DispatchBox{display:none!important;}

      /* Dentro do Ambiente de teste, esconder o bloco operacional antigo; deixar só o card de teste manual */
      #panel-fila-zap.v89-test-mode #v80DispatchBox > div:not(.v83-manual):not(#v80DispatchLog){display:none!important;}
      #panel-fila-zap.v89-test-mode #v80DispatchBox .v83-manual{display:grid!important;}
      #panel-fila-zap.v89-test-mode #v80DispatchLog{display:block!important;}

      /* Fora do Ambiente de teste, o card de teste não aparece na esquerda */
      #panel-fila-zap:not(.v89-test-mode) #v80DispatchBox{display:none!important;}

      /* Ações de disparo no topo do aside direito */
      #panel-fila-zap #v85DispatchGlobal.v89-aside-actions{
        margin:0 10px 12px!important;
        padding:12px 14px!important;
        display:flex!important;
        align-items:flex-start!important;
        justify-content:space-between!important;
        gap:12px!important;
        border:1px solid var(--border2)!important;
        border-radius:14px!important;
        background:rgba(255,255,255,.025)!important;
        position:relative!important;
        z-index:5!important;
      }
      #panel-fila-zap .status-tab[data-v89-test="1"],
      #panel-fila-zap .status-tab[data-v87-test="1"],
      #panel-fila-zap .status-tab[data-v85-test="1"]{border-color:rgba(184,240,89,.35)!important;}
      #panel-fila-zap .status-tab[data-v89-test="1"].active,
      #panel-fila-zap .status-tab[data-v87-test="1"].active,
      #panel-fila-zap .status-tab[data-v85-test="1"].active{border-color:var(--accent)!important;color:var(--accent)!important;background:rgba(184,240,89,.08)!important;}
      #panel-fila-zap .v89-test-note{font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:10px;}
    `;
    document.head.appendChild(st);
  }

  function nativeStatus(st){
    try{ if(typeof window.setFilaZapStatusV74==='function') return window.setFilaZapStatusV74(st); }catch(_){ }
    try{ if(typeof window.setFilaZapStatusV73==='function') return window.setFilaZapStatusV73(st); }catch(_){ }
  }

  function setMode(next){
    mode=next==='test'?'test':'queue';
    const p=panel();
    if(p){
      p.classList.toggle('v89-test-mode',mode==='test');
      p.classList.toggle('v87-test-mode',mode==='test');
      p.classList.toggle('v85-test-mode',mode==='test');
    }
    if(mode!=='test') nativeStatus('queue');
    schedule();
  }

  function ensureTestTab(){
    const tabs=qs('#panel-fila-zap .status-tabs'); if(!tabs)return;
    let test=qs('[data-v89-test="1"]',tabs) || qs('[data-v87-test="1"]',tabs) || qs('[data-v85-test="1"]',tabs);
    if(!test){
      test=document.createElement('button');
      test.type='button';
      test.className='status-tab';
      test.innerHTML='Ambiente de teste <span class="st-count">✓</span>';
      tabs.appendChild(test);
    }
    test.dataset.v89Test='1';
    test.dataset.v87Test='1';
    test.dataset.v85Test='1';
    test.onclick=function(e){e.preventDefault();e.stopPropagation(); setMode('test'); return false;};

    // garantir ordem: Em fila, Enviada, Erro, Ambiente de teste
    tabs.appendChild(test);
    qsa('.status-tab',tabs).forEach(b=>{
      if(b===test) b.classList.toggle('active',mode==='test');
      else if(mode==='test') b.classList.remove('active');
    });
  }

  function moveActionsToRightAside(){
    const p=panel(); if(!p)return;
    const right=qs('.zapRight',p); if(!right)return;
    const box=qs('#v85DispatchGlobal',p); if(!box)return;
    box.classList.add('v89-aside-actions');
    // colocar acima dos chips no aside direito
    if(right.firstElementChild!==box) right.insertBefore(box,right.firstChild);
  }

  function normalizeTestContent(){
    const p=panel(); if(!p)return;
    p.classList.toggle('v89-test-mode',mode==='test');
    p.classList.toggle('v87-test-mode',mode==='test');
    p.classList.toggle('v85-test-mode',mode==='test');
    const box=qs('#v80DispatchBox',p);
    if(box) box.style.display=mode==='test'?'grid':'none';
    if(mode==='test'){
      const left=qs('.zapLeft-body',p);
      if(left && !qs('.v89-test-note',left)){
        const note=document.createElement('div');
        note.className='v89-test-note';
        note.textContent='// Ambiente seguro para testar chip, template, ramo e imagem sem consumir lead real.';
        const tabs=qs('.status-tabs',left);
        if(tabs) tabs.insertAdjacentElement('afterend',note);
      }
    }
  }

  function apply(){
    addStyle();
    ensureTestTab();
    moveActionsToRightAside();
    normalizeTestContent();
  }
  function schedule(){clearTimeout(timer); timer=setTimeout(apply,50); setTimeout(apply,250); setTimeout(apply,800);}

  document.addEventListener('click',function(e){
    const test=e.target.closest?.('#panel-fila-zap [data-v89-test="1"],#panel-fila-zap [data-v87-test="1"],#panel-fila-zap [data-v85-test="1"]');
    if(test){e.preventDefault();e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation(); setMode('test'); return;}
    const st=e.target.closest?.('#panel-fila-zap .status-tab');
    if(st && !st.dataset.v89Test && !st.dataset.v87Test && !st.dataset.v85Test){
      mode='queue';
      const p=panel(); if(p)p.classList.remove('v89-test-mode','v87-test-mode','v85-test-mode');
      schedule();
    }
    if(e.target.closest?.('#panel-fila-zap .day-tab,#panel-fila-zap .status-tab,#panel-fila-zap .v73-chip-head,.nav-item[data-label="WhatsApp"]')) schedule();
  },true);

  const prevRender=window.renderFilaZap;
  window.renderFilaZap=async function(){
    const r=typeof prevRender==='function'?await prevRender.apply(this,arguments):undefined;
    schedule();
    return r;
  };

  document.addEventListener('DOMContentLoaded',schedule);
  window.setFilaZapModeV89=setMode;
  window.__V89_FILA_TESTE_ASIDE_FINAL__=VERSION;
})();
