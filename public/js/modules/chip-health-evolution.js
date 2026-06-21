/* V79 — Monitoramento leve de conexão dos chips pela Evolution
   - Supabase permanece fonte única de verdade.
   - Não altera envio, validação, webhook, conversas, pré-envio ou fila.
   - Atualiza whatsapp_instances.status/connection_state com o estado real da Evolution.
   - Chips sem URL/instância/api_key ficam como "not_configured" e não devem ser tratados como operacionais.
*/
(function(){
  'use strict';
  const VERSION='20260618-V79-CHIP-HEALTH-EVOLUTION';
  const CHECK_CFG_MS=60000;
  const CHECK_OP_MS=30000;
  const CHECK_IDLE_MS=90000;
  let timer=null;
  let checking=false;
  let lastCheckAt=0;
  let lastRenderAt=0;
  let lastHealth=[];

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function notify(msg,type){ try { if(typeof window.notify==='function') return window.notify(msg,type); } catch(e){} console[type==='err'?'error':'log'](msg); }
  function cleanBase(v){ return String(v||'').trim().replace(/\/+$/,'') || 'https://evolution.samuelvinsansi.com.br'; }
  function chipName(ch){ return String(ch?.label || ch?.name || ch?.chip_id || ch?.instance || 'Chip').trim(); }
  function chipId(ch){ return String(ch?.chip_id || ch?.id || ch?.instance || '').trim(); }
  function hasConfig(ch){ return !!(cleanBase(ch?.base_url || ch?.evolution_url || ch?.url) && String(ch?.instance||'').trim() && String(ch?.api_key || ch?.apiKey || ch?.key || '').trim()); }
  function activePanelId(){ try { return document.querySelector('.panel.active')?.id || ''; } catch(e){ return ''; } }
  function intervalForPage(){
    const id=activePanelId();
    if(id==='panel-config') return CHECK_CFG_MS;
    if(id==='panel-preenvio' || id==='panel-fila-zap') return CHECK_OP_MS;
    return CHECK_IDLE_MS;
  }
  function parseState(data){
    const raw = data?.instance?.state || data?.state || data?.connectionState || data?.connection_state || data?.status || data?.instance?.connectionStatus || data?.instance?.connection_state || '';
    const s=String(raw||'').toLowerCase();
    if(['open','connected','conectado','online','ready'].includes(s)) return 'connected';
    if(['connecting','pairing','qr','qrcode','loading','starting'].includes(s)) return 'connecting';
    if(['close','closed','disconnected','desconectado','offline','logout','logged_out'].includes(s)) return 'disconnected';
    return s || 'unknown';
  }
  async function loadDbChips(includeAll){
    const c=sb(), userId=uid();
    if(!c || !userId) return [];
    let q=c.from('whatsapp_instances')
      .select('id,user_id,user_email,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active,daily_limit,block_size,interval_seconds,blocks,created_at,updated_at')
      .eq('user_id',userId)
      .eq('active',true)
      .order('label',{ascending:true});
    const {data,error}=await q;
    if(error){ console.warn(`[${VERSION}][load]`,error.message); return []; }
    return (data||[]).filter(r=>includeAll || String(r.instance||'').trim());
  }
  async function fetchConnectionState(ch){
    if(!hasConfig(ch)) return {state:'not_configured', ok:false, message:'URL, instância ou api_key ausente'};
    const base=cleanBase(ch.base_url || ch.evolution_url || ch.url);
    const instance=String(ch.instance||'').trim();
    const apikey=String(ch.api_key || ch.apiKey || ch.key || '').trim();
    const endpoints=[
      `${base}/instance/connectionState/${encodeURIComponent(instance)}`,
      `${base}/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`
    ];
    let lastErr='';
    for(const url of endpoints){
      try{
        const res=await fetch(url,{method:'GET',headers:{apikey}});
        const text=await res.text();
        let data={};
        try{ data=JSON.parse(text); }catch(e){ data={raw:text}; }
        if(!res.ok){ lastErr=data?.message || data?.error || text || `HTTP ${res.status}`; continue; }
        let state=parseState(Array.isArray(data)?(data[0]||{}):data);
        // fetchInstances pode devolver array com objeto instance/state em formatos diferentes.
        if(Array.isArray(data) && data.length){
          const found=data.find(x=>String(x?.name||x?.instance?.instanceName||x?.instanceName||'')===instance) || data[0];
          state=parseState(found);
        }
        return {state, ok:state==='connected', message:''};
      }catch(e){ lastErr=e?.message || String(e); }
    }
    return {state:'unreachable', ok:false, message:lastErr || 'Evolution indisponível'};
  }
  function mapDbStatus(state){
    if(state==='connected') return {status:'connected', connection_state:'connected'};
    if(state==='connecting') return {status:'connecting', connection_state:'connecting'};
    if(state==='not_configured') return {status:'not_configured', connection_state:'not_configured'};
    if(state==='unreachable') return {status:'unreachable', connection_state:'unreachable'};
    if(state==='disconnected') return {status:'disconnected', connection_state:'disconnected'};
    return {status:state||'unknown', connection_state:state||'unknown'};
  }
  async function persistState(ch, health){
    const c=sb(), userId=uid();
    if(!c || !userId || !ch?.id) return;
    const patch={...mapDbStatus(health.state), updated_at:new Date().toISOString()};
    const currentStatus=String(ch.status||'');
    const currentState=String(ch.connection_state||'');
    if(currentStatus===patch.status && currentState===patch.connection_state) return;
    const {error}=await c.from('whatsapp_instances').update(patch).eq('user_id',userId).eq('id',ch.id);
    if(error) console.warn(`[${VERSION}][persist]`,error.message);
  }
  async function checkAllChips(reason){
    if(checking) return lastHealth;
    checking=true;
    try{
      const chips=await loadDbChips(true);
      const result=[];
      for(const ch of chips){
        const h=await fetchConnectionState(ch);
        result.push({...ch,_health:h});
        await persistState(ch,h);
        // pequena pausa para não bater 11 chips ao mesmo tempo no tunnel/Evolution
        await new Promise(r=>setTimeout(r,150));
      }
      lastHealth=result;
      lastCheckAt=Date.now();
      window.__whatsappChipHealthV79=result;
      patchOperationalCache(result);
      softRender(reason);
      return result;
    }catch(e){ console.warn(`[${VERSION}][check]`,e); return lastHealth; }
    finally{ checking=false; scheduleNext(); }
  }
  function normalizeForCache(row){
    const h=row._health || {state:row.connection_state || row.status || 'unknown'};
    const instance=String(row.instance || row.name || row.chip_id || '').trim();
    const label=row.label || row.name || instance || 'WhatsApp';
    return {
      ...row,
      id:String(row.chip_id || row.id || instance),
      dbId:row.id || null,
      nome:row.name || label,
      name:row.name || label,
      label,
      instance,
      status: row.active===false ? 'disabled' : (h.state==='not_configured' ? 'not_configured' : 'active'),
      connectionState:h.state || row.connection_state || row.status || 'unknown',
      connection_state:h.state || row.connection_state || row.status || 'unknown',
      operational: h.state!=='not_configured',
      isConnected: h.state==='connected',
      healthMessage:h.message || '',
      dailyLimit:Number(row.daily_limit || row.dailyLimit || 120),
      daily_limit:Number(row.daily_limit || row.dailyLimit || 120),
      blockSize:Number(row.block_size || row.blockSize || 60),
      block_size:Number(row.block_size || row.blockSize || 60),
      intervalSeconds:Number(row.interval_seconds || row.intervalSeconds || 120),
      interval_seconds:Number(row.interval_seconds || row.intervalSeconds || 120),
      blocks:Array.isArray(row.blocks) ? row.blocks : [],
      url: row.url || row.base_url || row.evolution_url || 'https://evolution.samuelvinsansi.com.br',
      apiKey: row.api_key || row.apiKey || row.key || '',
      key: row.api_key || row.apiKey || row.key || ''
    };
  }
  function patchOperationalCache(rows){
    const all=(rows||[]).map(normalizeForCache);
    const operational=all.filter(ch=>ch.operational!==false && ch.instance);
    window.__whatsappChipsHealthAllV79=all;
    window.__whatsappChipsDbFirstV51=operational;
    window.__whatsappChipsDbFirstV52=operational;
  }

  const originalGetWhatsapp=window.getWhatsappChipsV29;
  window.getWhatsappChipsV29=function(){
    if(Array.isArray(window.__whatsappChipsDbFirstV52) && window.__whatsappChipsDbFirstV52.length) return window.__whatsappChipsDbFirstV52.slice();
    try { return typeof originalGetWhatsapp==='function' ? originalGetWhatsapp() : []; } catch(e){ return []; }
  };
  window.getWhatsappChipsHealthAllV79=function(){
    if(Array.isArray(window.__whatsappChipsHealthAllV79)) return window.__whatsappChipsHealthAllV79.slice();
    return window.getWhatsappChipsV29();
  };

  function statusVisual(state){
    const s=String(state||'unknown').toLowerCase();
    if(s==='connected') return {cls:'ok',label:'Conectado',dot:'on',hint:'Pronto para validar/disparar'};
    if(s==='connecting') return {cls:'warn',label:'Conectando',dot:'warn',hint:'Aguardando conexão'};
    if(s==='not_configured') return {cls:'err',label:'Não configurado',dot:'off',hint:'Preencha URL, instância e api_key'};
    if(s==='unreachable') return {cls:'err',label:'Evolution offline',dot:'off',hint:'Não foi possível consultar a Evolution'};
    return {cls:'err',label:'Desconectado',dot:'off',hint:'Leia o QR Code ou reconecte no Manager'};
  }
  function renderStatusPill(ch){
    const s=statusVisual(ch.connection_state || ch.connectionState || ch.status);
    return `<span class="chip-health-pill ${s.cls}" title="${esc(s.hint)}">${esc(s.label)}</span>`;
  }
  function applyStyle(){
    if(document.getElementById('v79-chip-health-style')) return;
    const st=document.createElement('style');
    st.id='v79-chip-health-style';
    st.textContent=`
      .chip-health-pill{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:3px 8px;font-family:'DM Mono',monospace;font-size:9px;font-weight:800;letter-spacing:.02em;white-space:nowrap}
      .chip-health-pill.ok{color:var(--ok);border-color:rgba(35,213,115,.35);background:rgba(35,213,115,.08)}
      .chip-health-pill.warn{color:#ffd166;border-color:rgba(255,209,102,.35);background:rgba(255,209,102,.08)}
      .chip-health-pill.err{color:var(--error);border-color:rgba(255,91,91,.38);background:rgba(255,91,91,.08)}
      .chip-dot.warn{background:#ffd166!important;box-shadow:0 0 10px rgba(255,209,102,.35)!important}
      .chip-card.v79-disconnected{opacity:.86}
      .chip-card.v79-not-configured{opacity:.72;border-style:dashed!important}
      .v79-chip-meta-warn{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:5px;line-height:1.35}
    `;
    document.head.appendChild(st);
  }

  const originalRenderChipsConfig=window.renderChipsConfig;
  window.renderChipsConfig=function(){
    applyStyle();
    const grid=document.getElementById('chipGrid');
    if(!grid){ try { return typeof originalRenderChipsConfig==='function' ? originalRenderChipsConfig.apply(this,arguments) : undefined; } catch(e){} return; }
    const chips=window.getWhatsappChipsHealthAllV79();
    if(!chips.length){
      grid.innerHTML='<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">Nenhum chip configurado. Adicione os chips usados na operação.</div>';
      return;
    }
    grid.innerHTML=chips.map(c=>{
      const state=c.connection_state || c.connectionState || c.status || 'unknown';
      const vis=statusVisual(state);
      const cls=state==='not_configured'?'v79-not-configured':(state==='connected'?'':'v79-disconnected');
      return `<div class="chip-card ${cls}">
        <div class="chip-card-header">
          <div class="chip-dot ${vis.dot==='on'?'on':vis.dot==='warn'?'warn':'off'}"></div>
          <div style="flex:1;min-width:0">
            <div class="chip-name" id="chipNameDisplay_${esc(c.id)}">${esc(chipName(c))}</div>
            <div class="chip-instance">${esc(c.instance || 'instância não configurada')}</div>
          </div>
          ${renderStatusPill(c)}
        </div>
        <div class="v79-chip-meta-warn">${esc(vis.hint)}${c.healthMessage?`<br>${esc(c.healthMessage)}`:''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-ghost" style="font-size:10px;padding:6px 12px" onclick="verQRChip('${esc(c.id)}')">▦ QR Code</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:6px 12px" onclick="iniciarRenomeioChip('${esc(c.id)}')">━ Renomear</button>
          <button type="button" class="btn btn-danger chip-del" style="font-size:10px;padding:6px 12px" onclick="event.preventDefault();event.stopPropagation();deletarChip('${esc(c.id)}');return false;">✕ Remover</button>
        </div>
        <div id="renamePanel_${esc(c.id)}" style="display:none;margin-top:10px">
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" id="renameInput_${esc(c.id)}" value="${esc(chipName(c))}" placeholder="Novo nome..." style="flex:1;font-size:11px;padding:7px 10px"/>
            <button class="btn btn-primary" style="font-size:10px;padding:6px 12px;white-space:nowrap" onclick="confirmarRenomeioCip('${esc(c.id)}')">✓ Salvar</button>
            <button class="btn btn-ghost" style="font-size:10px;padding:6px 10px" onclick="cancelarRenomeioChip('${esc(c.id)}')">✕</button>
          </div>
        </div>
      </div>`;
    }).join('');
  };

  function softRender(reason){
    const now=Date.now();
    if(now-lastRenderAt<2500) return;
    lastRenderAt=now;
    try { if(activePanelId()==='panel-config' && typeof window.renderChipsConfig==='function') window.renderChipsConfig(); } catch(e){}
    try { if(typeof window.renderChipsPanel==='function') window.renderChipsPanel(); } catch(e){}
    try { if(typeof window.updateChipsBadge==='function') window.updateChipsBadge(); } catch(e){}
  }
  function scheduleNext(){
    clearTimeout(timer);
    timer=setTimeout(()=>checkAllChips('interval'), intervalForPage());
  }
  window.checkWhatsappChipsHealthV79=function(){ return checkAllChips('manual'); };
  window.isWhatsappChipConnectedV79=function(chip){
    const id=String(chip?.id||chip?.dbId||chip?.instance||chip||'');
    const rows=window.getWhatsappChipsHealthAllV79();
    const found=rows.find(c=>String(c.id)===id||String(c.dbId||'')===id||String(c.instance||'')===id);
    const state=found?.connection_state || found?.connectionState || found?.status;
    return state==='connected';
  };
  window.canUseWhatsappChipV79=function(chip){
    const id=String(chip?.id||chip?.dbId||chip?.instance||chip||'');
    const rows=window.getWhatsappChipsHealthAllV79();
    const found=rows.find(c=>String(c.id)===id||String(c.dbId||'')===id||String(c.instance||'')===id);
    const state=found?.connection_state || found?.connectionState || found?.status;
    return state!=='not_configured' && state!=='unreachable';
  };

  document.addEventListener('DOMContentLoaded',()=>{
    applyStyle();
    setTimeout(()=>checkAllChips('startup'),1800);
    setTimeout(()=>checkAllChips('startup-2'),6000);
  });
  window.addEventListener('focus',()=>{ if(Date.now()-lastCheckAt>15000) checkAllChips('focus'); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && Date.now()-lastCheckAt>15000) checkAllChips('visible'); });
  console.log(`[v79][chip-health] ativo ${VERSION}`);
})();
