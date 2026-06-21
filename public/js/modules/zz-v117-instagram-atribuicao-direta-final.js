/* V117 — Instagram: aprovação direta da Atribuição para a Fila
   - Se o input já contém um perfil válido (instagram.com/perfil ou @perfil), o botão Aprovar para fila envia direto para instagram_dispatch_items.
   - Não exige confirmação extra nem etapa intermediária de salvar primeiro.
   - Bloqueia links genéricos do Instagram (instagram.com, /p, /reel, /explore, etc.).
   - Mantém a correção/invalidar na Fila Instagram já implementada nas versões anteriores.
*/
(function(){
  'use strict';
  const VERSION='20260621-V117-INSTAGRAM-ATRIBUICAO-DIRETA-FINAL';

  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console[type==='err'?'error':'log'](msg); }
  function escCss(v){ try{ return CSS.escape(String(v)); }catch(_){ return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }
  function inputFor(id){ return document.getElementById('atrib-insta-url-'+id) || document.querySelector('#atrib-insta-url-'+escCss(id)); }

  function cleanUsername(value){
    let raw=String(value||'').trim();
    if(!raw) return '';
    raw=raw.replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
    raw=raw.replace(/^@+/,'').trim();
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

  function markInputState(input){
    if(!input) return '';
    const username=cleanUsername(input.value||input.dataset.instagramUsername||'');
    if(username){
      input.dataset.instagramUsername=username;
      input.style.borderColor='var(--ok,#a6ff3d)';
      if(String(input.value||'').trim() && !String(input.value||'').trim().startsWith('@') && !String(input.value||'').includes('instagram.com')) input.value='@'+username;
    }else{
      delete input.dataset.instagramUsername;
    }
    return username;
  }

  async function approveDirect(id){
    const input=inputFor(id);
    const username=markInputState(input);
    if(input && input.value && !username){
      input.style.borderColor='var(--error,#ff4d4d)';
      return notify('Instagram inválido. Use um perfil real, exemplo: instagram.com/perfil ou @perfil.','warn');
    }
    if(typeof window.instagramV108ApproveToDispatchQueue==='function'){
      return window.instagramV108ApproveToDispatchQueue(id);
    }
    return notify('Função de aprovação direta não encontrada. Recarregue a página e tente novamente.','err');
  }

  function decorate(){
    document.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(input=>{
      const id=String(input.id||'').replace(/^atrib-insta-url-/,'');
      if(!id) return;
      markInputState(input);
      input.removeAttribute('onpaste');
      input.removeAttribute('onchange');
      input.removeAttribute('onkeydown');
      if(input.dataset.igV117Bound!=='1'){
        input.dataset.igV117Bound='1';
        input.addEventListener('paste',()=>setTimeout(()=>markInputState(input),80));
        input.addEventListener('change',()=>markInputState(input));
        input.addEventListener('input',()=>markInputState(input));
        input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); approveDirect(id); } });
      }
      const card=input.closest('[data-lead-id]') || input.closest('.lead-card') || input.closest('.atrib-card');
      const wrap=input.closest('.atrib-v64-insta-input-wrap') || input.parentElement;
      if(!wrap) return;
      let btn=card?.querySelector?.(`[data-ig-v117-approve="${CSS.escape(id)}"]`) || wrap.querySelector?.(`[data-ig-v117-approve="${CSS.escape(id)}"]`);
      if(!btn){
        // Reaproveita o botão existente quando houver; caso contrário cria um botão único.
        btn=card?.querySelector?.('.ig-v107-approve-btn,.ig-v106-approve-btn,.ig-v105-approve-btn,.ig-v104-approve-btn,.ig-v102-approve-btn,[data-ig-v107-approve],[data-ig-v106-approve],[data-ig-v105-approve],[data-ig-v104-approve],[data-ig-v102-approve]') || null;
        if(!btn){
          btn=document.createElement('button');
          btn.type='button';
          btn.className='btn btn-primary ig-v117-approve-btn';
          btn.textContent='Aprovar para fila';
          btn.style.cssText='font-size:9px;padding:7px 10px;margin-left:6px;white-space:nowrap;min-width:112px';
          try{ wrap.style.display='inline-flex'; wrap.style.alignItems='center'; wrap.style.gap='6px'; }catch(_){}
          wrap.appendChild(btn);
        }
        btn.dataset.igV117Approve=id;
      }
      if(btn.dataset.igV117Click!=='1'){
        btn.dataset.igV117Click='1';
        btn.addEventListener('click',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); approveDirect(id); }, true);
      }
    });
  }

  window.instagramV117ApproveDirect=approveDirect;
  window.instagramV102ApproveForQueue=approveDirect;
  window.saveInstagramAttributionV105=function(id,opts){ return opts?.approve ? approveDirect(id) : markInputState(inputFor(id)); };
  window.approveInstagramAttributionV31=approveDirect;

  document.addEventListener('click',function(ev){
    const btn=ev.target?.closest?.('[data-ig-v117-approve], [data-ig-v107-approve], [data-ig-v106-approve], [data-ig-v105-approve], [data-ig-v104-approve], [data-ig-v102-approve], .ig-v117-approve-btn, .ig-v107-approve-btn, .ig-v106-approve-btn, .ig-v105-approve-btn, .ig-v104-approve-btn, .ig-v102-approve-btn');
    if(!btn) return;
    const id=btn.dataset.igV117Approve || btn.dataset.igV107Approve || btn.dataset.igV106Approve || btn.dataset.igV105Approve || btn.dataset.igV104Approve || btn.dataset.igV102Approve || btn.closest('[data-lead-id]')?.dataset?.leadId || '';
    if(!id || !inputFor(id)) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
    approveDirect(id);
  }, true);

  const mo=new MutationObserver(()=>{ clearTimeout(window.__igV117DecorateTimer); window.__igV117DecorateTimer=setTimeout(decorate,80); });
  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(decorate,300);
    setTimeout(decorate,1200);
    try{ mo.observe(document.body,{childList:true,subtree:true}); }catch(_){}
  });
  setTimeout(decorate,1000);
  console.log('[v117][instagram-atribuicao-direta] ativo', VERSION);
})();
