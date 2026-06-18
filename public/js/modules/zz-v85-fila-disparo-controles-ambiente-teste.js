/* V85 — Fila WhatsApp: controles operacionais na aba Em fila + Ambiente de teste separado.
   - Mantém o card de Lead teste/Disparo operacional apenas em Ambiente de teste.
   - Em fila mostra controles limpos para Disparar/Pausar/Retomar/Parar todos e por chip.
   - Não altera Supabase, pré-envio, importação, conversas ou base permanente. */
(function(){
  'use strict';
  const VERSION='20260618-V85-FILA-CONTROLES-AMBIENTE-TESTE';
  let activeMode='queue'; // queue | sent | error | test
  let timer=null;

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
  function chipKeyFromHead(head){
    const on=head?.getAttribute('onclick')||'';
    const m=on.match(/setFilaZapChipOpenV73\(['"]([^'"]*)['"]\)/)||on.match(/['"]([^'"]*)['"]/);
    return m&&m[1]?m[1]:'';
  }
  function chipTitleFromHead(head){return (head?.querySelector('div[style*="Syne"]')?.textContent||head?.textContent||'Chip').trim().split(/\s+/)[0]||'Chip';}

  function addStyle(){
    if(document.getElementById('v85-fila-style'))return;
    const st=document.createElement('style'); st.id='v85-fila-style'; st.textContent=`
      #panel-fila-zap .v85-test-mode .zap-empresa-list,
      #panel-fila-zap .v85-test-mode .stats-row,
      #panel-fila-zap .v85-test-mode .v85-dispatch-global,
      #panel-fila-zap .v85-test-mode .zapRight{display:none!important}
      #panel-fila-zap .v85-test-mode #v80DispatchBox{display:grid!important;margin-top:8px}
      #panel-fila-zap:not(.v85-test-mode) #v80DispatchBox{display:none!important}
      #panel-fila-zap .v85-dispatch-global{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:12px;padding:10px 12px;margin:10px 0 12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0}
      #panel-fila-zap .v85-global-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:900;color:var(--text)}
      #panel-fila-zap .v85-global-sub{font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);line-height:1.45;margin-top:2px}
      #panel-fila-zap .v85-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      #panel-fila-zap .v85-btn{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:8px;color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:7px 9px;cursor:pointer;white-space:nowrap;line-height:1}
      #panel-fila-zap .v85-btn:hover{border-color:var(--accent);color:var(--accent)}
      #panel-fila-zap .v85-btn.primary{background:var(--accent);color:#111;border-color:var(--accent);font-weight:900}
      #panel-fila-zap .v85-btn.blue{border-color:rgba(74,179,255,.5);color:#4ab3ff}
      #panel-fila-zap .v85-btn.danger{border-color:rgba(255,80,80,.55);color:#ff6b6b}
      #panel-fila-zap .v85-chip-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:8px}
      #panel-fila-zap .v85-chip-actions .v85-btn{padding:6px 7px;font-size:7px}
      #panel-fila-zap .v85-chip-state{font-family:'DM Mono',monospace;font-size:7px;color:var(--muted);border:1px solid var(--border2);border-radius:999px;padding:5px 7px;background:rgba(0,0,0,.16)}
      #panel-fila-zap .v85-chip-state.run{color:var(--accent);border-color:rgba(184,240,89,.45)}
      #panel-fila-zap .v85-chip-state.pause{color:#ffd166;border-color:rgba(255,209,102,.45)}
      #panel-fila-zap .v85-chip-state.err{color:var(--error);border-color:rgba(255,80,80,.45)}
      #panel-fila-zap .status-tab[data-v85-test="1"]{border-color:rgba(184,240,89,.35)}
      #panel-fila-zap .status-tab[data-v85-test="1"].active{border-color:var(--accent);color:var(--accent);background:rgba(184,240,89,.08)}
      @media(max-width:900px){#panel-fila-zap .v85-dispatch-global{align-items:flex-start}.v85-chip-actions{width:100%;margin-left:0}}
    `; document.head.appendChild(st);
  }

  function setNativeStatus(st){
    if(typeof window.setFilaZapStatusV74==='function') return window.setFilaZapStatusV74(st);
    if(typeof window.setFilaZapStatusV73==='function') return window.setFilaZapStatusV73(st);
  }
  function setMode(mode){
    activeMode=mode||'queue';
    if(activeMode!=='test'){
      const native=activeMode==='queue'?'queue':activeMode;
      try{setNativeStatus(native);}catch(_){ }
      setTimeout(apply,80);
    } else {
      apply();
    }
  }

  function ensureTestTab(){
    const tabs=document.querySelector('#panel-fila-zap .status-tabs'); if(!tabs)return;
    let btn=tabs.querySelector('[data-v85-test="1"]');
    if(!btn){
      btn=document.createElement('button');
      btn.type='button'; btn.className='status-tab'; btn.dataset.v85Test='1';
      btn.innerHTML='Ambiente de teste <span class="st-count">✓</span>';
      btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();setMode('test');},true);
      tabs.appendChild(btn);
    }
    tabs.querySelectorAll('.status-tab').forEach(b=>{if(b!==btn)b.classList.toggle('active',activeMode!=='test' && b.classList.contains('active'));});
    btn.classList.toggle('active',activeMode==='test');
  }

  function dispatchAll(){ if(typeof window.startDispatchV80==='function') window.startDispatchV80('all'); else notify('Função de disparo não encontrada.','err'); }
  function pauseAll(){ if(typeof window.pauseDispatchV80==='function') window.pauseDispatchV80(); }
  function resumeAll(){ if(typeof window.resumeDispatchV80==='function') window.resumeDispatchV80(); }
  function stopAll(){ if(typeof window.stopDispatchV80==='function') window.stopDispatchV80(); }

  function openChip(key){
    try{ if(typeof window.setFilaZapChipOpenV73==='function') window.setFilaZapChipOpenV73(key); }catch(_){ }
  }
  function dispatchChip(key){
    if(key)openChip(key);
    setTimeout(()=>{ if(typeof window.startDispatchV80==='function') window.startDispatchV80(key||'all'); else notify('Função de disparo não encontrada.','err'); },160);
  }
  function pauseChip(key){ if(typeof window.pauseChipV80==='function') window.pauseChipV80(key); else pauseAll(); }
  function resumeChip(key){ if(typeof window.resumeChipV80==='function') window.resumeChipV80(key); else resumeAll(); }
  function stopChip(key){ if(typeof window.stopChipV80==='function') window.stopChipV80(key); else stopAll(); }

  function ensureGlobalControls(){
    const body=document.querySelector('#panel-fila-zap .zapLeft-body'); if(!body)return;
    let box=document.getElementById('v85DispatchGlobal');
    if(!box){
      box=document.createElement('div'); box.id='v85DispatchGlobal'; box.className='v85-dispatch-global';
      box.innerHTML=`<div><div class="v85-global-title">Disparo dos chips</div><div class="v85-global-sub">Dispara chips conectados em paralelo. Cada chip mantém sua própria fila, posição, pausa e retomada.</div></div><div class="v85-actions"><button class="v85-btn primary" data-v85="dispatch-all">Disparar todos</button><button class="v85-btn blue" data-v85="pause-all">Pausar todos</button><button class="v85-btn blue" data-v85="resume-all">Retomar todos</button><button class="v85-btn danger" data-v85="stop-all">Parar todos</button></div>`;
      box.addEventListener('click',function(e){
        const a=e.target.closest('[data-v85]'); if(!a)return;
        e.preventDefault(); e.stopPropagation();
        const k=a.dataset.v85;
        if(k==='dispatch-all')dispatchAll();
        if(k==='pause-all')pauseAll();
        if(k==='resume-all')resumeAll();
        if(k==='stop-all')stopAll();
      },true);
      const stats=body.querySelector('.stats-row');
      if(stats&&stats.parentNode)stats.parentNode.insertBefore(box,stats.nextSibling); else body.insertBefore(box,body.firstChild);
    }
  }

  function chipRuntimeState(key){
    try{ const r=JSON.parse(localStorage.getItem('vs_dispatch_runtime_v80')||'{}'); const ch=r?.chips?.[key]||{}; return ch; }catch(_){ return {}; }
  }
  function stateLabel(r){
    const s=String(r.state||'').trim();
    if(r.running && r.paused)return {label:'Pausado',cls:'pause'};
    if(r.running)return {label:s||'Disparando',cls:'run'};
    if((r.errors||0)>0)return {label:s||'Erro',cls:'err'};
    return {label:s||'Pronto',cls:''};
  }
  function injectChipControls(){
    document.querySelectorAll('#panel-fila-zap .v73-chip-head').forEach(head=>{
      if(head.querySelector('.v85-chip-actions'))return;
      const key=chipKeyFromHead(head); if(!key)return;
      const run=chipRuntimeState(key); const st=stateLabel(run);
      const wrap=document.createElement('div'); wrap.className='v85-chip-actions'; wrap.setAttribute('data-chip',key);
      wrap.innerHTML=`<span class="v85-chip-state ${st.cls}">${esc(st.label)}${run.total?` · ${Number(run.sent||0)}/${Number(run.total||0)}`:''}</span><button class="v85-btn primary" data-chip-action="dispatch">Disparar</button><button class="v85-btn blue" data-chip-action="pause">Pausar</button><button class="v85-btn blue" data-chip-action="resume">Retomar</button><button class="v85-btn danger" data-chip-action="stop">Parar</button>`;
      wrap.addEventListener('click',function(e){
        const b=e.target.closest('[data-chip-action]'); if(!b)return;
        e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation();
        const action=b.dataset.chipAction;
        if(action==='dispatch')dispatchChip(key);
        if(action==='pause')pauseChip(key);
        if(action==='resume')resumeChip(key);
        if(action==='stop')stopChip(key);
      },true);
      head.appendChild(wrap);
    });
  }

  function apply(){
    addStyle();
    const panel=document.getElementById('panel-fila-zap'); if(!panel)return;
    ensureTestTab();
    ensureGlobalControls();
    injectChipControls();
    panel.classList.toggle('v85-test-mode',activeMode==='test');
    const testBox=document.getElementById('v80DispatchBox');
    if(testBox){
      testBox.style.display=activeMode==='test'?'grid':'none';
    }
  }
  function schedule(){ clearTimeout(timer); timer=setTimeout(apply,80); setTimeout(apply,350); setTimeout(apply,900); }

  const prevRender=window.renderFilaZap;
  window.renderFilaZap=async function(){ const r=typeof prevRender==='function'?await prevRender.apply(this,arguments):undefined; schedule(); return r; };
  window.renderFilaZapV85=window.renderFilaZap;

  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){ const r=typeof prevSwitch==='function'?prevSwitch.apply(this,arguments):undefined; const n=norm(name); if(['whatsapp','fila-zap','fila_whatsapp','zap'].includes(n)||name==='WhatsApp')schedule(); return r; };

  document.addEventListener('click',function(e){
    const st=e.target.closest?.('#panel-fila-zap .status-tab');
    if(st && !st.dataset.v85Test){ activeMode='queue'; const panel=document.getElementById('panel-fila-zap'); if(panel) panel.classList.remove('v85-test-mode'); }
    if(e.target.closest?.('#panel-fila-zap .day-tab,#panel-fila-zap .status-tab,#panel-fila-zap .v73-chip-head,.nav-item[data-label="WhatsApp"]')) schedule();
  },true);
  document.addEventListener('DOMContentLoaded',schedule);

  window.setFilaZapModeV85=setMode;
  window.__V85_FILA_CONTROLES_AMBIENTE_TESTE__=VERSION;
})();
