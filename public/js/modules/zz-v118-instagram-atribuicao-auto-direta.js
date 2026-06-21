/* V118 — Instagram Atribuição realmente direta
   Correção definitiva:
   - qualquer lead da aba Instagram que já tenha instagram.com/perfil ou @perfil válido é aprovado automaticamente para a Fila Instagram;
   - o botão "Aprovar para fila" também é interceptado mesmo se vier do handler antigo v65/v107;
   - não aprova links genéricos do Instagram;
   - evita loop usando lock em memória por lead.
*/
(function(){
  'use strict';
  const VERSION='20260621-V118-INSTAGRAM-ATRIBUICAO-AUTO-DIRETA';
  const approving = new Set();
  const approvedOnce = new Set();

  function log(){ try{ console.log.apply(console, ['[v118][ig-atrib-auto]'].concat([].slice.call(arguments))); }catch(_){} }
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

  function leadIdFromInput(input){
    return String(input?.id||'').replace(/^atrib-insta-url-/,'');
  }
  function cardFor(el){ return el?.closest?.('[data-lead-id], .empresa-card, .lead-card, .atrib-card, .ext-card, .empresa-row'); }
  function findInputNear(el){
    const card=cardFor(el);
    return card?.querySelector?.('input[id^="atrib-insta-url-"]') || el?.closest?.('.empresa-actions,.atrib-v64-insta-input-wrap')?.querySelector?.('input[id^="atrib-insta-url-"]') || null;
  }

  function markInput(input){
    const username=cleanUsername(input?.value||input?.dataset?.instagramUsername||'');
    if(!input) return '';
    if(username){
      input.dataset.instagramUsername=username;
      input.style.borderColor='var(--ok,#a6ff3d)';
      if(String(input.value||'').trim().startsWith('http') || String(input.value||'').includes('instagram.com')) {
        // Mantém o link visível, mas grava o username no dataset.
      } else if(String(input.value||'').trim()) {
        input.value='@'+username;
      }
    } else {
      delete input.dataset.instagramUsername;
      if(String(input.value||'').trim()) input.style.borderColor='var(--error,#ff4d4d)';
    }
    return username;
  }

  async function approveNow(id, opts={}){
    id=String(id||'').trim();
    if(!id) return;
    const input=inputFor(id);
    const username=markInput(input);
    if(!username){
      if(opts.fromClick) notify('Instagram inválido. Use um perfil real, exemplo: instagram.com/perfil ou @perfil.','warn');
      return;
    }
    const key=id+'|'+username;
    if(approving.has(key) || approvedOnce.has(key)) return;
    approving.add(key);
    try{
      if(typeof window.instagramV108ApproveToDispatchQueue==='function'){
        await window.instagramV108ApproveToDispatchQueue(id);
        approvedOnce.add(key);
        setTimeout(()=>approvedOnce.delete(key), 30000);
      } else if(typeof window.instagramV117ApproveDirect==='function'){
        await window.instagramV117ApproveDirect(id);
        approvedOnce.add(key);
        setTimeout(()=>approvedOnce.delete(key), 30000);
      } else {
        notify('Função de aprovação da fila Instagram não encontrada. Recarregue a página.','err');
      }
    } finally {
      approving.delete(key);
    }
  }

  function bindInputs(){
    document.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(input=>{
      const id=leadIdFromInput(input);
      if(!id) return;
      const username=markInput(input);
      if(input.dataset.igV118Bound!=='1'){
        input.dataset.igV118Bound='1';
        input.addEventListener('input',()=>markInput(input),true);
        input.addEventListener('change',()=>{ markInput(input); setTimeout(()=>approveNow(id,{fromChange:true}),120); },true);
        input.addEventListener('paste',()=>setTimeout(()=>{ markInput(input); approveNow(id,{fromPaste:true}); },120),true);
        input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation(); approveNow(id,{fromClick:true}); } },true);
      }
      // Principal: se o lead já veio com Instagram válido no campo, entra sozinho na fila.
      if(username && input.dataset.igV118AutoQueued!=='1'){
        input.dataset.igV118AutoQueued='1';
        setTimeout(()=>approveNow(id,{auto:true}), 450);
      }
    });
  }

  document.addEventListener('click',function(ev){
    const target=ev.target;
    const btn=target?.closest?.('button, a, [role="button"]');
    if(!btn) return;
    const text=String(btn.textContent||btn.value||'').toLowerCase();
    const explicit=btn.matches?.('[data-ig-v117-approve],[data-ig-v107-approve],[data-ig-v106-approve],[data-ig-v105-approve],[data-ig-v104-approve],[data-ig-v102-approve],.ig-v117-approve-btn,.ig-v107-approve-btn,.ig-v106-approve-btn,.ig-v105-approve-btn,.ig-v104-approve-btn,.ig-v102-approve-btn,.v65-approve-queue');
    if(!explicit && !(text.includes('aprovar') && text.includes('fila'))) return;
    const input=findInputNear(btn);
    if(!input) return;
    const id=leadIdFromInput(input);
    if(!id) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
    approveNow(id,{fromClick:true});
  }, true);

  // Garante compatibilidade com onclick antigo.
  const prevAprovar=window.aprovarLeadAtribuicaoParaFilaV65;
  window.aprovarLeadAtribuicaoParaFilaV65=function(id,tab){
    const input=inputFor(id);
    const isInsta = !!input || String(tab||'').toLowerCase().includes('insta');
    if(isInsta) return approveNow(id,{fromClick:true});
    return typeof prevAprovar==='function' ? prevAprovar.apply(this,arguments) : undefined;
  };
  window.instagramV118ApproveNow=approveNow;
  window.instagramV117ApproveDirect=approveNow;

  const mo=new MutationObserver(()=>{ clearTimeout(window.__igV118Timer); window.__igV118Timer=setTimeout(bindInputs,120); });
  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(bindInputs,200);
    setTimeout(bindInputs,900);
    setTimeout(bindInputs,1800);
    try{ mo.observe(document.body,{childList:true,subtree:true}); }catch(_){}
  });
  setInterval(bindInputs,2500);
  log('ativo', VERSION);
})();
