/* V106 — Instagram Atribuição definitivo
   - Uma única fonte para salvar/aprovar Instagram.
   - Aceita @perfil, perfil, instagram.com/perfil, www.instagram.com/perfil,
     https://instagram.com/perfil/ e https://www.instagram.com/perfil/.
   - Remove botões duplicados antigos.
   - Não muda o lead de aba: mantém attribution_instagram.
*/
(function(){
  'use strict';
  const VERSION='20260619-V106-INSTAGRAM-ATRIBUICAO-DEFINITIVA';

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); } catch(e){} }
  function escCss(v){ try { return CSS.escape(String(v)); } catch(e){ return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }
  function inputFor(id){ return document.getElementById(`atrib-insta-url-${id}`) || document.querySelector(`#atrib-insta-url-${escCss(id)}`); }

  function normalizeUsername(value){
    let raw=String(value||'').trim();
    if(!raw) return '';
    raw=raw.replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
    raw=raw.replace(/^@+/, '').trim();
    raw=raw.replace(/\?.*$/,'').replace(/#.*$/,'').trim();

    let candidate=raw;
    try{
      let parse=raw;
      if(/^instagram\.com\//i.test(parse)) parse='https://www.'+parse;
      if(/^www\.instagram\.com\//i.test(parse)) parse='https://'+parse;
      const u=new URL(parse);
      const host=String(u.hostname||'').replace(/^www\./i,'').toLowerCase();
      if(host==='instagram.com'){
        const parts=String(u.pathname||'').split('/').filter(Boolean);
        candidate=parts[0]||'';
      }
    }catch(_){
      candidate=raw
        .replace(/^https?:\/\//i,'')
        .replace(/^www\.instagram\.com\//i,'')
        .replace(/^instagram\.com\//i,'')
        .split('/')[0];
    }

    candidate=String(candidate||'')
      .trim()
      .replace(/^@+/,'')
      .split(/[/?#]/)[0]
      .replace(/[^a-zA-Z0-9._]/g,'')
      .toLowerCase();

    const invalid=new Set(['','http','https','www','instagram','instagram.com','www.instagram.com','com','p','reel','reels','stories','story','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if(invalid.has(candidate)) return '';
    if(candidate.length<2 || candidate.length>30) return '';
    return candidate;
  }
  function toUrl(value){ const u=normalizeUsername(value); return u ? `https://www.instagram.com/${u}/` : ''; }
  window.normalizeInstagramUsernameCRM = normalizeUsername;
  window.normalizeInstagramUrlCRM = toUrl;

  async function saveOrApprove(id, approve){
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível','err');
    const input=inputFor(id);
    let username=normalizeUsername(input?.value||'');

    if(!username && approve){
      try{
        const {data}=await c.from('leads').select('instagram_username,instagram_url,instagram').eq('user_id',user).eq('id',id).maybeSingle();
        username=normalizeUsername(data?.instagram_username || data?.instagram_url || data?.instagram || '');
      }catch(_){ }
    }

    if(!username){
      if(input) input.style.borderColor='var(--error,#ff4d4d)';
      return notify('Cole um @ ou link válido do Instagram','warn');
    }

    const url=toUrl(username);
    if(input){ input.value='@'+username; input.style.borderColor='var(--ok,#a6ff3d)'; }

    const payload={
      instagram:'@'+username,
      instagram_url:url,
      instagram_username:username,
      current_stage:'attribution_instagram',
      lead_channel:'instagram',
      pipeline_status: approve ? 'approved_for_instagram_queue' : 'instagram_profile_saved',
      updated_at:new Date().toISOString()
    };

    const {error}=await c.from('leads').update(payload).eq('user_id',user).eq('id',id);
    if(error) return notify((approve?'Erro ao aprovar: ':'Erro ao salvar Instagram: ')+error.message,'err');
    notify(approve ? `✓ @${username} aprovado para Fila Instagram` : `✓ Instagram salvo: @${username}`);

    try{ if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31(); else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao(); }catch(_){ }
    try{ if(typeof window.renderInstagram==='function') await window.renderInstagram(); }catch(_){ }
    setTimeout(bindAll,250);
  }

  // Sobrescreve qualquer função antiga que ainda esteja sendo chamada por onclick inline.
  window.approveInstagramAttributionV31 = function(id){ return saveOrApprove(id,false); };
  window.instagramV102ApproveForQueue = function(id){ return saveOrApprove(id,true); };
  window.saveInstagramAttributionV105 = function(id,opts){ return saveOrApprove(id,!!opts?.approve); };
  window.aprovarLeadAtribuicaoParaFilaV65 = (function(prev){
    return function(id,tab){
      if(String(tab||'').toLowerCase()==='insta' || document.getElementById(`atrib-insta-url-${id}`)) return saveOrApprove(id,true);
      return typeof prev==='function' ? prev.apply(this,arguments) : undefined;
    };
  })(window.aprovarLeadAtribuicaoParaFilaV65);

  function bindInput(input){
    if(!input) return;
    const id=String(input.id||'').replace(/^atrib-insta-url-/,'');
    if(!id) return;
    input.removeAttribute('onpaste');
    input.removeAttribute('onchange');
    input.removeAttribute('onkeydown');
    input.onpaste=null; input.onchange=null; input.onkeydown=null;

    if(input.dataset.igV106Bound!=='1'){
      input.dataset.igV106Bound='1';
      input.addEventListener('paste',()=>setTimeout(()=>saveOrApprove(id,false),120));
      input.addEventListener('change',()=>saveOrApprove(id,false));
      input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); saveOrApprove(id,false); } });
    }

    const wrap=input.closest('.atrib-v64-insta-input-wrap') || input.parentElement;
    const card=input.closest('[data-lead-id]');
    if(!wrap) return;
    // Remove todos os botões antigos/duplicados do card do Instagram.
    const scope=card || wrap;
    scope.querySelectorAll('[data-ig-v102-approve], [data-ig-v104-approve], [data-ig-v105-approve], [data-ig-v106-approve], .ig-v102-approve-btn, .ig-v104-approve-btn, .ig-v105-approve-btn, .ig-v106-approve-btn, .v65-approve-queue').forEach(btn=>btn.remove());

    const btn=document.createElement('button');
    btn.type='button';
    btn.dataset.igV106Approve=id;
    btn.className='btn btn-primary ig-v106-approve-btn';
    btn.textContent='Aprovar para fila';
    btn.style.cssText='font-size:9px;padding:7px 10px;margin-left:6px;white-space:nowrap;min-width:112px';
    btn.addEventListener('click',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); saveOrApprove(id,true); });
    try{ wrap.style.display='inline-flex'; wrap.style.alignItems='center'; wrap.style.gap='6px'; }catch(_){ }
    wrap.appendChild(btn);
  }

  function bindAll(){
    document.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(bindInput);
  }

  document.addEventListener('click',function(ev){
    const btn=ev.target?.closest?.('[data-ig-v102-approve], [data-ig-v104-approve], [data-ig-v105-approve], [data-ig-v106-approve], .ig-v102-approve-btn, .ig-v104-approve-btn, .ig-v105-approve-btn, .ig-v106-approve-btn, .v65-approve-queue');
    if(!btn) return;
    const card=btn.closest?.('[data-lead-id]');
    const id=btn.dataset.igV106Approve || btn.dataset.igV105Approve || btn.dataset.igV104Approve || btn.dataset.igV102Approve || card?.dataset?.leadId || '';
    const input=id ? inputFor(id) : null;
    if(!input) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
    saveOrApprove(id,true);
  }, true);

  const mo=new MutationObserver(()=>bindAll());
  try{ mo.observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(bindAll,300));
  setInterval(bindAll,800);
  console.log('[v106][instagram-atribuicao-definitiva] ativo',VERSION);
})();
