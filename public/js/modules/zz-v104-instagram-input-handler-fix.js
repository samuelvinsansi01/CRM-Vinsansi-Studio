/* V104 — Instagram Atribuição: handler forte para aceitar links completos.
   Corrige casos em que o onchange/onpaste antigo ainda rejeitava
   https://www.instagram.com/perfil/ antes do patch novo rodar.
*/
(function(){
  'use strict';
  const VERSION='20260619-V104-INSTAGRAM-INPUT-HANDLER-FIX';
  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); } catch(e){} }
  function escCss(v){ try { return CSS.escape(String(v)); } catch(e){ return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }

  function normalizeUsername(value){
    let s=String(value||'').trim();
    if(!s) return '';
    s=s.replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
    s=s.replace(/^@+/, '').trim();
    s=s.replace(/\?.*$/,'').replace(/#.*$/,'');

    // Aceita URL completa, com ou sem www, com ou sem protocolo.
    let parse=s;
    if(/^instagram\.com\//i.test(parse)) parse='https://www.'+parse;
    if(/^www\.instagram\.com\//i.test(parse)) parse='https://'+parse;
    try{
      const u=new URL(parse);
      const host=String(u.hostname||'').replace(/^www\./i,'').toLowerCase();
      if(host==='instagram.com'){
        const parts=String(u.pathname||'').split('/').filter(Boolean);
        s=parts[0]||'';
      }
    }catch(_){
      s=s
        .replace(/^https?:\/\//i,'')
        .replace(/^www\.instagram\.com\//i,'')
        .replace(/^instagram\.com\//i,'')
        .split('/')[0];
    }

    const username=String(s||'').trim().replace(/^@+/,'').split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
    const invalid=new Set(['','http','https','www','instagram','instagram.com','www.instagram.com','com','p','reel','reels','stories','explore','accounts','direct','about','privacy','terms','null','undefined']);
    if(invalid.has(username)) return '';
    if(username.length<2 || username.length>30) return '';
    return username;
  }
  function toUrl(value){ const u=normalizeUsername(value); return u ? `https://www.instagram.com/${u}/` : ''; }

  window.normalizeInstagramUsernameCRM = normalizeUsername;
  window.normalizeInstagramUrlCRM = toUrl;

  async function saveInstagram(id, opts={}){
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível','err');
    const input=document.getElementById(`atrib-insta-url-${escCss(id)}`);
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
    setTimeout(bindInputs,250);
  }

  window.approveInstagramAttributionV31 = function(id){ return saveInstagram(id,{approve:false}); };
  window.instagramV102ApproveForQueue = function(id){ return saveInstagram(id,{approve:true}); };

  function bindInput(input){
    if(!input || input.dataset.igV104Bound==='1') return;
    input.dataset.igV104Bound='1';
    input.removeAttribute('onpaste');
    input.removeAttribute('onchange');
    input.removeAttribute('onkeydown');
    input.onpaste=null; input.onchange=null; input.onkeydown=null;
    const id=String(input.id||'').replace(/^atrib-insta-url-/,'');
    input.addEventListener('paste',()=>setTimeout(()=>saveInstagram(id,{approve:false}),120));
    input.addEventListener('change',()=>saveInstagram(id,{approve:false}));
    input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); saveInstagram(id,{approve:false}); } });

    const wrap=input.parentElement;
    if(wrap && !wrap.querySelector(`[data-ig-v104-approve="${CSS.escape(id)}"]`)){
      const btn=document.createElement('button');
      btn.type='button';
      btn.dataset.igV104Approve=id;
      btn.className='btn btn-primary ig-v104-approve-btn';
      btn.textContent='Aprovar para fila';
      btn.style.cssText='font-size:9px;padding:7px 10px;margin-left:6px;white-space:nowrap';
      btn.addEventListener('click',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); saveInstagram(id,{approve:true}); });
      try{ wrap.style.display='inline-flex'; wrap.style.alignItems='center'; wrap.style.gap='6px'; }catch(_){ }
      wrap.appendChild(btn);
    }
  }
  function bindInputs(){ document.querySelectorAll('input[id^="atrib-insta-url-"]').forEach(bindInput); }
  const mo=new MutationObserver(()=>bindInputs());
  try{ mo.observe(document.documentElement,{childList:true,subtree:true}); }catch(_){ }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(bindInputs,500));
  setInterval(bindInputs,1000);
  console.log('[v104][instagram-input-handler-fix] ativo',VERSION);
})();
