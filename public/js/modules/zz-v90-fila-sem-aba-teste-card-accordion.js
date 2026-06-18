/* V90 — Fila WhatsApp: remove aba Ambiente de teste e restaura card de disparo/teste como accordion.
   - Remove visualmente a quarta aba Ambiente de teste.
   - Reexibe o card Disparo operacional + Lead teste no topo da coluna esquerda, como antes.
   - Lead teste com atributos vira accordion recolhível/expansível.
   - Esconde o card duplicado de ações globais do aside direito para evitar conflito.
   - Não altera Supabase, Evolution, envio, pré-envio, fila ou dados. */
(function(){
  'use strict';
  const VERSION='20260618-V90-FILA-SEM-ABA-TESTE-CARD-ACCORDION';
  let timer=null;
  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function panel(){return qs('#panel-fila-zap')}

  function addStyle(){
    if(qs('#v90-fila-style'))return;
    const st=document.createElement('style');
    st.id='v90-fila-style';
    st.textContent=`
      /* remover quarta aba/ambiente de teste */
      #panel-fila-zap [data-v85-test="1"],
      #panel-fila-zap [data-v87-test="1"],
      #panel-fila-zap [data-v89-test="1"]{display:none!important;visibility:hidden!important;pointer-events:none!important;}

      /* neutraliza os modos de teste antigos que escondiam listagem/aside */
      #panel-fila-zap.v85-test-mode .zap-empresa-list,
      #panel-fila-zap.v87-test-mode .zap-empresa-list,
      #panel-fila-zap.v89-test-mode .zap-empresa-list,
      #panel-fila-zap.v85-test-mode .stats-row,
      #panel-fila-zap.v87-test-mode .stats-row,
      #panel-fila-zap.v89-test-mode .stats-row,
      #panel-fila-zap.v85-test-mode .zapRight,
      #panel-fila-zap.v87-test-mode .zapRight,
      #panel-fila-zap.v89-test-mode .zapRight{display:initial!important;visibility:visible!important;opacity:1!important;}

      /* mostrar o card original de disparo/teste no topo esquerdo */
      #panel-fila-zap #v80DispatchBox.v90-dispatch-restored{
        display:grid!important;
        margin-top:12px!important;
        margin-bottom:14px!important;
        position:relative!important;
        z-index:2!important;
      }
      #panel-fila-zap:not(.v89-test-mode) #v80DispatchBox.v90-dispatch-restored,
      #panel-fila-zap:not(.v85-test-mode) #v80DispatchBox.v90-dispatch-restored,
      #panel-fila-zap:not(.v87-test-mode) #v80DispatchBox.v90-dispatch-restored{display:grid!important;}

      /* esconder ações globais duplicadas do aside direito; o card original já tem Disparar/Pausar/Retomar/Parar */
      #panel-fila-zap #v85DispatchGlobal{display:none!important;}

      /* Accordion do Lead teste */
      #panel-fila-zap .v83-manual.v90-test-accordion{
        border-top:1px dashed var(--border2)!important;
        margin-top:8px!important;
        padding-top:8px!important;
      }
      #panel-fila-zap .v83-manual.v90-test-accordion .v83-test-head{
        cursor:pointer!important;
        padding:8px 10px!important;
        border:1px solid var(--border2)!important;
        border-radius:10px!important;
        background:rgba(255,255,255,.025)!important;
        align-items:center!important;
      }
      #panel-fila-zap .v83-manual.v90-test-accordion .v83-test-head::after{
        content:'▾';
        font-family:'DM Mono',monospace;
        font-size:12px;
        color:var(--accent);
        margin-left:auto;
      }
      #panel-fila-zap .v83-manual.v90-test-accordion.v90-collapsed .v83-test-head::after{content:'▸';}
      #panel-fila-zap .v83-manual.v90-test-accordion.v90-collapsed > :not(.v83-test-head){display:none!important;}
      #panel-fila-zap .v83-manual.v90-test-accordion.v90-collapsed{
        display:flex!important;
        flex-direction:column!important;
        gap:0!important;
      }
    `;
    document.head.appendChild(st);
  }

  function removeTestMode(){
    const p=panel(); if(!p)return;
    p.classList.remove('v85-test-mode','v87-test-mode','v89-test-mode');
    qsa('[data-v85-test="1"],[data-v87-test="1"],[data-v89-test="1"]',p).forEach(el=>el.remove());
  }

  function restoreDispatchBox(){
    const p=panel(); if(!p)return;
    const body=qs('.zapLeft-body',p); if(!body)return;
    const box=qs('#v80DispatchBox',p); if(!box)return;
    box.classList.add('v90-dispatch-restored');
    box.style.display='grid';
    const stats=qs('.stats-row',body);
    if(stats && stats.nextSibling!==box){
      stats.parentNode.insertBefore(box,stats.nextSibling);
    }else if(!stats && body.firstChild!==box){
      body.insertBefore(box,body.firstChild);
    }
  }

  function setupLeadTestAccordion(){
    const p=panel(); if(!p)return;
    const manual=qs('#v80DispatchBox .v83-manual',p); if(!manual)return;
    manual.classList.add('v90-test-accordion');
    const head=qs('.v83-test-head',manual); if(!head)return;
    if(!manual.dataset.v90Ready){
      const saved=localStorage.getItem('v90_lead_test_open');
      if(saved==='1') manual.classList.remove('v90-collapsed');
      else manual.classList.add('v90-collapsed');
      head.addEventListener('click',function(e){
        const interactive=e.target.closest('input,select,button,textarea,a,label');
        if(interactive)return;
        e.preventDefault(); e.stopPropagation();
        manual.classList.toggle('v90-collapsed');
        localStorage.setItem('v90_lead_test_open',manual.classList.contains('v90-collapsed')?'0':'1');
      },true);
      manual.dataset.v90Ready='1';
    }
  }

  function unstickStatus(){
    const p=panel(); if(!p)return;
    const active=qs('.status-tab.active',p);
    if(active && (active.dataset.v85Test||active.dataset.v87Test||active.dataset.v89Test)){
      try{ if(typeof window.setFilaZapStatusV74==='function') window.setFilaZapStatusV74('queue'); }
      catch(_){ try{ if(typeof window.setFilaZapStatusV73==='function') window.setFilaZapStatusV73('queue'); }catch(__){} }
    }
  }

  function apply(){
    addStyle();
    removeTestMode();
    unstickStatus();
    restoreDispatchBox();
    setupLeadTestAccordion();
  }
  function schedule(){clearTimeout(timer); timer=setTimeout(apply,40); setTimeout(apply,180); setTimeout(apply,600);}

  const prevRender=window.renderFilaZap;
  window.renderFilaZap=async function(){
    const r=typeof prevRender==='function'?await prevRender.apply(this,arguments):undefined;
    schedule();
    return r;
  };

  document.addEventListener('click',function(e){
    if(e.target.closest?.('#panel-fila-zap .day-tab,#panel-fila-zap .status-tab,#panel-fila-zap .v73-chip-head,.nav-item[data-label="WhatsApp"]')) schedule();
  },true);
  document.addEventListener('DOMContentLoaded',schedule);
  setInterval(apply,1200);
  window.__V90_FILA_SEM_ABA_TESTE_CARD_ACCORDION__=VERSION;
})();
