/* V53 — Chips DB-first: remoção definitiva + sem redirecionamento pós-clique
   Base: V52. Patch adicional: trava submit/reload em botões de remoção de chip.

   V52 — Chips DB-first: remoção definitiva + leitura exata em Pré-envio/Fila
   - Supabase continua sendo a fonte única de verdade.
   - Remover chip marca whatsapp_instances.active=false no banco, sem depender de user_email.
   - Limpa caches locais para impedir o chip removido de reaparecer.
   - Configurações, Pré-envio e Fila passam a consumir somente chips ativos do banco. */
(function(){
  'use strict';
  const VERSION='v53-chips-remocao-sem-redirect';
  const LEGACY_KEY='vs_chips_v2';
  const V29_KEY='vs_whatsapp_chips_v29';
  let loaded=false;
  let activeChips=[];

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function email(){ try { return String(window.currentUser?.email || window.authUser?.email || '').trim().toLowerCase(); } catch(e){ return ''; } }
  function cacheKey(){ return `${V29_KEY}:${uid()}:${email()}`; }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function notify(msg,type){ try { if(typeof window.notify==='function') return window.notify(msg,type); } catch(e){} console[type==='err'?'error':'log'](msg); }
  function norm(row){
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
      status: row.active===false ? 'disabled' : 'active',
      connectionState: row.connection_state || row.status || 'salvo no banco',
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
  function writeCaches(chips){
    const safe=Array.isArray(chips)?chips:[];
    activeChips=safe;
    loaded=true;
    window.__whatsappChipsDbFirstV51=safe;
    window.__whatsappChipsDbFirstV52=safe;
    try { localStorage.setItem(cacheKey(), JSON.stringify(safe)); } catch(e){}
    try { localStorage.removeItem(V29_KEY); } catch(e){}
    try {
      const legacy=safe.map(c=>({ id:c.id, nome:c.nome||c.name||c.label||c.instance, name:c.name||c.label||c.instance, url:c.url, instance:c.instance, key:c.key||c.apiKey||'', status:c.connectionState||'salvo no banco' }));
      localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    } catch(e){}
  }
  async function loadActiveChips(){
    const c=sb(), userId=uid();
    if(!c || !userId){ loaded=true; writeCaches([]); return []; }
    const {data,error}=await c.from('whatsapp_instances')
      .select('id,user_id,user_email,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active,daily_limit,block_size,interval_seconds,blocks,created_at,updated_at')
      .eq('user_id',userId)
      .eq('active',true)
      .order('label',{ascending:true});
    if(error){ console.warn(`[${VERSION}][load]`,error.message); loaded=true; return activeChips; }
    const seen=new Set();
    const chips=(data||[]).filter(r=>String(r.instance||'').trim()).map(norm).filter(ch=>{ const k=String(ch.instance||ch.id||''); if(!k || seen.has(k)) return false; seen.add(k); return true; });
    writeCaches(chips);
    return chips;
  }
  window.fetchWhatsappChipsDbFirstV52=loadActiveChips;
  window.refreshWhatsappChipsDbFirstV52=async function(){
    const chips=await loadActiveChips();
    try { if(typeof window.renderConfiguracoes==='function') window.renderConfiguracoes(); } catch(e){}
    try { if(typeof window.renderChipsPanel==='function') window.renderChipsPanel(); } catch(e){}
    try { if(typeof window.updateChipsBadge==='function') window.updateChipsBadge(); } catch(e){}
    try { if(typeof window.updateBadges==='function') window.updateBadges(); } catch(e){}
    return chips;
  };

  const originalGetWhatsapp=window.getWhatsappChipsV29;
  window.getWhatsappChipsV29=function(){
    if(loaded) return activeChips.slice();
    if(Array.isArray(window.__whatsappChipsDbFirstV52)) return window.__whatsappChipsDbFirstV52.slice();
    if(Array.isArray(window.__whatsappChipsDbFirstV51)) return window.__whatsappChipsDbFirstV51.slice();
    try { const raw=JSON.parse(localStorage.getItem(cacheKey())||'[]'); if(Array.isArray(raw)) return raw.map(norm).filter(c=>c.status!=='disabled'); } catch(e){}
    try { return typeof originalGetWhatsapp==='function' ? originalGetWhatsapp() : []; } catch(e){ return []; }
  };

  const originalGetChips=window.getChips;
  window.getChips=function(){
    const chips=window.getWhatsappChipsV29();
    if(loaded || chips.length){
      return chips.map(c=>({ id:c.id, dbId:c.dbId, nome:c.nome||c.name||c.label||c.instance, name:c.name||c.label||c.instance, url:c.url, instance:c.instance, key:c.key||c.apiKey||'', status:c.connectionState==='open'?'conectado':(c.connectionState||'salvo no banco') }));
    }
    try { return typeof originalGetChips==='function' ? originalGetChips() : []; } catch(e){ return []; }
  };
  window.getChipById=function(id){ return window.getChips().find(c=>String(c.id)===String(id) || String(c.dbId||'')===String(id) || String(c.instance||'')===String(id)); };

  async function hardRemove(id, ask=true){
    const target=window.getWhatsappChipsV29().find(c=>String(c.id)===String(id)||String(c.dbId||'')===String(id)||String(c.instance||'')===String(id));
    if(!target) return notify('// chip não encontrado no banco/cache atual','warn');
    if(ask && typeof confirm==='function' && !confirm(`Remover o chip ${target.label||target.name||target.instance}?\n\nEle será desativado no Supabase e deixará de contar no Pré-envio e na Fila.`)) return;
    const c=sb(), userId=uid();
    if(!c || !userId) return notify('// Supabase indisponível para remover chip','err');
    const ids=[target.dbId,target.id].filter(Boolean).map(String);
    let ok=false;
    for(const dbId of ids){
      const {error}=await c.from('whatsapp_instances').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('id',dbId);
      if(!error) ok=true; else console.warn(`[${VERSION}][remove-id]`,error.message);
    }
    if(!ok && target.instance){
      const {error}=await c.from('whatsapp_instances').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('instance',target.instance);
      if(!error) ok=true; else console.warn(`[${VERSION}][remove-instance]`,error.message);
    }
    if(!ok && target.id){
      const {error}=await c.from('whatsapp_instances').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('chip_id',target.id);
      if(!error) ok=true; else console.warn(`[${VERSION}][remove-chip_id]`,error.message);
    }
    if(!ok) return notify('// não foi possível remover/desativar o chip no Supabase','err');
    const remaining=activeChips.filter(c=>String(c.id)!==String(target.id)&&String(c.dbId||'')!==String(target.dbId||'')&&String(c.instance||'')!==String(target.instance||''));
    writeCaches(remaining);
    await loadActiveChips();
    try { if(window.disparoChipId===id) window.disparoChipId=null; if(window.activeChipId===id) window.activeChipId=null; } catch(e){}
    try { if(typeof window.renderConfiguracoes==='function') window.renderConfiguracoes(); } catch(e){}
    try { if(typeof window.renderPreEnvioPanelV50==='function') await window.renderPreEnvioPanelV50(); } catch(e){}
    try { if(typeof window.renderPreEnvioPanelV31==='function') await window.renderPreEnvioPanelV31(); } catch(e){}
    try { if(typeof window.renderFilaZap==='function') await window.renderFilaZap(); } catch(e){}
    try { if(typeof window.renderChipsPanel==='function') window.renderChipsPanel(); } catch(e){}
    try { if(typeof window.updateBadges==='function') window.updateBadges(); if(typeof window.updateChipsBadge==='function') window.updateChipsBadge(); } catch(e){}
    notify('✓ Chip removido do banco e telas atualizadas');
  }
  window.removeWhatsappChip=function(id){ return hardRemove(id,true); };
  window.deletarChip=function(id){ return hardRemove(id,true); };

  const originalRenderConfig=window.renderConfiguracoes;
  if(typeof originalRenderConfig==='function'){
    window.renderConfiguracoes=function(){
      if(!loaded) loadActiveChips().then(()=>{ try{ originalRenderConfig(); }catch(e){} });
      return originalRenderConfig.apply(this,arguments);
    };
  }

  // V53: alguns botões de remoção ficam dentro de áreas/formulários legados.
  // O clique removia corretamente no Supabase, mas o submit padrão do <button> podia recarregar/redirecionar a página.
  // Este guard só cancela o comportamento padrão; não bloqueia o onclick existente.
  document.addEventListener('click', function(ev){
    const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if(!btn) return;
    const on = String(btn.getAttribute('onclick') || '');
    const isChipRemove = on.includes('removeWhatsappChip') || on.includes('deletarChip') || btn.classList.contains('chip-del');
    if(isChipRemove){
      try { ev.preventDefault(); } catch(e){}
      try { btn.setAttribute('type','button'); } catch(e){}
    }
  }, true);

  document.addEventListener('DOMContentLoaded',()=>{ setTimeout(loadActiveChips,250); setTimeout(()=>window.refreshWhatsappChipsDbFirstV52(),1000); setTimeout(()=>window.refreshWhatsappChipsDbFirstV52(),2500); });
  window.addEventListener('focus',()=>{ setTimeout(loadActiveChips,80); });
})();
