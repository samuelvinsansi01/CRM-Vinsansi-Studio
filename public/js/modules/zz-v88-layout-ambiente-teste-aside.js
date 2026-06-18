/* V88 — Fila WhatsApp: layout correto do Ambiente de Teste + controles no aside direito.
   - Ambiente de teste mostra apenas o card de teste na esquerda.
   - O aside direito continua visível em todas as abas.
   - Disparo dos chips fica no topo do aside direito, acima dos chips/lotes.
   - Em fila/Enviada/Erro mostram apenas a lista filtrada na esquerda. */
(function(){
  'use strict';
  const VERSION='20260618-V88-LAYOUT-AMBIENTE-TESTE-ASIDE';
  let mode='queue';
  let timer=null;

  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function panel(){return qs('#panel-fila-zap')}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type)}catch(_){} console[type==='err'?'error':'log'](msg)}

  function addStyle(){
    if(qs('#v88-fila-style'))return;
    const st=document.createElement('style');
    st.id='v88-fila-style';
    st.textContent=`
      #panel-fila-zap.v88-layout #v85DispatchGlobal{display:none!important;}
      #panel-fila-zap.v88-layout:not(.v88-test-mode) #v80DispatchBox{display:none!important;}
      #panel-fila-zap.v88-layout.v88-test-mode #v80DispatchBox{display:grid!important;margin-top:12px!important;}
      #panel-fila-zap.v88-layout.v88-test-mode .zap-empresa-list,
      #panel-fila-zap.v88-layout.v88-test-mode .stats-row{display:none!important;}
      #panel-fila-zap.v88-layout.v88-test-mode .zapRight,
      #panel-fila-zap.v87-test-mode.v88-layout .zapRight,
      #panel-fila-zap.v85-test-mode.v88-layout .zapRight{display:flex!important;visibility:visible!important;opacity:1!important;}
      #panel-fila-zap.v88-layout .v88-dispatch-right{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:12px;padding:12px;margin:12px 12px 6px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0;}
      #panel-fila-zap.v88-layout .v88-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:900;color:var(--text);letter-spacing:.01em;}
      #panel-fila-zap.v88-layout .v88-sub{font-family:'DM Mono',monospace;font-size:8px;line-height:1.45;color:var(--muted);margin-top:3px;}
      #panel-fila-zap.v88-layout .v88-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
      #panel-fila-zap.v88-layout .v88-btn{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:8px;color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:7px 9px;cursor:pointer;white-space:nowrap;line-height:1;}
      #panel-fila-zap.v88-layout .v88-btn:hover{border-color:var(--accent);color:var(--accent);}
      #panel-fila-zap.v88-layout .v88-btn.primary{background:var(--accent);color:#111;border-color:var(--accent);font-weight:900;}
      #panel-fila-zap.v88-layout .v88-btn.blue{border-color:rgba(74,179,255,.5);color:#4ab3ff;}
      #panel-fila-zap.v88-layout .v88-btn.danger{border-color:rgba(255,80,80,.55);color:#ff6b6b;}
      #panel-fila-zap.v88-layout .v88-test-note{font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin:8px 0 2px;}
      @media(max-width:900px){#panel-fila-zap.v88-layout .v88-dispatch-right{margin:10px 10px 4px;}}
    `;
    document.head.appendChild(st);
  }

  function dispatchAll(){
    if(typeof window.startDispatchV80==='function') window.startDispatchV80('all');
    else notify('Função de disparo não encontrada.','err');
  }
  function pauseAll(){ if(typeof window.pauseDispatchV80==='function') window.pauseDispatchV80(); }
  function resumeAll(){ if(typeof window.resumeDispatchV80==='function') window.resumeDispatchV80(); }
  function stopAll(){ if(typeof window.stopDispatchV80==='function') window.stopDispatchV80(); }

  function ensureRightControls(){
    const p=panel(); if(!p)return;
    const right=qs('.zapRight',p); if(!right)return;
    let box=qs('#v88DispatchRight',right);
    if(!box){
      box=document.createElement('div');
      box.id='v88DispatchRight';
      box.className='v88-dispatch-right';
      box.innerHTML=`<div><div class="v88-title">Disparo dos chips</div><div class="v88-sub">Dispara chips conectados em paralelo. Cada chip mantém própria fila, posição, pausa e retomada.</div></div><div class="v88-actions"><button class="v88-btn primary" data-v88="dispatch-all">Disparar todos</button><button class="v88-btn blue" data-v88="pause-all">Pausar todos</button><button class="v88-btn blue" data-v88="resume-all">Retomar todos</button><button class="v88-btn danger" data-v88="stop-all">Parar todos</button></div>`;
      box.addEventListener('click',function(e){
        const b=e.target.closest('[data-v88]'); if(!b)return;
        e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation();
        const k=b.dataset.v88;
        if(k==='dispatch-all')dispatchAll();
        if(k==='pause-all')pauseAll();
        if(k==='resume-all')resumeAll();
        if(k==='stop-all')stopAll();
      },true);
      right.insertBefore(box,right.firstChild);
    } else if(right.firstChild!==box){
      right.insertBefore(box,right.firstChild);
    }
  }

  function ensureTestTab(){
    const p=panel(); if(!p)return;
    const tabs=qs('.status-tabs',p); if(!tabs)return;
    let test=qs('[data-v88-test="1"]',tabs) || qs('[data-v87-test="1"]',tabs) || qs('[data-v85-test="1"]',tabs);
    if(!test){
      test=document.createElement('button');
      test.type='button';
      test.className='status-tab';
      test.innerHTML='Ambiente de teste <span class="st-count">✓</span>';
      tabs.appendChild(test);
    }
    test.dataset.v88Test='1'; test.dataset.v87Test='1'; test.dataset.v85Test='1';
    test.onclick=function(e){e.preventDefault();e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation(); setMode('test'); return false;};
    tabs.appendChild(test);
    qsa('.status-tab',tabs).forEach(b=>{
      if(b===test) b.classList.toggle('active',mode==='test');
      else if(mode==='test') b.classList.remove('active');
    });
  }

  function setNativeStatus(st){
    try{ if(typeof window.setFilaZapStatusV74==='function') return window.setFilaZapStatusV74(st); }catch(_){}
    try{ if(typeof window.setFilaZapStatusV73==='function') return window.setFilaZapStatusV73(st); }catch(_){}
  }

  function setMode(next){
    mode=next==='test'?'test':'queue';
    const p=panel();
    if(p){
      p.classList.add('v88-layout');
      p.classList.toggle('v88-test-mode',mode==='test');
      // manter classes antigas para compatibilidade, mas o CSS v88 sobrescreve o ocultamento do aside.
      p.classList.toggle('v87-test-mode',mode==='test');
      p.classList.toggle('v85-test-mode',mode==='test');
    }
    if(mode!=='test') setNativeStatus('queue');
    schedule();
  }

  function normalizeTestArea(){
    const p=panel(); if(!p)return;
    p.classList.add('v88-layout');
    p.classList.toggle('v88-test-mode',mode==='test');
    const box=qs('#v80DispatchBox',p);
    if(box){ box.style.display=mode==='test'?'grid':'none'; }
    const left=qs('.zapLeft-body',p);
    if(left && mode==='test' && !qs('.v88-test-note',left)){
      const note=document.createElement('div');
      note.className='v88-test-note';
      note.textContent='// Ambiente seguro para testar chip, template, ramo e imagem sem consumir lead real.';
      const tabs=qs('.status-tabs',left);
      if(tabs) tabs.insertAdjacentElement('afterend',note);
    }
  }

  function hideOldLeftControls(){
    qsa('#panel-fila-zap #v85DispatchGlobal').forEach(el=>{el.style.display='none';});
  }

  function apply(){
    addStyle();
    const p=panel(); if(!p)return;
    p.classList.add('v88-layout');
    ensureTestTab();
    ensureRightControls();
    hideOldLeftControls();
    normalizeTestArea();
  }
  function schedule(){ clearTimeout(timer); timer=setTimeout(apply,40); setTimeout(apply,220); setTimeout(apply,700); }

  document.addEventListener('click',function(e){
    const test=e.target.closest?.('#panel-fila-zap [data-v88-test="1"],#panel-fila-zap [data-v87-test="1"],#panel-fila-zap [data-v85-test="1"]');
    if(test){ e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation(); setMode('test'); return; }
    const st=e.target.closest?.('#panel-fila-zap .status-tab');
    if(st && !st.dataset.v88Test && !st.dataset.v87Test && !st.dataset.v85Test){
      mode='queue';
      const p=panel(); if(p){p.classList.remove('v88-test-mode','v87-test-mode','v85-test-mode'); p.classList.add('v88-layout');}
      schedule();
    }
    if(e.target.closest?.('#panel-fila-zap .day-tab,#panel-fila-zap .v73-chip-head,.nav-item[data-label="WhatsApp"]')) schedule();
  },true);

  const prevRender=window.renderFilaZap;
  window.renderFilaZap=async function(){ const r=typeof prevRender==='function'?await prevRender.apply(this,arguments):undefined; schedule(); return r; };

  window.setFilaZapModeV88=setMode;
  document.addEventListener('DOMContentLoaded',schedule);
  setTimeout(schedule,400);
  window.__V88_LAYOUT_AMBIENTE_TESTE_ASIDE__=VERSION;
})();
