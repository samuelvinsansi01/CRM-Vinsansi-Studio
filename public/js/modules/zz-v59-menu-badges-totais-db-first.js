/* V59 — Badges do menu por total real da página
   - O número do menu não pode depender da última aba aberta.
   - Atribuição = WhatsApp + Com site + Instagram (todas as abas).
   - Pré-envio = total planejado/aprovado/pronto em pre_dispatch_items, não apenas chip/aba selecionada.
   - Instagram = backlog/fila de Instagram.
   - Base Permanente = total ativo na base permanente.
   - Mantém Supabase como fonte única de verdade. */
(function(){
  'use strict';
  const VERSION='20260617-v59-menu-badges-totais-db-first';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  let running=false;
  let lastRun=0;

  function sb(){ try{return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;} }
  function uid(){ try{return window.currentUser?.id || (typeof currentUser!=='undefined'&&currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;} }
  function set(id,value){ document.querySelectorAll('#'+CSS.escape(id)).forEach(el=>{ el.textContent=String(Number(value)||0); }); }
  function todayIso(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
  function getSelectedPreDate(){ return String(window.__selectedPreEnvioDateV50 || window.__selectedPreEnvioDateV317 || document.getElementById('preEnvioRoot')?.getAttribute('data-selected-date') || document.querySelector('#preWeekCards .pre-day-card.active')?.getAttribute('data-date') || todayIso()).slice(0,10); }
  async function count(table, build){
    const c=sb(); if(!c) return 0;
    let q=c.from(table).select('id',{count:'exact',head:true}).eq('user_id',uid());
    if(typeof build==='function') q=build(q);
    const {count,error}=await q;
    if(error){ console.warn('[v59][badge-count]',table,error.message); return 0; }
    return count||0;
  }
  async function countLeadStage(stage){ return count('leads', q=>q.eq('current_stage',stage)); }
  async function refreshMenuBadgesV59(force=false){
    const now=Date.now();
    if(running) return;
    if(!force && now-lastRun<1200) return;
    running=true; lastRun=now;
    try{
      const preDate=getSelectedPreDate();
      const [aw,as,ai,instaBacklog,baseTotal,preTotal,queueZap] = await Promise.all([
        countLeadStage('attribution_whatsapp'),
        countLeadStage('attribution_site'),
        countLeadStage('attribution_instagram'),
        countLeadStage('instagram_backlog'),
        count('base_permanente', q=>q.eq('active',true)),
        count('pre_dispatch_items', q=>q.eq('scheduled_date',preDate)),
        count('queue_items', q=>q.in('status',['queued','ready','waiting','not_sent','pending','scheduled']))
      ]);

      // Menu Atribuição é a soma fixa das abas da página, não a aba atual.
      set('badge-atribuicao', aw+as+ai);

      // Contadores das abas da Atribuição também ficam sincronizados.
      set('atribTabZapCount', `(${aw})`.replace(/[^0-9]/g,''));
      document.querySelectorAll('#atribTabZapCount').forEach(el=>el.textContent=`(${aw})`);
      document.querySelectorAll('#atribTabComSiteCount').forEach(el=>el.textContent=`(${as})`);
      document.querySelectorAll('#atribTabInstaCount').forEach(el=>el.textContent=`(${ai})`);

      // Menus de Envios: cada um mostra o total da própria página/fila.
      set('badge-pre-envio', preTotal);
      set('badge-fila-zap', queueZap);
      set('badge-instagram', instaBacklog);
      set('badge-ja-enviados', baseTotal);
    }catch(e){
      console.warn('[v59][menu-badges]',e?.message||e);
    }finally{
      running=false;
    }
  }

  const previousUpdateBadges=window.updateBadges;
  window.updateBadges=function updateBadgesV59(){
    try{ if(typeof previousUpdateBadges==='function') previousUpdateBadges.apply(this,arguments); }catch(e){ console.warn('[v59][previous-updateBadges]',e?.message||e); }
    refreshMenuBadgesV59(false);
  };

  window.updateMenuBadgesTotalsV59=refreshMenuBadgesV59;
  window.__V59_MENU_BADGES_TOTAIS__=VERSION;

  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>refreshMenuBadgesV59(true),500);
    setTimeout(()=>refreshMenuBadgesV59(true),1800);
    setInterval(()=>refreshMenuBadgesV59(false),5000);
  });
  document.addEventListener('click',()=>setTimeout(()=>refreshMenuBadgesV59(true),350),true);
  if(document.readyState!=='loading') setTimeout(()=>refreshMenuBadgesV59(true),500);
})();
