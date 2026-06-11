/* V41.10 OPERACIONAL PATCH — chips + proteção + envio server-side Supabase/Evolution */
(function(){
  const DEFAULT_CHIPS = [
    { id:'chip-8352', name:'8352', label:'8352', url:'https://evolution.samuelvinsansi.com.br', baseUrl:'https://evolution.samuelvinsansi.com.br', evolutionUrl:'https://evolution.samuelvinsansi.com.br', instance:'chip-8352', key:'vinsansi8352', apiKey:'vinsansi8352', status:'active', connectionState:'open', active:true, dailyLimit:120, blockSize:30, intervalSeconds:120, blocks:['08:00','10:00','12:00','14:00'] },
    { id:'chip-6846', name:'6846', label:'6846', url:'https://evolution.samuelvinsansi.com.br', baseUrl:'https://evolution.samuelvinsansi.com.br', evolutionUrl:'https://evolution.samuelvinsansi.com.br', instance:'chip-6846', key:'vinsansi6846', apiKey:'vinsansi6846', status:'active', connectionState:'open', active:true, dailyLimit:120, blockSize:30, intervalSeconds:120, blocks:['08:00','10:00','12:00','14:00'] },
    { id:'chip-8457', name:'8457', label:'8457', url:'https://evolution.samuelvinsansi.com.br', baseUrl:'https://evolution.samuelvinsansi.com.br', evolutionUrl:'https://evolution.samuelvinsansi.com.br', instance:'chip-8457', key:'vinsansi8457', apiKey:'vinsansi8457', status:'active', connectionState:'saved', active:true, dailyLimit:120, blockSize:30, intervalSeconds:120, blocks:['08:00','10:00','12:00','14:00'] }
  ];
  const CHIPS_KEY = 'vs_whatsapp_chips_v29';
  const SENT_KEY = 'vs_sent_contacts_cache_v41';

  function normalizePhoneV41(raw){
    let d = String(raw || '').replace(/\D/g,'');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (!d.startsWith('55') && d.length >= 10 && d.length <= 11) d = '55' + d;
    return d;
  }
  function isConnectedChipV41(chip){
    const s = String(chip?.connectionState || chip?.connection_state || chip?.status || '').toLowerCase();
    return chip && chip.active !== false && !chip.paused && chip.status !== 'disabled' && ['open','connected','active'].includes(s);
  }
  function getCachedSentSetV41(){
    try { return new Set((JSON.parse(localStorage.getItem(SENT_KEY) || '[]') || []).map(String)); } catch { return new Set(); }
  }
  function addCachedSentV41(phone){
    const n = normalizePhoneV41(phone); if (!n) return;
    const set = getCachedSentSetV41(); set.add(n);
    localStorage.setItem(SENT_KEY, JSON.stringify([...set].slice(-30000)));
  }
  async function getCurrentUserIdV41(){
    try {
      if (!window.sbClient && window.supabase && window.SUPABASE_URL && window.SUPABASE_PUBLISHABLE_KEY) return null;
      const client = window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null);
      const { data } = await client.auth.getSession();
      return data?.session?.user?.id || null;
    } catch { return null; }
  }
  function installDefaultChipsV41(){
    let current = [];
    try { current = JSON.parse(localStorage.getItem(CHIPS_KEY) || '[]') || []; } catch {}
    const byInstance = new Map(current.map(c => [c.instance, c]));
    for (const c of DEFAULT_CHIPS) {
      const prev = byInstance.get(c.instance) || {};
      byInstance.set(c.instance, { ...c, ...prev, url:prev.url || c.url, baseUrl:prev.baseUrl || c.baseUrl, evolutionUrl:prev.evolutionUrl || c.evolutionUrl, key:prev.key || c.key, apiKey:prev.apiKey || c.apiKey, dailyLimit:120, blockSize:30, intervalSeconds:120, blocks:c.blocks });
    }
    localStorage.setItem(CHIPS_KEY, JSON.stringify([...byInstance.values()]));
  }
  async function bootstrapDbV41(){
    const user_id = await getCurrentUserIdV41();
    if (!user_id) return;
    try {
      const res = await fetch('/api/prospeccao/v41/bootstrap', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ user_id }) });
      const data = await res.json().catch(()=>({}));
      if (data?.chips?.length) {
        const chips = data.chips.map(c => ({ id:c.instance, name:c.name || c.label, label:c.label, url:c.base_url || c.evolution_url || c.url, baseUrl:c.base_url, evolutionUrl:c.evolution_url, instance:c.instance, key:c.api_key, apiKey:c.api_key, status:c.active === false ? 'disabled' : 'active', connectionState:c.connection_state || c.status, active:c.active, dailyLimit:c.daily_limit, blockSize:c.block_size, intervalSeconds:c.interval_seconds, blocks:Array.isArray(c.blocks) ? c.blocks : ['08:00','10:00','12:00','14:00'] }));
        localStorage.setItem(CHIPS_KEY, JSON.stringify(chips));
      }
    } catch(e){ console.warn('[V41 bootstrap]', e); }
    try {
      const res = await fetch('/api/prospeccao/v41/sent-contacts?user_id=' + encodeURIComponent(user_id));
      const data = await res.json().catch(()=>({}));
      if (data?.contacts) localStorage.setItem(SENT_KEY, JSON.stringify(data.contacts.map(c => c.normalized_phone).filter(Boolean)));
    } catch(e){ console.warn('[V41 sent cache]', e); }
    try { window.renderChipsPanel?.(); window.renderWhatsappQueuePanel?.(); window.renderDispatchV30Panel?.(); } catch {}
  }

  installDefaultChipsV41();

  const oldReady = window.getReadyDispatchItemsV30;
  window.getReadyDispatchItemsV30 = function(){
    const sent = getCachedSentSetV41();
    const base = typeof oldReady === 'function' ? oldReady() : [];
    return base.filter(item => {
      const phone = normalizePhoneV41(item.telefone || item.phone || item.whatsapp || '');
      if (phone && sent.has(phone)) return false;
      const chip = (window.getWhatsappChipsV29?.() || []).find(c => c.id === item.chipId || c.instance === item.chipInstance);
      return isConnectedChipV41(chip);
    });
  };

  window.dispatchOneItemV32 = async function(item, chip){
    const queue = window.getWhatsappQueueV27?.() || [];
    const queueItem = queue.find(q => q.id === item.id) || item;
    const phone = normalizePhoneV41(queueItem.telefone || queueItem.phone || queueItem.whatsapp || '');
    if (getCachedSentSetV41().has(phone)) {
      queueItem.status = 'Erro'; queueItem.error = 'Telefone já está na proteção/já enviados'; window.saveWhatsappQueueV27?.(queue); return { ok:false, reason:queueItem.error };
    }
    if (!isConnectedChipV41(chip)) {
      queueItem.status = 'Erro'; queueItem.error = 'Chip não conectado/open'; window.saveWhatsappQueueV27?.(queue); return { ok:false, reason:queueItem.error };
    }
    const user_id = await getCurrentUserIdV41();
    if (!user_id) return { ok:false, reason:'usuário não autenticado' };
    queueItem.status = 'Enviando'; window.saveWhatsappQueueV27?.(queue); window.renderWhatsappQueuePanel?.();
    try {
      const res = await fetch('/api/prospeccao/v41/dispatch-one', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ user_id, item:queueItem, chip }) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      queueItem.status = 'Enviado'; queueItem.sentAt = new Date().toISOString(); queueItem.sentAtLabel = (typeof crmNowLabel === 'function' ? crmNowLabel() : new Date().toLocaleString('pt-BR')); queueItem.response = data.response; queueItem.dbDispatchItemId = data.dispatch_item_id;
      addCachedSentV41(phone);
      window.saveWhatsappQueueV27?.(queue);
      return { ok:true, reason:'enviado' };
    } catch(err) {
      queueItem.status = 'Erro'; queueItem.error = err?.message || 'falha desconhecida'; queueItem.updatedAt = new Date().toISOString(); window.saveWhatsappQueueV27?.(queue); return { ok:false, reason:queueItem.error };
    }
  };

  const oldImportar = window.importarLeads;
  window.importarLeads = function(){
    const before = getCachedSentSetV41();
    const raw = document.getElementById('importJsonInput')?.value || '';
    if (typeof oldImportar !== 'function') return;
    oldImportar();
    try {
      const val = window.getValData?.() || [];
      const filtered = val.filter(v => !before.has(normalizePhoneV41(v.whatsapp || v.phone || v.telefone || '')));
      if (filtered.length !== val.length) {
        window.saveValData?.(filtered);
        window.updateBadges?.();
        window.notify?.(`${val.length - filtered.length} lead(s) bloqueado(s) por já enviados/proteção.`, 'warn');
      }
    } catch(e){ console.warn('[V41 import block]', e, raw?.slice?.(0,20)); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(bootstrapDbV41, 1000);
    setTimeout(bootstrapDbV41, 3500);
  });
  window.V41Operacional = { bootstrapDbV41, normalizePhoneV41, isConnectedChipV41, addCachedSentV41 };
})();
