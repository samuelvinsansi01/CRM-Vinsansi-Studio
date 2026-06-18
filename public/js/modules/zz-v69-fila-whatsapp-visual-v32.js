/* V69 — Fila WhatsApp visual inspirado na v32, mantendo regras/ações atuais da v68/v33. */
(function(){
  'use strict';
  const VERSION='20260618-V69-FILA-WHATSAPP-VISUAL-V32';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const STATUS_TABS=['all','ready','queued','sent','error'];
  const state={date:null,status:'all',chip:'all',lastData:null};

  function sb(){ try { return window.sbClient || (typeof sbClient!=='undefined'?sbClient:null); } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || (typeof currentUser!=='undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK; } catch(e){ return USER_ID_FALLBACK; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function cleanUrl(url){ const u=String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`; }
  function shortHost(url){ try { return new URL(cleanUrl(url)).hostname.replace(/^www\./,''); } catch(e){ return String(url||'').replace(/^https?:\/\/(www\.)?/,'').split('/')[0] || 'Site'; } }
  function phoneOf(l){ return String(l?.normalized_phone || l?.phone || '').replace(/\D/g,''); }
  function fmtPhone(v){ const d=String(v||'').replace(/\D/g,''); if(d.length===13) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,9)}-${d.slice(9)}`; if(d.length===12) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8)}`; return d?`+${d}`:''; }
  function leadName(l){ return l?.company_name || l?.nome || 'Sem nome'; }
  function mapsUrl(l){ return cleanUrl(l?.maps_url || l?.googleUrl || l?.mapsUrl || l?.url || ''); }
  function leadNameHtml(l){ const m=mapsUrl(l); const name=esc(leadName(l)); return m?`<a href="${esc(m)}" target="_blank" rel="noopener noreferrer" class="v69-lead-name-link">${name}</a>`:`<span>${name}</span>`; }
  function todayIso(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
  function weekDates(){ const d=new Date(); d.setHours(0,0,0,0); const start=new Date(d); start.setDate(d.getDate()-d.getDay()); return Array.from({length:7},(_,i)=>{ const x=new Date(start); x.setDate(start.getDate()+i); return x.toISOString().slice(0,10); }); }
  function dayLabel(iso){ try { const [y,m,d]=String(iso).split('-').map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.',''); } catch(e){ return iso; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') return window.notify(msg,type); } catch(e){} console[type==='err'?'error':'log'](msg); }

  function statusKey(st){ const s=String(st||'').toLowerCase(); if(['ready_to_dispatch','ready','approved','not_sent','waiting','scheduled','dispatch_queue'].includes(s)) return 'ready'; if(['queued','em_fila'].includes(s)) return 'queued'; if(['sent','enviada','responded','respondida','closed','fechada'].includes(s)) return 'sent'; if(['error','erro','rejected','recusada','failed'].includes(s)) return 'error'; return s||'ready'; }
  function statusLabel(st){ const k=statusKey(st); return k==='ready'?'Não enviada':k==='queued'?'Em fila':k==='sent'?'Enviada':k==='error'?'Erro':st; }
  function rowChipKey(r){ return String(r.chip_instance || r.source_instance || r.chip_id || '').trim(); }
  function rowChipName(r){ return String(r.chip_label || r.source_account || r.chip_instance || 'Chip').trim(); }
  function chipKey(ch){ return String(ch.instance || ch.chip_id || ch.id || '').trim(); }
  function chipTitle(ch){ return String(ch.label || ch.name || ch.phone || ch.instance || 'Chip').trim(); }
  function chipSub(ch){ return [ch.phone, ch.instance, ch.connection_state || ch.status].filter(Boolean).join(' · ') || 'instância WhatsApp'; }
  function loteNum(r){ const pos=Number(r.position||0); return pos ? Math.max(1,Math.ceil(pos/30)) : 1; }

  function applyStyle(){
    if(document.getElementById('v69-fila-whatsapp-visual-style')) return;
    const st=document.createElement('style'); st.id='v69-fila-whatsapp-visual-style'; st.textContent=`
      #panel-fila-zap.v69-zap-panel{padding:0!important;overflow:hidden!important;flex-direction:row!important;height:100vh!important;width:100%!important;max-width:none!important}
      .v69-left{flex:1;min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:transparent}.v69-right{width:44%;min-width:440px;max-width:760px;height:100vh;overflow:auto;background:rgba(255,255,255,.015)}.v69-divider{width:1px;background:var(--border);flex:0 0 auto;height:100vh}
      .v69-body{padding:16px 20px 24px;flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}.v69-title-line{font-family:'Syne',sans-serif;color:var(--text);font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin:0 0 10px}.v69-title-line span{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;margin-left:4px}
      .v69-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.v69-tab{background:rgba(255,255,255,.025);border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:7px 12px;cursor:pointer}.v69-tab.active{border-color:var(--accent);color:var(--accent);background:rgba(184,240,89,.08)}.v69-tab span{margin-left:5px;color:inherit;opacity:.85}
      .v69-oper-panel{border:1px solid var(--border2);background:rgba(255,255,255,.018);border-radius:12px;padding:12px;margin:0 0 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.v69-oper-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:var(--text)}.v69-oper-sub{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);line-height:1.6;margin-top:4px}.v69-oper-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;min-width:250px}.v69-mini-lotes{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.v69-mini-lote{border:1px solid var(--border2);border-radius:999px;padding:4px 7px;font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)}
      .v69-stats{display:flex;gap:14px;align-items:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--text);margin:4px 0 12px;flex-wrap:wrap}.v69-stats span{color:var(--muted)}.v69-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}.v69-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:44px 16px}
      .v69-card{display:flex;gap:14px;align-items:center;justify-content:space-between;background:rgba(255,255,255,.018);border:1px solid var(--border2);border-radius:12px;padding:13px 14px}.v69-card.compact{border-radius:0;border-left:0;border-right:0;border-top:0;margin:0;padding:13px 16px;background:transparent}.v69-main{min-width:0;flex:1}.v69-lead-name,.v69-lead-name-link{font-family:'Syne',sans-serif;font-size:14px;line-height:1.22;font-weight:800;color:var(--text)!important;text-decoration:none}.v69-lead-name-link:hover{color:var(--accent)!important}.v69-meta{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:5px;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)}.v69-meta a{color:var(--accent);text-decoration:none}.v69-meta .zap{color:var(--ok);font-family:'Syne',sans-serif;font-weight:800;font-size:10px;background:none;border:0;padding:0;cursor:pointer}.v69-dispatch-box{margin-top:6px;border-top:1px dashed var(--border2);padding-top:6px;font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}.v69-dispatch-box strong{color:var(--text2);font-weight:600}
      .v69-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;min-width:280px}.v69-btn{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:8px;color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:6px 8px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.v69-btn:hover{border-color:var(--accent);color:var(--accent)}.v69-btn.primary{background:var(--accent);color:#111;border-color:var(--accent);font-weight:900}.v69-btn.blue{border-color:rgba(74,179,255,.45);color:#4ab3ff}.v69-btn.danger{border-color:rgba(255,80,80,.45);color:#ff6b6b}.v69-btn:disabled{opacity:.45;cursor:not-allowed}.v69-status{display:inline-flex;border:1px solid var(--border2);border-radius:999px;padding:5px 8px;font-family:'DM Mono',monospace;font-size:8px;color:var(--text2);white-space:nowrap}.v69-status.ready{color:var(--accent);border-color:rgba(184,240,89,.38);background:rgba(184,240,89,.08)}.v69-status.queued{color:#4ab3ff;border-color:rgba(74,179,255,.38);background:rgba(74,179,255,.08)}.v69-status.sent{color:var(--ok);border-color:rgba(78,203,113,.38);background:rgba(78,203,113,.08)}.v69-status.error{color:var(--error);border-color:rgba(255,80,80,.38);background:rgba(255,80,80,.08)}
      .v69-chip{border-bottom:1px solid var(--border)}.v69-chip-head{display:flex;align-items:center;gap:10px;padding:15px 18px;cursor:pointer;border-left:3px solid var(--accent);background:rgba(255,255,255,.025)}.v69-chip-chevron{font-size:14px;color:var(--muted);transition:.2s}.v69-chip.open .v69-chip-chevron{transform:rotate(90deg);color:var(--accent)}.v69-chip-title{font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);font-weight:900}.v69-chip-sub{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px}.v69-chip-count{font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);white-space:nowrap}.v69-chip-body{display:none}.v69-chip.open .v69-chip-body{display:block}.v69-chip-scroll{max-height:360px;overflow:auto}.v69-log{border-top:1px solid var(--border);padding:12px 16px;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);line-height:1.6;max-height:160px;overflow:auto}
      @media(max-width:1100px){#panel-fila-zap.v69-zap-panel{flex-direction:column!important;height:auto!important;overflow:auto!important}.v69-left,.v69-right{width:100%;max-width:none;min-width:0;height:auto;min-height:420px}.v69-divider{display:none}.v69-actions,.v69-oper-actions{min-width:0}}
    `; document.head.appendChild(st);
  }

  async function fetchData(){
    const c=sb(); if(!c) return {items:[],chips:[],error:new Error('Supabase indisponível')};
    const itemQ=c.from('pre_dispatch_items')
      .select('id,lead_id,user_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,raw_payload,updated_at,leads(id,company_name,phone,normalized_phone,website,instagram_url,maps_url,street,city,state,country_code,rating,reviews_count,category,category_name,categories,parent_category,lead_type,raw_payload)')
      .eq('user_id',uid())
      .in('status',['ready_to_dispatch','ready','approved','queued','sent','error','responded','no_response','rejected','closed','not_sent','waiting','scheduled','dispatch_queue'])
      .order('scheduled_date',{ascending:true}).order('chip_label',{ascending:true}).order('position',{ascending:true});
    const chipQ=c.from('whatsapp_instances')
      .select('id,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active,daily_limit,block_size,interval_seconds,phone')
      .eq('user_id',uid()).order('label',{ascending:true});
    const [it,ch]=await Promise.all([itemQ,chipQ]);
    if(it.error) return {items:[],chips:[],error:it.error};
    if(ch.error) console.warn('[v69][chips]',ch.error.message);
    return {items:(it.data||[]).map(r=>({...r,lead:r.leads||{}})), chips:(ch.data||[]).filter(x=>x.active!==false && x.instance), error:null};
  }

  function selectedRows(rows){ return rows.filter(r=>state.status==='all'||statusKey(r.status)===state.status).filter(r=>state.chip==='all'||rowChipKey(r)===state.chip||rowChipName(r)===state.chip).sort((a,b)=>(a.position||0)-(b.position||0)); }
  function countStatus(st,list){ return st==='all'?list.length:list.filter(r=>statusKey(r.status)===st).length; }
  function currentChip(chips){ return chips.find(ch=>chipKey(ch)===state.chip||chipTitle(ch)===state.chip) || null; }

  function renderCard(r,compact=false){
    const l=r.lead||{}; const phone=phoneOf(l); const web=String(l.website||'').trim(); const loc=[l.city,l.state].filter(Boolean).join('/'); const sk=statusKey(r.status);
    return `<div class="v69-card ${compact?'compact':''}" data-id="${esc(r.id)}" data-lead-id="${esc(r.lead_id||l.id||'')}">
      <div class="v69-main">
        <div class="v69-lead-name">${leadNameHtml(l)}</div>
        <div class="v69-meta">
          ${web?`<a href="${esc(cleanUrl(web))}" target="_blank" rel="noopener noreferrer">${esc(shortHost(web))}</a>`:'<span>Sem site</span>'}
          <span>|</span><button class="zap" onclick="copyV69('${esc(phone)}')">WhatsApp</button>
          ${phone?`<span>${esc(fmtPhone(phone))}</span>`:''}
          <span>${esc(rowChipName(r))}</span>
          ${loc?`<span>${esc(loc)}</span>`:''}
          ${l.rating?`<span>⭐ ${esc(l.rating)} · ${esc(l.reviews_count||0)}</span>`:''}
        </div>
        <div class="v69-dispatch-box"><span><strong>Lote:</strong> ${loteNum(r)}</span><span><strong>Fluxo:</strong> Msg 1 → Msg 2 → Imagem</span><span><strong>Tipo:</strong> ${web?'com site':'sem site'}</span><span><strong>Ramo:</strong> ${esc(l.parent_category||l.category_name||l.category||r.lead_type||'não definido')}</span></div>
      </div>
      <div class="v69-actions">
        <button class="v69-btn" onclick="openLeadDrawer && openLeadDrawer('${esc(r.lead_id||l.id||'')}')">Ficha</button>
        <span class="v69-status ${esc(sk)}">${esc(statusLabel(r.status))}</span>
        <button class="v69-btn" onclick="copyV69('${esc(phone)}')">Copiar nº</button>
        <button class="v69-btn" onclick="openWaV69('${esc(phone)}')">Abrir WA</button>
        <button class="v69-btn blue" onclick="setZapStatusV33 && setZapStatusV33('${esc(r.id)}','queued')">Em fila</button>
        <button class="v69-btn primary" onclick="sendSingleV33 && sendSingleV33('${esc(r.id)}')">Enviar agora</button>
        <button class="v69-btn" onclick="setZapStatusV33 && setZapStatusV33('${esc(r.id)}','sent')">Enviada</button>
        <button class="v69-btn danger" onclick="setZapStatusV33 && setZapStatusV33('${esc(r.id)}','error')">Erro</button>
      </div>
    </div>`;
  }

  function operationalPanel(selected,byDate,chips){
    const chip=currentChip(chips); const chipLabel=state.chip==='all'?'todos os chips':(chipTitle(chip)||state.chip); const ready=selected.filter(r=>['ready','queued'].includes(statusKey(r.status))).length;
    let lotes='';
    if(state.chip==='all'){
      lotes=[1,2,3,4].map(n=>`<span class="v69-mini-lote">Lote ${n}: ${byDate.filter(r=>loteNum(r)===n).length} leads</span>`).join('');
    } else {
      const list=byDate.filter(r=>rowChipKey(r)===state.chip||rowChipName(r)===state.chip);
      lotes=[1,2,3,4].map(n=>`<span class="v69-mini-lote">Lote ${n}: ${list.filter(r=>loteNum(r)===n).length}/30</span>`).join('');
    }
    return `<div class="v69-oper-panel"><div><div class="v69-oper-title">Disparo operacional</div><div class="v69-oper-sub">Dia: <b>${esc(dayLabel(state.date))}</b> · Chip: <b>${esc(chipLabel)}</b> · Prontos neste filtro: <b>${ready}</b><br>Sequência: Msg 1 → 10s → Msg 2 → 5s → imagem do lote.</div><div class="v69-mini-lotes">${lotes}</div></div><div class="v69-oper-actions"><button class="v69-btn" onclick="previewDispatchV33 && previewDispatchV33()">Prévia</button><button class="v69-btn primary" onclick="startDispatchV33 && startDispatchV33()">Iniciar disparo</button><button class="v69-btn blue" onclick="pauseDispatchV33 && pauseDispatchV33()">Pausar/Retomar</button><button class="v69-btn danger" onclick="stopDispatchV33 && stopDispatchV33()">Parar</button></div></div>`;
  }

  async function renderFilaZapV69(){
    applyStyle();
    const panel=document.getElementById('panel-fila-zap'); if(!panel) return;
    document.querySelectorAll('.panel').forEach(p=>{ const on=p.id==='panel-fila-zap'; p.classList.toggle('active',on); p.style.display=on?'flex':'none'; });
    panel.classList.remove('v32-zap-panel','v33-panel'); panel.classList.add('v69-zap-panel');
    panel.innerHTML=`<div class="v69-left"><div class="page-header" style="padding:22px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// carregando fila operacional...</div></div></div><div class="v69-divider"></div><div class="v69-right"><div class="v69-empty">// carregando chips...</div></div>`;
    const data=await fetchData(); state.lastData=data;
    if(data.error){ panel.innerHTML=`<div class="page-header"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" style="color:var(--error)">// erro: ${esc(data.error.message)}</div></div>`; return; }
    const rows=data.items||[]; const chips=data.chips||[];
    const dates=[...new Set([...weekDates(),...rows.map(r=>r.scheduled_date).filter(Boolean)])].sort();
    if(!state.date||!dates.includes(state.date)) state.date=dates.includes(todayIso())?todayIso():(dates[0]||todayIso());
    if(state.chip!=='all'&&!chips.some(ch=>chipKey(ch)===state.chip||chipTitle(ch)===state.chip)) state.chip='all';
    const byDate=rows.filter(r=>r.scheduled_date===state.date);
    const selected=selectedRows(byDate);
    const badge=document.getElementById('badge-fila-zap'); if(badge) badge.textContent=String(rows.filter(r=>['ready','queued'].includes(statusKey(r.status))).length);
    const left=`<div class="v69-left"><div class="page-header" style="padding:22px 20px 0;flex-shrink:0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// ${rows.length} lead(s) na fila final · visão por dia, chip e status</div></div><div class="v69-body"><div class="v69-title-line">Selecionar empresas <span>— conteúdo pronto para disparo</span></div><div class="v69-tabs">${dates.map(d=>`<button class="v69-tab ${state.date===d?'active':''}" onclick="setFilaZapDateV69('${esc(d)}')">${esc(dayLabel(d))}<span>${rows.filter(r=>r.scheduled_date===d).length}</span></button>`).join('')}</div><div class="v69-tabs">${STATUS_TABS.map(st=>`<button class="v69-tab ${state.status===st?'active':''}" onclick="setFilaZapStatusV69('${esc(st)}')">${st==='all'?'Todos':esc(statusLabel(st))}<span>${countStatus(st,byDate)}</span></button>`).join('')}</div>${operationalPanel(selected,byDate,chips)}<div class="v69-stats"><strong>${selected.length}</strong><span>exibindo</span><strong>${countStatus('ready',byDate)}</strong><span>não enviada</span><strong>${countStatus('queued',byDate)}</strong><span>em fila</span><strong>${countStatus('sent',byDate)}</strong><span>enviada</span></div><div class="v69-list">${selected.length?selected.map(r=>renderCard(r)).join(''):'<div class="v69-empty">// nenhuma empresa neste filtro</div>'}</div></div></div>`;
    const right=`<div class="v69-right"><div style="padding:14px 16px 8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);border-bottom:1px solid var(--border)">Chips ativos · clique para filtrar</div>${chips.length?chips.map((ch,idx)=>{ const key=chipKey(ch), title=chipTitle(ch); const list=byDate.filter(r=>rowChipKey(r)===key||rowChipName(r)===title||rowChipKey(r)===title||rowChipName(r)===key); const open=(state.chip==='all'&&idx===0)||state.chip===key||state.chip===title; const limit=Number(ch.daily_limit||120)||120; return `<div class="v69-chip ${open?'open':''}"><div class="v69-chip-head" onclick="setFilaZapChipV69('${esc(open?'all':key)}')"><span class="v69-chip-chevron">›</span><div style="flex:1;min-width:0"><div class="v69-chip-title">${esc(title)}</div><div class="v69-chip-sub">${esc(chipSub(ch))}</div></div><div class="v69-chip-count">(${list.length}/${limit} · ${list.filter(r=>statusKey(r.status)==='ready').length} aguardando · ${list.filter(r=>statusKey(r.status)==='queued').length} fila · ${list.filter(r=>statusKey(r.status)==='sent').length} enviados)</div></div><div class="v69-chip-body"><div class="v69-chip-scroll">${list.length?list.map(r=>renderCard(r,true)).join(''):'<div class="v69-empty">// nenhum lead neste chip para '+esc(dayLabel(state.date))+'</div>'}</div></div></div>`; }).join(''):'<div class="v69-empty">// nenhum chip ativo encontrado</div>'}<div class="v69-log" id="v33DispatchLog">${(window.__v33DispatchLog||[]).length?window.__v33DispatchLog.map(esc).join('<br>'):'// log do disparo aparecerá aqui durante a execução'}</div></div>`;
    panel.innerHTML=left+`<div class="v69-divider"></div>`+right;
  }

  function copyV69(text){ const t=String(text||''); if(!t) return; navigator.clipboard?.writeText(t).then(()=>notify('✓ copiado')).catch(()=>{}); }
  function openWaV69(phone){ const p=String(phone||'').replace(/\D/g,''); if(p) window.open(`https://wa.me/${p}`,'_blank','noopener,noreferrer'); }
  function setDate(d){ state.date=d; renderFilaZapV69(); }
  function setStatus(st){ state.status=st; renderFilaZapV69(); }
  function setChip(ch){ state.chip=ch||'all'; renderFilaZapV69(); }

  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){ const n=String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); if(['whatsapp','fila-zap','fila_whatsapp','zap'].includes(n)||name==='WhatsApp'){ renderFilaZapV69(); return; } return typeof prevSwitch==='function'?prevSwitch(name):undefined; };
  window.renderFilaZap=renderFilaZapV69; window.renderFilaZapV69=renderFilaZapV69; window.renderFilaZapV33=renderFilaZapV69;
  window.setFilaZapDateV69=setDate; window.setFilaZapStatusV69=setStatus; window.setFilaZapChipV69=setChip;
  window.copyV69=copyV69; window.openWaV69=openWaV69;
  document.addEventListener('click',function(e){ const nav=e.target.closest?.('.nav-item[data-label]'); if(!nav) return; const label=nav.getAttribute('data-label')||''; if(label!=='WhatsApp') return; e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); renderFilaZapV69(); },true);
  document.addEventListener('DOMContentLoaded',()=>{ applyStyle(); console.log('[v69][fila-whatsapp-visual] ativo',VERSION); setTimeout(()=>{ try{ if(document.getElementById('panel-fila-zap')?.classList.contains('active')) renderFilaZapV69(); }catch(e){} },450); });
})();
