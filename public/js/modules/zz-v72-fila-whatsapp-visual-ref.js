/* V72 — Fila WhatsApp visual baseada no arquivo redirect 9b7bb...
   - Apenas visual/renderização da Fila WhatsApp.
   - Não altera Supabase, disparo, validação, chips, QR, conversas ou pré-envio.
   - Usa pre_dispatch_items + leads + whatsapp_instances, preservando DB-first. */
(function(){
  'use strict';
  const VERSION='20260618-V72-FILA-WHATSAPP-VISUAL-REF';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const state={date:null,status:'all',chipOpen:null,expanded:{},last:null};

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
  function rowChipKey(r){return String(r?.chip_instance||r?.chip_label||'').trim();}
  function rowChipTitle(r){return String(r?.chip_label||r?.chip_instance||'Chip').trim();}
  function leadName(l){return l?.company_name||l?.nome||l?.title||'Lead';}
  function leadPhone(l){return normPhone(l?.normalized_phone||l?.phone||l?.whatsapp||l?.telefone||'');}
  function mapsUrl(l){return cleanUrl(l?.maps_url||l?.googleUrl||l?.mapsUrl||'');}
  function statusKey(s){const raw=String(s||'').toLowerCase(); if(['ready_to_dispatch','not_sent','waiting','review','approved','nao_enviada','pending','scheduled'].includes(raw))return 'ready'; if(['queued','em_fila','dispatch_queue'].includes(raw))return 'queued'; if(['sent','enviado','enviada'].includes(raw))return 'sent'; if(['responded','respondida'].includes(raw))return 'responded'; if(['no_response','not_responded','nao_respondida'].includes(raw))return 'no_response'; if(['rejected','refused','recusada'].includes(raw))return 'rejected'; if(['closed','fechada'].includes(raw))return 'closed'; if(['error','erro','dispatch_error'].includes(raw))return 'error'; return 'ready';}
  function statusLabel(s){return ({ready:'Não enviada',queued:'Em fila',sent:'Enviada',responded:'Respondida',no_response:'Não respondida',rejected:'Recusada',closed:'Fechada',error:'Erro'})[statusKey(s)]||'Não enviada';}
  function statusDb(s){return ({ready:'ready_to_dispatch',queued:'queued',sent:'sent',error:'error',responded:'responded',no_response:'no_response',rejected:'rejected',closed:'closed'})[s]||s;}
  function loteNum(r){return Math.floor((Number(r?.position||1)-1)/30)+1;}
  function leadLinkHtml(l){const m=mapsUrl(l);const name=esc(leadName(l));return m?`<a href="${esc(m)}" target="_blank" rel="noopener" class="v72-name-link">${name}</a>`:name;}
  function getMsg(r,n){const raw=r.raw_payload||{}; const l=r.lead||{}; return raw[`message_${n}`]||raw[`mensagem${n}`]||raw[`msg${n}`]||l[`message_${n}`]||l[`mensagem${n}`]||'';}
  function classifyType(l){const w=String(l.website||'').trim(); const wt=String(l.website_type||'').trim(); if(wt==='aggregator')return 'Agregador'; if(wt==='own_site'||w)return 'Com site'; return 'Sem site';}

  function addStyle(){if(document.getElementById('v72-fila-style'))return; const st=document.createElement('style'); st.id='v72-fila-style'; st.textContent=`
    #panel-fila-zap.v72-panel{display:flex!important;flex-direction:row!important;padding:0!important;overflow:hidden!important;height:100vh!important;background:var(--bg)!important;}
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
    #panel-fila-zap .v72-company-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px;}
    #panel-fila-zap .v72-company-row:hover{background:rgba(255,255,255,.018);}
    #panel-fila-zap .v72-company-main{flex:1;min-width:0;}
    #panel-fila-zap .v72-company-name{font-weight:800;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);}
    #panel-fila-zap .v72-name-link{color:var(--text);text-decoration:none;}
    #panel-fila-zap .v72-company-meta{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;}
    #panel-fila-zap .v72-company-meta a{color:var(--muted);text-decoration:none;}
    #panel-fila-zap .v72-company-actions{display:flex;gap:4px;flex-shrink:0;align-items:center;}
    #panel-fila-zap .v72-btn{background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:8px;padding:5px 8px;cursor:pointer;text-decoration:none;white-space:nowrap;}
    #panel-fila-zap .v72-btn:hover{border-color:var(--accent);color:var(--accent);}
    #panel-fila-zap .v72-btn.primary{background:var(--accent);border-color:var(--accent);color:#111;font-weight:900;}
    #panel-fila-zap .v72-status{font-family:'DM Mono',monospace;font-size:8px;padding:4px 7px;border-radius:999px;border:1px solid var(--border2);color:var(--muted);white-space:nowrap;}
    #panel-fila-zap .v72-status.ready{color:var(--accent);border-color:rgba(184,240,89,.38)}
    #panel-fila-zap .v72-status.queued{color:#4ab3ff;border-color:rgba(74,179,255,.38)}
    #panel-fila-zap .v72-status.sent,#panel-fila-zap .v72-status.responded,#panel-fila-zap .v72-status.closed{color:var(--ok);border-color:rgba(78,203,113,.38)}
    #panel-fila-zap .v72-status.error,#panel-fila-zap .v72-status.rejected{color:var(--error);border-color:rgba(255,80,80,.38)}
    #panel-fila-zap .chip-accordion{display:flex;flex-direction:column;min-height:0;transition:flex .3s cubic-bezier(.4,0,.2,1);flex-shrink:0;border-bottom:1px solid var(--border);}
    #panel-fila-zap .chip-accordion.open{flex:1;flex-shrink:1;min-height:0;}
    #panel-fila-zap .chip-accordion-header{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer;user-select:none;border-left:3px solid transparent;background:var(--surface);transition:background .18s,border-color .18s;flex-shrink:0;}
    #panel-fila-zap .chip-accordion-header:hover,#panel-fila-zap .chip-accordion.open .chip-accordion-header{background:var(--surface2);}
    #panel-fila-zap .chip-accordion.open .chip-accordion-header{border-left-color:var(--accent);}
    #panel-fila-zap .chip-accordion-chevron{font-size:10px;color:var(--muted);transition:transform .25s cubic-bezier(.4,0,.2,1);flex-shrink:0;}
    #panel-fila-zap .chip-accordion.open .chip-accordion-chevron{transform:rotate(90deg);color:var(--text2);}
    #panel-fila-zap .chip-accordion-body{display:none;flex-direction:column;min-height:0;flex:1;overflow:hidden;}
    #panel-fila-zap .chip-accordion.open .chip-accordion-body{display:flex;}
    #panel-fila-zap .chip-fila-scroll{flex:1;overflow-y:auto;min-height:0;scroll-behavior:smooth;padding:10px 12px 80px;}
    #panel-fila-zap .fila-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px;}
    #panel-fila-zap .v72-lote{margin:0 0 10px;border-radius:8px;background:rgba(184,240,89,.05);border:1px solid rgba(184,240,89,.24);overflow:hidden;}
    #panel-fila-zap .v72-lote-head{display:flex;align-items:center;gap:10px;padding:7px 12px;}
    #panel-fila-zap .v72-lote-title{font-family:'DM Mono',monospace;font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--accent);}
    #panel-fila-zap .v72-lote-line{flex:1;height:1px;background:rgba(184,240,89,.24);}
    #panel-fila-zap .v72-lote-ok{font-family:'DM Mono',monospace;font-size:8px;color:var(--accent);}
    #panel-fila-zap .v72-lote-tools{display:flex;align-items:flex-start;gap:10px;padding:0 12px 10px;border-top:1px solid rgba(184,240,89,.18);}
    #panel-fila-zap .v72-tool-title{font-family:'DM Mono',monospace;font-size:7px;letter-spacing:.1em;color:var(--muted);margin:8px 0 4px;}
    #panel-fila-zap .v72-lote-select{background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:5px 8px;width:100%;outline:none;}
    #panel-fila-zap .v72-img-box{border:2px dashed var(--border2);border-radius:8px;min-height:58px;display:flex;align-items:center;justify-content:center;background:var(--surface2);font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);min-width:132px;}
    #panel-fila-zap .fila-item{background:var(--bg);border:1px solid var(--border2);border-radius:10px;position:relative;transition:border-color .2s;margin-bottom:6px;}
    #panel-fila-zap .fila-item.enviado{border-color:rgba(78,203,113,.35);opacity:.62;}
    #panel-fila-zap .fila-item.erro{border-color:rgba(255,92,92,.35);}
    #panel-fila-zap .fila-item.enviando{border-color:rgba(184,240,89,.35);}
    #panel-fila-zap .fila-item-header{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;}
    #panel-fila-zap .fila-item-header:hover{background:rgba(255,255,255,.02);}
    #panel-fila-zap .fila-item-num{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);min-width:18px;}
    #panel-fila-zap .fila-item-nome{font-weight:700;font-size:12px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #panel-fila-zap .fila-item-wa{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);}
    #panel-fila-zap .fila-item-status{font-family:'DM Mono',monospace;font-size:8px;padding:2px 7px;border-radius:100px;border:1px solid var(--border2);color:var(--muted);}
    #panel-fila-zap .fila-item-body{padding:0 14px 14px;display:flex;flex-direction:column;gap:10px;}
    #panel-fila-zap .fila-msg-area{background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);white-space:pre-wrap;line-height:1.7;max-height:110px;overflow-y:auto;border:1px solid var(--border2);}
    @media(max-width:900px){#panel-fila-zap.v72-panel{flex-direction:column!important;height:auto!important}.zapLeft,.zapRight{width:100%!important;min-width:0!important;height:auto!important}.zapDivider{display:none!important}}
  `; document.head.appendChild(st);}

  async function fetchData(){
    const c=sb(); if(!c) return {items:[],chips:[],error:new Error('Supabase indisponível')};
    const statuses=['approved','ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','pending','scheduled','sent','enviado','responded','respondida','not_responded','nao_respondida','refused','recusada','rejected','closed','fechada','error','erro','no_response'];
    const itemQ=c.from('pre_dispatch_items').select('id,lead_id,user_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,raw_payload,updated_at').eq('user_id',uid()).in('status',statuses).order('scheduled_date',{ascending:true}).order('chip_label',{ascending:true}).order('position',{ascending:true});
    const chipQ=c.from('whatsapp_instances').select('id,chip_id,label,name,instance,status,connection_state,active,daily_limit,block_size,interval_seconds').eq('user_id',uid()).order('label',{ascending:true});
    const [it,ch]=await Promise.all([itemQ,chipQ]);
    if(it.error) return {items:[],chips:[],error:it.error};
    const rows=it.data||[];
    const ids=[...new Set(rows.map(r=>r.lead_id).filter(Boolean))];
    const leads={};
    if(ids.length){const {data,error}=await c.from('leads').select('id,company_name,phone,normalized_phone,website,website_type,current_stage,lead_type,city,state,rating,reviews_count,category,category_name,categories,maps_url,raw_payload').eq('user_id',uid()).in('id',ids); if(error)console.warn('[v72][fila-leads]',error.message); (data||[]).forEach(l=>leads[l.id]=l);}
    const chips=(ch.data||[]).filter(x=>x.active!==false && x.instance);
    rows.forEach(r=>{if(!chips.some(ch=>chipKey(ch)===rowChipKey(r)||chipTitle(ch)===rowChipTitle(r))) chips.push({id:rowChipKey(r)||rowChipTitle(r),instance:rowChipKey(r),label:rowChipTitle(r),daily_limit:120,active:true});});
    return {items:rows.map(r=>({...r,lead:leads[r.lead_id]||{}})),chips,error:ch.error||null};
  }

  function statusTabs(rows){const sts=['all','ready','queued','sent','responded','no_response','rejected','closed','error']; return sts.map(st=>{const cnt=st==='all'?rows.length:rows.filter(r=>statusKey(r.status)===st).length; const label=st==='all'?'Todos':statusLabel(st); return `<button class="status-tab ${state.status===st?'active':''}" onclick="setFilaZapStatusV72('${esc(st)}')">${esc(label)} <span class="st-count">${cnt}</span></button>`;}).join('');}
  function dateTabs(rows){const dates=[...new Set([...weekDates(),...rows.map(r=>r.scheduled_date).filter(Boolean)])].sort(); if(!state.date||!dates.includes(state.date)) state.date=dates.includes(todayIso())?todayIso():(dates[0]||todayIso()); return dates.map(d=>`<button class="day-tab ${state.date===d?'active':''}" onclick="setFilaZapDateV72('${esc(d)}')">${esc(dayLabel(d))}${d===todayIso()?' <span style="color:var(--accent);font-size:8px">●</span>':''} <span class="day-count">${rows.filter(r=>r.scheduled_date===d).length}</span></button>`).join('');}
  function filteredRows(rows){return rows.filter(r=>{if(state.date&&r.scheduled_date!==state.date)return false; if(state.status!=='all'&&statusKey(r.status)!==state.status)return false; return true;});}

  function renderCompanyRow(r){const l=r.lead||{}; const phone=leadPhone(l); const web=String(l.website||'').trim(); const status=statusKey(r.status); return `<div class="v72-company-row"><div class="v72-company-main"><div class="v72-company-name">${leadLinkHtml(l)}</div><div class="v72-company-meta">${phone?`<span style="color:var(--ok)">📱 +${esc(phone)}</span>`:'<span style="color:var(--error)">sem WhatsApp</span>'}${web?`<a href="${esc(cleanUrl(web))}" target="_blank" rel="noopener">${esc(host(web))}</a>`:''}<span>${esc(rowChipTitle(r))}</span><span>Lote ${loteNum(r)}</span></div></div><div class="v72-company-actions"><button class="v72-btn" onclick="openLeadDrawer('${esc(r.lead_id||l.id||'')}')">Ficha</button>${phone?`<button class="v72-btn" onclick="openWaV72('${esc(phone)}')">WA</button>`:''}<span class="v72-status ${status}">${esc(statusLabel(r.status))}</span></div></div>`;}

  function renderFilaItem(r,idx){const l=r.lead||{}; const phone=leadPhone(l); const status=statusKey(r.status); const exp=!!state.expanded[r.id]; const cls=status==='sent'?'enviado':status==='error'?'erro':status==='queued'?'enviando':''; const msg1=getMsg(r,1); const msg2=getMsg(r,2); return `<div class="fila-item ${cls}" id="fila-item-v72-${esc(r.id)}"><div class="fila-item-header" onclick="toggleFilaItemV72('${esc(r.id)}')"><div class="fila-item-num">${idx}</div><div class="fila-item-nome">${leadLinkHtml(l)}</div><div class="fila-item-wa">${phone?`+${esc(phone)}`:'sem zap'}</div><div class="fila-item-status ${status}">${esc(statusLabel(r.status))}</div><div style="color:var(--muted);font-size:12px;margin-left:4px;transition:transform .2s;transform:rotate(${exp?'90':'0'}deg)">▶</div></div>${exp?`<div class="fila-item-body"><div><div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">① MENSAGEM 1</div><div class="fila-msg-area">${esc(msg1||'Mensagem 1 será aplicada pelo template do lote.')}</div></div><div><div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">② MENSAGEM 2</div><div class="fila-msg-area">${esc(msg2||'Mensagem 2 será aplicada pelo template do lote.')}</div></div></div>`:''}</div>`;}

  function renderLotes(list){if(!list.length)return '<div class="fila-empty">// nenhum lead neste chip</div>'; let html=''; for(let i=0;i<list.length;i+=30){const lote=list.slice(i,i+30); const n=Math.floor(i/30)+1; const complete=lote.length>=30; html+=`<div class="v72-lote"><div class="v72-lote-head"><span class="v72-lote-title">LOTE ${n} — #${i+1}–${i+lote.length}</span><span class="v72-lote-line"></span><span class="v72-lote-ok">${complete?'✓ completo':`${30-lote.length} restantes`}</span></div><div class="v72-lote-tools"><div style="flex:1"><div class="v72-tool-title">RAMO DO TEMPLATE</div><select class="v72-lote-select" disabled><option>${esc((lote[0]?.lead?.category_name||lote[0]?.lead?.category||lote[0]?.lead_type||'— sem ramo —'))}</option></select></div><div style="flex-shrink:0"><div class="v72-tool-title" style="color:var(--accent)">IMAGEM DO LOTE</div><div class="v72-img-box">📎 imagem do lote</div></div></div>${lote.map((r,j)=>renderFilaItem(r,i+j+1)).join('')}</div>`;} return html;}

  function renderChips(data,byDate){const chips=data.chips||[]; if(!chips.length)return '<div class="fila-empty">// nenhum chip ativo</div>'; if(!state.chipOpen)state.chipOpen=chipKey(chips[0]); return chips.map((ch,idx)=>{const key=chipKey(ch); const title=chipTitle(ch); const list=byDate.filter(r=>rowChipKey(r)===key||rowChipTitle(r)===title||rowChipKey(r)===title||rowChipTitle(r)===key); const open=state.chipOpen===key||(state.chipOpen===title)||(!state.chipOpen&&idx===0); const limit=Number(ch.daily_limit||120)||120; return `<div class="chip-accordion ${open?'open':''}" id="chipAccordionV72-${idx}"><div class="chip-accordion-header" onclick="setFilaZapChipOpenV72('${esc(open?'':key)}')"><span class="chip-accordion-chevron">▶</span><div style="flex:1;min-width:0"><div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:900;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div><div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:2px">${esc(ch.instance||ch.chip_id||ch.name||'')}</div></div><div style="font-family:'DM Mono',monospace;font-size:9px;color:${list.length>=limit?'var(--error)':'var(--muted)'}">${list.length}/${limit}</div></div><div class="chip-accordion-body"><div class="chip-fila-scroll">${renderLotes(list)}</div></div></div>`;}).join('');}

  async function setStatus(id,st){const c=sb(); if(!c)return; const db=statusDb(st); const {error}=await c.from('pre_dispatch_items').update({status:db,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',id); if(error)return notify('Erro ao atualizar: '+error.message,'err'); await renderFilaZapV72();}

  async function renderFilaZapV72(){addStyle(); const panel=document.getElementById('panel-fila-zap'); if(!panel)return; document.querySelectorAll('.panel').forEach(p=>{const on=p.id==='panel-fila-zap';p.classList.toggle('active',on);p.style.display=on?'flex':'none';}); panel.classList.add('v72-panel'); panel.innerHTML=`<div class="zapLeft"><div class="zapLeft-inner"><div class="page-header" style="flex-shrink:0;padding:20px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// carregando...</div></div></div></div><div class="zapDivider"></div><div class="zapRight"><div class="fila-empty">// carregando chips...</div></div>`; const data=await fetchData(); state.last=data; if(data.error){panel.innerHTML=`<div class="page-header"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" style="color:var(--error)">// erro: ${esc(data.error.message)}</div></div>`; return;} const rows=data.items||[]; dateTabs(rows); const byDate=rows.filter(r=>r.scheduled_date===state.date); const selected=filteredRows(rows); const total=byDate.length; const ready=byDate.filter(r=>statusKey(r.status)==='ready').length; const queued=byDate.filter(r=>statusKey(r.status)==='queued').length; const sent=byDate.filter(r=>statusKey(r.status)==='sent').length;
    const left=`<div class="zapLeft"><div class="zapLeft-inner"><div class="page-header" style="flex-shrink:0;padding:20px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" id="filaZapSub">// ${rows.length} lead(s) na fila final · visual baseado no arquivo enviado</div></div><div class="zapLeft-body"><div class="card-title" style="flex-shrink:0">Selecionar empresas <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;margin-left:4px">— visão do dia e status</span></div><div class="day-tabs">${dateTabs(rows)}</div><div class="status-tabs">${statusTabs(byDate)}</div><div class="stats-row"><span>${total} leads · <span style="color:var(--accent)">${ready} não enviados</span> · <span style="color:#4ab3ff">${queued} em fila</span> · <span style="color:var(--ok)">${sent} enviados</span></span></div><div class="stretch-list zap-empresa-list">${selected.length?selected.map(renderCompanyRow).join(''):`<div class="fila-empty">// nenhuma empresa neste filtro</div>`}</div></div></div></div>`;
    const right=`<div class="zapRight">${renderChips(data,byDate)}</div>`;
    panel.innerHTML=left+`<div class="zapDivider"></div>`+right;
    const badge=document.getElementById('badge-fila-zap'); if(badge)badge.textContent=String(rows.filter(r=>['ready','queued'].includes(statusKey(r.status))).length);
  }

  function setDate(d){state.date=d;renderFilaZapV72();}
  function setSt(s){state.status=s||'all';renderFilaZapV72();}
  function setOpen(k){state.chipOpen=k||null;renderFilaZapV72();}
  function toggleItem(id){state.expanded[id]=!state.expanded[id];renderFilaZapV72();}
  function copy(text){const t=String(text||'');if(!t)return; navigator.clipboard?.writeText(t).then(()=>notify('✓ copiado')).catch(()=>{});}
  function openWa(phone){const p=normPhone(phone); if(p)window.open(`https://wa.me/${p}`,'_blank','noopener,noreferrer');}

  window.renderFilaZap=renderFilaZapV72; window.renderFilaZapV72=renderFilaZapV72;
  window.setFilaZapDateV72=setDate; window.setFilaZapStatusV72=setSt; window.setFilaZapChipOpenV72=setOpen; window.toggleFilaItemV72=toggleItem;
  window.copyV72=copy; window.openWaV72=openWa; window.setZapStatusV72=setStatus;
  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){const n=String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); if(['whatsapp','fila-zap','fila_whatsapp','zap'].includes(n)||name==='WhatsApp'){renderFilaZapV72();return;} return typeof prevSwitch==='function'?prevSwitch(name):undefined;};
  document.addEventListener('click',function(e){const nav=e.target.closest?.('.nav-item[data-label]'); if(!nav)return; if((nav.getAttribute('data-label')||'')!=='WhatsApp')return; e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation(); renderFilaZapV72();},true);
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{try{if(document.getElementById('panel-fila-zap')?.classList.contains('active'))renderFilaZapV72();}catch(_){}},600));
  window.__V72_FILA_WHATSAPP_VISUAL_REF__=VERSION;
})();
