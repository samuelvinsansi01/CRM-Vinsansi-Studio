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

  console.log('[v111][regras-importacao-editaveis-fix] ativo',VERSION);
})();

/* V108 — Configurações estruturais: regras de importação + imagens fixas por ramo
   - Não salva imagem pesada no banco/Supabase: usa IndexedDB do navegador do painel.
   - Banco/CRM guardam texto/templates e regras; imagem fica fixa por ramo no navegador operacional.
   - WhatsApp passa a buscar imagem fixa do ramo antes da imagem antiga por lote.
   - Importação passa a respeitar regras configuráveis e ramos/subcategorias cadastrados.
*/
(function(){
  'use strict';
  const VERSION='20260619-V113-IMPORT-RULES-TOASTS';
  const RULES_KEY='vs_import_rules_v108';
  const IDB_NAME='vs_ramo_images_v108';
  const IDB_STORE='images';
  const imgCache={};
  let dbPromise=null;

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');}
  function slug(v){return norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'ramo';}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function readRamos(){try{return (typeof window.getRamos==='function'?window.getRamos():getRamos())||[];}catch(_){return [];}}
  function normalizeRamo(r){return {id:String(r?.id||slug(r?.nome||'ramo')),nome:String(r?.nome||'Ramo'),keywords:Array.isArray(r?.keywords)?r.keywords:[]};}
  function ramos(){return readRamos().map(normalizeRamo);}

  function defaultRules(){return {
    minRating:4.0,
    minReviews:10,
    minLeadScore:0,
    requirePhone:false,
    requireWhatsapp:false,
    requireInstagram:false,
    requireWebsite:false,
    allowOwnSite:true,
    allowWix:true,
    allowAggregators:true,
    allowFacebook:false,
    allowWhatsappAsSite:true,
    allowLinktree:true,
    allowBeacons:true,
    allowGoogleSites:true,
    onlyBrazil:false,
    allowedStates:'',
    blockedCities:'',
    useRegisteredRamosOnly:true,
    allowUnmatchedCategories:false,
    allowNoReviews:false,
    allowHiddenRating:false,
    blockDuplicatePhone:true,
    blockDuplicateInstagram:true,
    blockDuplicateWebsite:true,
    blockSentCompany:true,
    blockBasePermanente:true,
    instagramOnlyPublic:true,
    moveInvalidWhatsappToInstagram:true,
    invalidDestination:'instagram'
  };}
  function getRules(){
    try{return {...defaultRules(),...(JSON.parse(localStorage.getItem(RULES_KEY)||'{}')||{})};}catch(_){return defaultRules();}
  }
  function saveRules(r){
    const payload={...defaultRules(),...(r||{})};
    localStorage.setItem(RULES_KEY,JSON.stringify(payload));
    try{window.__crmImportRules=payload;}catch(_){ }
  }
  function bool(id){
    const tg=document.querySelector(`.v111-toggle[data-rule="${id}"]`);
    if(tg)return String(tg.dataset.value)==='true';
    const el=document.getElementById(id);
    if(!el)return false;
    if(String(el.tagName||'').toUpperCase()==='SELECT')return String(el.value)==='true';
    return !!el.checked;
  }
  function txt(id){return String(document.getElementById(id)?.value||'').trim();}
  function yn(id,val){
    const v=!!val;
    return `<div class="v111-toggle" data-rule="${id}" data-value="${v?'true':'false'}" role="group" aria-label="${id}">
      <button type="button" class="v111-toggle-btn ${v?'active':''}" data-rule="${id}" data-value="true">Sim</button>
      <button type="button" class="v111-toggle-btn ${!v?'active':''}" data-rule="${id}" data-value="false">Não</button>
    </div>`;
  }
  function num(id,fallback){const n=Number(document.getElementById(id)?.value);return Number.isFinite(n)?n:fallback;}


  const RULE_LABELS_V113={
    minRating:'Nota mínima',minReviews:'Reviews mínimos',minLeadScore:'Score mínimo',
    requirePhone:'Exigir telefone',requireWhatsapp:'Exigir WhatsApp válido',requireInstagram:'Exigir Instagram',requireWebsite:'Exigir website',
    allowOwnSite:'Permitir site próprio',allowWix:'Permitir Wix',allowAggregators:'Permitir agregadores',allowFacebook:'Permitir Facebook',allowLinktree:'Permitir Linktree',allowBeacons:'Permitir Beacons',allowGoogleSites:'Permitir Google Sites',
    onlyBrazil:'Apenas Brasil',allowedStates:'Estados permitidos',blockedCities:'Cidades bloqueadas',
    useRegisteredRamosOnly:'Usar ramos cadastrados',allowUnmatchedCategories:'Permitir sem correspondência',allowNoReviews:'Permitir sem reviews',allowHiddenRating:'Permitir nota oculta',
    blockDuplicatePhone:'Bloquear telefone duplicado',blockDuplicateInstagram:'Bloquear Instagram duplicado',blockDuplicateWebsite:'Bloquear website duplicado',blockSentCompany:'Bloquear já enviado',blockBasePermanente:'Bloquear Base Permanente',
    instagramOnlyPublic:'Apenas perfil público',moveInvalidWhatsappToInstagram:'Inválidos WhatsApp → Instagram',invalidDestination:'Destino inválidos'
  };
  const RULE_ID_TO_KEY_V113={
    v108MinRating:'minRating',v108MinReviews:'minReviews',v110MinLeadScore:'minLeadScore',
    v108RequirePhone:'requirePhone',v110RequireWhatsapp:'requireWhatsapp',v108RequireInstagram:'requireInstagram',v110RequireWebsite:'requireWebsite',
    v108AllowOwnSite:'allowOwnSite',v108AllowWix:'allowWix',v108AllowAggregators:'allowAggregators',v108AllowFacebook:'allowFacebook',v110AllowLinktree:'allowLinktree',v110AllowBeacons:'allowBeacons',v110AllowGoogleSites:'allowGoogleSites',
    v110OnlyBrazil:'onlyBrazil',v110AllowedStates:'allowedStates',v110BlockedCities:'blockedCities',
    v110UseRegisteredRamosOnly:'useRegisteredRamosOnly',v110AllowUnmatchedCategories:'allowUnmatchedCategories',v110AllowNoReviews:'allowNoReviews',v110AllowHiddenRating:'allowHiddenRating',
    v110BlockDuplicatePhone:'blockDuplicatePhone',v110BlockDuplicateInstagram:'blockDuplicateInstagram',v110BlockDuplicateWebsite:'blockDuplicateWebsite',v110BlockSentCompany:'blockSentCompany',v110BlockBasePermanente:'blockBasePermanente',
    v110InstagramOnlyPublic:'instagramOnlyPublic',v110MoveInvalidWhatsappToInstagram:'moveInvalidWhatsappToInstagram',v110InvalidDestination:'invalidDestination'
  };
  let lastRuleToastAtV113=0;
  function ruleToastV113(key,value){
    const label=RULE_LABELS_V113[key]||key;
    let msg='✓ '+label+' atualizado';
    if(typeof value==='boolean') msg='✓ '+label+' '+(value?'ativado':'desativado');
    else if(value!==undefined && value!==null && String(value)!=='') msg='✓ '+label+' atualizado para '+String(value);
    if(key==='useRegisteredRamosOnly') msg=value?'✓ Apenas categorias/subcategorias cadastradas serão importadas':'✓ Ramos cadastrados não serão obrigatórios na importação';
    if(key==='allowUnmatchedCategories') msg=value?'✓ Categorias sem correspondência serão aceitas':'✓ Categorias sem correspondência serão recusadas';
    if(key==='moveInvalidWhatsappToInstagram') msg=value?'✓ Inválidos do WhatsApp irão para Instagram':'✓ Inválidos do WhatsApp não irão para Instagram';
    if(key==='invalidDestination') msg='✓ Destino de inválidos atualizado para '+String(value);
    lastRuleToastAtV113=Date.now();
    notify(msg);
    try{
      let el=document.getElementById('v113LastRuleChange');
      if(!el){
        const actions=document.querySelector('.v111-actions');
        if(actions){actions.insertAdjacentHTML('afterend','<div id="v113LastRuleChange" style="font-family:\'DM Mono\',monospace;font-size:9px;color:#33d17a;margin-top:8px"></div>');el=document.getElementById('v113LastRuleChange');}
      }
      if(el)el.textContent='Última alteração: '+label+' → '+(typeof value==='boolean'?(value?'Sim':'Não'):String(value||''));
    }catch(_){}
  }

  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(IDB_NAME,1);
      req.onupgradeneeded=e=>{const db=e.target.result; if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE);};
      req.onsuccess=e=>resolve(e.target.result);
      req.onerror=e=>reject(e.target.error);
    });
    return dbPromise;
  }
  async function idbGet(key){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readonly');const rq=tx.objectStore(IDB_STORE).get(key);rq.onsuccess=()=>res(rq.result||null);rq.onerror=()=>rej(rq.error);});}
  async function idbSet(key,val){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');const rq=tx.objectStore(IDB_STORE).put(val,key);rq.onsuccess=()=>res();rq.onerror=()=>rej(rq.error);});}
  async function idbDel(key){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');const rq=tx.objectStore(IDB_STORE).delete(key);rq.onsuccess=()=>res();rq.onerror=()=>rej(rq.error);});}
  function imageKey(ramoId){return `ramo:${ramoId||'geral'}`;}
  async function getRamoImage(ramoId){const k=imageKey(ramoId); if(imgCache[k]!==undefined)return imgCache[k]; const v=await idbGet(k); imgCache[k]=v||null; return imgCache[k];}
  function getRamoImageSync(ramoId){const k=imageKey(ramoId); return imgCache[k]||null;}
  async function setRamoImage(ramoId,dataUrl){const k=imageKey(ramoId); imgCache[k]=dataUrl; await idbSet(k,dataUrl);}
  async function removeRamoImage(ramoId){const k=imageKey(ramoId); delete imgCache[k]; await idbDel(k);}

  // Guarda referência aos métodos antigos de imagem por lote para fallback.
  const oldLoadLote=window.loadLoteImagemPorRamoV73;
  const oldGetLote=window.getLoteImagemPorRamoV73;
  window.loadRamoImageV108=getRamoImage;
  window.getRamoImageSyncV108=getRamoImageSync;
  window.loadLoteImagemPorRamoV73=async function(chipId,loteNum,ramoId){
    const fixed=await getRamoImage(ramoId);
    if(fixed)return fixed;
    try{if(typeof oldLoadLote==='function')return await oldLoadLote(chipId,loteNum,ramoId);}catch(_){ }
    return null;
  };
  window.getLoteImagemPorRamoV73=function(chipId,loteNum,ramoId){
    const fixed=getRamoImageSync(ramoId);
    if(fixed)return fixed;
    try{if(typeof oldGetLote==='function')return oldGetLote(chipId,loteNum,ramoId);}catch(_){ }
    return null;
  };

  function renderImportRulesCard(){
    const r=getRules();
    return `<div class="card v108-import-rules-card" style="margin-top:16px">
      <div class="card-title">Regras de importação</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:14px;line-height:1.6">A importação usa estes requisitos + os ramos/subcategorias cadastrados. Tudo aqui é editável e persistente. Alterou, salvou, a próxima importação respeita.</div>
      <style>
        .v110-rules-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px}
        .v110-rules-section{border:1px solid var(--border2);background:var(--bg);border-radius:14px;padding:14px}
        .v110-rules-section h4{font-family:'DM Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px 0}
        .v110-rule-row{display:grid;grid-template-columns:1fr 110px;gap:8px;align-items:center;margin:8px 0}
        .v110-rule-row label{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);letter-spacing:.06em;text-transform:uppercase;margin:0}
        .v110-rule-row input,.v110-rule-row select{width:100%;min-height:38px;background:#06070b;border:1px solid var(--border2);color:var(--text);border-radius:9px;padding:8px 10px;font-family:'DM Mono',monospace;font-size:11px;outline:none}
        .v110-rule-row input:focus,.v110-rule-row select:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(179,255,70,.12)}
        .v110-rule-wide{grid-column:1/-1;display:block}.v110-rule-wide label{display:block;margin-bottom:6px}
        .v111-toggle{display:grid;grid-template-columns:1fr 1fr;gap:5px;background:#06070b;border:1px solid var(--border2);border-radius:10px;padding:4px;min-height:38px}
        .v111-toggle-btn{border:0;border-radius:8px;background:transparent;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px;font-weight:900;cursor:pointer;min-height:30px}
        .v111-toggle-btn.active{background:var(--accent);color:#050607}
        .v111-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
        .v111-saved-note{font-family:'DM Mono',monospace;font-size:9px;color:#33d17a;display:none}.v111-saved-note.show{display:inline}
      </style>
      <div class="v110-rules-grid">
        <div class="v110-rules-section"><h4>Qualificação</h4>
          <div class="v110-rule-row"><label>Nota mínima</label><input id="v108MinRating" type="number" step="0.1" min="0" max="5" value="${esc(r.minRating)}" oninput="saveImportRulesV108()"></div>
          <div class="v110-rule-row"><label>Reviews mínimos</label><input id="v108MinReviews" type="number" step="1" min="0" value="${esc(r.minReviews)}" oninput="saveImportRulesV108()"></div>
          <div class="v110-rule-row"><label>Score mínimo</label><input id="v110MinLeadScore" type="number" step="1" min="0" value="${esc(r.minLeadScore)}" oninput="saveImportRulesV108()"></div>
          <div class="v110-rule-row"><label>Permitir sem reviews</label>${yn('v110AllowNoReviews',r.allowNoReviews)}</div>
          <div class="v110-rule-row"><label>Permitir nota oculta</label>${yn('v110AllowHiddenRating',r.allowHiddenRating)}</div>
        </div>
        <div class="v110-rules-section"><h4>Canais</h4>
          <div class="v110-rule-row"><label>Exigir telefone</label>${yn('v108RequirePhone',r.requirePhone)}</div>
          <div class="v110-rule-row"><label>Exigir WhatsApp válido</label>${yn('v110RequireWhatsapp',r.requireWhatsapp)}</div>
          <div class="v110-rule-row"><label>Exigir Instagram</label>${yn('v108RequireInstagram',r.requireInstagram)}</div>
          <div class="v110-rule-row"><label>Exigir website</label>${yn('v110RequireWebsite',r.requireWebsite)}</div>
        </div>
        <div class="v110-rules-section"><h4>Sites</h4>
          <div class="v110-rule-row"><label>Permitir site próprio</label>${yn('v108AllowOwnSite',r.allowOwnSite)}</div>
          <div class="v110-rule-row"><label>Permitir Wix</label>${yn('v108AllowWix',r.allowWix)}</div>
          <div class="v110-rule-row"><label>Permitir agregadores</label>${yn('v108AllowAggregators',r.allowAggregators)}</div>
          <div class="v110-rule-row"><label>Permitir Facebook</label>${yn('v108AllowFacebook',r.allowFacebook)}</div>
          <div class="v110-rule-row"><label>Permitir Linktree</label>${yn('v110AllowLinktree',r.allowLinktree)}</div>
          <div class="v110-rule-row"><label>Permitir Beacons</label>${yn('v110AllowBeacons',r.allowBeacons)}</div>
          <div class="v110-rule-row"><label>Permitir Google Sites</label>${yn('v110AllowGoogleSites',r.allowGoogleSites)}</div>
        </div>
        <div class="v110-rules-section"><h4>Geografia</h4>
          <div class="v110-rule-row"><label>Apenas Brasil</label>${yn('v110OnlyBrazil',r.onlyBrazil)}</div>
          <div class="v110-rule-row v110-rule-wide"><label>Estados permitidos</label><input id="v110AllowedStates" value="${esc(r.allowedStates)}" placeholder="SP, PR, DF" oninput="saveImportRulesV108()"></div>
          <div class="v110-rule-row v110-rule-wide"><label>Cidades bloqueadas</label><input id="v110BlockedCities" value="${esc(r.blockedCities)}" placeholder="Cidade A, Cidade B" oninput="saveImportRulesV108()"></div>
        </div>
        <div class="v110-rules-section"><h4>Categorias/Ramos</h4>
          <div class="v110-rule-row"><label>Usar ramos cadastrados</label>${yn('v110UseRegisteredRamosOnly',r.useRegisteredRamosOnly)}</div>
          <div class="v110-rule-row"><label>Permitir sem correspondência</label>${yn('v110AllowUnmatchedCategories',r.allowUnmatchedCategories)}</div>
        </div>
        <div class="v110-rules-section"><h4>Duplicidade</h4>
          <div class="v110-rule-row"><label>Bloquear telefone duplicado</label>${yn('v110BlockDuplicatePhone',r.blockDuplicatePhone)}</div>
          <div class="v110-rule-row"><label>Bloquear Instagram duplicado</label>${yn('v110BlockDuplicateInstagram',r.blockDuplicateInstagram)}</div>
          <div class="v110-rule-row"><label>Bloquear website duplicado</label>${yn('v110BlockDuplicateWebsite',r.blockDuplicateWebsite)}</div>
          <div class="v110-rule-row"><label>Bloquear já enviado</label>${yn('v110BlockSentCompany',r.blockSentCompany)}</div>
          <div class="v110-rule-row"><label>Bloquear Base Permanente</label>${yn('v110BlockBasePermanente',r.blockBasePermanente)}</div>
        </div>
        <div class="v110-rules-section"><h4>Instagram</h4>
          <div class="v110-rule-row"><label>Apenas perfil público</label>${yn('v110InstagramOnlyPublic',r.instagramOnlyPublic)}</div>
        </div>
        <div class="v110-rules-section"><h4>Operacional</h4>
          <div class="v110-rule-row"><label>Inválidos WhatsApp → Instagram</label>${yn('v110MoveInvalidWhatsappToInstagram',r.moveInvalidWhatsappToInstagram)}</div>
          <div class="v110-rule-row"><label>Destino inválidos</label><select id="v110InvalidDestination" onchange="saveImportRulesV108()"><option value="instagram" ${r.invalidDestination==='instagram'?'selected':''}>Instagram</option><option value="discard" ${r.invalidDestination==='discard'?'selected':''}>Descartar</option></select></div>
        </div>
      </div>
      <div class="v111-actions">
        <button class="btn btn-primary" type="button" onclick="saveImportRulesV108(true)">Salvar regras</button>
        <button class="btn btn-ghost" type="button" onclick="resetImportRulesV111()">Restaurar padrão</button>
        <span id="v111SavedNote" class="v111-saved-note">✓ salvo</span>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:10px;line-height:1.6">Categorias fora dos ramos cadastrados serão recusadas quando <b>Usar ramos cadastrados</b> estiver ativo e <b>Permitir sem correspondência</b> estiver desligado.</div>
    </div>`;
  }

  function renderRamoImagesCard(){
    const rs=ramos();
    return `<div class="card v108-ramo-images-card" style="margin-top:16px">
      <div class="card-title">Imagens fixas por ramo</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:12px;line-height:1.6">Use uma imagem padrão por ramo. Ela serve para WhatsApp e Instagram, sem precisar subir imagem por lote. A imagem fica no IndexedDB do navegador e não pesa o banco.</div>
      <div id="v108RamoImageGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">
        ${rs.length?rs.map(r=>{
          const key=imageKey(r.id); const img=imgCache[key]||''; const inp='v108Img_'+slug(r.id);
          return `<div class="v108-img-card" data-ramo="${esc(r.id)}" style="background:var(--bg);border:1px solid var(--border2);border-radius:12px;padding:12px">
            <div style="font-family:'DM Mono',monospace;font-size:9px;font-weight:900;color:var(--accent);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">${esc(r.nome)}</div>
            <div class="v108-img-box ${img?'has-img':''}" onclick="document.getElementById('${esc(inp)}').click()" style="min-height:110px;border:2px dashed var(--border2);border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--surface2);position:relative;overflow:hidden;cursor:pointer">
              <img id="v108Preview_${esc(slug(r.id))}" src="${esc(img)}" style="${img?'display:block':'display:none'};max-width:100%;max-height:150px;object-fit:contain;border-radius:8px">
              <span id="v108Ph_${esc(slug(r.id))}" style="${img?'display:none':'display:block'};font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">📎 inserir imagem</span>
            </div>
            <input id="${esc(inp)}" type="file" accept="image/*" style="display:none" onchange="onRamoImageChangeV108('${esc(r.id)}',this)">
            <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-ghost" style="flex:1;font-size:9px;padding:7px" onclick="document.getElementById('${esc(inp)}').click()">Trocar</button><button class="btn btn-danger" style="font-size:9px;padding:7px" onclick="removeRamoImageV108('${esc(r.id)}')">Remover</button></div>
          </div>`;
        }).join(''):'<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">// cadastre um ramo para inserir imagem</div>'}
      </div>
    </div>`;
  }

  async function prewarmImages(){
    for(const r of ramos()){
      const k=imageKey(r.id);
      if(imgCache[k]===undefined){imgCache[k]=await idbGet(k)||null;}
    }
  }
  async function injectSettingsCards(){
    await prewarmImages();
    const ramosList=document.getElementById('ramosConfigList');
    if(!ramosList)return;
    const ramosCard=ramosList.closest('.card');
    if(ramosCard && !document.querySelector('.v108-import-rules-card')){
      ramosCard.insertAdjacentHTML('beforebegin',renderImportRulesCard());
    }
    let imgCard=document.querySelector('.v108-ramo-images-card');
    if(ramosCard){
      const html=renderRamoImagesCard();
      if(!imgCard) ramosCard.insertAdjacentHTML('afterend',html);
      else imgCard.outerHTML=html;
    }
  }
  window.setImportRuleBoolV111=function(id,value){
    const el=document.querySelector(`.v111-toggle[data-rule="${id}"]`);
    if(el){
      const v=!!value;
      el.dataset.value=v?'true':'false';
      el.setAttribute('aria-pressed',v?'true':'false');
      el.querySelectorAll('.v111-toggle-btn').forEach(btn=>{
        const is=String(btn.dataset.value)===(v?'true':'false');
        btn.classList.toggle('active',is);
        btn.setAttribute('aria-selected',is?'true':'false');
      });
    }
    saveImportRulesV108(false,id);
  };

  if(!window.__v112ImportRuleToggleListener){
    window.__v112ImportRuleToggleListener=true;
    document.addEventListener('click',function(ev){
      const btn=ev.target&&ev.target.closest&&ev.target.closest('.v111-toggle-btn[data-rule]');
      if(!btn)return;
      ev.preventDefault();
      ev.stopPropagation();
      window.setImportRuleBoolV111(btn.dataset.rule, String(btn.dataset.value)==='true');
    },true);
  }
  window.resetImportRulesV111=function(){
    saveRules(defaultRules());
    try{injectSettingsCards();}catch(_){ }
    notify('✓ Regras restauradas');
  };
  window.saveImportRulesV108=function(showMsg,changedId){
    const before=getRules();
    const payload={
      minRating:num('v108MinRating',4),
      minReviews:num('v108MinReviews',10),
      minLeadScore:num('v110MinLeadScore',0),
      requirePhone:bool('v108RequirePhone'),
      requireWhatsapp:bool('v110RequireWhatsapp'),
      requireInstagram:bool('v108RequireInstagram'),
      requireWebsite:bool('v110RequireWebsite'),
      allowOwnSite:bool('v108AllowOwnSite'),
      allowWix:bool('v108AllowWix'),
      allowAggregators:bool('v108AllowAggregators'),
      allowFacebook:bool('v108AllowFacebook'),
      allowWhatsappAsSite:true,
      allowLinktree:bool('v110AllowLinktree'),
      allowBeacons:bool('v110AllowBeacons'),
      allowGoogleSites:bool('v110AllowGoogleSites'),
      onlyBrazil:bool('v110OnlyBrazil'),
      allowedStates:txt('v110AllowedStates'),
      blockedCities:txt('v110BlockedCities'),
      useRegisteredRamosOnly:bool('v110UseRegisteredRamosOnly'),
      allowUnmatchedCategories:bool('v110AllowUnmatchedCategories'),
      allowNoReviews:bool('v110AllowNoReviews'),
      allowHiddenRating:bool('v110AllowHiddenRating'),
      blockDuplicatePhone:bool('v110BlockDuplicatePhone'),
      blockDuplicateInstagram:bool('v110BlockDuplicateInstagram'),
      blockDuplicateWebsite:bool('v110BlockDuplicateWebsite'),
      blockSentCompany:bool('v110BlockSentCompany'),
      blockBasePermanente:bool('v110BlockBasePermanente'),
      instagramOnlyPublic:bool('v110InstagramOnlyPublic'),
      moveInvalidWhatsappToInstagram:bool('v110MoveInvalidWhatsappToInstagram'),
      invalidDestination:txt('v110InvalidDestination')||'instagram'
    };
    saveRules(payload);
    try{if(typeof window.importPreview==='function')window.importPreview();}catch(_){ }
    try{const n=document.getElementById('v111SavedNote'); if(n){n.classList.add('show'); setTimeout(()=>n.classList.remove('show'),1600);}}catch(_){ }
    if(showMsg){notify('✓ Regras de importação salvas');return;}
    let key=RULE_ID_TO_KEY_V113[changedId]||null;
    if(!key){
      for(const k of Object.keys(payload)){if(JSON.stringify(before[k])!==JSON.stringify(payload[k])){key=k;break;}}
    }
    if(key && Date.now()-lastRuleToastAtV113>120){ruleToastV113(key,payload[key]);}
  };

  window.onRamoImageChangeV108=function(ramoId,input){
    const file=input.files&&input.files[0]; if(!file)return;
    if(!/^image\//i.test(file.type||'')){notify('// selecione uma imagem válida','err');return;}
    if(file.size>24*1024*1024){notify('// imagem acima de 24 MB. Comprima antes de usar.','err');return;}
    const reader=new FileReader();
    reader.onload=async e=>{await setRamoImage(ramoId,e.target.result); notify('✓ Imagem fixa do ramo salva'); await injectSettingsCards(); try{if(typeof window.renderFilaZapV74==='function')window.renderFilaZapV74();}catch(_){ }};
    reader.onerror=()=>notify('// erro ao carregar imagem','err');
    reader.readAsDataURL(file);
  };
  window.removeRamoImageV108=async function(ramoId){await removeRamoImage(ramoId); notify('✓ Imagem removida'); await injectSettingsCards(); try{if(typeof window.renderFilaZapV74==='function')window.renderFilaZapV74();}catch(_){ }};

  function cleanSite(v){return String(v||'').trim().toLowerCase();}
  function domainOf(v){try{return new URL(/^https?:\/\//i.test(v)?v:'https://'+v).hostname.replace(/^www\./,'').toLowerCase();}catch(_){return cleanSite(v).replace(/^https?:\/\/(www\.)?/,'').split('/')[0];}}
  function isFacebook(v){const d=domainOf(v); return d==='facebook.com'||d==='fb.com'||d.endsWith('.facebook.com')||d.endsWith('.fb.com');}
  function isWhatsapp(v){const d=domainOf(v); return ['wa.me','whatsapp.com','api.whatsapp.com','chat.whatsapp.com'].includes(d)||d.endsWith('.whatsapp.com');}
  function isInstagram(v){const d=domainOf(v); return d==='instagram.com'||d.endsWith('.instagram.com')||d==='instagr.am'||d.endsWith('.instagr.am');}
  function isWix(v){const d=domainOf(v); return d.includes('wixsite.com')||d.includes('wix.com');}
  function isAggregator(v){const d=domainOf(v); return ['linktr.ee','bio.site','beacons.ai','carrd.co','taplink.cc','msha.ke','lnk.bio','solo.to','about.me'].some(x=>d===x||d.endsWith('.'+x));}
  function isLinktree(v){const d=domainOf(v); return d==='linktr.ee'||d.endsWith('.linktr.ee');}
  function isBeacons(v){const d=domainOf(v); return d==='beacons.ai'||d.endsWith('.beacons.ai');}
  function isGoogleSites(v){const d=domainOf(v); return d==='sites.google.com'||d.endsWith('.sites.google.com');}
  function hasInstagramAny(item,a){return !!(a?.instagram||a?.instagram_url||a?.instagram_username||item?.instagram||item?.instagram_url||item?.instagramUsername||item?.instagram_username);}
  function leadScoreFromAnalysis(a){return Number(a?.lead_score??a?.score??a?.qualification?.score??0)||0;}
  function countryFrom(item,a){return String(a?.country_code||a?.country||a?.item?.country_code||item?.country_code||item?.country||'').trim().toUpperCase();}
  function stateFrom(item,a){return String(a?.state||a?.item?.state||item?.state||item?.estado||'').trim().toUpperCase();}
  function cityFrom(item,a){return norm(a?.city||a?.item?.city||item?.city||item?.cidade||'');}
  function listFromCsv(v){return String(v||'').split(',').map(x=>x.trim()).filter(Boolean);}
  function websiteFromAnalysis(a){return a?.website?.site||a?.website?.url||a?.site||a?.website_url||a?.item?.website||a?.item?.url||'';}
  function ratingFromAnalysis(a){return Number(a?.qualification?.rating??a?.rating??a?.item?.rating??a?.item?.stars??0)||0;}
  function reviewsFromAnalysis(a){return Number(a?.qualification?.reviews??a?.reviewsCount??a?.reviews_count??a?.item?.reviewsCount??a?.item?.reviews_count??a?.item?.reviews??0)||0;}

  const prevAnalyze=window.analyzeApifyLeadV430;
  if(typeof prevAnalyze==='function'){
    window.analyzeApifyLeadV430=function(item,databaseIndex,payloadIndex,phase){
      const analysis=prevAnalyze.apply(this,arguments)||{};
      try{
        const rules=getRules();
        const reason=String(analysis.reason||'').toLowerCase();
        const protectedSkip=analysis.route==='skip'&&(reason.includes('duplicado')||reason.includes('existente')||reason.includes('base permanente')||reason.includes('sent_contacts')||reason.includes('sem nome'));
        if(!protectedSkip){
          const rating=ratingFromAnalysis(analysis);
          const reviews=reviewsFromAnalysis(analysis);
          const site=websiteFromAnalysis(analysis);
          const country=countryFrom(item,analysis), st=stateFrom(item,analysis), city=cityFrom(item,analysis);
          const allowedStates=listFromCsv(rules.allowedStates).map(x=>x.toUpperCase());
          const blockedCities=listFromCsv(rules.blockedCities).map(norm);
          const score=leadScoreFromAnalysis(analysis);
          const noRating=!rating;
          const noReviews=!reviews;
          if(noRating && !rules.allowHiddenRating){analysis.route='skip';analysis.reason='nota oculta bloqueada';}
          else if(!noRating && rating<Number(rules.minRating||0)){analysis.route='skip';analysis.reason=`nota abaixo do mínimo (${rating||0})`;}
          else if(noReviews && !rules.allowNoReviews){analysis.route='skip';analysis.reason='sem reviews bloqueado';}
          else if(!noReviews && reviews<Number(rules.minReviews||0)){analysis.route='skip';analysis.reason=`reviews abaixo do mínimo (${reviews||0})`;}
          else if(score<Number(rules.minLeadScore||0)){analysis.route='skip';analysis.reason=`score abaixo do mínimo (${score||0})`;}
          else if(rules.onlyBrazil && country && !['BR','BRA','BRASIL','BRAZIL'].includes(country)){analysis.route='skip';analysis.reason='fora do Brasil';}
          else if(allowedStates.length && st && !allowedStates.includes(st)){analysis.route='skip';analysis.reason='estado não permitido';}
          else if(blockedCities.length && city && blockedCities.includes(city)){analysis.route='skip';analysis.reason='cidade bloqueada';}
          else if(rules.requirePhone && !analysis.phone){analysis.route='skip';analysis.reason='sem telefone obrigatório';}
          else if(rules.requireWhatsapp && !(analysis.whatsapp||analysis.phone)){analysis.route='skip';analysis.reason='sem WhatsApp obrigatório';}
          else if(rules.requireInstagram && !hasInstagramAny(item,analysis)){analysis.route='skip';analysis.reason='sem instagram obrigatório';}
          else if(rules.requireWebsite && !site){analysis.route='skip';analysis.reason='sem website obrigatório';}
          else if(site && isFacebook(site) && !rules.allowFacebook){analysis.route='skip';analysis.reason='facebook bloqueado';}
          else if(site && isWix(site) && !rules.allowWix){analysis.route='skip';analysis.reason='wix bloqueado';}
          else if(site && isLinktree(site) && !rules.allowLinktree){analysis.route='skip';analysis.reason='linktree bloqueado';}
          else if(site && isBeacons(site) && !rules.allowBeacons){analysis.route='skip';analysis.reason='beacons bloqueado';}
          else if(site && isGoogleSites(site) && !rules.allowGoogleSites){analysis.route='skip';analysis.reason='google sites bloqueado';}
          else if(site && isAggregator(site) && !rules.allowAggregators){analysis.route='skip';analysis.reason='agregador bloqueado';}
          else if(site && !isWhatsapp(site) && !isInstagram(site) && !isAggregator(site) && !isWix(site) && !isGoogleSites(site) && !rules.allowOwnSite){analysis.route='skip';analysis.reason='site próprio bloqueado';}
        }
      }catch(e){console.warn('[v108][rules analyze]',e?.message||e);}
      return analysis;
    };
  }

  function hideLegacyImportRamoSelect(){
    const sel=document.getElementById('ramoSelect'); if(!sel)return;
    const wrap=sel.closest('div[style*="margin-bottom:10px"]')||sel.closest('div');
    const label=[...document.querySelectorAll('#panel-importar label')].find(l=>/ramo ativo/i.test(l.textContent||''));
    if(label) label.style.display='none';
    if(wrap) wrap.style.display='none';
    const sub=document.getElementById('subRamosWrap'); if(sub) sub.style.display='none';
    const subText=document.querySelector('#panel-importar .page-sub');
    if(subText) subText.textContent='// Apify · regras configuráveis · ramos/subcategorias cadastrados definem o que passa';
  }

  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){
    const out=typeof prevSwitch==='function'?prevSwitch.apply(this,arguments):undefined;
    setTimeout(()=>{hideLegacyImportRamoSelect(); injectSettingsCards();},120);
    return out;
  };
  const prevRenderRamos=window.renderRamosConfig;
  if(typeof prevRenderRamos==='function'){
    window.renderRamosConfig=function(){const out=prevRenderRamos.apply(this,arguments); setTimeout(injectSettingsCards,80); return out;};
  }
  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>{hideLegacyImportRamoSelect(); injectSettingsCards();},900);
    setTimeout(()=>{hideLegacyImportRamoSelect(); injectSettingsCards();},2200);
    setInterval(()=>{if(document.getElementById('panel-importar')?.classList.contains('active'))hideLegacyImportRamoSelect(); if(document.getElementById('panel-settings')?.classList.contains('active'))injectSettingsCards();},2500);
    console.log('[v108][import-rules-ramo-images] ativo',VERSION);
  });
})();
