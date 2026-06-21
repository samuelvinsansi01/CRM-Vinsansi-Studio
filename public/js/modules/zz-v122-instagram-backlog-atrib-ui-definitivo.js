/* V122 — Correção definitiva: Atribuição Instagram -> Backlog, sem alocar/abrir fila.
   Também corrige a UI da atribuição removendo botões duplicados/sobrescritos e scroll horizontal.
*/
(function(){
  'use strict';
  const VERSION='20260621-V122-IG-ATRIB-BACKLOG-UI-BASE';
  const locks=new Set();

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(_) { return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(_) { return ''; } }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function css(v){ try { return CSS.escape(String(v)); } catch(_) { return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }
  function inputFor(id){ return document.getElementById('atrib-insta-url-'+id) || document.querySelector('#atrib-insta-url-'+css(id)); }
  function cardForInput(input){ return input?.closest?.('[data-lead-id],.empresa-card,.atrib-v64-card,.lead-card'); }
  function idFromInput(input){ return String(input?.id||'').replace(/^atrib-insta-url-/,''); }
  function isInstaCard(card){ return !!card?.querySelector?.('input[id^="atrib-insta-url-"]'); }

  function cleanUsername(value){
    let raw=String(value||'').trim();
    if(!raw) return '';
    raw=raw.replace(/[\u200B-\u200D\uFEFF]/g,'').trim().replace(/^@+/,'').trim();
    raw=raw.replace(/\?.*$/,'').replace(/#.*$/,'').trim();
    let candidate=raw;
    try{
      let parse=raw;
      if(/^instagram\.com\//i.test(parse)) parse='https://www.'+parse;
      if(/^www\.instagram\.com\//i.test(parse)) parse='https://'+parse;
      const u=new URL(parse);
      const host=String(u.hostname||'').replace(/^www\./i,'').toLowerCase();
      if(host==='instagram.com') candidate=String(u.pathname||'').split('/').filter(Boolean)[0]||'';
    }catch(_){
      candidate=raw.replace(/^https?:\/\//i,'').replace(/^www\.instagram\.com\//i,'').replace(/^instagram\.com\//i,'').split('/')[0];
    }
    candidate=String(candidate||'').trim().replace(/^@+/,'').split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
    const invalid=new Set(['','http','https','www','instagram','instagram.com','www.instagram.com','com','p','reel','reels','stories','story','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if(invalid.has(candidate)) return '';
    if(candidate.length<2 || candidate.length>30) return '';
    if(/^\.+$/.test(candidate)) return '';
    return candidate;
  }
  function igUrl(username){ const u=cleanUsername(username); return u ? 'https://www.instagram.com/'+u+'/' : ''; }

  function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[_-]+/g,' '); }
  function categoryText(lead){
    const vals=[]; const push=v=>{ if(v==null) return; if(Array.isArray(v)) v.forEach(push); else if(typeof v==='object') Object.values(v).forEach(push); else vals.push(String(v)); };
    push(lead?.parent_category); push(lead?.category_name); push(lead?.category); push(lead?.categories);
    try{ push(lead?.raw_payload?.category); push(lead?.raw_payload?.categoryName); push(lead?.raw_payload?.categories); }catch(_){}
    return vals.filter(Boolean).join(' ');
  }
  function hasRegisteredRamo(lead){
    try{
      const ramos=typeof window.getRamos==='function' ? (window.getRamos()||[]) : [];
      if(!ramos.length) return true; // não bloqueia se a config ainda não carregou
      const n=norm(categoryText(lead));
      if(!n) return false;
      return ramos.some(r=>{
        const keys=[r.id,r.nome,...(r.keywords||[]),...(r.subcategories||[])].filter(Boolean).map(norm).filter(Boolean);
        return keys.some(k=>n===k || n.includes(k) || k.includes(n));
      });
    }catch(_){ return true; }
  }

  async function approveToBacklog(id){
    id=String(id||'').trim();
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível', 'err');
    const input=inputFor(id);
    let username=cleanUsername(input?.value || input?.dataset?.instagramUsername || '');
    const lockKey=id+'|'+username;
    if(locks.has(lockKey)) return;
    locks.add(lockKey);
    try{
      const {data:lead,error:lErr}=await c.from('leads').select('*').eq('user_id',user).eq('id',id).maybeSingle();
      if(lErr) throw lErr;
      if(!lead) return notify('Lead não encontrado.', 'err');
      if(!username) username=cleanUsername(lead.instagram_username || lead.instagram_url || lead.instagram || '');
      if(!username){
        if(input) input.style.borderColor='var(--error,#ff4d4d)';
        return notify('Cole um Instagram válido com perfil real. Ex: instagram.com/perfil ou @perfil.', 'warn');
      }
      const url=igUrl(username);
      if(!hasRegisteredRamo(lead)){
        if(input) input.style.borderColor='var(--error,#ff4d4d)';
        return notify('Lead bloqueado: categoria/subcategoria não cadastrada nos ramos da plataforma.', 'warn');
      }
      // Bloqueio global: se já foi enviado/invalido/base ou fila ativa por Instagram, não volta para backlog.
      try{
        const [q,b]=await Promise.all([
          c.from('instagram_dispatch_items').select('id,status,company_name,profile_username').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).neq('lead_id',String(id)).limit(1),
          c.from('base_permanente').select('id,status,company_name').eq('user_id',user).or(`instagram_username.eq.${username},instagram_url.eq.${url}`).limit(1)
        ]);
        const dup=(q.data||[])[0];
        if(dup && !['error','failed','erro'].includes(String(dup.status||'').toLowerCase())) return notify('Instagram já existe em outra fila/perfil: @'+username, 'warn');
        if((b.data||[])[0]) return notify('Instagram já está na Base Permanente: @'+username, 'warn');
      }catch(e){ console.warn('[v122][dup-check]', e?.message||e); }

      const now=new Date().toISOString();
      const payload={
        instagram:'@'+username,
        instagram_url:url,
        instagram_username:username,
        current_stage:'instagram_backlog',
        current_status:'instagram_backlog',
        status:'Aguardando alocação Instagram',
        lead_channel:'instagram',
        pipeline_status:'instagram_backlog',
        updated_at:now
      };
      const {error:uErr}=await c.from('leads').update(payload).eq('user_id',user).eq('id',id);
      if(uErr) throw uErr;
      if(input){ input.value=url; input.dataset.instagramUsername=username; input.style.borderColor='var(--ok,#a6ff3d)'; }
      notify('✓ @'+username+' enviado para Backlog Instagram. Aloque pelo botão Preencher perfil no dia desejado.');

      // Não redireciona, não chama refreshInstagram. Só atualiza a própria Atribuição e badges.
      try{ if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31(); else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao(); }catch(e){ console.warn('[v122][render-atrib]',e?.message||e); }
      try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); else if(typeof window.updateBadges==='function') window.updateBadges(); }catch(_){}
    }catch(e){
      notify('Erro ao aprovar Instagram: '+(e?.message||e), 'err');
    }finally{ locks.delete(lockKey); }
  }

  function cleanupAttributionUI(){
    const panel=document.getElementById('panel-atribuicao');
    if(!panel) return;
    // Mata scroll horizontal causado por botões duplicados.
    panel.querySelectorAll('#atribPanelInsta,.atrib-v64-card,.empresa-card').forEach(el=>{ try{ el.style.maxWidth='100%'; el.style.overflowX='hidden'; }catch(_){} });

    panel.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(input=>{
      const id=idFromInput(input); if(!id) return;
      const card=cardForInput(input); if(!card) return;
      const wrap=input.closest('.atrib-v64-insta-input-wrap') || input.parentElement;
      const actions=card.querySelector('.empresa-actions,.atrib-v64-actions');
      const username=cleanUsername(input.value || input.dataset.instagramUsername || '');
      if(username){ input.dataset.instagramUsername=username; input.style.borderColor='var(--ok,#a6ff3d)'; }
      else if(String(input.value||'').trim()) input.style.borderColor='var(--error,#ff4d4d)';

      // Remove qualquer botão de aprovação antigo, inclusive os criados por v106/v107/v117, para parar sobrescrita.
      card.querySelectorAll('button,a,[role="button"]').forEach(btn=>{
        const text=String(btn.textContent||btn.value||'').toLowerCase().trim();
        const isApprove=text.includes('aprovar') && text.includes('fila');
        const isOld=btn.matches?.('[data-ig-v102-approve],[data-ig-v104-approve],[data-ig-v105-approve],[data-ig-v106-approve],[data-ig-v107-approve],[data-ig-v117-approve],.ig-v102-approve-btn,.ig-v104-approve-btn,.ig-v105-approve-btn,.ig-v106-approve-btn,.ig-v107-approve-btn,.ig-v117-approve-btn,.v65-approve-queue');
        if(isApprove || isOld) btn.remove();
      });

      // Recria um único botão, sempre ao lado do input.
      let btn=card.querySelector('.ig-v122-approve-backlog');
      if(!btn){
        btn=document.createElement('button');
        btn.type='button';
        btn.className='btn btn-primary ig-v122-approve-backlog';
        btn.textContent='Aprovar para backlog';
        btn.style.cssText='font-size:9px;padding:7px 10px;white-space:nowrap;min-width:128px;flex:0 0 auto;';
        (wrap || actions || card).appendChild(btn);
      }
      btn.dataset.leadId=id;
      if(wrap){
        wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='6px'; wrap.style.minWidth='0'; wrap.style.maxWidth='520px';
        input.style.minWidth='0'; input.style.flex='1 1 240px';
      }
      if(actions){ actions.style.flex='0 0 auto'; actions.style.minWidth='0'; }

      // Limpa inline handlers antigos do input.
      input.removeAttribute('onpaste'); input.removeAttribute('onchange'); input.removeAttribute('onkeydown');
      input.onpaste=null; input.onchange=null; input.onkeydown=null;
      if(input.dataset.igV122Bound!=='1'){
        input.dataset.igV122Bound='1';
        input.addEventListener('input',()=>{ const u=cleanUsername(input.value); if(u){input.dataset.instagramUsername=u; input.style.borderColor='var(--ok,#a6ff3d)';} },true);
        input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation(); approveToBacklog(id); } },true);
      }
    });
  }

  // Intercepta qualquer clique antigo na atribuição Instagram.
  document.addEventListener('click',function(ev){
    const btn=ev.target?.closest?.('button,a,[role="button"]');
    if(!btn) return;
    const panel=document.getElementById('panel-atribuicao');
    if(!panel?.contains(btn)) return;
    const card=btn.closest?.('[data-lead-id],.empresa-card,.atrib-v64-card');
    if(!card || !isInstaCard(card)) return;
    const text=String(btn.textContent||btn.value||'').toLowerCase();
    const isApprove=btn.classList?.contains('ig-v122-approve-backlog') || (text.includes('aprovar') && text.includes('fila')) || (text.includes('aprovar') && text.includes('backlog')) || btn.matches?.('[data-ig-v102-approve],[data-ig-v104-approve],[data-ig-v105-approve],[data-ig-v106-approve],[data-ig-v107-approve],[data-ig-v117-approve],.v65-approve-queue');
    if(!isApprove) return;
    const input=card.querySelector('input[id^="atrib-insta-url-"]');
    const id=idFromInput(input) || card.dataset.leadId;
    if(!id) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
    approveToBacklog(id);
  }, true);

  // Overrides globais depois de todos os legados: nada de alocar/fila direto.
  window.instagramV122ApproveToBacklog=approveToBacklog;
  window.instagramV108ApproveToDispatchQueue=approveToBacklog;
  window.instagramV117ApproveDirect=approveToBacklog;
  window.instagramV118ApproveNow=approveToBacklog;
  window.instagramV102ApproveForQueue=approveToBacklog;
  window.saveInstagramAttributionV105=function(id,opts){ return opts?.approve ? approveToBacklog(id) : undefined; };
  window.approveInstagramAttributionV31=function(id){ return undefined; };
  const prevAprovar=window.aprovarLeadAtribuicaoParaFilaV65;
  window.aprovarLeadAtribuicaoParaFilaV65=function(id,tab){
    if(String(tab||'').toLowerCase().includes('insta') || inputFor(id)) return approveToBacklog(id);
    return typeof prevAprovar==='function' ? prevAprovar.apply(this,arguments) : undefined;
  };

  function injectStyles(){
    if(document.getElementById('ig-v122-atrib-style')) return;
    const st=document.createElement('style'); st.id='ig-v122-atrib-style';
    st.textContent=`
      #panel-atribuicao, #atribPanelInsta{overflow-x:hidden!important;}
      #atribPanelInsta .empresa-card, #atribPanelInsta .atrib-v64-card{max-width:100%!important;overflow:hidden!important;display:flex!important;align-items:center!important;gap:12px!important;}
      #atribPanelInsta .atrib-v64-info{min-width:0!important;flex:1 1 auto!important;}
      #atribPanelInsta .atrib-v64-insta-input-wrap{display:flex!important;align-items:center!important;gap:6px!important;min-width:0!important;flex:0 1 520px!important;}
      #atribPanelInsta input[id^="atrib-insta-url-"]{min-width:0!important;flex:1 1 240px!important;}
      #atribPanelInsta .atrib-v64-actions{display:flex!important;align-items:center!important;gap:8px!important;flex:0 0 auto!important;min-width:0!important;}
      #atribPanelInsta .ig-v122-approve-backlog{background:var(--accent)!important;color:#0b0b0f!important;border-color:var(--accent)!important;}
    `;
    document.head.appendChild(st);
  }

  const mo=new MutationObserver(()=>{ clearTimeout(window.__igV122Timer); window.__igV122Timer=setTimeout(cleanupAttributionUI,60); });
  document.addEventListener('DOMContentLoaded',()=>{
    injectStyles();
    setTimeout(cleanupAttributionUI,150);
    setTimeout(cleanupAttributionUI,700);
    setTimeout(cleanupAttributionUI,1600);
    try{ mo.observe(document.body,{childList:true,subtree:true}); }catch(_){}
  });
  injectStyles();
  setInterval(cleanupAttributionUI,1200);
  console.log('[v122][instagram-backlog-atrib-ui] ativo', VERSION);
})();
