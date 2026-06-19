/* V107 — Instagram Atribuição sem loop
   Correção definitiva sem MutationObserver e sem setInterval.
   - Remove dependência dos patches v103/v104/v106.
   - Aceita @perfil, perfil, instagram.com/perfil, www.instagram.com/perfil,
     https://instagram.com/perfil/ e https://www.instagram.com/perfil/.
   - Salvar Instagram não remove o lead da aba.
   - Aprovar para fila só sinaliza pipeline_status='approved_for_instagram_queue'.
   - Não chama render em loop após salvar/aprovar.
*/
(function(){
  'use strict';
  const VERSION='20260619-V107-INSTAGRAM-ATRIBUICAO-SEM-LOOP';
  const FALLBACK_UID='c02fe973-4eb5-4036-9f8d-8787937e8b11';

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(_){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || localStorage.getItem('vs_auth_local_user_v423') || FALLBACK_UID; } catch(_){ return FALLBACK_UID; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); } catch(_){ } }
  function escCss(v){ try { return CSS.escape(String(v)); } catch(_){ return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }
  function inputFor(id){ return document.getElementById('atrib-insta-url-'+id) || document.querySelector('#atrib-insta-url-'+escCss(id)); }
  function cardFor(id){ return document.querySelector('[data-lead-id="'+escCss(id)+'"]'); }

  function normalizeInstagramUsername(value){
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
    if(/^\.+$/.test(candidate)) return '';
    return candidate;
  }
  function instagramUrl(value){
    const u=normalizeInstagramUsername(value);
    return u ? 'https://www.instagram.com/'+u+'/' : '';
  }

  window.normalizeInstagramUsernameCRM=normalizeInstagramUsername;
  window.normalizeInstagramUrlCRM=instagramUrl;

  function markCardApproved(id, username){
    const input=inputFor(id);
    if(input){
      input.value='@'+username;
      input.dataset.instagramUsername=username;
      input.style.borderColor='var(--ok,#a6ff3d)';
    }
    const card=cardFor(id);
    if(!card) return;
    let state=card.querySelector('.ig-v107-state');
    if(!state){
      state=document.createElement('span');
      state.className='ig-v107-state';
      state.style.cssText='font-family:DM Mono,monospace;font-size:9px;color:var(--ok,#a6ff3d);margin-left:6px;white-space:nowrap';
      const wrap=input?.closest('.atrib-v64-insta-input-wrap') || input?.parentElement || card.querySelector('.empresa-actions');
      wrap?.appendChild(state);
    }
    state.textContent='✓ @'+username+' aprovado';
    const btn=card.querySelector('[data-ig-v107-approve]');
    if(btn){ btn.textContent='✓ Aprovado'; btn.disabled=true; btn.style.opacity='.75'; }
  }

  async function saveInstagram(id, approve){
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível','err');
    const input=inputFor(id);
    let username=normalizeInstagramUsername(input?.value || '');

    if(!username && approve){
      try{
        const {data}=await c.from('leads').select('instagram_username,instagram_url,instagram').eq('user_id',user).eq('id',id).maybeSingle();
        username=normalizeInstagramUsername(data?.instagram_username || data?.instagram_url || data?.instagram || '');
      }catch(_){ }
    }
    if(!username){
      if(input) input.style.borderColor='var(--error,#ff4d4d)';
      return notify('Cole um @ ou link válido do Instagram','warn');
    }

    const url='https://www.instagram.com/'+username+'/';
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

    if(approve){
      markCardApproved(id,username);
      notify('✓ @'+username+' aprovado para Fila Instagram');
    }else{
      notify('✓ Instagram salvo: @'+username);
    }
    try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); }catch(_){ }
  }

  // Nomes legados usados por onclick inline: salvar, não aprovar automaticamente.
  window.approveInstagramAttributionV31=function(id){ return saveInstagram(id,false); };
  window.instagramV102ApproveForQueue=function(id){ return saveInstagram(id,true); };
  window.saveInstagramAttributionV105=function(id, opts){ return saveInstagram(id, !!opts?.approve); };

  function decorateInstagramInputs(){
    const inputs=[...document.querySelectorAll('input[id^="atrib-insta-url-"]')];
    for(const input of inputs){
      const id=String(input.id||'').replace(/^atrib-insta-url-/,'');
      if(!id) continue;
      input.removeAttribute('onpaste');
      input.removeAttribute('onchange');
      input.removeAttribute('onkeydown');
      input.onpaste=null; input.onchange=null; input.onkeydown=null;
      if(input.dataset.igV107Bound!=='1'){
        input.dataset.igV107Bound='1';
        input.addEventListener('paste',()=>setTimeout(()=>saveInstagram(id,false),120));
        input.addEventListener('change',()=>saveInstagram(id,false));
        input.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); saveInstagram(id,false); } });
      }

      const card=cardFor(id);
      const wrap=input.closest('.atrib-v64-insta-input-wrap') || input.parentElement;
      if(!card || !wrap) continue;

      // Remove duplicados criados por patches antigos, preservando Ficha/Invalidar.
      card.querySelectorAll('[data-ig-v102-approve], [data-ig-v104-approve], [data-ig-v105-approve], [data-ig-v106-approve], [data-ig-v107-approve], .ig-v102-approve-btn, .ig-v104-approve-btn, .ig-v105-approve-btn, .ig-v106-approve-btn, .ig-v107-approve-btn').forEach(btn=>btn.remove());

      const btn=document.createElement('button');
      btn.type='button';
      btn.dataset.igV107Approve=id;
      btn.className='btn btn-primary ig-v107-approve-btn';
      btn.textContent='Aprovar para fila';
      btn.style.cssText='font-size:9px;padding:7px 10px;margin-left:6px;white-space:nowrap;min-width:112px';
      btn.addEventListener('click',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); saveInstagram(id,true); });
      try{ wrap.style.display='inline-flex'; wrap.style.alignItems='center'; wrap.style.gap='6px'; }catch(_){ }
      wrap.appendChild(btn);

      const current=normalizeInstagramUsername(input.value);
      if(current && String(input.value||'').trim().startsWith('@')) input.dataset.instagramUsername=current;
    }
  }

  let decorateTimer=null;
  function scheduleDecorate(){
    clearTimeout(decorateTimer);
    decorateTimer=setTimeout(decorateInstagramInputs,80);
  }

  // Wrap renderizadores uma única vez, sem observar DOM continuamente.
  function wrapAsync(name){
    const fn=window[name];
    if(typeof fn!=='function' || fn.__igV107Wrapped) return;
    const wrapped=async function(){
      const r=await fn.apply(this,arguments);
      scheduleDecorate();
      return r;
    };
    wrapped.__igV107Wrapped=true;
    window[name]=wrapped;
  }
  function wrapSync(name){
    const fn=window[name];
    if(typeof fn!=='function' || fn.__igV107Wrapped) return;
    const wrapped=function(){
      const r=fn.apply(this,arguments);
      scheduleDecorate();
      return r;
    };
    wrapped.__igV107Wrapped=true;
    window[name]=wrapped;
  }

  wrapAsync('renderAtribuicaoPanelV31');
  wrapAsync('renderAtribuicao');
  wrapSync('setAtribTab');
  wrapSync('atribGoPageV31');

  document.addEventListener('click',function(ev){
    const btn=ev.target?.closest?.('[data-ig-v107-approve], .ig-v107-approve-btn');
    if(!btn) return;
    ev.preventDefault(); ev.stopPropagation();
    const id=btn.dataset.igV107Approve || btn.closest('[data-lead-id]')?.dataset?.leadId;
    if(id) saveInstagram(id,true);
  }, true);

  document.addEventListener('DOMContentLoaded', scheduleDecorate);
  if(document.readyState!=='loading') scheduleDecorate();
  setTimeout(scheduleDecorate,500);

  console.log('[v107][instagram-atribuicao-sem-loop] ativo',VERSION);
})();
