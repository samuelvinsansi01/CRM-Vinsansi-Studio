/* V105 — Instagram Atribuição: normalização definitiva de URLs e botões.
   - Aceita https://www.instagram.com/perfil/
   - Corrige bug de getElementById com UUID escapado.
   - Intercepta botões antigos "Aprovar para fila" e força o handler novo.
   - Remove botões duplicados/legados no card.
*/
(function(){
  'use strict';
  const VERSION='20260619-V105-INSTAGRAM-URL-HANDLER-DEFINITIVO';

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

    // remove query/hash, but keep full URL path before extracting username
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

  async function saveInstagram(id, opts={}){
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível','err');

    const input=inputFor(id);
    const username=normalizeUsername(input?.value||'');
    if(!username){
      if(input) input.style.borderColor='var(--error,#ff4d4d)';
      return notify('Cole um @ ou link válido do Instagram','warn');
    }

    const url=toUrl(username);
    if(input){ input.value=url; input.style.borderColor='var(--ok,#a6ff3d)'; }

    const { error } = await c.from('leads').update({
      instagram:url,
      instagram_url:url,
      instagram_username:username,
      current_stage:'attribution_instagram',
      lead_channel:'instagram',
      pipeline_status: opts.approve ? 'approved_for_instagram_queue' : 'instagram_profile_saved',
      updated_at:new Date().toISOString()
    }).eq('user_id',user).eq('id',id);

    if(error) return notify((opts.approve?'Erro ao aprovar: ':'Erro ao salvar Instagram: ')+error.message,'err');
    notify(opts.approve ? `✓ @${username} aprovado para Fila Instagram` : `✓ Instagram salvo: @${username}`);

    try{ if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31(); else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao(); }catch(_){ }
    try{ if(typeof window.renderInstagram==='function') window.renderInstagram(); }catch(_){ }
    setTimeout(bindInputs,250);
  }

  // Mantém os nomes usados pelo código antigo, mas apontando para a regra nova.
  window.approveInstagramAttributionV31 = function(id){ return saveInstagram(id,{approve:false}); };
  window.instagramV102ApproveForQueue = function(id){ return saveInstagram(id,{approve:true}); };
  window.saveInstagramAttributionV105 = saveInstagram;

  function extractIdFromButton(btn){
    return btn?.dataset?.igV104Approve || btn?.dataset?.igV102Approve || btn?.dataset?.igApprove || '';
  }

  function bindInput(input){
    if(!input) return;
    const id=String(input.id||'').replace(/^atrib-insta-url-/,'');
    if(!id) return;

    if(input.dataset.igV105Bound!=='1'){
      input.dataset.igV105Bound='1';
      input.removeAttribute('onpaste');
      input.removeAttribute('onchange');
      input.removeAttribute('onkeydown');
      input.onpaste=null; input.onchange=null; input.onkeydown=null;
      input.addEventListener('paste',()=>setTimeout(()=>saveInstagram(id,{approve:false}),160));
      input.addEventListener('change',()=>saveInstagram(id,{approve:false}));
      input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); saveInstagram(id,{approve:false}); } });
    }

    const wrap=input.closest('.atrib-v64-insta-input-wrap') || input.parentElement;
    if(!wrap) return;

    // Remove botões legados/duplicados para evitar onclick antigo.
    wrap.querySelectorAll('[data-ig-v102-approve], [data-ig-v104-approve], .ig-v102-approve-btn, .ig-v104-approve-btn, .ig-v105-approve-btn').forEach(btn=>btn.remove());

    const btn=document.createElement('button');
    btn.type='button';
    btn.dataset.igV105Approve=id;
    btn.className='btn btn-primary ig-v105-approve-btn';
    btn.textContent='Aprovar para fila';
    btn.style.cssText='font-size:9px;padding:7px 10px;margin-left:6px;white-space:nowrap;min-width:112px';
    btn.addEventListener('click',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); saveInstagram(id,{approve:true}); });
    try{ wrap.style.display='inline-flex'; wrap.style.alignItems='center'; wrap.style.gap='6px'; }catch(_){ }
    wrap.appendChild(btn);
  }

  function bindInputs(){ document.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(bindInput); }

  // Captura qualquer clique que ainda venha de botão antigo antes do onclick legado.
  document.addEventListener('click',function(ev){
    const btn=ev.target?.closest?.('[data-ig-v102-approve], [data-ig-v104-approve], [data-ig-v105-approve], .ig-v102-approve-btn, .ig-v104-approve-btn, .ig-v105-approve-btn');
    if(!btn) return;
    const id=btn.dataset.igV105Approve || extractIdFromButton(btn);
    if(!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    saveInstagram(id,{approve:true});
  }, true);

  const mo=new MutationObserver(()=>bindInputs());
  try{ mo.observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(bindInputs,500));
  setInterval(bindInputs,1000);
  console.log('[v105][instagram-url-handler-definitivo] ativo',VERSION);
})();
