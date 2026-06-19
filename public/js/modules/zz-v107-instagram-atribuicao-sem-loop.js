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

/* V108 — Configurações estruturais: regras de importação + imagens fixas por ramo
   - Não salva imagem pesada no banco/Supabase: usa IndexedDB do navegador do painel.
   - Banco/CRM guardam texto/templates e regras; imagem fica fixa por ramo no navegador operacional.
   - WhatsApp passa a buscar imagem fixa do ramo antes da imagem antiga por lote.
   - Importação passa a respeitar regras configuráveis e ramos/subcategorias cadastrados.
*/
(function(){
  'use strict';
  const VERSION='20260619-V108-IMPORT-RULES-RAMO-IMAGES';
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
    requirePhone:false,
    requireInstagram:false,
    allowOwnSite:true,
    allowWix:true,
    allowAggregators:true,
    allowFacebook:false,
    allowWhatsappAsSite:true
  };}
  function getRules(){
    try{return {...defaultRules(),...(JSON.parse(localStorage.getItem(RULES_KEY)||'{}')||{})};}catch(_){return defaultRules();}
  }
  function saveRules(r){localStorage.setItem(RULES_KEY,JSON.stringify({...defaultRules(),...(r||{})}));}
  function bool(id){return !!document.getElementById(id)?.checked;}
  function num(id,fallback){const n=Number(document.getElementById(id)?.value);return Number.isFinite(n)?n:fallback;}

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
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:12px;line-height:1.6">A importação usa estes requisitos + os ramos/subcategorias cadastrados. O seletor manual de ramo deixa de ser a fonte principal.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div><label>Nota mínima</label><input id="v108MinRating" type="number" step="0.1" min="0" max="5" value="${esc(r.minRating)}" oninput="saveImportRulesV108()"></div>
        <div><label>Reviews mínimos</label><input id="v108MinReviews" type="number" step="1" min="0" value="${esc(r.minReviews)}" oninput="saveImportRulesV108()"></div>
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text2)"><input id="v108RequirePhone" type="checkbox" ${r.requirePhone?'checked':''} onchange="saveImportRulesV108()"> Exigir telefone</label>
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text2)"><input id="v108RequireInstagram" type="checkbox" ${r.requireInstagram?'checked':''} onchange="saveImportRulesV108()"> Exigir Instagram</label>
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text2)"><input id="v108AllowOwnSite" type="checkbox" ${r.allowOwnSite?'checked':''} onchange="saveImportRulesV108()"> Permitir site próprio</label>
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text2)"><input id="v108AllowWix" type="checkbox" ${r.allowWix?'checked':''} onchange="saveImportRulesV108()"> Permitir Wix</label>
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text2)"><input id="v108AllowAggregators" type="checkbox" ${r.allowAggregators?'checked':''} onchange="saveImportRulesV108()"> Permitir agregadores</label>
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text2)"><input id="v108AllowFacebook" type="checkbox" ${r.allowFacebook?'checked':''} onchange="saveImportRulesV108()"> Permitir Facebook</label>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:10px;line-height:1.6">Categorias fora dos ramos cadastrados são recusadas automaticamente como <b>Fora do ramo</b>.</div>
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
  window.saveImportRulesV108=function(){
    saveRules({
      minRating:num('v108MinRating',4),
      minReviews:num('v108MinReviews',10),
      requirePhone:bool('v108RequirePhone'),
      requireInstagram:bool('v108RequireInstagram'),
      allowOwnSite:bool('v108AllowOwnSite'),
      allowWix:bool('v108AllowWix'),
      allowAggregators:bool('v108AllowAggregators'),
      allowFacebook:bool('v108AllowFacebook'),
      allowWhatsappAsSite:true
    });
    try{if(typeof window.importPreview==='function')window.importPreview();}catch(_){ }
    notify('✓ Regras de importação salvas');
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
          if(rating<Number(rules.minRating||0)){analysis.route='skip';analysis.reason=`nota abaixo do mínimo (${rating||0})`;}
          else if(reviews<Number(rules.minReviews||0)){analysis.route='skip';analysis.reason=`reviews abaixo do mínimo (${reviews||0})`;}
          else if(rules.requirePhone && !analysis.phone){analysis.route='skip';analysis.reason='sem telefone obrigatório';}
          else if(rules.requireInstagram && !(analysis.instagram||item?.instagram||item?.instagram_url||item?.instagramUsername)){analysis.route='skip';analysis.reason='sem instagram obrigatório';}
          else if(site && isFacebook(site) && !rules.allowFacebook){analysis.route='skip';analysis.reason='facebook bloqueado';}
          else if(site && isWix(site) && !rules.allowWix){analysis.route='skip';analysis.reason='wix bloqueado';}
          else if(site && isAggregator(site) && !rules.allowAggregators){analysis.route='skip';analysis.reason='agregador bloqueado';}
          else if(site && !isWhatsapp(site) && !isInstagram(site) && !isAggregator(site) && !isWix(site) && !rules.allowOwnSite){analysis.route='skip';analysis.reason='site próprio bloqueado';}
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
