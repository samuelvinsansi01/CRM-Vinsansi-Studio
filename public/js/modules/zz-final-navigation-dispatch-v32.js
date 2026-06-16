/* V32 — normalização final de navegação + Fila WhatsApp operacional por chip
   Objetivo: uma rota = uma tela, sem render legado cruzado. Carregado por último. */
(function(){
  'use strict';
  const VERSION='20260615-v32-final-nav-dispatch';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const PANEL_MAP={
    inicio:'panel-inicio', inbox:'panel-inbox', importar:'panel-importar', atribuicao:'panel-atribuicao',
    validacao:'panel-validacao', 'pre-envio':'panel-pre-envio', preenvio:'panel-pre-envio',
    whatsapp:'panel-fila-zap', 'fila-zap':'panel-fila-zap', instagram:'panel-instagram',
    'ja-enviados':'panel-ja-enviados', jaenviados:'panel-ja-enviados', conversations:'panel-conversations', conversas:'panel-conversations',
    followups:'panel-followups', kanban:'panel-kanban', acompanhamento:'panel-acompanhamento',
    redirecionamentos:'panel-redirecionamentos', audit:'panel-audit', conta:'panel-conta', configuracoes:'panel-configuracoes',
    chips:'panel-chips', evolution:'panel-evolution', responses:'panel-responses', whatsappqueue:'panel-whatsappQueue'
  };
  const LABEL_TO_ROUTE={
    'Início':'inicio','Caixa de Entrada':'inbox','Importar':'importar','Atribuição':'atribuicao',
    'Pré-envio':'pre-envio','WhatsApp':'fila-zap','Instagram':'instagram','Já enviados':'ja-enviados',
    'Conversas':'conversations','Follow-ups':'followups','Kanban':'kanban','Acompanhamentos':'acompanhamento',
    'Redirecionamentos':'redirecionamentos','Auditoria':'audit','Minha conta':'conta','Configurações':'configuracoes'
  };
  const ROUTE_LABEL={}; Object.entries(LABEL_TO_ROUTE).forEach(([k,v])=>ROUTE_LABEL[v]=k);
  ROUTE_LABEL['fila-zap']='WhatsApp'; ROUTE_LABEL['pre-envio']='Pré-envio'; ROUTE_LABEL['ja-enviados']='Já enviados';

  function sb(){ try { return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null); } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || (typeof currentUser!=='undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK; } catch(e){ return USER_ID_FALLBACK; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function cleanUrl(url){ const u=String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`; }
  function shortUrl(url){ try { return new URL(cleanUrl(url)).hostname.replace(/^www\./,''); } catch(e){ return String(url||'').replace(/^https?:\/\/(www\.)?/,'').split('/')[0]; } }
  function phoneOf(lead){ return String(lead?.normalized_phone || lead?.phone || '').replace(/\D/g,''); }
  function fmtPhone(v){ const d=String(v||'').replace(/\D/g,''); if(d.length===13) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,9)}-${d.slice(9)}`; if(d.length===12) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8)}`; return d?`+${d}`:''; }
  function mapsUrl(l){ return cleanUrl(l?.maps_url || l?.googleUrl || l?.mapsUrl || l?.url || ''); }
  function leadName(l){ return l?.company_name || l?.nome || 'Sem nome'; }
  function leadNameHtml(l){ const m=mapsUrl(l); const name=esc(leadName(l)); return m?`<a href="${esc(m)}" target="_blank" rel="noopener noreferrer" class="v32-lead-name-link">${name}</a>`:`<span>${name}</span>`; }
  function todayIso(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
  function weekDates(){ const d=new Date(); d.setHours(0,0,0,0); const start=new Date(d); start.setDate(d.getDate()-d.getDay()); return Array.from({length:7},(_,i)=>{ const x=new Date(start); x.setDate(start.getDate()+i); return x.toISOString().slice(0,10); }); }
  function dayLabel(iso){ try { const [y,m,d]=String(iso).split('-').map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.',''); } catch(e){ return iso; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') return window.notify(msg,type); } catch(e){} console[type==='err'?'error':'log'](msg); }

  function applyStyles(){
    if(document.getElementById('v32-final-nav-dispatch-style')) return;
    const st=document.createElement('style'); st.id='v32-final-nav-dispatch-style'; st.textContent=`
      .panel{display:none}.panel.active{display:flex!important}
      #panel-fila-zap.v32-zap-panel{padding:0!important;overflow:hidden!important;flex-direction:row!important;height:100vh!important;width:100%!important;max-width:none!important}
      .v32-zap-left{flex:1;min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:transparent}
      .v32-zap-right{width:44%;min-width:440px;max-width:760px;height:100vh;overflow:auto;background:rgba(255,255,255,.015)}
      .v32-zap-divider{width:1px;background:var(--border);flex:0 0 auto;height:100vh}
      .v32-zap-body{padding:16px 20px 24px;flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
      .v32-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.v32-tab{background:rgba(255,255,255,.025);border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:7px 12px;cursor:pointer}.v32-tab.active{border-color:var(--accent);color:var(--accent);background:rgba(184,240,89,.08)}.v32-tab span{margin-left:5px;color:inherit;opacity:.85}
      .v32-stats{display:flex;gap:14px;align-items:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--text);margin:8px 0 14px;flex-wrap:wrap}.v32-stats span{color:var(--muted)}.v32-stats strong{color:var(--text)}
      .v32-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}.v32-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:44px 16px}
      .v32-lead-card{display:flex;gap:14px;align-items:center;justify-content:space-between;background:rgba(255,255,255,.018);border:1px solid var(--border2);border-radius:12px;padding:13px 14px}.v32-lead-card.compact{border-radius:0;border-left:0;border-right:0;border-top:0;margin:0;padding:13px 16px;background:transparent}.v32-lead-main{min-width:0;flex:1}.v32-lead-name,.v32-lead-name-link{font-family:'Syne',sans-serif;font-size:14px;line-height:1.22;font-weight:700;color:var(--text)!important;text-decoration:none}.v32-lead-name-link:hover{color:var(--accent)!important}.v32-meta{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:5px;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)}.v32-meta a{color:var(--accent);text-decoration:none}.v32-meta .zap{color:var(--ok);font-family:'Syne',sans-serif;font-weight:800;font-size:10px;background:none;border:0;padding:0;cursor:pointer}.v32-meta .chip{font-size:9px;color:var(--muted2)}
      .v32-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.v32-btn{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:8px;color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:6px 8px;cursor:pointer}.v32-btn:hover{border-color:var(--accent);color:var(--accent)}.v32-btn.primary{background:var(--accent);color:#111;border-color:var(--accent);font-weight:900}.v32-status{display:inline-flex;border:1px solid var(--border2);border-radius:999px;padding:5px 8px;font-family:'DM Mono',monospace;font-size:8px;color:var(--text2);white-space:nowrap}.v32-status.nao_enviada{color:var(--accent);border-color:rgba(184,240,89,.38);background:rgba(184,240,89,.08)}.v32-status.em_fila{color:#4ab3ff;border-color:rgba(74,179,255,.38);background:rgba(74,179,255,.08)}.v32-status.enviada,.v32-status.respondida,.v32-status.fechada{color:var(--ok);border-color:rgba(78,203,113,.38);background:rgba(78,203,113,.08)}.v32-status.erro,.v32-status.recusada{color:var(--error);border-color:rgba(255,80,80,.38);background:rgba(255,80,80,.08)}
      .v32-chip{border-bottom:1px solid var(--border)}.v32-chip-head{display:flex;align-items:center;gap:10px;padding:15px 18px;cursor:pointer;border-left:3px solid var(--accent);background:rgba(255,255,255,.025)}.v32-chip-chevron{font-size:14px;color:var(--muted);transition:.2s}.v32-chip.open .v32-chip-chevron{transform:rotate(90deg);color:var(--accent)}.v32-chip-title{font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);font-weight:900}.v32-chip-sub{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px}.v32-chip-count{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);white-space:nowrap}.v32-chip-body{display:none}.v32-chip.open .v32-chip-body{display:block}.v32-chip-scroll{max-height:360px;overflow:auto}
      .v32-dispatch-box{margin-top:6px;border-top:1px dashed var(--border2);padding-top:6px;font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}.v32-dispatch-box strong{color:var(--text2);font-weight:600}
      @media(max-width:1100px){#panel-fila-zap.v32-zap-panel{flex-direction:column!important;height:auto!important;overflow:auto!important}.v32-zap-left,.v32-zap-right{width:100%;max-width:none;min-width:0;height:auto;min-height:420px}.v32-zap-divider{display:none}}
    `; document.head.appendChild(st);
  }

  function routeName(name){
    const raw=String(name||'').trim();
    const direct=raw.toLowerCase();
    if(PANEL_MAP[direct]) return direct;
    if(LABEL_TO_ROUTE[raw]) return LABEL_TO_ROUTE[raw];
    const normalized=direct.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const aliases={preenvio:'pre-envio','pre_envio':'pre-envio','ja_enviados':'ja-enviados',jaenviados:'ja-enviados',whatsapp:'fila-zap',zap:'fila-zap',fila_whatsapp:'fila-zap',fila_zap:'fila-zap',conversas:'conversations',configuracoes:'configuracoes'};
    return aliases[normalized] || direct;
  }

  function setOnlyPanelByRoute(route){
    applyStyles();
    const r=routeName(route);
    const panelId=PANEL_MAP[r];
    document.querySelectorAll('.panel').forEach(p=>{
      const on=p.id===panelId;
      p.classList.toggle('active',on);
      p.style.display=on?'flex':'none';
      if(on && p.id!=='panel-fila-zap'){
        p.classList.remove('v32-zap-panel');
        p.style.flexDirection='column'; p.style.width='100%'; p.style.maxWidth='none'; p.style.padding='24px 28px'; p.style.overflow='auto'; p.style.height='';
      }
    });
    const label=ROUTE_LABEL[r] || Object.keys(LABEL_TO_ROUTE).find(k=>LABEL_TO_ROUTE[k]===r) || '';
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',(n.getAttribute('data-label')||'')===label));
    return {route:r,panelId};
  }

  async function routeRender(route){
    const {route:r,panelId}=setOnlyPanelByRoute(route);
    try{
      if(r==='fila-zap') return renderFilaZapV32();
      if(r==='pre-envio' && typeof window.renderPreEnvioPanelV31==='function') return window.renderPreEnvioPanelV31();
      if(r==='atribuicao' && typeof window.renderAtribuicaoPanelV31==='function') return window.renderAtribuicaoPanelV31();
      if(r==='instagram' && typeof window.renderInstagram==='function') return window.renderInstagram();
      if(r==='ja-enviados' && typeof window.renderSentContactsPanelV31==='function') return window.renderSentContactsPanelV31();
      if(r==='inicio' && typeof window.renderInicio==='function') return window.renderInicio();
      if(r==='importar' && typeof window.renderImportHomeDashboard==='function') return window.renderImportHomeDashboard();
      if(r==='conversations' && typeof window.renderConversations==='function') return window.renderConversations();
      if(r==='followups' && typeof window.renderFollowupsPanel==='function') return window.renderFollowupsPanel();
      if(r==='kanban' && typeof window.renderKanbanPanel==='function') return window.renderKanbanPanel();
    }catch(e){ console.error('[v32][route-render]',r,e); }
  }

  const state = window.__filaZapV32 ||= {date:'',status:'all',chip:'all'};
  const FINAL_STATUSES=['ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','sent','enviado','responded','respondida','not_responded','nao_respondida','refused','recusada','closed','fechada','error','erro'];
  function statusLabel(st){ const v=String(st||'').toLowerCase(); if(['ready_to_dispatch','not_sent','waiting'].includes(v)) return 'Não enviada'; if(['queued','dispatch_queue'].includes(v)) return 'Em fila'; if(['sent','enviado'].includes(v)) return 'Enviada'; if(['responded','respondida'].includes(v)) return 'Respondida'; if(['not_responded','nao_respondida'].includes(v)) return 'Não respondida'; if(['refused','recusada'].includes(v)) return 'Recusada'; if(['closed','fechada'].includes(v)) return 'Fechada'; if(['error','erro'].includes(v)) return 'Erro'; return 'Não enviada'; }
  function statusClass(lbl){ return String(lbl||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_'); }
  const STATUS_TABS=['all','Não enviada','Em fila','Enviada','Respondida','Não respondida','Recusada','Fechada','Erro'];
  function chipKey(ch){ return String(ch.instance || ch.label || ch.chip_id || ch.id || 'chip').trim(); }
  function chipTitle(ch){ return String(ch.label || ch.name || ch.chip_id || ch.instance || 'Chip').trim(); }
  function chipSub(ch){ return String(ch.chip_id || ch.instance || ch.name || '').trim(); }
  function rowChipInstance(r){ return String(r.chip_instance || r.chip_label || '').trim(); }
  function rowChipName(r){ return String(r.chip_label || r.chip_instance || 'chip').trim(); }

  async function fetchFilaData(){
    const c=sb(); if(!c) return {items:[],chips:[],error:null};
    const itemQuery=c.from('pre_dispatch_items')
      .select('id,lead_id,chip_instance,chip_label,scheduled_date,status,position,updated_at,created_at,raw_payload,leads(id,company_name,phone,normalized_phone,website,maps_url,city,state,rating,reviews_count,lead_type,category,parent_category,current_stage)')
      .eq('user_id',uid()).in('status',FINAL_STATUSES)
      .order('scheduled_date',{ascending:true}).order('chip_label',{ascending:true}).order('position',{ascending:true});
    const chipQuery=c.from('whatsapp_instances')
      .select('id,chip_id,label,name,instance,active,status,connection_state,daily_limit,block_size,interval_seconds')
      .eq('user_id',uid()).eq('active',true).order('label',{ascending:true});
    const [it,ch]=await Promise.all([itemQuery,chipQuery]);
    if(it.error) return {items:[],chips:[],error:it.error};
    if(ch.error) console.warn('[v32][whatsapp_instances]',ch.error.message);
    return {items:(it.data||[]).map(r=>({...r,lead:r.leads||{}})), chips:ch.data||[], error:null};
  }

  function renderLeadCard(r,compact=false){
    const l=r.lead||{}; const phone=phoneOf(l); const fmt=fmtPhone(phone); const website=l.website||''; const lbl=statusLabel(r.status);
    const loc=[l.city,l.state].filter(Boolean).join('/');
    return `<div class="v32-lead-card ${compact?'compact':''}" data-item-id="${esc(r.id)}">
      <div class="v32-lead-main">
        <div class="v32-lead-name">${leadNameHtml(l)}</div>
        <div class="v32-meta">
          ${website?`<a href="${esc(cleanUrl(website))}" target="_blank" rel="noopener noreferrer">Site</a>`:`<span>Sem site</span>`}
          <span>|</span><button class="zap" onclick="copyV32('${esc(phone)}')">WhatsApp</button>
          ${fmt?`<span>${esc(fmt)}</span>`:''}
          <span class="chip">${esc(rowChipName(r))}</span>
          ${loc?`<span>${esc(loc)}</span>`:''}
          ${l.rating?`<span>⭐ ${esc(l.rating)} · ${esc(l.reviews_count||0)}</span>`:''}
        </div>
        <div class="v32-dispatch-box">
          <span><strong>Fluxo:</strong> Msg 1 → Msg 2 → Imagem</span>
          <span><strong>Tipo:</strong> ${website?'com site':'sem site'}</span>
          <span><strong>Ramo:</strong> ${esc(l.parent_category || l.category || l.lead_type || 'não definido')}</span>
        </div>
      </div>
      <div class="v32-actions">
        <span class="v32-status ${esc(statusClass(lbl))}">${esc(lbl)}</span>
        <button class="v32-btn" onclick="copyV32('${esc(phone)}')">Copiar nº</button>
        <button class="v32-btn" onclick="openWaV32('${esc(phone)}')">Abrir WA</button>
        <button class="v32-btn" onclick="setZapItemStatusV32('${esc(r.id)}','queued')">Em fila</button>
        <button class="v32-btn primary" onclick="setZapItemStatusV32('${esc(r.id)}','sent')">Enviada</button>
        <button class="v32-btn" onclick="setZapItemStatusV32('${esc(r.id)}','error')">Erro</button>
      </div>
    </div>`;
  }

  async function renderFilaZapV32(){
    applyStyles();
    const panel=document.getElementById('panel-fila-zap'); if(!panel) return;
    setOnlyPanelByRoute('fila-zap');
    panel.classList.add('v32-zap-panel');
    panel.innerHTML=`<div class="v32-zap-left"><div class="page-header" style="padding:22px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// carregando fila operacional por chip...</div></div></div><div class="v32-zap-divider"></div><div class="v32-zap-right"><div class="v32-empty">// carregando chips...</div></div>`;
    const {items, chips, error}=await fetchFilaData();
    if(error){ panel.innerHTML=`<div class="page-header"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" style="color:var(--error)">// erro: ${esc(error.message)}</div></div>`; return; }
    const rows=items;
    const badge=document.getElementById('badge-fila-zap'); if(badge) badge.textContent=String(rows.filter(r=>['ready_to_dispatch','queued','dispatch_queue','not_sent','waiting'].includes(String(r.status||''))).length);
    const dates=[...new Set([...weekDates(),...rows.map(r=>r.scheduled_date).filter(Boolean)])].sort();
    if(!state.date || !dates.includes(state.date)) state.date=dates.includes(todayIso())?todayIso():(dates[0]||todayIso());
    const byDate=rows.filter(r=>r.scheduled_date===state.date);
    const known=[...chips];
    rows.forEach(r=>{ const inst=rowChipInstance(r), label=rowChipName(r); if(!known.some(ch=>chipKey(ch)===inst || chipTitle(ch)===label || chipKey(ch)===label || chipTitle(ch)===inst)) known.push({id:inst||label,instance:inst,label:label,daily_limit:120,active:true}); });
    if(state.chip!=='all' && !known.some(ch=>chipKey(ch)===state.chip || chipTitle(ch)===state.chip)) state.chip='all';
    const countStatus=(st,list=byDate)=> st==='all'?list.length:list.filter(r=>statusLabel(r.status)===st).length;
    const selected=byDate.filter(r=>state.status==='all'||statusLabel(r.status)===state.status).filter(r=>state.chip==='all'||rowChipInstance(r)===state.chip||rowChipName(r)===state.chip).sort((a,b)=>(a.position||0)-(b.position||0));
    const left=`<div class="v32-zap-left"><div class="page-header" style="padding:22px 20px 0;flex-shrink:0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// ${rows.length} lead(s) na fila final · visão por dia, chip e status</div></div><div class="v32-zap-body"><div class="card-title">Selecionar empresas <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;margin-left:4px">— conteúdo pronto para disparo</span></div><div class="v32-tabs">${dates.map(d=>`<button class="v32-tab ${state.date===d?'active':''}" onclick="setFilaZapDateV32('${esc(d)}')">${esc(dayLabel(d))}<span>${rows.filter(r=>r.scheduled_date===d).length}</span></button>`).join('')}</div><div class="v32-tabs">${STATUS_TABS.map(st=>`<button class="v32-tab ${state.status===st?'active':''}" onclick="setFilaZapStatusV32('${esc(st)}')">${st==='all'?'Todos':esc(st)}<span>${countStatus(st)}</span></button>`).join('')}</div><div class="v32-stats"><strong>${selected.length}</strong><span>exibindo</span><strong>${countStatus('Não enviada')}</strong><span>não enviada</span><strong>${countStatus('Em fila')}</strong><span>em fila</span><strong>${countStatus('Enviada')}</strong><span>enviada</span></div><div class="v32-list">${selected.length?selected.map(r=>renderLeadCard(r)).join(''):`<div class="v32-empty">// nenhuma empresa neste filtro</div>`}</div></div></div>`;
    const right=`<div class="v32-zap-right">${known.length?known.map((chip,idx)=>{ const key=chipKey(chip), title=chipTitle(chip), sub=chipSub(chip); const list=byDate.filter(r=>rowChipInstance(r)===key||rowChipName(r)===title||rowChipInstance(r)===title||rowChipName(r)===key); const open=(state.chip==='all'&&idx===0)||state.chip===key||state.chip===title; const limit=Number(chip.daily_limit||120)||120; return `<div class="v32-chip ${open?'open':''}"><div class="v32-chip-head" onclick="setFilaZapChipV32('${esc(open?'all':key)}')"><span class="v32-chip-chevron">›</span><div style="flex:1;min-width:0"><div class="v32-chip-title">${esc(title)}</div><div class="v32-chip-sub">${esc(sub)}</div></div><div class="v32-chip-count">(${list.length}/${limit} · ${list.filter(r=>statusLabel(r.status)==='Não enviada').length} aguardando · ${list.filter(r=>statusLabel(r.status)==='Erro').length} erro · ${list.filter(r=>statusLabel(r.status)==='Enviada').length} enviados)</div></div><div class="v32-chip-body"><div class="v32-chip-scroll">${list.length?list.map(r=>renderLeadCard(r,true)).join(''):`<div class="v32-empty">// nenhum lead neste chip para ${esc(dayLabel(state.date))}</div>`}</div></div></div>`; }).join(''):`<div class="v32-empty">// nenhum chip ativo encontrado</div>`}</div>`;
    panel.innerHTML=`${left}<div class="v32-zap-divider"></div>${right}`;
  }

  async function setZapItemStatusV32(id,status){
    const c=sb(); if(!c||!id) return;
    const dbStatus=status==='sent'?'sent':status==='queued'?'queued':status==='error'?'error':status;
    const {data:item}=await c.from('pre_dispatch_items').select('lead_id').eq('user_id',uid()).eq('id',id).maybeSingle();
    const {error}=await c.from('pre_dispatch_items').update({status:dbStatus,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',id);
    if(error) return notify('// erro ao atualizar status: '+error.message,'err');
    if(item?.lead_id){
      const leadStatus=dbStatus==='sent'?'sent':dbStatus==='error'?'dispatch_error':dbStatus==='queued'?'queued':'dispatch_queue';
      await c.from('leads').update({current_status:leadStatus,status:leadStatus,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',item.lead_id);
    }
    notify('✓ status atualizado');
    renderFilaZapV32();
  }

  function copyV32(text){ const t=String(text||''); if(!t) return; navigator.clipboard?.writeText(t).then(()=>notify('✓ copiado')).catch(()=>{}); }
  function openWaV32(phone){ const p=String(phone||'').replace(/\D/g,''); if(p) window.open(`https://wa.me/${p}`,'_blank','noopener,noreferrer'); }
  function setFilaZapDateV32(d){ state.date=d; renderFilaZapV32(); }
  function setFilaZapStatusV32(st){ state.status=st; renderFilaZapV32(); }
  function setFilaZapChipV32(chip){ state.chip=chip||'all'; renderFilaZapV32(); }

  function bindNavigation(){
    // Intercepta clique do menu antes de qualquer onclick legado.
    document.addEventListener('click',function(e){
      const nav=e.target.closest?.('.nav-item[data-label]'); if(!nav) return;
      const label=nav.getAttribute('data-label')||'';
      const route=LABEL_TO_ROUTE[label];
      if(!route) return;
      e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
      routeRender(route);
    },true);
  }

  window.switchPanel=function(name){ return routeRender(name); };
  window.renderFilaZap=renderFilaZapV32;
  window.renderFilaZapV32=renderFilaZapV32;
  window.setFilaZapDateV32=setFilaZapDateV32; window.setFilaZapDateV31=setFilaZapDateV32;
  window.setFilaZapStatusV32=setFilaZapStatusV32; window.setFilaZapStatusV31=setFilaZapStatusV32;
  window.setFilaZapChipV32=setFilaZapChipV32; window.setFilaZapChipV31=setFilaZapChipV32;
  window.setZapItemStatusV32=setZapItemStatusV32;
  window.copyV32=copyV32; window.openWaV32=openWaV32;
  window.__V32_FINAL_NAV_DISPATCH__=VERSION;

  applyStyles(); bindNavigation();
  document.addEventListener('DOMContentLoaded',()=>{ applyStyles(); setTimeout(()=>{ try{ if(document.getElementById('panel-fila-zap')?.classList.contains('active')) renderFilaZapV32(); }catch(e){} },300); });
})();
