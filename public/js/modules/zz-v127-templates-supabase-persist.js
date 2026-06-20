(function(){
  'use strict';
  const VERSION = '20260620-V127-TEMPLATES-SUPABASE-PERSIST';
  const SYNC_DEBOUNCE_MS = 900;
  let timer = null;
  let syncing = false;
  let lastHash = '';

  function log(...args){ try{ console.log('[v127][templates-supabase]', ...args); }catch(_){} }
  function sb(){ try { return window.sbClient || window.supabaseClient || null; } catch(_) { return null; } }
  function uid(){ try { return window.currentUser && window.currentUser.id ? String(window.currentUser.id) : ''; } catch(_) { return ''; } }
  function notifySafe(msg,type){ try { if (typeof notify === 'function') notify(msg,type); } catch(_){} }
  function esc(v){ return String(v == null ? '' : v); }
  function normType(v){
    const s = String(v||'').toLowerCase().trim().replace(/_/g,'-');
    if (s.includes('agreg')) return 'agregador';
    if (s.includes('com')) return 'com-site';
    return 'sem-site';
  }
  function templateList(ramoId,tipo){
    try {
      const list = typeof getTemplatesForRamoTipo === 'function' ? getTemplatesForRamoTipo(ramoId,tipo) : [];
      return (Array.isArray(list) ? list : []).map(t => {
        if (t && typeof t === 'object') return { msg1: esc(t.msg1 || t.part_1 || t.message_1 || t.text || ''), msg2: esc(t.msg2 || t.part_2 || t.message_2 || '') };
        return { msg1: esc(t), msg2: '' };
      }).filter(t => t.msg1.trim() || t.msg2.trim());
    } catch(_) { return []; }
  }
  function getRamosSafe(){
    try { return typeof getRamos === 'function' ? (getRamos() || []) : []; } catch(_) { return []; }
  }
  function buildPayload(){
    const out = [];
    const ramos = getRamosSafe();
    ramos.forEach(r => {
      const ramoId = String(r.id || r.nome || '').trim();
      if (!ramoId) return;
      ['sem-site','com-site','agregador'].forEach(tipo => {
        const list = templateList(ramoId,tipo);
        list.forEach((t,idx) => {
          out.push({
            ramo_id: ramoId,
            ramo_nome: String(r.nome || ramoId).trim(),
            template_type: tipo,
            idx,
            name: `${String(r.nome || ramoId).trim()} · ${tipo} · ${idx+1}`,
            part_1: t.msg1 || '',
            part_2: t.msg2 || '',
            active: true
          });
        });
      });
    });
    return out;
  }
  function hash(obj){ try { return JSON.stringify(obj); } catch(_) { return String(Date.now()); } }
  async function syncNow(reason='manual'){
    if (syncing) return;
    const c = sb(); const user = uid();
    if (!c || !user) return;
    const rows = buildPayload();
    if (!rows.length) return;
    const h = hash(rows);
    if (h === lastHash && reason !== 'force') return;
    syncing = true;
    try {
      const payload = rows.map(r => ({
        user_id: user,
        name: r.name,
        template_type: r.template_type,
        ramo_id: r.ramo_id,
        part_1: r.part_1,
        part_2: r.part_2,
        active: true,
        updated_at: new Date().toISOString()
      }));
      // Desativa apenas os templates dos ramos/tipos que serão regravados, preservando outros futuros.
      const { error: upErr } = await c.from('message_templates').upsert(payload, { onConflict: 'user_id,ramo_id,template_type,name' });
      if (upErr) throw upErr;
      lastHash = h;
      log('sincronizado', {reason, count:payload.length});
    } catch(err) {
      console.warn('[v127][templates-supabase] erro ao sincronizar', err);
      notifySafe('Templates locais OK, mas falhou salvar no Supabase: ' + (err && err.message ? err.message : err), 'warn');
    } finally { syncing = false; }
  }
  function schedule(reason){
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(reason), SYNC_DEBOUNCE_MS);
  }

  function wrap(name, after){
    const old = window[name];
    if (typeof old !== 'function' || old.__v127Wrapped) return;
    const fn = function(){
      const res = old.apply(this, arguments);
      try { after && after.apply(this, arguments); } catch(_){}
      return res;
    };
    fn.__v127Wrapped = true;
    window[name] = fn;
  }

  function install(){
    wrap('saveRamoTemplateMessage', () => schedule('save-template-message'));
    wrap('adicionarRamoTemplate', () => schedule('add-template'));
    wrap('removerRamoTemplate', () => schedule('remove-template'));
    wrap('saveRamos', () => schedule('save-ramos'));
    window.syncTemplatesSupabaseV127 = () => syncNow('force');
    setTimeout(() => syncNow('boot'), 1800);
    log('ativo', VERSION);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
