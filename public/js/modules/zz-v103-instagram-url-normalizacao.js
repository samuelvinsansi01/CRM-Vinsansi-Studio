/* V103 — Instagram: normalização robusta de @/URL no campo da Atribuição Instagram.
   Aceita:
   @perfil, perfil, instagram.com/perfil, www.instagram.com/perfil,
   https://instagram.com/perfil/, https://www.instagram.com/perfil/
   Rejeita home/explore/reels/p/etc e tokens inválidos.
*/
(function(){
  'use strict';
  const VERSION='20260619-V103-INSTAGRAM-URL-NORMALIZACAO';
  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); } catch(e){} }
  function cssId(id){ try { return CSS.escape(String(id)); } catch(e){ return String(id).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); } }

  function cleanInstagramUsername(value){
    let raw=String(value||'').trim();
    if(!raw) return '';
    raw=raw.replace(/^@+/, '').trim();

    // Corrige variações sem protocolo para URL parseável.
    let parseable=raw;
    if(/^www\.instagram\.com\//i.test(parseable)) parseable='https://'+parseable;
    if(/^instagram\.com\//i.test(parseable)) parseable='https://www.'+parseable;

    try{
      const u=new URL(parseable);
      const host=u.hostname.replace(/^www\./i,'').toLowerCase();
      if(host==='instagram.com'){
        const first=(u.pathname||'').split('/').filter(Boolean)[0]||'';
        raw=first;
      }
    }catch(_){
      // Não é URL; pode ser username puro.
      raw=raw
        .replace(/^https?:\/\//i,'')
        .replace(/^www\.instagram\.com\//i,'')
        .replace(/^instagram\.com\//i,'')
        .split(/[/?#]/)[0];
    }

    let username=String(raw||'').trim().replace(/^@+/,'').split(/[/?#]/)[0];
    username=username.replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();

    const invalid=new Set([
      '','http','https','www','instagram','instagram.com','www.instagram.com','com','null','undefined',
      'p','reel','reels','stories','explore','accounts','direct','about','developer','legal','privacy','terms'
    ]);
    if(invalid.has(username)) return '';
    if(username.length<2 || username.length>30) return '';
    if(/^\.+$/.test(username)) return '';
    return username;
  }

  function instagramUrl(username){
    const u=cleanInstagramUsername(username);
    return u ? `https://www.instagram.com/${u}/` : '';
  }

  // Expor para outros patches/usos futuros.
  window.normalizeInstagramUsernameCRM = cleanInstagramUsername;
  window.normalizeInstagramUrlCRM = function(value){ return instagramUrl(cleanInstagramUsername(value)); };

  async function saveInstagramOnly(id){
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível','err');
    const input=document.getElementById(`atrib-insta-url-${cssId(id)}`);
    const username=cleanInstagramUsername(input?.value||'');
    if(!username){
      if(input) input.style.borderColor='var(--error)';
      return notify('Cole um @ ou link válido do Instagram','warn');
    }
    const url=instagramUrl(username);
    if(input){ input.value=url; input.style.borderColor='var(--ok)'; }
    const card=document.querySelector(`[data-lead-id="${cssId(id)}"]`);
    if(card) card.style.opacity='.65';
    const {error}=await c.from('leads').update({
      instagram:url,
      instagram_url:url,
      instagram_username:username,
      current_stage:'attribution_instagram',
      lead_channel:'instagram',
      pipeline_status:'instagram_profile_saved',
      updated_at:new Date().toISOString()
    }).eq('user_id',user).eq('id',id);
    if(card) card.style.opacity='1';
    if(error) return notify('Erro ao salvar Instagram: '+error.message,'err');
    notify(`✓ Instagram salvo: @${username}. Revise e clique em Aprovar para fila.`);
    try{ if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31(); else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao(); }catch(_){ }
    try{ if(typeof window.updateMenuBadgesTotalsV65==='function') window.updateMenuBadgesTotalsV65(true); else if(typeof window.updateBadges==='function') window.updateBadges(); }catch(_){ }
  }

  async function approveForQueue(id){
    const c=sb(), user=uid();
    if(!c || !user) return notify('// Supabase indisponível','err');
    const input=document.getElementById(`atrib-insta-url-${cssId(id)}`);
    let username=cleanInstagramUsername(input?.value||'');
    if(!username){
      const {data:lead}=await c.from('leads').select('instagram,instagram_url,instagram_username').eq('user_id',user).eq('id',id).maybeSingle();
      username=cleanInstagramUsername(lead?.instagram_username || lead?.instagram_url || lead?.instagram || '');
    }
    if(!username){
      if(input) input.style.borderColor='var(--error)';
      return notify('Para aprovar, primeiro cole e salve um Instagram válido.','warn');
    }
    const url=instagramUrl(username);
    if(input){ input.value=url; input.style.borderColor='var(--ok)'; }
    const {error}=await c.from('leads').update({
      instagram:url,
      instagram_url:url,
      instagram_username:username,
      current_stage:'attribution_instagram',
      lead_channel:'instagram',
      pipeline_status:'approved_for_instagram_queue',
      updated_at:new Date().toISOString()
    }).eq('user_id',user).eq('id',id);
    if(error) return notify('Erro ao aprovar para fila: '+error.message,'err');
    notify(`✓ @${username} aprovado para Fila Instagram`);
    try{ if(typeof window.renderAtribuicaoPanelV31==='function') await window.renderAtribuicaoPanelV31(); else if(typeof window.renderAtribuicao==='function') await window.renderAtribuicao(); }catch(_){ }
  }

  // Sobrescreve os handlers antigos que rejeitavam https://www.instagram.com/perfil/.
  window.approveInstagramAttributionV31 = saveInstagramOnly;
  window.instagramV102ApproveForQueue = approveForQueue;

  console.log('[v103][instagram-url-normalizacao] ativo', VERSION);
})();
