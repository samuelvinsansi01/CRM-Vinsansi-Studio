/* V123 — Base única da Atribuição Instagram.
   Remove os renders/handlers legados que alternavam entre "Aprovar para fila" e "Aprovar para backlog".
   Fluxo definitivo: Atribuição Instagram -> Backlog Instagram -> Preencher perfil -> Dia alocado.
*/
(function(){
  'use strict';
  const VERSION='20260621-V123-IG-BACKLOG-SINGLE-RENDER';
  const busy=new Set();

  function client(){ return window.sbClient || window.supabaseClient || window.supabase || null; }
  function userId(){ return window.currentUser?.id || window.authUser?.id || ''; }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function clean(s){
    let raw=String(s||'').trim().replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/^@+/,'');
    if(!raw) return '';
    raw=raw.replace(/[?#].*$/,'');
    let v=raw;
    try{
      let ustr=raw;
      if(/^instagram\.com\//i.test(ustr)) ustr='https://www.'+ustr;
      if(/^www\.instagram\.com\//i.test(ustr)) ustr='https://'+ustr;
      const u=new URL(ustr);
      if(String(u.hostname||'').replace(/^www\./i,'').toLowerCase()==='instagram.com') v=String(u.pathname||'').split('/').filter(Boolean)[0]||'';
    }catch(_){
      v=raw.replace(/^https?:\/\//i,'').replace(/^www\.instagram\.com\//i,'').replace(/^instagram\.com\//i,'').split('/')[0];
    }
    v=String(v||'').trim().replace(/^@+/,'').split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
    const bad=new Set(['','instagram','instagram.com','www.instagram.com','www','com','p','reel','reels','stories','story','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if(bad.has(v) || v.length<2 || v.length>30 || /^\.+$/.test(v)) return '';
    return v;
  }
  function urlFrom(u){ const x=clean(u); return x ? `https://www.instagram.com/${x}/` : ''; }
  function css(v){ try{return CSS.escape(String(v));}catch(_){return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');} }
  function inputById(id){ return document.getElementById('atrib-insta-url-'+id) || document.querySelector('#atrib-insta-url-'+css(id)); }
  function inputId(input){ return String(input?.id||'').replace(/^atrib-insta-url-/,''); }
  function cardOf(el){ return el?.closest?.('[data-lead-id],.empresa-card,.atrib-v64-card,.lead-card'); }

  async function approveBacklog(id){
    id=String(id||'').trim();
    const c=client(), uid=userId();
    if(!c || !uid || !id) return notify('Supabase/auth indisponível.', 'err');
    if(busy.has(id)) return;
    busy.add(id);
    try{
      const input=inputById(id);
      const {data:lead,error:lerr}=await c.from('leads').select('*').eq('user_id',uid).eq('id',id).maybeSingle();
      if(lerr) throw lerr;
      if(!lead) return notify('Lead não encontrado.', 'err');
      let username=clean(input?.value || input?.dataset?.instagramUsername || lead.instagram_username || lead.instagram_url || lead.instagram || '');
      if(!username){
        if(input) input.style.borderColor='var(--error,#ff4d4d)';
        return notify('Cole um Instagram válido com perfil real. Ex: instagram.com/perfil.', 'warn');
      }
      const ig=urlFrom(username);

      // Bloqueio básico contra reentrada de enviados/invalidos/fila ativa pelo mesmo Instagram.
      try{
        const [base, queue]=await Promise.all([
          c.from('base_permanente').select('id,status,company_name').eq('user_id',uid).or(`instagram_username.eq.${username},instagram_url.eq.${ig}`).limit(1),
          c.from('instagram_dispatch_items').select('id,status,lead_id,company_name,profile_username').eq('user_id',uid).or(`instagram_username.eq.${username},instagram_url.eq.${ig}`).limit(1)
        ]);
        if((base.data||[])[0]) return notify(`Instagram @${username} já está na Base Permanente.`, 'warn');
        const q=(queue.data||[])[0];
        if(q && String(q.lead_id)!==String(id) && !['error','failed','erro'].includes(String(q.status||'').toLowerCase())) return notify(`Instagram @${username} já existe em fila/perfil.`, 'warn');
      }catch(e){ console.warn('[v123 dup-check]', e?.message||e); }

      const now=new Date().toISOString();
      const {error}=await c.from('leads').update({
        instagram:'@'+username,
        instagram_url:ig,
        instagram_username:username,
        current_stage:'instagram_backlog',
        current_status:'instagram_backlog',
        pipeline_status:'instagram_backlog',
        lead_channel:'instagram',
        status:'Aguardando alocação Instagram',
        updated_at:now
      }).eq('user_id',uid).eq('id',id);
      if(error) throw error;
      if(input){ input.value=ig; input.dataset.instagramUsername=username; input.style.borderColor='var(--ok,#a6ff3d)'; }
      notify(`✓ @${username} enviado para Backlog Instagram.`);
      await refreshAssignmentOnly();
    }catch(e){ notify('Erro ao aprovar para backlog: '+(e?.message||e), 'err'); }
    finally{ busy.delete(id); }
  }

  async function refreshAssignmentOnly(){
    try{
      if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31();
      else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao();
    }catch(e){ console.warn('[v123 refresh atrib]', e?.message||e); }
    setTimeout(normalizeUI,50);
    try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); }catch(_){}
  }

  function normalizeUI(){
    const panel=document.getElementById('panel-atribuicao');
    if(!panel) return;
    const roots=panel.querySelectorAll('#atribPanelInsta,.empresa-card,.atrib-v64-card,.lead-card');
    roots.forEach(el=>{ el.style.maxWidth='100%'; el.style.overflowX='hidden'; });

    panel.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(input=>{
      const id=inputId(input); if(!id) return;
      const card=cardOf(input); if(!card) return;

      const username=clean(input.value || input.dataset.instagramUsername || '');
      if(username){ input.dataset.instagramUsername=username; input.value=urlFrom(username); input.style.borderColor='var(--ok,#a6ff3d)'; }
      else if(String(input.value||'').trim()) input.style.borderColor='var(--error,#ff4d4d)';

      // Remove TODOS os botões de aprovação herdados desse card.
      card.querySelectorAll('button,a,[role="button"]').forEach(b=>{
        const t=String(b.textContent||b.value||'').toLowerCase().trim();
        const approve=t.includes('aprovar') && (t.includes('fila') || t.includes('backlog'));
        const legacy=b.matches?.('[data-ig-v102-approve],[data-ig-v104-approve],[data-ig-v105-approve],[data-ig-v106-approve],[data-ig-v107-approve],[data-ig-v117-approve],.ig-v102-approve-btn,.ig-v104-approve-btn,.ig-v105-approve-btn,.ig-v106-approve-btn,.ig-v107-approve-btn,.ig-v117-approve-btn,.v65-approve-queue');
        if((approve || legacy) && !b.classList.contains('ig-v123-approve-backlog')) b.remove();
      });

      let btn=card.querySelector('.ig-v123-approve-backlog');
      if(!btn){
        btn=document.createElement('button');
        btn.type='button';
        btn.className='btn btn-primary ig-v123-approve-backlog';
        btn.textContent='Aprovar para backlog';
      }
      btn.dataset.leadId=id;
      btn.onclick=null;
      btn.style.cssText='font-size:9px;padding:7px 10px;white-space:nowrap;min-width:132px;flex:0 0 auto;background:var(--accent)!important;color:#0b0b0f!important;border-color:var(--accent)!important;';

      // Coloca o botão no mesmo container do input, evitando duplicação em actions.
      let host=input.closest('.atrib-v64-insta-input-wrap') || input.parentElement || card;
      if(!host.contains(btn)) host.appendChild(btn);
      host.style.display='flex'; host.style.alignItems='center'; host.style.gap='8px'; host.style.minWidth='0'; host.style.maxWidth='560px'; host.style.flex='0 1 560px';
      input.style.minWidth='0'; input.style.flex='1 1 260px';

      input.removeAttribute('onpaste'); input.removeAttribute('onchange'); input.removeAttribute('onkeydown');
      if(input.dataset.v123Bound!=='1'){
        input.dataset.v123Bound='1';
        input.addEventListener('input',()=>{ const u=clean(input.value); if(u){ input.dataset.instagramUsername=u; input.style.borderColor='var(--ok,#a6ff3d)'; } },true);
        input.addEventListener('keydown',ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation(); approveBacklog(id); }},true);
      }
    });
  }

  document.addEventListener('click',ev=>{
    const btn=ev.target?.closest?.('button,a,[role="button"]');
    if(!btn) return;
    const panel=document.getElementById('panel-atribuicao');
    if(!panel?.contains(btn)) return;
    const card=cardOf(btn); if(!card?.querySelector?.('input[id^="atrib-insta-url-"]')) return;
    const t=String(btn.textContent||btn.value||'').toLowerCase();
    const isApprove=btn.classList.contains('ig-v123-approve-backlog') || (t.includes('aprovar') && (t.includes('fila') || t.includes('backlog')));
    if(!isApprove) return;
    const input=card.querySelector('input[id^="atrib-insta-url-"]');
    const id=inputId(input) || card.dataset.leadId;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
    approveBacklog(id);
  },true);

  // Mata funções legadas que criavam fila direta/redirecionavam.
  window.instagramV123ApproveToBacklog=approveBacklog;
  window.instagramV108ApproveToDispatchQueue=approveBacklog;
  window.instagramV117ApproveDirect=approveBacklog;
  window.instagramV118ApproveNow=approveBacklog;
  window.instagramV102ApproveForQueue=approveBacklog;
  window.saveInstagramAttributionV105=(id,opts)=> opts?.approve ? approveBacklog(id) : undefined;
  window.approveInstagramAttributionV31=()=>undefined;
  const oldV65=window.aprovarLeadAtribuicaoParaFilaV65;
  window.aprovarLeadAtribuicaoParaFilaV65=function(id,tab){
    if(String(tab||'').toLowerCase().includes('insta') || inputById(id)) return approveBacklog(id);
    return typeof oldV65==='function' ? oldV65.apply(this,arguments) : undefined;
  };

  function styles(){
    if(document.getElementById('ig-v123-style')) return;
    const st=document.createElement('style'); st.id='ig-v123-style';
    st.textContent=`
      #panel-atribuicao,#atribPanelInsta{overflow-x:hidden!important;}
      #atribPanelInsta .empresa-card,#atribPanelInsta .atrib-v64-card{max-width:100%!important;overflow:hidden!important;display:flex!important;align-items:center!important;gap:12px!important;}
      #atribPanelInsta .atrib-v64-info{min-width:0!important;flex:1 1 auto!important;}
      #atribPanelInsta input[id^="atrib-insta-url-"]{min-width:0!important;}
      #atribPanelInsta .atrib-v64-actions{display:flex!important;align-items:center!important;gap:8px!important;flex:0 0 auto!important;}
    `;
    document.head.appendChild(st);
  }

  let timer=null;
  function schedule(){ clearTimeout(timer); timer=setTimeout(normalizeUI,80); }
  document.addEventListener('DOMContentLoaded',()=>{ styles(); normalizeUI(); setTimeout(normalizeUI,300); setTimeout(normalizeUI,900); });
  styles();
  try{ new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  setInterval(normalizeUI,2500);
  console.log('[v123] Instagram atribuição single-render ativo', VERSION);
})();
