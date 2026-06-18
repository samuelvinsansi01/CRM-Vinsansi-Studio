/* V70 — Fila WhatsApp com visual da v31, preservando regras atuais DB-first. */
(function(){
  'use strict';
  const VERSION='20260618-V70-FILA-WHATSAPP-VISUAL-V31';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';

  function db(){ try { return window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null); } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || (typeof currentUser!=='undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK; } catch(e){ return USER_ID_FALLBACK; } }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function cleanUrl(url){ const u=String(url||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u)?u:`https://${u}`; }
  function phoneOf(lead){ return String(lead?.normalized_phone || lead?.phone || '').replace(/\D/g,''); }
  function mapsUrl(l){ return cleanUrl(l?.maps_url || l?.googleUrl || l?.mapsUrl || l?.url || ''); }
  function leadName(l){ return l?.company_name || l?.nome || 'Sem nome'; }
  function leadNameHtml(l){ const m=mapsUrl(l); const name=esc(leadName(l)); return m?`<a href="${esc(m)}" target="_blank" rel="noopener noreferrer" class="v70-lead-name-link">${name}</a>`:`<span>${name}</span>`; }
  function normalizeUrl(url){ return cleanUrl(url); }
  function todayIso(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
  function weekDates(){ const d=new Date(); d.setHours(0,0,0,0); const start=new Date(d); start.setDate(d.getDate()-d.getDay()); return Array.from({length:7},(_,i)=>{ const x=new Date(start); x.setDate(start.getDate()+i); return x.toISOString().slice(0,10); }); }
  function dayLabel(iso){ try { const [y,m,d]=String(iso).split('-').map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.',''); } catch(e){ return iso; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') return window.notify(msg,type); } catch(e){} console[type==='err'?'error':'log'](msg); }
  function copyText(text){ const t=String(text||''); if(!t) return; navigator.clipboard?.writeText(t).then(()=>notify('✓ copiado')).catch(()=>{}); }

  function setOnlyPanel(panelId,label){
    document.querySelectorAll('.panel').forEach(p=>{
      const on=p.id===panelId;
      p.classList.toggle('active',on);
      p.style.display=on?'flex':'none';
      if(on){ p.style.flexDirection='column'; p.style.width='100%'; p.style.maxWidth='none'; p.style.padding='24px 28px'; p.style.overflow='auto'; }
    });
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',(n.getAttribute('data-label')||'')===label));
  }

  function statusLabel(st){
    const v=String(st||'').toLowerCase();
    if(['approved','ready','ready_to_dispatch','not_sent','waiting','scheduled'].includes(v)) return 'Não enviada';
    if(['queued','dispatch_queue','em_fila'].includes(v)) return 'Em fila';
    if(['sent','enviado'].includes(v)) return 'Enviada';
    if(['responded','respondida'].includes(v)) return 'Respondida';
    if(['not_responded','nao_respondida'].includes(v)) return 'Não respondida';
    if(['refused','recusada'].includes(v)) return 'Recusada';
    if(['closed','fechada'].includes(v)) return 'Fechada';
    if(['error','erro','failed'].includes(v)) return 'Erro';
    return 'Não enviada';
  }
  function statusKey(label){ return String(label||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_'); }
  function readyStatuses(){ return ['approved','ready','ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled']; }
  function finalStatuses(){ return ['approved','ready','ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled','sent','enviado','responded','respondida','not_responded','nao_respondida','refused','recusada','closed','fechada','error','erro','failed']; }
  function rowChipName(r){ return String(r.chip_label || r.chip_instance || 'chip').trim(); }
  function rowChipInstance(r){ return String(r.chip_instance || r.chip_label || '').trim(); }
  function chipKey(chip){ return String(chip.instance || chip.chip_id || chip.id || chip.label || 'chip').trim(); }
  function chipTitle(chip){ return String(chip.label || chip.name || chip.instance || chip.phone || 'Chip').trim(); }
  function chipSub(chip){ return [chip.phone, chip.instance, chip.connection_state || chip.status].filter(Boolean).join(' · ') || 'instância WhatsApp'; }

  function applyStyles(){
    if(document.getElementById('v70-fila-whatsapp-v31-style')) return;
    const style=document.createElement('style'); style.id='v70-fila-whatsapp-v31-style'; style.textContent=`
      #panel-fila-zap.v70-fila-v31{padding:0!important;overflow:hidden!important;flex-direction:row!important;height:100vh!important;width:100%!important;max-width:none!important}
      #panel-fila-zap.v70-fila-v31 .zapLeft{flex:1;min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:transparent}
      #panel-fila-zap.v70-fila-v31 .zapLeft-inner{height:100%;display:flex;flex-direction:column;min-height:0}
      #panel-fila-zap.v70-fila-v31 .zapRight{width:44%;min-width:440px;max-width:760px;height:100vh;overflow:auto;background:rgba(255,255,255,.015)}
      #panel-fila-zap.v70-fila-v31 .zapDivider{width:1px;background:var(--border);flex-shrink:0;align-self:stretch}
      #panel-fila-zap.v70-fila-v31 .day-tabs,#panel-fila-zap.v70-fila-v31 .status-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
      #panel-fila-zap.v70-fila-v31 .day-tab,#panel-fila-zap.v70-fila-v31 .status-tab{background:rgba(255,255,255,.025);border:1px solid var(--border2);border-radius:7px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:7px 12px;cursor:pointer}
      #panel-fila-zap.v70-fila-v31 .day-tab.active,#panel-fila-zap.v70-fila-v31 .status-tab.active{border-color:var(--accent);color:var(--accent);background:rgba(184,240,89,.08)}
      #panel-fila-zap.v70-fila-v31 .day-count,#panel-fila-zap.v70-fila-v31 .status-tab span{margin-left:5px;color:inherit;opacity:.85}
      #panel-fila-zap.v70-fila-v31 .stats-row{display:flex;gap:14px;align-items:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin:6px 0 12px;flex-wrap:wrap}
      #panel-fila-zap.v70-fila-v31 .zap-empresa-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}
      #panel-fila-zap.v70-fila-v31 .fila-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:44px 16px}
      #panel-fila-zap.v70-fila-v31 .empresa-card.fila-zap-row{display:flex;gap:14px;align-items:center;justify-content:space-between;background:rgba(255,255,255,.018);border:1px solid var(--border2);border-radius:12px;padding:13px 14px}
      #panel-fila-zap.v70-fila-v31 .empresa-card.fila-zap-row.compact{border-radius:0;border-left:0;border-right:0;border-top:0;margin:0;padding:12px 16px;background:transparent}
      #panel-fila-zap.v70-fila-v31 .empresa-info{min-width:0;flex:1}
      #panel-fila-zap.v70-fila-v31 .pre-card-name,#panel-fila-zap.v70-fila-v31 .v70-lead-name-link{font-family:'Syne',sans-serif;font-size:14px!important;line-height:1.25!important;font-weight:700!important;color:var(--text)!important;text-decoration:none!important}
      #panel-fila-zap.v70-fila-v31 .v70-lead-name-link:hover{color:var(--accent)!important}
      #panel-fila-zap.v70-fila-v31 .empresa-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:5px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)}
      #panel-fila-zap.v70-fila-v31 .pre-card-link,#panel-fila-zap.v70-fila-v31 .pre-sep,#panel-fila-zap.v70-fila-v31 .pre-chip-mini{font-size:10px!important;line-height:1.25!important;text-decoration:none!important}
      #panel-fila-zap.v70-fila-v31 .pre-card-link{background:none;border:0;padding:0;cursor:pointer;font-family:'Syne',sans-serif;font-weight:700}
      #panel-fila-zap.v70-fila-v31 .pre-site{color:var(--accent)!important}
      #panel-fila-zap.v70-fila-v31 .pre-whatsapp{color:var(--ok)!important}
      #panel-fila-zap.v70-fila-v31 .pre-card-link.muted{color:var(--muted)!important}
      #panel-fila-zap.v70-fila-v31 .pre-sep{color:var(--muted);margin:0 3px}
      #panel-fila-zap.v70-fila-v31 .pre-chip-mini{color:var(--muted);margin-left:8px;font-family:'DM Mono',monospace}
      #panel-fila-zap.v70-fila-v31 .empresa-actions{display:flex;gap:6px;align-items:center;justify-content:flex-end}
      #panel-fila-zap.v70-fila-v31 .fila-zap-status{font-family:'DM Mono',monospace;font-size:8px;border:1px solid var(--border2);border-radius:999px;padding:5px 8px;color:var(--text2);white-space:nowrap}
      #panel-fila-zap.v70-fila-v31 .fila-zap-status.nao_enviada{color:var(--accent);border-color:rgba(184,240,89,.35);background:rgba(184,240,89,.08)}
      #panel-fila-zap.v70-fila-v31 .fila-zap-status.em_fila{color:#4ab3ff;border-color:rgba(74,179,255,.35);background:rgba(74,179,255,.08)}
      #panel-fila-zap.v70-fila-v31 .fila-zap-status.enviada,#panel-fila-zap.v70-fila-v31 .fila-zap-status.respondida,#panel-fila-zap.v70-fila-v31 .fila-zap-status.fechada{color:var(--ok);border-color:rgba(78,203,113,.35);background:rgba(78,203,113,.08)}
      #panel-fila-zap.v70-fila-v31 .fila-zap-status.erro,#panel-fila-zap.v70-fila-v31 .fila-zap-status.recusada{color:var(--error);border-color:rgba(255,80,80,.35);background:rgba(255,80,80,.08)}
      #panel-fila-zap.v70-fila-v31 .chip-accordion{border-bottom:1px solid var(--border)}
      #panel-fila-zap.v70-fila-v31 .chip-accordion-header{display:flex;align-items:center;gap:10px;padding:15px 18px;cursor:pointer;border-left:3px solid var(--accent);background:rgba(255,255,255,.025)}
      #panel-fila-zap.v70-fila-v31 .chip-accordion-chevron{font-size:14px;color:var(--muted);transition:.2s}
      #panel-fila-zap.v70-fila-v31 .chip-accordion.open .chip-accordion-chevron{transform:rotate(90deg);color:var(--accent)}
      #panel-fila-zap.v70-fila-v31 .chip-accordion-body{display:none}
      #panel-fila-zap.v70-fila-v31 .chip-accordion.open .chip-accordion-body{display:block}
      #panel-fila-zap.v70-fila-v31 .chip-fila-scroll{max-height:360px;overflow:auto}
      @media(max-width:900px){#panel-fila-zap.v70-fila-v31{flex-direction:column!important;height:auto!important}.zapRight{height:auto!important;min-height:420px}.zapLeft{height:auto!important;min-height:520px}}
    `; document.head.appendChild(style);
  }

  async function renderFilaZapV70(){
    applyStyles();
    const panel=document.getElementById('panel-fila-zap'); if(!panel) return;
    setOnlyPanel('panel-fila-zap','WhatsApp');
    panel.classList.remove('v32-zap-panel','v33-panel','v69-zap-panel');
    panel.classList.add('v70-fila-v31');
    panel.style.padding='0'; panel.style.overflow='hidden'; panel.style.flexDirection='row'; panel.style.height='100vh'; panel.style.width='100%'; panel.style.maxWidth='none';

    panel.innerHTML=`<div class="zapLeft"><div class="zapLeft-inner"><div class="page-header" style="flex-shrink:0;padding:20px 20px 0"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub">// carregando fila por chip...</div></div></div></div><div class="zapDivider"></div><div class="zapRight"><div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:24px">// carregando chips...</div></div>`;
    const c=db(); if(!c) return;
    const state=window.__filaZapStateV70 ||= { date:'', status:'all', chip:'all' };

    const [{data:items,error},{data:chips,error:chipErr}] = await Promise.all([
      c.from('pre_dispatch_items')
        .select('id,lead_id,chip_instance,chip_label,scheduled_date,status,position,updated_at,created_at,leads(company_name,phone,normalized_phone,website,maps_url,city,state,rating,reviews_count,category,category_name)')
        .eq('user_id',uid())
        .in('status',finalStatuses())
        .order('scheduled_date',{ascending:true})
        .order('chip_label',{ascending:true})
        .order('position',{ascending:true}),
      c.from('whatsapp_instances')
        .select('id,label,name,instance,phone,active,status,connection_state,daily_limit')
        .eq('user_id',uid())
        .eq('active',true)
        .order('label',{ascending:true})
    ]);
    if(error){ panel.innerHTML=`<div class="page-header"><div class="page-title">Fila <span>WhatsApp.</span></div><div class="page-sub" style="color:var(--error)">// erro: ${esc(error.message)}</div></div>`; return; }
    if(chipErr) console.warn('[v70][fila-zap-chips]', chipErr.message);

    const rows=(items||[]).map(r=>({ ...r, lead:r.leads||{} }));
    const activeChips=(chips||[]);
    const badge=document.getElementById('badge-fila-zap'); if(badge) badge.textContent=String(rows.filter(r=>readyStatuses().includes(String(r.status||'').toLowerCase())).length);
    const dates=[...new Set([...weekDates(),...rows.map(r=>r.scheduled_date).filter(Boolean)])].sort();
    if(!state.date || !dates.includes(state.date)) state.date=dates.includes(todayIso())?todayIso():(dates[0]||todayIso());
    if(state.chip!=='all' && !activeChips.some(ch=>chipKey(ch)===state.chip || chipTitle(ch)===state.chip)) state.chip='all';

    const statuses=['all','Não enviada','Em fila','Enviada','Respondida','Não respondida','Recusada','Fechada','Erro'];
    const byDate=rows.filter(r=>r.scheduled_date===state.date);
    const countStatus=(label,list=byDate)=> label==='all'?list.length:list.filter(r=>statusLabel(r.status)===label).length;
    const selectedRows=byDate
      .filter(r=>state.status==='all' || statusLabel(r.status)===state.status)
      .filter(r=>state.chip==='all' || rowChipInstance(r)===state.chip || rowChipName(r)===state.chip)
      .sort((a,b)=>(a.position||0)-(b.position||0));

    const leadRow=(r,compact=false)=>{ const l=r.lead||{}; const label=statusLabel(r.status); const web=String(l.website||'').trim(); return `<div class="empresa-card fila-zap-row ${compact?'compact':''}">
      <div class="empresa-info">
        <div class="empresa-nome pre-card-name">${leadNameHtml(l)}</div>
        <div class="empresa-meta pre-card-actions-line">
          ${web?`<a href="${esc(normalizeUrl(web))}" target="_blank" rel="noopener noreferrer" class="pre-card-link pre-site">Site</a>`:`<span class="pre-card-link muted">Sem site</span>`}
          <span class="pre-sep">|</span>
          <button class="pre-card-link pre-whatsapp" onclick="copyPreEnvioWhatsappV70('${esc(phoneOf(l))}')">WhatsApp</button>
          <span class="pre-chip-mini">${esc(rowChipName(r))}</span>
        </div>
      </div>
      <div class="empresa-actions"><span class="fila-zap-status ${esc(statusKey(label))}">${esc(label)}</span></div>
    </div>`; };

    const leftHtml=`<div class="zapLeft" id="zapLeft"><div class="zapLeft-inner">
      <div class="page-header" style="flex-shrink:0;padding:20px 20px 0">
        <div class="page-title">Fila <span>WhatsApp.</span></div>
        <div class="page-sub" id="filaZapSub">// ${rows.length} lead(s) na fila final · visão por dia, chip e status</div>
      </div>
      <div style="padding:16px 20px;flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
        <div class="card-title" style="flex-shrink:0">Selecionar empresas <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;margin-left:4px">— controle operacional da fila final</span></div>
        <div class="day-tabs" id="disparoDayTabs" style="flex-shrink:0">${dates.map(d=>`<button type="button" class="day-tab ${state.date===d?'active':''}" onclick="setFilaZapDateV70('${esc(d)}')">${esc(dayLabel(d))}${d===todayIso()?' <span style="color:var(--accent);font-size:8px">●</span>':''}<span class="day-count">${rows.filter(r=>r.scheduled_date===d).length}</span></button>`).join('')}</div>
        <div class="status-tabs" id="disparoStatusTabs" style="flex-shrink:0">${statuses.map(st=>`<button type="button" class="status-tab ${state.status===st?'active':''}" onclick="setFilaZapStatusV70('${esc(st)}')">${st==='all'?'Todos':esc(st)} <span>${countStatus(st)}</span></button>`).join('')}</div>
        <div class="stats-row" id="disparoStats" style="flex-shrink:0"><span>${selectedRows.length} exibindo</span><span>${countStatus('Não enviada')} não enviada</span><span>${countStatus('Em fila')} em fila</span><span>${countStatus('Enviada')} enviada</span></div>
        <div id="disparoEmpresasList" class="stretch-list zap-empresa-list">${selectedRows.length?selectedRows.map(r=>leadRow(r)).join(''):`<div class="fila-empty">// nenhuma empresa neste filtro</div>`}</div>
      </div>
    </div></div>`;

    const rightHtml=`<div class="zapRight" id="zapRight">${activeChips.length?activeChips.map((chip,idx)=>{
      const key=chipKey(chip), title=chipTitle(chip), sub=chipSub(chip);
      const list=byDate.filter(r=>rowChipInstance(r)===key || rowChipName(r)===title || rowChipInstance(r)===title || rowChipName(r)===key);
      const open=(state.chip==='all' && idx===0) || state.chip===key || state.chip===title;
      const limit=Number(chip.daily_limit || 120) || 120;
      return `<div class="chip-accordion ${open?'open':''}">
        <div class="chip-accordion-header" onclick="setFilaZapChipV70('${esc(open?'all':key)}')" style="border-left-color:${idx%2===0?'var(--accent)':'#4ab3ff'}">
          <span class="chip-accordion-chevron">›</span>
          <div style="flex:1;min-width:0"><div style="font-family:'DM Mono',monospace;font-size:11px;color:${idx%2===0?'var(--accent)':'#4ab3ff'};font-weight:800">${esc(title)}</div><div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">${esc(sub)}</div></div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);white-space:nowrap">(${list.length}/${limit} · ${list.filter(r=>statusLabel(r.status)==='Não enviada').length} aguardando · ${list.filter(r=>statusLabel(r.status)==='Erro').length} erro · ${list.filter(r=>statusLabel(r.status)==='Enviada').length} enviados)</div>
        </div>
        <div class="chip-accordion-body"><div class="chip-fila-scroll">${list.length?list.map(r=>leadRow(r,true)).join(''):`<div class="fila-empty">// nenhum lead neste chip para ${esc(dayLabel(state.date))}</div>`}</div></div>
      </div>`; }).join(''):`<div class="fila-empty">// nenhum chip ativo encontrado</div>`}</div>`;

    panel.innerHTML=`${leftHtml}<div class="zapDivider"></div>${rightHtml}`;
  }

  function setDate(d){ window.__filaZapStateV70 ||= {date:'',status:'all',chip:'all'}; window.__filaZapStateV70.date=d; renderFilaZapV70(); }
  function setStatus(st){ window.__filaZapStateV70 ||= {date:'',status:'all',chip:'all'}; window.__filaZapStateV70.status=st; renderFilaZapV70(); }
  function setChip(chip){ window.__filaZapStateV70 ||= {date:'',status:'all',chip:'all'}; window.__filaZapStateV70.chip=chip||'all'; renderFilaZapV70(); }

  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){ const n=String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); if(n==='fila-zap'||n==='whatsapp'||n==='zap'||name==='WhatsApp'){ renderFilaZapV70(); return; } return typeof prevSwitch==='function'?prevSwitch(name):undefined; };
  window.renderFilaZap=renderFilaZapV70;
  window.renderFilaZapV70=renderFilaZapV70;
  window.setFilaZapDateV70=setDate; window.setFilaZapStatusV70=setStatus; window.setFilaZapChipV70=setChip;
  window.setFilaZapDateV31=setDate; window.setFilaZapStatusV31=setStatus; window.setFilaZapChipV31=setChip;
  window.copyPreEnvioWhatsappV70=copyText;
  document.addEventListener('click',function(e){ const nav=e.target.closest?.('.nav-item[data-label]'); if(!nav) return; const label=nav.getAttribute('data-label')||''; if(label!=='WhatsApp') return; e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); renderFilaZapV70(); },true);
  document.addEventListener('DOMContentLoaded',()=>{ applyStyles(); console.log('[v70][fila-whatsapp-visual-v31] ativo',VERSION); setTimeout(()=>{ try{ if(document.getElementById('panel-fila-zap')?.classList.contains('active')) renderFilaZapV70(); }catch(e){} },450); });
})();
