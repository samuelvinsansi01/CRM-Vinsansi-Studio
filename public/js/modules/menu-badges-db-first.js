/* V61 — Badges totais do menu usando o banco real e separação correta por status
   - Não consulta queue_items, pois essa tabela não existe no banco atual.
   - Base Permanente: base_permanente não possui coluna active; conta por user_id.
   - Pré-envio conta somente itens ainda em revisão/validação.
   - Fila WhatsApp conta itens aprovados/prontos/agendados para disparo.
   - Não conta invalid/sent/archived/moved/cancelled nos badges de pré-envio/fila.
   - Atribuição = soma das abas: WhatsApp + Com site + Instagram. */
(function(){
  'use strict';
  const VERSION='20260617-v61-menu-badges-status-correto';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  let running=false;
  let lastRun=0;

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined'&&currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;} }
  function set(id,value){ document.querySelectorAll('#'+CSS.escape(id)).forEach(el=>{ el.textContent=String(Number(value)||0); }); }
  async function count(table, build){
    const c=sb(); if(!c) return 0;
    let q=c.from(table).select('id',{count:'exact',head:true}).eq('user_id',uid());
    if(typeof build==='function') q=build(q);
    const {count,error}=await q;
    if(error){ console.warn('[v61][badge-count]',table,error.message || error); return 0; }
    return Number(count)||0;
  }
  async function countLeadStage(stage){ return count('leads', q=>q.eq('current_stage',stage)); }

  async function refreshMenuBadgesV61(force=false){
    const now=Date.now();
    if(running) return;
    if(!force && now-lastRun<2500) return;
    running=true; lastRun=now;
    try{
      const [aw,as,ai,instaBacklog,baseTotal,preTotal,queueZap] = await Promise.all([
        countLeadStage('attribution_whatsapp'),
        countLeadStage('attribution_site'),
        countLeadStage('attribution_instagram'),
        countLeadStage('instagram_backlog'),
        count('base_permanente'),
        count('pre_dispatch_items', q=>q.in('status',['review','pending_review','validation_retry','validation_error'])),
        count('pre_dispatch_items', q=>q.in('status',['approved','ready_to_dispatch','queued','dispatch_queue','waiting','not_sent','ready','pending','scheduled']))
      ]);

      set('badge-atribuicao', aw+as+ai);
      document.querySelectorAll('#atribTabZapCount').forEach(el=>el.textContent=`(${aw})`);
      document.querySelectorAll('#atribTabComSiteCount').forEach(el=>el.textContent=`(${as})`);
      document.querySelectorAll('#atribTabInstaCount').forEach(el=>el.textContent=`(${ai})`);

      set('badge-pre-envio', preTotal);
      set('badge-fila-zap', queueZap);
      set('badge-instagram', instaBacklog);
      set('badge-ja-enviados', baseTotal);
    }catch(e){
      console.warn('[v61][menu-badges]',e?.message||e);
    }finally{
      running=false;
    }
  }

  const previousUpdateBadges=window.updateBadges;
  window.updateBadges=function updateBadgesV61(){
    try{ if(typeof previousUpdateBadges==='function') previousUpdateBadges.apply(this,arguments); }catch(e){ console.warn('[v61][previous-updateBadges]',e?.message||e); }
    refreshMenuBadgesV61(false);
  };

  window.updateMenuBadgesTotalsV59=refreshMenuBadgesV61;
  window.updateMenuBadgesTotalsV60=refreshMenuBadgesV61;
  window.updateMenuBadgesTotalsV61=refreshMenuBadgesV61;
  window.__V61_MENU_BADGES_STATUS_CORRETO__=VERSION;

  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>refreshMenuBadgesV61(true),500);
    setTimeout(()=>refreshMenuBadgesV61(true),1800);
  });
  document.addEventListener('click',()=>setTimeout(()=>refreshMenuBadgesV61(true),350),true);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refreshMenuBadgesV61(true); });
  if(document.readyState!=='loading') setTimeout(()=>refreshMenuBadgesV61(true),500);
})();
