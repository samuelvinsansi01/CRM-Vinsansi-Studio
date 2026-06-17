
(function(){
  'use strict';
  const VERSION='v51-chips-db-first';
  function sb(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function email(){ try { return String(window.currentUser?.email || window.authUser?.email || '').trim().toLowerCase(); } catch(e){ return ''; } }
  function cacheKey(){ return `vs_whatsapp_chips_v29:${uid()}:${email()}`; }
  function normalize(row){
    const instance=String(row.instance || row.name || row.chip_id || '').trim();
    const label=row.label || row.name || instance || 'WhatsApp';
    return {
      ...row,
      id:String(row.chip_id || row.id || instance),
      dbId:row.id || null,
      name:row.name || label,
      label,
      instance,
      status: row.active===false ? 'disabled' : (row.status || row.connection_state || 'active'),
      connectionState: row.connection_state || row.status || 'salvo no banco',
      dailyLimit:Number(row.daily_limit || row.dailyLimit || 120),
      blockSize:Number(row.block_size || row.blockSize || 60),
      intervalSeconds:Number(row.interval_seconds || row.intervalSeconds || 120),
      blocks:Array.isArray(row.blocks) ? row.blocks : [],
      url: row.url || row.base_url || row.evolution_url || 'https://evolution.samuelvinsansi.com.br',
      apiKey: row.api_key || row.apiKey || row.key || '',
      key: row.api_key || row.apiKey || row.key || ''
    };
  }
  async function loadChipsDbFirst(){
    const c=sb(); const userId=uid();
    if(!c || !userId) return [];
    const {data,error}=await c.from('whatsapp_instances')
      .select('id,user_id,user_email,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active,daily_limit,block_size,interval_seconds,blocks,created_at,updated_at')
      .eq('user_id',userId)
      .order('label',{ascending:true});
    if(error){ console.warn(`[${VERSION}] erro ao carregar chips`, error.message); return []; }
    const seen=new Set();
    const chips=(data||[]).filter(r=>r.active!==false && String(r.instance||'').trim()).map(normalize).filter(ch=>{
      const k=String(ch.instance||ch.id||''); if(!k || seen.has(k)) return false; seen.add(k); return true;
    });
    try { localStorage.setItem(cacheKey(), JSON.stringify(chips)); localStorage.removeItem('vs_whatsapp_chips_v29'); } catch(e){}
    window.__whatsappChipsDbFirstV51=chips;
    return chips;
  }
  window.fetchWhatsappChipsDbFirstV51=loadChipsDbFirst;
  const originalGet=window.getWhatsappChipsV29;
  window.getWhatsappChipsV29=function(){
    const cached=Array.isArray(window.__whatsappChipsDbFirstV51) ? window.__whatsappChipsDbFirstV51 : null;
    if(cached && cached.length) return cached;
    try {
      const raw=JSON.parse(localStorage.getItem(cacheKey())||'[]');
      if(Array.isArray(raw) && raw.length) return raw.map(normalize).filter(ch=>ch.status!=='disabled');
    } catch(e){}
    try { return typeof originalGet==='function' ? originalGet() : []; } catch(e){ return []; }
  };
  async function refresh(){
    const chips=await loadChipsDbFirst();
    try { if(typeof window.renderChipsPanel==='function') window.renderChipsPanel(); } catch(e){}
    try { if(typeof window.updateChipsBadge==='function') window.updateChipsBadge(); } catch(e){}
    return chips;
  }
  window.refreshWhatsappChipsDbFirstV51=refresh;
  document.addEventListener('DOMContentLoaded',()=>{ setTimeout(refresh,700); setTimeout(refresh,1800); });
  window.addEventListener('focus',()=>{ setTimeout(refresh,100); });
})();
