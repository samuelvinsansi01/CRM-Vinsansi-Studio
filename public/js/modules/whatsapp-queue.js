/* Lead Certo — módulo dono da Fila WhatsApp: renderização, lotes, imagens por ramo, status e remover/devolver lead.
   Consolidado sem carregamento dos patches visuais antigos. */
/* V78 — Fila WhatsApp: fila final real + navegação sem travar
   Base: V74 — status enxutos + lotes pela configuração + accordions sem piscar
   - Visual baseado na V72 aprovada.
   - Não altera Supabase, Evolution, pré-envio, QR, conversas ou base permanente.
   - Lê pre_dispatch_items + leads + whatsapp_instances.
   - Imagens por ramo ficam no IndexedDB, não como banco principal. */
(function(){
  'use strict';
  const VERSION='20260618-V77-FILA-FINAL-NAV-CONFIG';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const state={date:null,status:'queue',chipOpen:null,lotes:{},expanded:{},last:null,imgCache:{}};
  const IDB_NAME='vs_lote_imgs';
  const IDB_STORE='imgs';
  let _db=null;

  function sb(){try{return window.sbClient||(typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;}}
  function uid(){try{return window.currentUser?.id||(typeof currentUser!=='undefined'&&currentUser?.id)||localStorage.getItem('vs_auth_local_user_v423')||USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;}}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function digits(v){return String(v||'').replace(/\D/g,'');}
  function normPhone(v){let d=digits(v); if(!d)return ''; if(d.startsWith('00'))d=d.slice(2); if(d.startsWith('55'))return d; if(d.length===10||d.length===11)return '55'+d; return d;}
  function cleanUrl(url){const u=String(url||'').trim(); if(!u)return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`;}
  function host(url){try{return new URL(cleanUrl(url)).hostname.replace(/^www\./,'');}catch(_){return String(url||'').replace(/^https?:\/\/(www\.)?/,'').split('/')[0];}}
  function todayIso(){const d=new Date();d.setHours(0,0,0,0);return d.toISOString().slice(0,10);}
  function weekDates(){const d=new Date();d.setHours(0,0,0,0);const start=new Date(d);start.setDate(d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>{const x=new Date(start);x.setDate(start.getDate()+i);return x.toISOString().slice(0,10);});}
  function dayLabel(iso){try{const [y,m,d]=String(iso).split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.','');}catch(_){return iso;}}
  function chipKey(ch){return String(ch?.instance||ch?.chip_id||ch?.label||ch?.id||'').trim();}
  function chipTitle(ch){return String(ch?.label||ch?.name||ch?.chip_id||ch?.instance||'Chip').trim();}
  function chipRef(ch){return String(ch?.id||chipKey(ch)||chipTitle(ch)||'chip');}
  function rowChipKey(r){return String(r?.chip_instance||r?.chip_label||'').trim();}
  function rowChipTitle(r){return String(r?.chip_label||r?.chip_instance||'Chip').trim();}
  function leadName(l){return l?.company_name||l?.nome||l?.title||'Lead';}
  function leadPhone(l){return normPhone(l?.normalized_phone||l?.phone||l?.whatsapp||l?.telefone||'');}
  function mapsUrl(l){return cleanUrl(l?.maps_url||l?.googleUrl||l?.mapsUrl||'');}
  function normalize(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
  function slug(v){return normalize(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'geral';}

  function statusKey(s){
    const raw=String(s||'').toLowerCase();
    if(['sent','enviado','enviada'].includes(raw))return 'sent';
    if(['error','erro','failed','dispatch_error'].includes(raw))return 'error';
    return 'queue';
  }
  function statusLabel(s){return ({queue:'Em fila',sent:'Enviada',error:'Erro'})[statusKey(s)]||'Em fila';}
  function statusDb(s){return ({queue:'ready_to_dispatch',sent:'sent',error:'error'})[s]||s;}

  function readDispatchCfg(){
    try{ if(typeof window.getDispatchEditableConfigV49==='function') return window.getDispatchEditableConfigV49()||{}; }catch(_){}
    try{ return JSON.parse(localStorage.getItem('vs_evo_config')||localStorage.getItem('evo_config')||'{}')||{}; }catch(_){ return {}; }
  }
  function blockSize(ch){
    const cfg=readDispatchCfg();
    const fromCfg=Number(cfg.loteTamanho||cfg.disparosPorBloco||0);
    if(fromCfg>0)return fromCfg;
    const fromInput=Number(document.getElementById('dispatchBlockSize')?.value||document.getElementById('loteTamanho')?.value||0);
    if(fromInput>0)return fromInput;
    try{if(typeof window.getLoteSize==='function')return Math.max(1,Number(window.getLoteSize())||60);}catch(_){}
    return 60;
  }
  function blockCount(){
    const cfg=readDispatchCfg();
    const fromCfg=Number(cfg.blocoQuantidade||cfg.quantidadeBlocos||0);
    if(fromCfg>0)return fromCfg;
    const fromInput=Number(document.getElementById('dispatchBlockCount')?.value||0);
    return fromInput>0?fromInput:2;
  }
  function dailyLimit(ch){
    const cfgLimit=blockSize(ch)*blockCount();
    return cfgLimit>0?cfgLimit:(Number(ch?.daily_limit||120)||120);
  }
  function leadLinkHtml(l){const m=mapsUrl(l);const name=esc(leadName(l));return m?`<a href="${esc(m)}" target="_blank" rel="noopener" class="v73-name-link">${name}</a>`:name;}
  function getMsg(r,n){const raw=r.raw_payload||{}; const l=r.lead||{}; return raw[`message_${n}`]||raw[`mensagem${n}`]||raw[`msg${n}`]||l[`message_${n}`]||l[`mensagem${n}`]||'';}

  function categoriesOf(l){
    const out=[];
    ['category_name','category','categoria','parent_category'].forEach(k=>{if(l&&l[k])out.push(String(l[k]));});
    const cats=l?.categories;
    if(Array.isArray(cats)) cats.forEach(c=>out.push(String(c)));
    else if(typeof cats==='string') {
      try{const parsed=JSON.parse(cats); if(Array.isArray(parsed)) parsed.forEach(c=>out.push(String(c))); else out.push(cats);}catch(_){cats.split(/[;,|]/).forEach(c=>out.push(c));}
    }
    const raw=l?.raw_payload||{};
    ['category','category_name','categoria','categories'].forEach(k=>{const v=raw[k]; if(Array.isArray(v))v.forEach(x=>out.push(String(x))); else if(v)out.push(String(v));});
    return [...new Set(out.map(x=>x.trim()).filter(Boolean))];
  }
  const MOVEIS_PLANEJADOS_KEYS_V75 = ['marcenaria','marceneiro','moveleiro','moveis planejados','móveis planejados','movelaria','moveis sob medida','móveis sob medida','carpintaria','armarios planejados','armários planejados','cozinhas planejadas','dormitorios planejados','dormitórios planejados','moveis','móveis'];
  function isMoveisRamoV75(r){
    const hay=normalize([r?.id,r?.nome,...(Array.isArray(r?.keywords)?r.keywords:[])].join(' '));
    return hay.includes('marcenaria')||hay.includes('marceneiro')||hay.includes('moveleiro')||hay.includes('movelaria')||hay.includes('moveis planejados')||hay.includes('moveis sob medida');
  }
  function normalizeRamoDisplayV75(r){
    if(isMoveisRamoV75(r)) return {id:r?.id||'marcenaria', nome:'Móveis Planejados', keywords:[...(Array.isArray(r?.keywords)?r.keywords:[]), ...MOVEIS_PLANEJADOS_KEYS_V75]};
    return r;
  }
  function getRamosSafe(){try{return ((typeof window.getRamos==='function'?window.getRamos():getRamos())||[]).map(normalizeRamoDisplayV75);}catch(_){return [];}}
  function resolveRamo(l){
    const ramos=getRamosSafe();
    const cats=categoriesOf(l);
    const catsNorm=cats.map(normalize);
    const hay=normalize(cats.join(' '));
    if(MOVEIS_PLANEJADOS_KEYS_V75.map(normalize).some(k=>hay.includes(k)||catsNorm.includes(k))) return {id:'marcenaria', nome:'Móveis Planejados', unknown:false};
    for(const r of ramos){
      const rr=normalizeRamoDisplayV75(r);
      const keys=[rr.nome, ...(Array.isArray(rr.keywords)?rr.keywords:[])].map(normalize).filter(Boolean);
      if(keys.some(k=>hay.includes(k)||catsNorm.includes(k))) return {id:rr.id||slug(rr.nome), nome:rr.nome||cats[0]||'Geral', unknown:false};
    }
    // Segurança operacional: NUNCA criar ramo automaticamente a partir do lead_type
    // ou da categoria crua importada. Se a categoria não bate com um ramo cadastrado,
    // o lead fica marcado como fora do ramo e não pode gerar slot de imagem/disparo.
    return {id:'__fora_do_ramo__', nome:'Fora do ramo', unknown:true, raw:cats[0]||''};
  }
  function typeKey(l,r){
    const lt=normalize(r?.lead_type||l?.lead_type||l?.current_stage||'');
    const wt=normalize(l?.website_type||'');
    const web=String(l?.website||'').trim();
    if(lt.includes('aggreg')||wt.includes('aggreg')) return 'agregador';
    if(lt.includes('com')&&lt.includes('site')) return 'com-site';
    if(lt.includes('sem')&&lt.includes('site')) return 'sem-site';
    if(wt==='own_site'||web) return 'com-site';
    return 'sem-site';
  }
  function typeLabel(l,r){return ({'sem-site':'Sem site','com-site':'Com site','agregador':'Agregador'})[typeKey(l,r)]||'Sem site';}
  function imgKey(chipId,loteNum,ramoId){return `chip-${chipId}-lote-${loteNum}-ramo-${ramoId||'geral'}`;}

  function openDb(){if(_db)return Promise.resolve(_db); return new Promise((res,rej)=>{const req=indexedDB.open(IDB_NAME,1);req.onupgradeneeded=e=>{try{e.target.result.createObjectStore(IDB_STORE);}catch(_){}};req.onsuccess=e=>{_db=e.target.result;res(_db);};req.onerror=e=>rej(e.target.error);});}
  function idbGetLocal(k){if(typeof window.idbGet==='function')return window.idbGet(k);return openDb().then(db=>new Promise((res,rej)=>{const req=db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(k);req.onsuccess=e=>res(e.target.result||null);req.onerror=e=>rej(e.target.error);}));}
  function idbSetLocal(k,v){if(typeof window.idbSet==='function')return window.idbSet(k,v);return openDb().then(db=>new Promise((res,rej)=>{const req=db.transaction(IDB_STORE,'readwrite').objectStore(IDB_STORE).put(v,k);req.onsuccess=()=>res();req.onerror=e=>rej(e.target.error);}));}
  function idbDelLocal(k){if(typeof window.idbDel==='function')return window.idbDel(k);return openDb().then(db=>new Promise((res,rej)=>{const req=db.transaction(IDB_STORE,'readwrite').objectStore(IDB_STORE).delete(k);req.onsuccess=()=>res();req.onerror=e=>rej(e.target.error);}));}

  function getImage(chipId,loteNum,ramoId){return state.imgCache[imgKey(chipId,loteNum,ramoId)]||null;}
  function refreshImageNode(k,val){
    document.querySelectorAll(`[data-v73-img-key="${String(k).replace(/"/g,'\\"')}"]`).forEach(el=>{
      const box=el.closest('.v73-img-box');
      if(val){ el.src=val; el.style.display='block'; if(box)box.classList.add('has-img'); }
      else { el.removeAttribute('src'); el.style.display='none'; if(box)box.classList.remove('has-img'); }
    });
  }
  async function loadImage(chipId,loteNum,ramoId){const k=imgKey(chipId,loteNum,ramoId); if(state.imgCache[k]!==undefined)return state.imgCache[k]; try{const v=await idbGetLocal(k); state.imgCache[k]=v||null; refreshImageNode(k,v||null); return v||null;}catch(_){state.imgCache[k]=null; return null;}}
  async function onImageChange(k,input){const file=input.files&&input.files[0]; if(!file)return; const reader=new FileReader(); reader.onload=async e=>{state.imgCache[k]=e.target.result; await idbSetLocal(k,e.target.result); refreshImageNode(k,e.target.result); notify('✓ Imagem do ramo salva');}; reader.onerror=()=>notify('// erro ao ler imagem','err'); reader.readAsDataURL(file);}
  async function removeImage(k){state.imgCache[k]=null; await idbDelLocal(k); refreshImageNode(k,null); notify('✓ Imagem removida');}

  function addStyle(){if(document.getElementById('v73-fila-style'))return; const st=document.createElement('style'); st.id='v73-fila-style'; st.textContent=`
    #panel-fila-zap.v73-panel.active{display:flex!important;flex-direction:row!important;padding:0!important;overflow:hidden!important;height:100vh!important;background:var(--bg)!important;}
    #panel-fila-zap.v73-panel:not(.active){display:none!important;}
    #panel-fila-zap .zapLeft{width:50%!important;flex-shrink:0!important;height:100vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;background:var(--bg)!important;}
    #panel-fila-zap .zapLeft-inner{display:flex!important;flex-direction:column!important;height:100%!important;overflow:hidden!important;}
    #panel-fila-zap .zapLeft-body{padding:16px 20px!important;flex:1!important;display:flex!important;flex-direction:column!important;min-height:0!important;overflow:hidden!important;}
    #panel-fila-zap .zap-empresa-list{flex:1!important;overflow-y:auto!important;min-height:0!important;max-height:none!important;border-top:1px solid var(--border)!important;}
    #panel-fila-zap .zapDivider{width:1px;background:var(--border);flex-shrink:0;align-self:stretch;}
    #panel-fila-zap .zapRight{flex:1!important;height:100vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;background:var(--surface)!important;min-width:360px!important;}
    #panel-fila-zap .day-tabs,#panel-fila-zap .status-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;flex-shrink:0;}
    #panel-fila-zap .day-tab,#panel-fila-zap .status-tab{font-family:'DM Mono',monospace;font-size:9px;border:1px solid var(--border2);border-radius:999px;background:transparent;color:var(--muted);padding:7px 10px;cursor:pointer;}
    #panel-fila-zap .day-tab.active,#panel-fila-zap .status-tab.active{border-color:var(--accent);color:var(--accent);background:rgba(184,240,89,.06);}
    #panel-fila-zap .day-count,#panel-fila-zap .st-count{opacity:.75;margin-left:3px;}
    #panel-fila-zap .stats-row{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin:0 0 10px;min-height:18px;}
    #panel-fila-zap .v73-company-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;}
    #panel-fila-zap .v73-company-row:hover{background:rgba(255,255,255,.018);}
    #panel-fila-zap .v73-company-main{flex:1;min-width:0;}
    #panel-fila-zap .v73-company-name{font-weight:800;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);}
    #panel-fila-zap .v73-name-link{color:var(--text);text-decoration:none;}
    #panel-fila-zap .v73-company-meta{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;}
    #panel-fila-zap .v73-company-meta a{color:var(--muted);text-decoration:none;}
    #panel-fila-zap .v73-company-actions{display:flex;gap:4px;flex-shrink:0;align-items:center;}
    #panel-fila-zap .v73-btn{background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:8px;padding:5px 8px;cursor:pointer;text-decoration:none;white-space:nowrap;}
    #panel-fila-zap .v73-btn:hover{border-color:var(--accent);color:var(--accent);} #panel-fila-zap .v73-btn.danger{border-color:rgba(255,80,80,.55);color:#ff6b6b;} #panel-fila-zap .v73-lead-remove-row{display:flex;justify-content:flex-end;border-top:1px dashed var(--border2);padding-top:10px;margin-top:2px;}
    #panel-fila-zap .v73-chip-acc{display:flex;flex-direction:column;min-height:0;transition:flex .3s cubic-bezier(.4,0,.2,1);flex-shrink:0;border-bottom:1px solid var(--border);}
    #panel-fila-zap .v73-chip-acc.open{flex:1;flex-shrink:1;min-height:0;}
    #panel-fila-zap .v73-chip-head{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer;user-select:none;border-left:3px solid transparent;background:var(--surface);transition:background .18s,border-color .18s;flex-shrink:0;}
    #panel-fila-zap .v73-chip-head:hover,#panel-fila-zap .v73-chip-acc.open .v73-chip-head{background:var(--surface2);}
    #panel-fila-zap .v73-chip-acc.open .v73-chip-head{border-left-color:var(--accent);}
    #panel-fila-zap .v73-chev{font-size:10px;color:var(--muted);transition:transform .25s cubic-bezier(.4,0,.2,1);flex-shrink:0;}
    #panel-fila-zap .v73-chip-acc.open>.v73-chip-head .v73-chev{transform:rotate(90deg);color:var(--text2);}
    #panel-fila-zap .v73-chip-body{display:none;flex-direction:column;min-height:0;flex:1;overflow:hidden;}
    #panel-fila-zap .v73-chip-acc.open>.v73-chip-body{display:flex;}
    #panel-fila-zap .v73-chip-scroll{flex:1;overflow-y:auto;min-height:0;scroll-behavior:smooth;padding:10px 12px 80px;}
    #panel-fila-zap .fila-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px;}
    #panel-fila-zap .v73-lote{margin:0 0 10px;border-radius:10px;background:rgba(184,240,89,.045);border:1px solid rgba(184,240,89,.24);overflow:hidden;}
    #panel-fila-zap .v73-lote-head{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;user-select:none;}
    #panel-fila-zap .v73-lote-title{font-family:'DM Mono',monospace;font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--accent);}
    #panel-fila-zap .v73-lote-line{flex:1;height:1px;background:rgba(184,240,89,.24);}
    #panel-fila-zap .v73-lote-meta{font-family:'DM Mono',monospace;font-size:8px;color:var(--accent);white-space:nowrap;}
    #panel-fila-zap .v73-lote-body{display:none;border-top:1px solid rgba(184,240,89,.18);padding:10px 10px 12px;}
    #panel-fila-zap .v73-lote.open .v73-lote-body{display:block;}
    #panel-fila-zap .v73-lote.open>.v73-lote-head .v73-chev{transform:rotate(90deg);}
    #panel-fila-zap .v73-ramo-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;}
    #panel-fila-zap .v73-img-card{background:rgba(0,0,0,.18);border:1px solid var(--border2);border-radius:9px;padding:8px;min-width:0;}
    #panel-fila-zap .v73-img-title{font-family:'DM Mono',monospace;font-size:8px;color:var(--accent);font-weight:800;margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #panel-fila-zap .v73-img-box{border:2px dashed var(--border2);border-radius:8px;min-height:68px;display:flex;align-items:center;justify-content:center;background:var(--surface2);font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);cursor:pointer;position:relative;overflow:hidden;}
    #panel-fila-zap .v73-img-box.has-img{border-style:solid;border-color:rgba(78,203,113,.38);}
    #panel-fila-zap .v73-img-box img{max-width:100%;max-height:96px;object-fit:contain;border-radius:5px;display:none;}
    #panel-fila-zap .v73-img-box.has-img .v73-img-placeholder{display:none;}
    #panel-fila-zap .v73-img-remove{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:999px;border:1px solid rgba(255,80,80,.55);background:rgba(0,0,0,.72);color:var(--error);display:none;align-items:center;justify-content:center;cursor:pointer;}
    #panel-fila-zap .v73-img-box.has-img .v73-img-remove{display:flex;}
    #panel-fila-zap .v73-lead{background:var(--bg);border:1px solid var(--border2);border-radius:10px;position:relative;transition:border-color .2s;margin-bottom:6px;}
    #panel-fila-zap .v73-lead.sent{border-color:rgba(78,203,113,.35);opacity:.7;}
    #panel-fila-zap .v73-lead.error{border-color:rgba(255,92,92,.35);}
    #panel-fila-zap .v73-lead.sending{border-color:rgba(184,240,89,.35);}
    #panel-fila-zap .v73-lead-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;}
    #panel-fila-zap .v73-lead-head:hover{background:rgba(255,255,255,.02);}
    #panel-fila-zap .v73-lead-index{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);min-width:22px;}
    #panel-fila-zap .v73-lead-main{min-width:0;}
    #panel-fila-zap .v73-lead-name{font-weight:800;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);}
    #panel-fila-zap .v73-lead-phone{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);margin-top:4px;}
    #panel-fila-zap .v73-lead-badges{display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0;}
    #panel-fila-zap .v73-badge{font-family:'DM Mono',monospace;font-size:8px;padding:3px 7px;border-radius:100px;border:1px solid var(--border2);color:var(--muted);white-space:nowrap;}
    #panel-fila-zap .v73-badge.ramo{color:var(--accent);border-color:rgba(184,240,89,.38);}
    #panel-fila-zap .v73-badge.tipo{color:#5bb8f5;border-color:rgba(91,184,245,.35);}
    #panel-fila-zap .v73-badge.queue{color:var(--accent);border-color:rgba(184,240,89,.38);}
    #panel-fila-zap .v73-badge.sent{color:var(--ok);border-color:rgba(78,203,113,.38);}
    #panel-fila-zap .v73-badge.error{color:var(--error);border-color:rgba(255,80,80,.38);} #panel-fila-zap .v73-badge.ramo.unknown{color:var(--error);border-color:rgba(255,80,80,.55);background:rgba(255,80,80,.06);} #panel-fila-zap .v73-lote-warn{border:1px solid rgba(255,80,80,.35);background:rgba(255,80,80,.055);color:var(--error);border-radius:10px;padding:9px 11px;margin-bottom:10px;font-family:'DM Mono',monospace;font-size:9px;line-height:1.5}
    #panel-fila-zap .v73-lead-body{padding:0 14px 14px;display:none;flex-direction:column;gap:10px;}
    #panel-fila-zap .v73-lead.open .v73-lead-body{display:flex;}
    #panel-fila-zap .v73-msg-box{background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);white-space:pre-wrap;line-height:1.7;max-height:130px;overflow-y:auto;border:1px solid var(--border2);}
    #panel-fila-zap .v73-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
    #panel-fila-zap .v73-info{background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:8px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);}
    #panel-fila-zap .v73-info b{display:block;color:var(--muted);font-size:7px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;}
    @media(max-width:900px){#panel-fila-zap.v73-panel.active{flex-direction:column!important;height:auto!important}.zapLeft,.zapRight{width:100%!important;min-width:0!important;height:auto!important}.zapDivider{display:none!important}.v73-lead-head{grid-template-columns:auto minmax(0,1fr)!important}.v73-lead-badges{grid-column:2;justify-content:flex-start!important;flex-wrap:wrap}.v73-info-grid{grid-template-columns:1fr!important}}
  `; document.head.appendChild(st);}

  async function fetchData(){
    const c=sb(); if(!c) return {items:[],chips:[],error:new Error('Supabase indisponível')};
    const statuses=['ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled','sending','sent','enviado','paused','error','erro','failed'];
    const itemQ=c.from('pre_dispatch_items').select('id,lead_id,user_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,raw_payload,updated_at').eq('user_id',uid()).in('status',statuses).order('scheduled_date',{ascending:true}).order('chip_label',{ascending:true}).order('position',{ascending:true});
    const chipQ=c.from('whatsapp_instances').select('id,chip_id,label,name,instance,status,connection_state,active,daily_limit,block_size,interval_seconds').eq('user_id',uid()).order('label',{ascending:true});
    const [it,ch]=await Promise.all([itemQ,chipQ]);
    if(it.error) return {items:[],chips:[],error:it.error};
    const rows=it.data||[];
    const ids=[...new Set(rows.map(r=>r.lead_id).filter(Boolean))];
    const leads={};
    if(ids.length){const {data,error}=await c.from('leads').select('id,company_name,phone,normalized_phone,website,website_type,current_stage,lead_type,city,state,rating,reviews_count,category,category_name,categories,maps_url,raw_payload').eq('user_id',uid()).in('id',ids); if(error)console.warn('[v73][fila-leads]',error.message); (data||[]).forEach(l=>leads[l.id]=l);}
    const chips=(ch.data||[]).filter(x=>x.active!==false && x.instance);
    const finalRows=rows.filter(r=>{
      const st=String(r.status||'').toLowerCase();
      const l=leads[r.lead_id]||{};
      const stage=String(l.current_stage||'').toLowerCase();
      // A Fila WhatsApp só mostra o que foi enviado para a fila final.
      // No fluxo atual, o botão "Enviar aprovados para fila final" marca o lead como dispatch_queue.
      if(st==='ready_to_dispatch') return stage==='dispatch_queue';
      return ['queued','dispatch_queue','not_sent','waiting','scheduled','sending','sent','enviado','paused','error','erro','failed'].includes(st) && stage==='dispatch_queue';
    });
    finalRows.forEach(r=>{if(!chips.some(ch=>chipKey(ch)===rowChipKey(r)||chipTitle(ch)===rowChipTitle(r))) chips.push({id:rowChipKey(r)||rowChipTitle(r),instance:rowChipKey(r),label:rowChipTitle(r),daily_limit:120,block_size:60,active:true});});
    const items=finalRows.map(r=>({...r,lead:leads[r.lead_id]||{}}));
    return {items,chips,error:ch.error||null};
  }

  function statusTabs(rows){const sts=['queue','sent','error']; return sts.map(st=>{const cnt=rows.filter(r=>statusKey(r.status)===st).length; const label=statusLabel(st); return `<button class="status-tab ${state.status===st?'active':''}" onclick="setFilaZapStatusV74('${esc(st)}')">${esc(label)} <span class="st-count">${cnt}</span></button>`;}).join('');}
  function dateTabs(rows){const dates=[...new Set([...weekDates(),...rows.map(r=>r.scheduled_date).filter(Boolean)])].sort(); if(!state.date||!dates.includes(state.date)) state.date=dates.includes(todayIso())?todayIso():(dates[0]||todayIso()); return dates.map(d=>`<button class="day-tab ${state.date===d?'active':''}" onclick="setFilaZapDateV73('${esc(d)}')">${esc(dayLabel(d))}${d===todayIso()?' <span style="color:var(--accent);font-size:8px">●</span>':''} <span class="day-count">${rows.filter(r=>r.scheduled_date===d).length}</span></button>`).join('');}
  function filteredRows(rows){return rows.filter(r=>{if(state.date&&r.scheduled_date!==state.date)return false; if(state.status&&statusKey(r.status)!==state.status)return false; return true;});}

  function renderCompanyRow(r){const l=r.lead||{}; const phone=leadPhone(l); const web=String(l.website||'').trim(); const st=statusKey(r.status); const ramo=resolveRamo(l); return `<div class="v73-company-row"><div class="v73-company-main"><div class="v73-company-name">${leadLinkHtml(l)}</div><div class="v73-company-meta">${phone?`<span style="color:var(--ok)">📱 +${esc(phone)}</span>`:'<span style="color:var(--error)">sem WhatsApp</span>'}${web?`<a href="${esc(cleanUrl(web))}" target="_blank" rel="noopener">${esc(host(web))}</a>`:''}<span>${esc(rowChipTitle(r))}</span><span>${esc(ramo.nome)}</span></div></div><div class="v73-company-actions"><button class="v73-btn" onclick="openLeadDrawer('${esc(r.lead_id||l.id||'')}')">Ficha</button>${phone?`<button class="v73-btn" onclick="openWaV73('${esc(phone)}')">WA</button>`:''}<span class="v73-badge ${st}">${esc(statusLabel(r.status))}</span></div></div>`;}

  function ramoSlotsHtml(ch,loteNum,lote){
    const chipId=chipRef(ch);
    const map=new Map();
    let unknownCount=0;
    lote.forEach(r=>{const ramo=resolveRamo(r.lead||{}); if(ramo.unknown){unknownCount++; return;} if(!map.has(ramo.id))map.set(ramo.id,ramo);});
    const warn=unknownCount?`<div class="v73-lote-warn">⚠ ${unknownCount} lead(s) fora dos ramos cadastrados neste lote. Eles não geram imagem e o disparo será bloqueado até corrigir/remover.</div>`:'';
    const slots=`<div class="v73-ramo-images">${[...map.values()].map(ramo=>{
      const k=imgKey(chipId,loteNum,ramo.id); const img=state.imgCache[k]||null; if(state.imgCache[k]===undefined) setTimeout(()=>loadImage(chipId,loteNum,ramo.id),0);
      const inp=`v73-img-${slug(k)}`;
      return `<div class="v73-img-card"><div class="v73-img-title">${esc(ramo.nome)}</div><div class="v73-img-box ${img?'has-img':''}" onclick="document.getElementById('${esc(inp)}').click()"><img data-v73-img-key="${esc(k)}" src="${img?esc(img):''}" style="${img?'display:block':'display:none'}"/><span class="v73-img-placeholder">📎 selecionar imagem</span><button class="v73-img-remove" onclick="event.stopPropagation();removeLoteRamoImgV73('${esc(k)}')">×</button></div><input id="${esc(inp)}" type="file" accept="image/*" style="display:none" onchange="onLoteRamoImgChangeV73('${esc(k)}',this)"></div>`;
    }).join('')}</div>`;
    return warn+slots;
  }

  function renderLead(r,idx,ch,loteNum){
    const l=r.lead||{}; const phone=leadPhone(l); const st=statusKey(r.status); const exp=!!state.expanded[r.id]; const ramo=resolveRamo(l); const tipo=typeLabel(l,r); const msg1=getMsg(r,1); const msg2=getMsg(r,2); const web=String(l.website||'').trim(); const cls=st==='sent'?'sent':st==='error'?'error':ramo.unknown?'error':'';
    const ramoBadge=`<span class="v73-badge ramo ${ramo.unknown?'unknown':''}">${esc(ramo.nome)}</span>`;
    return `<div class="v73-lead ${cls} ${exp?'open':''}" id="fila-item-v73-${esc(r.id)}" data-v73-lead-id="${esc(r.id)}"><div class="v73-lead-head" onclick="toggleFilaItemV74('${esc(r.id)}')"><div class="v73-lead-index">${idx}</div><div class="v73-lead-main"><div class="v73-lead-name">${leadLinkHtml(l)}</div><div class="v73-lead-phone">${phone?`+${esc(phone)}`:'sem WhatsApp'}</div></div><div class="v73-lead-badges">${ramoBadge}<span class="v73-badge tipo">${esc(tipo)}</span><span class="v73-badge ${st}">${esc(statusLabel(r.status))}</span><span class="v73-chev" style="transform:rotate(${exp?'90':'0'}deg)">▶</span></div></div><div class="v73-lead-body"><div><div class="v73-tool-title">① MENSAGEM 1</div><div class="v73-msg-box">${esc(ramo.unknown?'Lead fora dos ramos cadastrados. Não disparar até corrigir a subcategoria/ramo.':(msg1||'Mensagem 1 será aplicada pelo template do ramo e tipo do lead.'))}</div></div><div><div class="v73-tool-title">② MENSAGEM 2</div><div class="v73-msg-box">${esc(ramo.unknown?'Lead bloqueado para segurança operacional.':(msg2||'Mensagem 2 será aplicada pelo template do ramo e tipo do lead.'))}</div></div><div class="v73-info-grid"><div class="v73-info"><b>Imagem usada</b>${esc(ramo.unknown?'Bloqueado — fora do ramo':ramo.nome)}</div><div class="v73-info"><b>Tipo</b>${esc(tipo)}</div>${web?`<div class="v73-info"><b>Site</b>${esc(host(web))}</div>`:''}<div class="v73-info"><b>Status</b>${esc(statusLabel(r.status))}</div></div><div class="v73-lead-remove-row"><button class="v73-btn danger" onclick="event.stopPropagation();removerLeadFilaFinalV87('${esc(r.id)}','${esc(r.lead_id||l.id||'')}','${esc(typeKey(l,r))}')">Remover da fila</button></div></div></div>`;
  }

  function renderLotes(list,ch){
    if(!list.length)return '<div class="fila-empty">// nenhum lead neste chip</div>';
    const size=blockSize(ch); let html='';
    for(let i=0;i<list.length;i+=size){
      const lote=list.slice(i,i+size); const n=Math.floor(i/size)+1; const loteId=`${chipRef(ch)}-${state.date}-${n}`; if(state.lotes[loteId]===undefined)state.lotes[loteId]=n===1; const open=!!state.lotes[loteId];
      const sent=lote.filter(r=>statusKey(r.status)==='sent').length; const err=lote.filter(r=>statusKey(r.status)==='error').length; const pending=lote.length-sent-err; const resolved=lote.map(r=>resolveRamo(r.lead||{})); const ramos=[...new Set(resolved.filter(x=>!x.unknown).map(x=>x.nome))]; const fora=resolved.filter(x=>x.unknown).length; const complete=lote.length>=size;
      html+=`<div class="v73-lote ${open?'open':''}" data-v73-lote-id="${esc(loteId)}"><div class="v73-lote-head" onclick="toggleLoteV74('${esc(loteId)}')"><span class="v73-chev">▶</span><span class="v73-lote-title">LOTE ${n} — #${i+1}–${i+lote.length}</span><span class="v73-lote-line"></span><span class="v73-lote-meta">${lote.length} leads · ${sent} enviados · ${pending} pendentes · ${err} erros · ${ramos.length} ramo${ramos.length!==1?'s':''}${fora?` · ⚠ ${fora} fora do ramo`:''} · ${complete?'✓ completo':`${size-lote.length} restantes`}</span></div><div class="v73-lote-body">${ramoSlotsHtml(ch,n,lote)}${lote.map((r,j)=>renderLead(r,i+j+1,ch,n)).join('')}</div></div>`;
    }
    return html;
  }

  function chipMatches(ch,r){const key=chipKey(ch), title=chipTitle(ch); return rowChipKey(r)===key||rowChipTitle(r)===title||rowChipKey(r)===title||rowChipTitle(r)===key;}
  function renderChips(data,byDate){
    const chips=data.chips||[]; if(!chips.length)return '<div class="fila-empty">// nenhum chip ativo</div>'; if(!state.chipOpen)state.chipOpen=chipKey(chips[0]);
    return chips.map((ch,idx)=>{const key=chipKey(ch); const title=chipTitle(ch); const list=byDate.filter(r=>chipMatches(ch,r)); const open=state.chipOpen===key||state.chipOpen===title||(!state.chipOpen&&idx===0); const limit=dailyLimit(ch); const sent=list.filter(r=>statusKey(r.status)==='sent').length; const err=list.filter(r=>statusKey(r.status)==='error').length; const lotes=Math.ceil(list.length/blockSize(ch)); return `<div class="v73-chip-acc ${open?'open':''}" id="chipAccordionV73-${idx}"><div class="v73-chip-head" onclick="setFilaZapChipOpenV73('${esc(open?'':key)}')"><span class="v73-chev">▶</span><div style="flex:1;min-width:0"><div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:900;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div><div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:2px">${esc(ch.instance||ch.chip_id||ch.name||'')} · ${lotes} lote${lotes!==1?'s':''} · ${sent} enviados · ${err} erros</div></div><div style="font-family:'DM Mono',monospace;font-size:9px;color:${list.length>=limit?'var(--error)':'var(--muted)'}">${list.length}/${limit}</div></div><div class="v73-chip-body"><div class="v73-chip-scroll">${renderLotes(list,ch)}</div></div></div>`;}).join('');
  }


  async function removerLeadFilaFinalV87(itemId,leadId,tipo){
    if(!itemId)return;
    const ok=confirm('Remover este lead da fila final? Ele sairá do lote e voltará para Atribuição para revisão.');
    if(!ok)return;
    const c=sb(); if(!c)return notify('Supabase indisponível.','err');
    const now=new Date().toISOString();
    const {error}=await c.from('pre_dispatch_items').update({status:'removed_from_queue',updated_at:now}).eq('user_id',uid()).eq('id',itemId);
    if(error)return notify('Erro ao remover da fila: '+error.message,'err');
    if(leadId){
      const t=String(tipo||'').toLowerCase();
      const stage=t.includes('agreg')?'attribution_aggregator':(t.includes('com')?'attribution_site':'attribution_whatsapp');
      try{await c.from('leads').update({current_stage:stage,status:'attribution',updated_at:now}).eq('user_id',uid()).eq('id',leadId);}catch(e){console.warn('[v87][remove lead stage]',e?.message||e);}
    }
    notify('Lead removido da fila e devolvido para Atribuição.');
    await renderFilaZapV73();
  }

  async function setStatus(id,st){const c=sb(); if(!c)return; const db=statusDb(st); const {error}=await c.from('pre_dispatch_items').update({status:db,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',id); if(error)return notify('Erro ao atualizar: '+error.message,'err'); await renderFilaZapV73();}

  async function renderFilaZapV73(){
    addStyle(); const panel=document.getElementById('panel-fila-zap'); if(!panel)return;
    document.querySelectorAll('.panel').forEach(p=>{const on=p.id==='panel-fila-zap';p.classList.toggle('active',on); if(p.id==='panel-fila-zap') p.style.display='flex'; else p.style.display='';});
    panel.classList.add('v73-panel'); panel.classList.remove('v72-panel');
    panel.innerHTML=`<div class="zapLeft"><div class="zapLeft-inner"><div class="page-header" style="flex-shrink:0;padding:20px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// carregando...</div></div></div></div><div class="zapDivider"></div><div class="zapRight"><div class="fila-empty">// carregando chips...</div></div>`;
    const data=await fetchData(); state.last=data;
    if(data.error){panel.innerHTML=`<div class="page-header"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" style="color:var(--error)">// erro: ${esc(data.error.message)}</div></div>`; return;}
    const rows=data.items||[]; dateTabs(rows); const byDate=rows.filter(r=>r.scheduled_date===state.date); const selected=filteredRows(rows); const total=byDate.length; const queued=byDate.filter(r=>statusKey(r.status)==='queue').length; const sent=byDate.filter(r=>statusKey(r.status)==='sent').length; const err=byDate.filter(r=>statusKey(r.status)==='error').length;
    const left=`<div class="zapLeft"><div class="zapLeft-inner"><div class="page-header" style="flex-shrink:0;padding:20px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" id="filaZapSub">// ${rows.length} lead(s) na fila final · lotes por configuração · imagem por ramo</div></div><div class="zapLeft-body"><div class="card-title" style="flex-shrink:0">Selecionar empresas <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;margin-left:4px">— visão do dia e status</span></div><div class="day-tabs">${dateTabs(rows)}</div><div class="status-tabs">${statusTabs(byDate)}</div><div class="stats-row"><span>${total} leads · <span style="color:var(--accent)">${queued} em fila</span> · <span style="color:var(--ok)">${sent} enviadas</span> · <span style="color:var(--error)">${err} erros</span></span></div><div class="stretch-list zap-empresa-list">${selected.length?selected.map(renderCompanyRow).join(''):`<div class="fila-empty">// nenhuma empresa neste filtro</div>`}</div></div></div></div>`;
    const right=`<div class="zapRight">${renderChips(data,byDate)}</div>`;
    panel.innerHTML=left+`<div class="zapDivider"></div>`+right;
    const badge=document.getElementById('badge-fila-zap'); if(badge)badge.textContent=String(rows.filter(r=>statusKey(r.status)==='queue').length);
  }

  function setDate(d){state.date=d;renderFilaZapV73();}
  function setSt(s){state.status=s||'queue';renderFilaZapV73();}
  function setOpen(k){state.chipOpen=k||null;renderFilaZapV73();}
  function toggleItem(id){state.expanded[id]=!state.expanded[id]; const el=document.querySelector(`[data-v73-lead-id="${String(id).replace(/\"/g,'\\"')}"]`); if(el){el.classList.toggle('open',!!state.expanded[id]); const chev=el.querySelector('.v73-lead-head .v73-chev'); if(chev)chev.style.transform=`rotate(${state.expanded[id]?'90':'0'}deg)`; return;} renderFilaZapV73();}
  function toggleLote(id){state.lotes[id]=!state.lotes[id]; const el=document.querySelector(`[data-v73-lote-id="${String(id).replace(/\"/g,'\\"')}"]`); if(el){el.classList.toggle('open',!!state.lotes[id]); return;} renderFilaZapV73();}
  function openWa(phone){const p=normPhone(phone); if(p)window.open(`https://wa.me/${p}`,'_blank','noopener,noreferrer');}

  window.renderFilaZap=renderFilaZapV73; window.renderFilaZapV73=renderFilaZapV73; window.renderFilaZapV74=renderFilaZapV73;
  window.setFilaZapDateV73=setDate; window.setFilaZapStatusV73=setSt; window.setFilaZapChipOpenV73=setOpen; window.toggleFilaItemV73=toggleItem; window.toggleLoteV73=toggleLote;
  window.setFilaZapDateV74=setDate; window.setFilaZapStatusV74=setSt; window.setFilaZapChipOpenV74=setOpen; window.toggleFilaItemV74=toggleItem; window.toggleLoteV74=toggleLote;
  window.openWaV73=openWa; window.setZapStatusV73=setStatus; window.removerLeadFilaFinalV87=removerLeadFilaFinalV87; window.onLoteRamoImgChangeV73=onImageChange; window.removeLoteRamoImgV73=removeImage;
  window.getLoteImagemPorRamoV73=function(chipId,loteNum,ramoId){return getImage(chipId,loteNum,ramoId);};
  window.loadLoteImagemPorRamoV73=function(chipId,loteNum,ramoId){return loadImage(chipId,loteNum,ramoId);};
  window.resolveLeadParentRamoV73=resolveRamo;
  // Lead Certo v139: Fila WhatsApp não sobrescreve switchPanel.
  // O router chama renderFilaZapV73 quando a rota fila-zap é aberta.
  document.addEventListener('click',function(e){const nav=e.target.closest?.('.nav-item[data-label]'); if(!nav)return; if((nav.getAttribute('data-label')||'')!=='WhatsApp')return; e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation(); renderFilaZapV73();},true);
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{try{if(document.getElementById('panel-fila-zap')?.classList.contains('active'))renderFilaZapV73();}catch(_){}},700));
  window.__V74_FILA_WHATSAPP_STATUS_LOTES_CONFIG_SEM_PISCAR__=VERSION;
  window.__V77_FILA_FINAL_NAV_CONFIG__=VERSION;
  window.__V78_FILA_FINAL_REAL_NAV_OK__=VERSION;
})();
