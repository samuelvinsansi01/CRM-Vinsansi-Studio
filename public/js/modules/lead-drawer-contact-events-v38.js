/* V38 — Ficha global + histórico multicanal
   - Adiciona botão Ficha em cards que ainda não tinham.
   - Carrega a ficha diretamente do banco quando possível.
   - Registra/mostra canal de envio: WhatsApp, Instagram, Email ou Manual.
   - Não sobrescreve dados preenchidos na Base Permanente; apenas complementa canal/histórico. */
(function(){
  'use strict';
  const VERSION = '20260616-v38-drawer-contact-events';
  const USER_ID_FALLBACK = 'c02fe973-4eb5-4036-9f8d-8787937e8b11';

  function sb(){ try { return window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null); } catch(_) { return window.sbClient || null; } }
  function uid(){ try { return window.currentUser?.id || (typeof currentUser !== 'undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || USER_ID_FALLBACK; } catch(_) { return USER_ID_FALLBACK; } }
  function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
  function digits(v){ return String(v||'').replace(/\D/g,''); }
  function normPhone(v){ let d=digits(v); if(!d) return ''; if(d.startsWith('00')) d=d.slice(2); if(d.startsWith('55')) return d; if(d.length===10||d.length===11) return '55'+d; return d; }
  function normUrl(v){ return String(v||'').trim().replace(/\/+$/,'').toLowerCase(); }
  function normSite(v){ let raw=String(v||'').trim(); if(!raw) return ''; try{ const u=raw.startsWith('http')?new URL(raw):new URL('https://'+raw); return u.hostname.replace(/^www\./i,'').toLowerCase(); }catch(_){ return raw.replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].toLowerCase(); } }
  function normInsta(v){ let raw=String(v||'').trim(); if(!raw) return ''; raw=raw.replace(/^@/,''); try{ if(raw.includes('instagram.com')){ const u=raw.startsWith('http')?new URL(raw):new URL('https://'+raw); return (u.pathname.split('/').filter(Boolean)[0]||'').replace(/^@/,'').toLowerCase(); } }catch(_){} return raw.split('?')[0].split('/')[0].replace(/^@/,'').toLowerCase(); }
  function now(){ return new Date().toISOString(); }
  function notify(msg,type){ try{ if(typeof window.notify==='function') return window.notify(msg,type); }catch(_){} console.log(msg); }
  function channelLabel(ch){ return ({whatsapp:'WhatsApp',instagram:'Instagram',email:'Email',manual:'Manual'})[String(ch||'').toLowerCase()] || (ch||'—'); }
  function channelIcon(ch){ return ({whatsapp:'💬',instagram:'📸',email:'✉️',manual:'✍️'})[String(ch||'').toLowerCase()] || '•'; }
  function fmtDate(v){ if(!v) return '—'; try{return new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(_){return v;} }
  function getLeadName(lead){ return lead?.company_name || lead?.nome || lead?.title || lead?.companyName || 'Lead'; }
  function getLeadPhone(lead){ return normPhone(lead?.normalized_phone || lead?.phone || lead?.whatsapp || lead?.telefone || ''); }

  function addStyle(){ if(document.getElementById('v38-lead-events-style')) return; const st=document.createElement('style'); st.id='v38-lead-events-style'; st.textContent=`
    .v38-ficha-btn{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:7px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:6px 9px;cursor:pointer;text-decoration:none;white-space:nowrap}.v38-ficha-btn:hover{border-color:var(--accent);color:var(--accent)}
    .v38-channel-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.v38-channel-badge{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035);border-radius:999px;padding:4px 8px;font-family:'DM Mono',monospace;font-size:8px;color:var(--text2)}.v38-channel-badge.whatsapp{color:var(--ok);border-color:rgba(78,203,113,.28)}.v38-channel-badge.instagram{color:#e1306c;border-color:rgba(225,48,108,.28)}.v38-channel-badge.email{color:#5bb8f5;border-color:rgba(91,184,245,.28)}
    .v38-events-list{display:flex;flex-direction:column;gap:8px}.v38-event{border:1px solid var(--border2);border-radius:10px;background:rgba(255,255,255,.025);padding:10px}.v38-event-top{display:flex;justify-content:space-between;gap:8px;align-items:center;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)}.v38-event-channel{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:var(--text)}.v38-event-meta{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:5px;line-height:1.5}.v38-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:14px;border:1px dashed var(--border2);border-radius:10px;text-align:center}
  `; document.head.appendChild(st); }

  async function fetchLeadById(id){
    const c=sb(); const user=uid(); if(!c||!user||!id) return null;
    const {data,error}=await c.from('leads').select('*').eq('user_id',user).eq('id',String(id)).maybeSingle();
    if(error) console.warn('[v38][fetch-lead]',error.message||error);
    return data||null;
  }

  async function fetchBaseById(id){
    const c=sb(); const user=uid(); if(!c||!user||!id) return null;
    const {data,error}=await c.from('base_permanente').select('*').eq('user_id',user).eq('id',String(id)).maybeSingle();
    if(error) console.warn('[v38][fetch-base]',error.message||error);
    return data||null;
  }

  async function fetchBaseByIdentity(payload={}){
    const c=sb(); const user=uid(); if(!c||!user) return null;
    const phone=normPhone(payload.normalized_phone||payload.phone||payload.whatsapp||'');
    const site=normSite(payload.website||payload.site||'');
    const insta=normInsta(payload.instagram_url||payload.instagram||'');
    const maps=normUrl(payload.maps_url||payload.googleUrl||payload.url||'');
    const checks=[];
    if(phone) checks.push(['normalized_phone',phone]);
    if(site) checks.push(['website',site]);
    if(insta) checks.push(['instagram_url',insta]);
    if(maps) checks.push(['maps_url',maps]);
    for(const [field,value] of checks){
      const {data,error}=await c.from('base_permanente').select('*').eq('user_id',user).eq(field,value).limit(1);
      if(error) console.warn('[v38][fetch-base-identity]',field,error.message||error);
      if(data?.[0]) return data[0];
    }
    return null;
  }

  async function fetchEventsFor(payload={}){
    const c=sb(); const user=uid(); if(!c||!user) return [];
    const leadId=payload.lead_id||payload.id||'';
    const baseId=payload.base_permanente_id||payload.base_id||'';
    const phone=normPhone(payload.normalized_phone||payload.phone||payload.whatsapp||'');
    let rows=[];
    if(baseId){ const {data}=await c.from('contact_events').select('*').eq('user_id',user).eq('base_permanente_id',baseId).order('sent_at',{ascending:false}).limit(50); rows=data||[]; }
    if(!rows.length && leadId){ const {data}=await c.from('contact_events').select('*').eq('user_id',user).eq('lead_id',String(leadId)).order('sent_at',{ascending:false}).limit(50); rows=data||[]; }
    if(!rows.length && phone){ const {data}=await c.from('contact_events').select('*').eq('user_id',user).eq('normalized_phone',phone).order('sent_at',{ascending:false}).limit(50); rows=data||[]; }
    return rows;
  }

  async function recordContactEventV38(payload={}){
    const c=sb(); const user=uid(); if(!c||!user) return {ok:false,error:'Supabase/usuário indisponível'};
    const lead=payload.lead || {};
    const channel=String(payload.channel||payload.sent_channel||payload.source_channel||'whatsapp').toLowerCase();
    const sentAt=payload.sent_at || payload.dispatched_at || now();
    const phone=normPhone(payload.normalized_phone||payload.phone||lead.normalized_phone||lead.phone||lead.whatsapp||'');
    const website=normSite(payload.website||lead.website||'') || null;
    const instagram=normInsta(payload.instagram_url||lead.instagram_url||lead.instagram||'') || null;
    const maps=normUrl(payload.maps_url||lead.maps_url||lead.googleUrl||lead.url||'') || null;
    const company=payload.company_name || lead.company_name || lead.nome || lead.title || null;
    const sourceAccount=payload.source_account || payload.source || payload.chip_label || payload.chip_instance || payload.profile || null;
    const sourceInstance=payload.source_instance || payload.instance || payload.chip_instance || null;

    let base = await fetchBaseByIdentity({normalized_phone:phone,website,instagram_url:instagram,maps_url:maps});
    const baseRow={
      user_id:user, company_name:company, normalized_phone:phone || null, website, instagram_url:instagram, maps_url:maps,
      status:'ja_enviado', notes:payload.notes || `salvo automaticamente por ${channelLabel(channel)}`,
      last_channel:channel, source_account:sourceAccount, source_instance:sourceInstance, last_contact_at:sentAt,
      last_event_type:payload.event_type || 'sent', last_event_status:payload.status || 'sent', updated_at:now()
    };
    if(channel==='whatsapp') baseRow.whatsapp_sent_at=sentAt;
    if(channel==='instagram') baseRow.instagram_sent_at=sentAt;
    if(channel==='email') baseRow.email_sent_at=sentAt;
    if(channel==='manual') baseRow.manual_sent_at=sentAt;
    // carrega dados enriquecidos se vierem no lead/payload
    ['street','city','state','country_code','category','category_name','rating','reviews_count','raw_payload'].forEach(k=>{ const v=payload[k] ?? lead[k]; if(v!==undefined && v!==null && String(v).trim?.() !== '') baseRow[k]=v; });
    const cats=payload.categories ?? lead.categories; if(cats) baseRow.categories=Array.isArray(cats)?cats:[];

    if(base?.id){
      const patch={...baseRow}; delete patch.user_id; delete patch.normalized_phone;
      // Não sobrescrever dados de identidade se já existem; complementa apenas vazios.
      ['company_name','website','instagram_url','maps_url','street','city','state','country_code','category','category_name','rating','reviews_count','raw_payload','categories'].forEach(k=>{
        const current=base[k];
        const incoming=patch[k];
        const currentEmpty = current===null || current===undefined || String(Array.isArray(current)?current.join(''):current).trim()==='' || (Array.isArray(current)&&!current.length);
        if(!currentEmpty && incoming!==undefined) delete patch[k];
      });
      const channels=Array.isArray(base.sent_channels)?base.sent_channels:[];
      patch.sent_channels = channels.includes(channel) ? channels : [...channels,channel];
      await c.from('base_permanente').update(patch).eq('user_id',user).eq('id',base.id);
    } else {
      baseRow.sent_channels=[channel]; baseRow.created_at=now();
      const {data,error}=await c.from('base_permanente').insert(baseRow).select('id').maybeSingle();
      if(error) console.warn('[v38][base-insert]',error.message||error);
      base = data || base;
    }

    const eventRow={
      user_id:user, lead_id:payload.lead_id||lead.id||null, base_permanente_id:base?.id||payload.base_permanente_id||null,
      company_name:company, normalized_phone:phone||null, website, instagram_url:instagram, maps_url:maps,
      channel, source_account:sourceAccount, source_instance:sourceInstance,
      event_type:payload.event_type||'sent', status:payload.status||'sent', message_template:payload.message_template||payload.template_name||null,
      sent_at:sentAt, created_at:now(), metadata:payload.metadata||{}
    };
    const {error:evErr}=await c.from('contact_events').insert(eventRow);
    if(evErr) console.warn('[v38][contact-event]',evErr.message||evErr);
    return {ok:!evErr,error:evErr?.message||null,baseId:base?.id||null};
  }

  function ensureEventsSection(){
    const body=document.querySelector('#leadDrawer .lead-drawer-body'); if(!body) return null;
    let sec=document.getElementById('leadDrawerContactEventsSection');
    if(sec) return sec;
    sec=document.createElement('section');
    sec.className='lead-drawer-section';
    sec.id='leadDrawerContactEventsSection';
    sec.innerHTML='<div class="lead-drawer-section-title">Histórico de contato por canal</div><div id="leadDrawerContactEvents" class="v38-events-list"><div class="v38-empty">// carregando histórico...</div></div>';
    const hist=[...body.querySelectorAll('.lead-drawer-section')].find(s=>(s.querySelector('.lead-drawer-section-title')?.textContent||'').trim()==='Histórico');
    if(hist) body.insertBefore(sec,hist); else body.appendChild(sec);
    return sec;
  }

  function renderEventRows(rows=[]){
    const el=document.getElementById('leadDrawerContactEvents'); if(!el) return;
    if(!rows.length){ el.innerHTML='<div class="v38-empty">// nenhum envio registrado para este lead ainda</div>'; return; }
    el.innerHTML=rows.map(r=>`<div class="v38-event"><div class="v38-event-top"><div class="v38-event-channel">${channelIcon(r.channel)} ${esc(channelLabel(r.channel))}</div><div>${esc(fmtDate(r.sent_at||r.created_at))}</div></div><div class="v38-event-meta">Status: ${esc(r.status||'sent')} · Origem: ${esc(r.source_account||r.source_instance||'não informado')}${r.message_template?` · Template: ${esc(r.message_template)}`:''}</div></div>`).join('');
  }

  async function refreshDrawerEventsV38(payload={}){
    ensureEventsSection();
    const base = payload.base_permanente_id || payload.source_table==='base_permanente' ? payload : await fetchBaseByIdentity(payload);
    const rows = await fetchEventsFor({...payload, base_permanente_id:base?.id});
    renderEventRows(rows);
    // badges no topo dos dados importados
    const sheet=document.getElementById('leadDrawerDataSheet');
    if(sheet && (rows.length || base?.sent_channels?.length)){
      const channels = rows.length ? [...new Set(rows.map(r=>r.channel).filter(Boolean))] : (base.sent_channels||[]);
      const badges=`<div class="lead-info-subtitle-v37">Canais já utilizados</div><div class="v38-channel-badges">${channels.map(ch=>`<span class="v38-channel-badge ${esc(ch)}">${channelIcon(ch)} ${esc(channelLabel(ch))}</span>`).join('')}</div>`;
      if(!sheet.querySelector('.v38-channel-badges')) sheet.insertAdjacentHTML('afterbegin', badges);
    }
  }

  const previousOpen=window.openLeadDrawer;
  window.openLeadDrawer = async function(id){
    addStyle();
    let opened=false;
    if(typeof previousOpen==='function'){
      try { previousOpen(id); opened=true; } catch(e){ console.warn('[v38][prev-open]',e?.message||e); }
    }
    // Se a versão anterior não achou no cache, tenta buscar no banco como lead ou base permanente.
    setTimeout(async()=>{
      let lead = await fetchLeadById(id);
      let source='leads';
      if(!lead){ lead = await fetchBaseById(id); source='base_permanente'; }
      if(lead && typeof window.normalizeLeadForDrawer==='function' && typeof window.renderLeadDrawer==='function'){
        try{
          window.activeLeadDrawerId = id;
          window.activeLeadDrawerData = window.normalizeLeadForDrawer({...lead, source_table:source});
          window.renderLeadDrawer();
          document.getElementById('leadDrawerOverlay')?.classList.add('open');
          document.getElementById('leadDrawer')?.setAttribute('aria-hidden','false');
        }catch(e){ console.warn('[v38][render-db-lead]',e?.message||e); }
      }
      await refreshDrawerEventsV38(lead || {id});
    }, opened ? 350 : 50);
  };

  function inferLeadIdFromCard(card){
    return card?.getAttribute('data-lead-id') || card?.dataset?.leadId || card?.getAttribute('data-id') || card?.getAttribute('data-pre-id') || card?.getAttribute('data-fila-id') || '';
  }

  function injectFichaButtons(){
    addStyle();
    document.querySelectorAll('.empresa-card').forEach(card=>{
      if(card.dataset.v38FichaInjected==='1') return;
      const id=inferLeadIdFromCard(card);
      if(!id) return;
      if(card.querySelector('[onclick*="openLeadDrawer"]')) { card.dataset.v38FichaInjected='1'; return; }
      let actions=card.querySelector('.empresa-actions') || card.querySelector('.v33-actions');
      if(!actions){ actions=document.createElement('div'); actions.className='empresa-actions'; card.appendChild(actions); }
      const btn=document.createElement('button'); btn.type='button'; btn.className='v38-ficha-btn'; btn.textContent='Ficha';
      btn.onclick=function(ev){ ev.preventDefault(); ev.stopPropagation(); window.openLeadDrawer(id); };
      actions.insertBefore(btn, actions.firstChild);
      card.dataset.v38FichaInjected='1';
    });
  }

  const obs=new MutationObserver(()=>{ clearTimeout(window.__v38FichaTimer); window.__v38FichaTimer=setTimeout(injectFichaButtons,80); });
  document.addEventListener('DOMContentLoaded',()=>{ addStyle(); injectFichaButtons(); obs.observe(document.body,{childList:true,subtree:true}); });
  setInterval(injectFichaButtons,2000);

  window.recordContactEventV38 = recordContactEventV38;
  window.refreshDrawerEventsV38 = refreshDrawerEventsV38;
  window.__V38_DRAWER_CONTACT_EVENTS__ = VERSION;
})();
