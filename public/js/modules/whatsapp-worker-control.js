/* Lead Certo — Controle visual do Worker WhatsApp local.
   Não envia pelo navegador. Apenas autoriza/pausa/testa o worker via Supabase operational_data.
*/
(function(){
  'use strict';
  const SCOPE='whatsapp_worker_control';
  const VERSION='20260622-WHATSAPP-WORKER-CONTROL-V3-SAFE-START';
  const DEFAULT_TEST_PHONE='5511962420764';
  let lastPayload=null;
  let injecting=false;

  function sb(){try{return window.sbClient||(typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;}}
  function uid(){try{return window.currentUser?.id||(typeof currentUser!=='undefined'&&currentUser?.id)||localStorage.getItem('vs_auth_local_user_v423')||'';}catch(_){return '';}}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function nowIso(){return new Date().toISOString();}
  function normPhone(v){let d=String(v||'').replace(/\D/g,''); if(!d)return ''; if(d.startsWith('00'))d=d.slice(2); if(d.startsWith('55'))return d; if(d.length===10||d.length===11)return '55'+d; return d;}

  async function getControl(){
    const c=sb(), userId=uid();
    if(!c||!userId) return {enabled:false,status:'offline',mode:'live'};
    const {data,error}=await c.from('operational_data').select('payload').eq('user_id',userId).eq('scope',SCOPE).maybeSingle();
    if(error){console.warn('[worker-control] get',error.message); return {enabled:false,status:'error',error:error.message};}
    lastPayload=data?.payload&&typeof data.payload==='object'?data.payload:{enabled:false,status:'idle',mode:'live'};
    return lastPayload;
  }

  async function setControl(patch){
    const c=sb(), userId=uid();
    if(!c||!userId){notify('Supabase/usuário não carregado.','err');return null;}
    const current=await getControl();
    const payload={...(current||{}),...(patch||{}),updated_at:nowIso(),updated_by:'crm'};
    const {error}=await c.from('operational_data').upsert({user_id:userId,scope:SCOPE,payload,updated_at:nowIso()},{onConflict:'user_id,scope'});
    if(error){notify('Erro ao salvar controle do worker: '+error.message,'err');return null;}
    lastPayload=payload;
    await renderControl();
    return payload;
  }

  function statusLabel(p){
    const s=String(p?.status||'idle');
    if(p?.enabled&&s==='running'&&p?.mode==='test')return 'Teste autorizado';
    if(p?.enabled&&s==='running')return 'Rodando';
    if(s==='paused')return 'Pausado';
    if(s==='error')return 'Erro';
    return 'Aguardando autorização';
  }
  function statusClass(p){
    const s=String(p?.status||'idle');
    if(p?.enabled&&s==='running')return 'ok';
    if(s==='error')return 'err';
    if(s==='paused')return 'warn';
    return 'idle';
  }

  function cardHtml(p){
    const testPhone=normPhone(p?.test_phone||p?.testPhone||DEFAULT_TEST_PHONE||'');
    return `<div id="workerControlCard" class="worker-control-card ${statusClass(p)}">
      <div class="worker-control-head">
        <div>
          <div class="worker-control-title">Worker WhatsApp local</div>
          <div class="worker-control-sub">Docker envia em background somente quando você autorizar aqui.</div>
        </div>
        <div class="worker-control-status">${esc(statusLabel(p))}</div>
      </div>
      <div class="worker-control-grid">
        <div><span>Modo</span><strong>${esc(p?.mode==='test'?'Teste':'Produção')}</strong></div>
        <div><span>Atualizado</span><strong>${esc(p?.updated_at?new Date(p.updated_at).toLocaleTimeString('pt-BR'):'—')}</strong></div>
        <div><span>Teste</span><strong>${testPhone?`+${esc(testPhone)}`:'não configurado'}</strong></div>
      </div>
      <div class="worker-control-actions">
        <button type="button" class="btn btn-primary" data-worker-control="start-live">Iniciar worker</button>
        <button type="button" class="btn btn-ghost" data-worker-control="pause">Pausar</button>
        <button type="button" class="btn btn-ghost" data-worker-control="stop">Parar</button>
        <input id="workerTestPhone" placeholder="+55 DDD número de teste" value="${testPhone?`+${esc(testPhone)}`:''}">
        <button type="button" class="btn btn-ghost" data-worker-control="save-test-phone">Salvar número teste</button>
        <button type="button" class="btn btn-ghost" data-worker-control="test-once">Enviar teste</button>
      </div>
      <div class="worker-control-note">Segurança: abrir o Docker não dispara nada. O worker só envia quando o controle estiver <b>enabled=true</b> e <b>Rodando</b>. Em <b>Teste</b>, o destino será o número configurado neste card e o worker pausa depois do teste.</div>
    </div>`;
  }

  function ensureStyles(){
    if(document.getElementById('workerControlStyles'))return;
    const st=document.createElement('style');
    st.id='workerControlStyles';
    st.textContent=`
      .worker-control-card{border:1px solid var(--border2,#2a2d38);background:rgba(16,17,24,.92);border-radius:14px;padding:14px;margin:12px 0 16px;color:var(--text,#f5f5f7)}
      .worker-control-card.ok{border-color:rgba(166,255,65,.65);box-shadow:0 0 0 1px rgba(166,255,65,.12) inset}.worker-control-card.err{border-color:rgba(255,73,73,.7)}.worker-control-card.warn{border-color:rgba(255,190,60,.7)}
      .worker-control-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.worker-control-title{font-size:16px;font-weight:800;letter-spacing:.02em}.worker-control-sub,.worker-control-note{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted,#777b91);line-height:1.6}.worker-control-status{font-family:'DM Mono',monospace;font-size:10px;border:1px solid currentColor;border-radius:999px;padding:6px 10px;color:var(--accent,#a6ff41);white-space:nowrap}.worker-control-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.worker-control-grid>div{border:1px solid var(--border2,#2a2d38);border-radius:10px;padding:9px 10px;background:rgba(0,0,0,.18)}.worker-control-grid span{display:block;font-family:'DM Mono',monospace;font-size:8px;color:var(--muted,#777b91);text-transform:uppercase}.worker-control-grid strong{display:block;margin-top:4px;font-size:13px}.worker-control-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.worker-control-actions input{min-width:210px;flex:1;border:1px solid var(--border2,#2a2d38);background:var(--bg,#090a0f);color:var(--text,#fff);border-radius:10px;padding:10px 12px;font-size:12px}.worker-control-note{margin-top:10px}`;
    document.head.appendChild(st);
  }

  async function renderControl(){
    if(injecting)return;
    injecting=true;
    try{
      ensureStyles();
      const panel=document.getElementById('panel-fila-zap');
      if(!panel)return;
      const p=await getControl();
      let host=document.getElementById('workerControlMount');
      if(!host){
        host=document.createElement('div');
        host.id='workerControlMount';
        const title=[...panel.querySelectorAll('h1,h2,.page-title')][0];
        const target=title?.parentElement || panel.firstElementChild || panel;
        target.insertAdjacentElement('afterend',host);
      }
      host.innerHTML=cardHtml(p);
    }finally{injecting=false;}
  }

  async function startLive(){
    await setControl({enabled:true,status:'running',mode:'live',test_mode:false,testMode:false,started_at:nowIso(),last_command:'start_live'});
    notify('Worker autorizado. O Docker local assumirá os disparos.','ok');
  }
  async function pause(){
    await setControl({enabled:false,status:'paused',paused_at:nowIso(),last_command:'pause'});
    notify('Worker pausado.','ok');
  }
  async function stop(){
    await setControl({enabled:false,status:'idle',stopped_at:nowIso(),last_command:'stop'});
    notify('Worker parado.','ok');
  }
  async function saveTestPhone(){
    const phone=normPhone(document.getElementById('workerTestPhone')?.value||DEFAULT_TEST_PHONE||'');
    if(!phone){notify('Informe um número de teste.','err');return null;}
    const payload=await setControl({test_phone:phone,testMode:false,test_mode:false,last_command:'save_test_phone'});
    if(payload)notify('Número de teste salvo.','ok');
    return phone;
  }

  async function testOnce(){
    const phone=normPhone(document.getElementById('workerTestPhone')?.value||DEFAULT_TEST_PHONE||'');
    if(!phone){notify('Informe um número de teste.','err');return;}
    await setControl({enabled:true,status:'running',mode:'test',test_mode:true,testMode:true,test_phone:phone,started_at:nowIso(),last_command:'test_once'});
    notify('Teste autorizado. O worker enviará para o número informado e pausará depois.','ok');
  }

  document.addEventListener('click',function(e){
    const btn=e.target.closest('button');
    if(!btn)return;
    const action=btn.getAttribute('data-worker-control');
    if(action){
      e.preventDefault(); e.stopPropagation();
      if(action==='start-live')startLive();
      if(action==='pause')pause();
      if(action==='stop')stop();
      if(action==='save-test-phone')saveTestPhone();
      if(action==='test-once')testOnce();
      return;
    }
    const panel=document.getElementById('panel-fila-zap');
    if(panel&&panel.contains(btn)&&String(btn.textContent||'').trim().toLowerCase()==='disparar'){
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      startLive();
    }
  },true);

  const oldSwitch=window.switchPanel;
  if(typeof oldSwitch==='function'&&!oldSwitch.__workerControlPatched){
    const patched=function(name){const res=oldSwitch.apply(this,arguments); setTimeout(()=>{try{if(String(name).toLowerCase().includes('whatsapp')||String(name).toLowerCase().includes('fila-zap'))renderControl();}catch(_){}},250); return res;};
    patched.__workerControlPatched=true; window.switchPanel=patched;
  }
  window.renderWhatsappWorkerControl=renderControl;
  window.setWhatsappWorkerControl=setControl;
  setInterval(()=>{try{const panel=document.getElementById('panel-fila-zap'); if(panel&&panel.classList.contains('active'))renderControl();}catch(_){}},5000);
  document.addEventListener('DOMContentLoaded',()=>setTimeout(renderControl,1200));
  setTimeout(renderControl,1800);
  console.log('[lead-certo][worker-control]',VERSION);
})();
