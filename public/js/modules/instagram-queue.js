/* V94 — Instagram V1: perfis, fila por perfil/dia/lote e base para extensão Chrome.
   - Usa instagram_profiles e instagram_dispatch_items.
   - Não cria templates separados: usa Templates de Prospecção.
   - Configuração por perfil: 60/dia, 4 lotes, 15/lote, 120min entre lotes.
   - Instagram: Em fila / Enviadas / Erro.
*/
(function(){
  'use strict';
  const VERSION='20260622-V154-INSTAGRAM-CARRYOVER-20H';
  const DEFAULTS={daily_limit:60,blocks:4,block_size:15,interval_minutes:120};
  let activeStatus='queued';
  let activeDate=toDateInput(new Date());
  let activeProfileFilter='all';
  let profilesCache=[];
  let queueCache=[];
  let backlogCache=[];
  let leadsById={};
  let weekCountsCache={};

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); } catch(e){} }

  async function safePersistSentContact(row){
    const c=sb(); if(!c || !row?.user_id || !row?.normalized_phone) return;
    try{
      const {data:existing,error:selErr}=await c.from('sent_contacts')
        .select('id,raw_payload')
        .eq('user_id',row.user_id)
        .eq('normalized_phone',row.normalized_phone)
        .eq('active',true)
        .limit(1);
      if(selErr) throw selErr;
      if(existing && existing[0]?.id){
        const prev=existing[0].raw_payload && typeof existing[0].raw_payload==='object' ? existing[0].raw_payload : {};
        const patch={
          lead_id:row.lead_id||null,
          company_name:row.company_name||null,
          phone:row.phone||row.normalized_phone,
          block_type:row.block_type||'already_sent',
          source:row.source||'instagram',
          reason:row.reason||'instagram_sent',
          active:true,
          dispatched_at:row.dispatched_at||new Date().toISOString(),
          raw_payload:{...prev,...(row.raw_payload||{})}
        };
        const {error:upErr}=await c.from('sent_contacts').update(patch).eq('id',existing[0].id).eq('user_id',row.user_id);
        if(upErr) throw upErr;
      }else{
        const {error:insErr}=await c.from('sent_contacts').insert({...row,created_at:new Date().toISOString()});
        if(insErr) throw insErr;
      }
    }catch(e){ console.warn('[instagram][sent_contacts-safe]', e?.message||e); }
  }
  async function apiInstagram(action, payload={}){
    const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,user_id:uid(),...payload})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok || data.error || data.success===false) throw new Error(data.error || data.message || ('API HTTP '+res.status));
    return data;
  }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function cleanIgUsername(v){
    let raw=String(v||'').trim();
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
    return candidate;
  }
  function instagramFromLead(lead){
    return cleanIgUsername(lead?.instagram_username || lead?.instagram_url || lead?.instagram || '');
  }
  function isInstagramEligibleStage(lead){
    const stage=String(lead?.current_stage||'').toLowerCase();
    const channel=String(lead?.lead_channel||'').toLowerCase();
    return stage==='attribution_instagram' || stage==='instagram_backlog' || channel==='instagram';
  }
  function isSentLikeLead(lead){
    const hay=[lead?.status,lead?.current_status,lead?.current_stage,lead?.pipeline_status].map(x=>String(x||'').toLowerCase()).join(' ');
    return /(^|_|)(sent|enviado|whatsapp_sent|instagram_sent)(_||$)/.test(hay);
  }

  function isInstagramApprovedForQueue(lead){
    const stage=String(lead?.current_stage||'').toLowerCase();
    const ps=String(lead?.pipeline_status||lead?.current_status||lead?.status||'').toLowerCase();
    return stage==='instagram_backlog' || ps==='instagram_backlog' || ps==='approved_for_instagram_queue' || ps==='instagram_approved' || ps==='approved_instagram' || ps.includes('approved_for_instagram');
  }
  function igUrl(username){ const u=cleanIgUsername(username); return u?`https://www.instagram.com/${u}/`:''; }
  function toDateInput(d){ const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,10); }
  function fmtDate(s){ try { const [y,m,d]=String(s).split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.',''); } catch(e){ return s; } }
  function parseLocalDate(s){ const [y,m,d]=String(s||toDateInput(new Date())).split('-').map(Number); return new Date(y,m-1,d); }
  function addDaysISO(s,days){ const d=parseLocalDate(s); d.setDate(d.getDate()+Number(days||0)); return toDateInput(d); }
  function weekStartISO(s){ const d=parseLocalDate(s); const day=d.getDay(); d.setDate(d.getDate()-day); return toDateInput(d); }
  function weekDatesISO(s){ const start=weekStartISO(s); return Array.from({length:7},(_,i)=>addDaysISO(start,i)); }
  function fmtWeekCardDate(s){ try { const [y,m,d]=String(s).split('-').map(Number); const dt=new Date(y,m-1,d); const wd=dt.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''); return `${wd}, ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`; } catch(e){ return s; } }
  function isSentStatus(s){ return ['sent','enviado'].includes(String(s||'').toLowerCase()); }
  function isErrorStatus(s){ return ['error','failed','erro'].includes(String(s||'').toLowerCase()); }
  function isInvalidStatus(s){ return ['invalid','invalidated','invalido','invalidado'].includes(String(s||'').toLowerCase()); }
  function isActiveQueueStatus(s){ return !isSentStatus(s) && !isErrorStatus(s) && !isInvalidStatus(s); }
  function statusVisual(s){ s=String(s||'queued').toLowerCase(); if(isSentStatus(s)) return 'Enviada'; if(isErrorStatus(s)) return 'Erro'; if(isInvalidStatus(s)) return 'Invalidado'; return 'Em fila'; }
  function statusClass(s){ s=String(s||'queued').toLowerCase(); if(isSentStatus(s)) return 'ok'; if(isErrorStatus(s)) return 'err'; if(isInvalidStatus(s)) return 'err'; return 'queue'; }
  function leadTypeOf(lead,item){
    const t=String(item?.lead_type || lead?.lead_type || lead?.website_type || '').toLowerCase();
    if(t.includes('agreg')) return 'agregador';
    if(t.includes('site') && !t.includes('sem')) return 'com-site';
    return 'sem-site';
  }
  function parentCategoryOf(lead,item){
    const registered=resolveRegisteredParentRamoStrictV111(lead,item);
    if(registered?.nome) return registered.nome;
    if(item?.parent_category) return item.parent_category;
    if(lead?.parent_category) return lead.parent_category;
    if(typeof window.resolveParentRamoForLeadV76==='function') { try { return window.resolveParentRamoForLeadV76(lead)?.nome || window.resolveParentRamoForLeadV76(lead) || ''; } catch(e){} }
    return lead?.category_name || lead?.category || 'Ramo não cadastrado';
  }

  function categoryTextForMatchV111(lead,item){
    const vals=[];
    const push=v=>{
      if(v===null||v===undefined) return;
      if(Array.isArray(v)) v.forEach(push);
      else if(typeof v==='object') Object.values(v).forEach(push);
      else vals.push(String(v));
    };
    push(item?.parent_category); push(lead?.parent_category); push(lead?.category_name); push(lead?.category); push(lead?.categories);
    try{ push(lead?.raw_payload?.category); push(lead?.raw_payload?.categoryName); push(lead?.raw_payload?.categories); }catch(_){}
    return vals.filter(Boolean).join(' ');
  }

  function resolveRegisteredParentRamoStrictV111(lead,item={}){
    const ramos=typeof window.getRamos==='function' ? (window.getRamos()||[]) : [];
    if(!ramos.length) return null;
    const raw=categoryTextForMatchV111(lead,item);
    const n=norm(raw).replace(/-/g,' ');
    if(!n) return null;
    for(const r of ramos){
      const keys=[r.id,r.nome,...(r.keywords||[]),...(r.subcategories||[])].filter(Boolean).map(x=>norm(x).replace(/-/g,' ')).filter(Boolean);
      if(keys.some(k=>n===k || n.includes(k) || k.includes(n))){
        return { id:String(r.id||r.nome||''), nome:String(r.nome||r.id||'') };
      }
    }
    return null;
  }
  async function loadProfiles(){
    const c=sb(), user=uid(); if(!user) return [];
    try{
      const data=await apiInstagram('instagram_profiles_list');
      profilesCache=(data.profiles||[]).map(p=>({ ...DEFAULTS, ...p, username:cleanIgUsername(p.username) }));
      return profilesCache;
    }catch(apiErr){
      console.warn('[v100][profiles-api]',apiErr.message);
      if(!c) return [];
      const {data,error}=await c.from('instagram_profiles').select('*').eq('user_id',user).eq('active',true).order('username',{ascending:true});
      if(error){ console.warn('[v94][profiles]',error.message); return []; }
      profilesCache=(data||[]).map(p=>({ ...DEFAULTS, ...p, username:cleanIgUsername(p.username) }));
      return profilesCache;
    }
  }
  async function loadQueue(){
    const c=sb(), user=uid(); if(!c||!user) return [];
    const {data,error}=await c.from('instagram_dispatch_items').select('*').eq('user_id',user).eq('scheduled_date',activeDate).order('profile_username',{ascending:true}).order('block_number',{ascending:true}).order('position',{ascending:true});
    if(error){ console.warn('[v94][queue]',error.message); return []; }
    queueCache=data||[];
    await normalizeOrphanInstagramItems();
    const ids=[...new Set(queueCache.map(x=>String(x.lead_id||'')).filter(Boolean))];
    leadsById={};
    if(ids.length){
      const {data:leads,error:leadsErr}=await c.from('leads').select('*').in('id',ids);
      if(!leadsErr){ (leads||[]).forEach(l=>leadsById[String(l.id)]=l); }
    }
    await repairFrozenInstagramMessagesV150();
    return queueCache;
  }

  async function loadBacklog(){
    const c=sb(), user=uid(); if(!c||!user){ backlogCache=[]; return []; }
    try{
      const {data:items}=await c.from('instagram_dispatch_items').select('lead_id,status,instagram_username,instagram_url').eq('user_id',user).limit(5000);
      const blockedIds=new Set((items||[]).filter(x=>!isErrorStatus(x.status)&&!isInvalidStatus(x.status)).map(x=>String(x.lead_id||'')).filter(Boolean));
      const blockedIg=new Set((items||[]).filter(x=>!isErrorStatus(x.status)&&!isInvalidStatus(x.status)).flatMap(x=>[cleanIgUsername(x.instagram_username),cleanIgUsername(x.instagram_url)]).filter(Boolean));
      const {data:baseRows}=await c.from('base_permanente').select('normalized_phone,instagram_username,instagram_url,status').eq('user_id',user).limit(5000);
      const blockedPhones=new Set((baseRows||[]).map(x=>String(x.normalized_phone||'')).filter(Boolean));
      (baseRows||[]).forEach(x=>{ const ig=cleanIgUsername(x.instagram_username||x.instagram_url); if(ig) blockedIg.add(ig); });
      const {data,error}=await c.from('leads').select('*').eq('user_id',user).or('current_stage.eq.instagram_backlog,current_status.eq.instagram_backlog,pipeline_status.eq.instagram_backlog').order('updated_at',{ascending:false}).limit(2000);
      if(error){ console.warn('[instagram][backlog]',error.message); backlogCache=[]; return []; }
      backlogCache=(data||[]).filter(l=>{
        const id=String(l.id||'');
        if(blockedIds.has(id)) return false;
        if(isSentLikeLead(l)) return false;
        const ph=String(l.normalized_phone||l.phone||'').replace(/\D/g,'');
        if(ph && blockedPhones.has(ph)) return false;
        const ig=instagramFromLead(l);
        if(!ig || blockedIg.has(ig)) return false;
        return true;
      });
      return backlogCache;
    }catch(e){ console.warn('[instagram][loadBacklog]',e?.message||e); backlogCache=[]; return []; }
  }

  async function loadWeekCounts(){
    const c=sb(), user=uid(); if(!c||!user){ weekCountsCache={}; return {}; }
    const dates=weekDatesISO(activeDate);
    const start=dates[0], end=addDaysISO(start,7);
    const {data,error}=await c.from('instagram_dispatch_items')
      .select('scheduled_date,status')
      .eq('user_id',user)
      .gte('scheduled_date',start)
      .lt('scheduled_date',end);
    if(error){ console.warn('[v112][week-counts]',error.message); weekCountsCache={}; return {}; }
    const m={};
    dates.forEach(d=>m[d]={total:0,queued:0,sent:0,error:0});
    (data||[]).forEach(r=>{
      const d=String(r.scheduled_date||'').slice(0,10);
      if(!m[d]) m[d]={total:0,queued:0,sent:0,error:0};
      const st=String(r.status||'queued').toLowerCase();
      m[d].total++;
      if(isSentStatus(st)) m[d].sent++;
      else if(isErrorStatus(st)) m[d].error++;
      else if(isInvalidStatus(st)) m[d].invalid=(m[d].invalid||0)+1;
      else m[d].queued++;
    });
    weekCountsCache=m;
    return m;
  }


  function instagramCarryoverTargetDateV154(){
    const now=new Date();
    const today=toDateInput(now);
    if(now.getHours()>=20) return addDaysISO(today,1);
    return today;
  }

  async function carryoverInstagramPending20hV154(){
    const c=sb(), user=uid();
    if(!c||!user) return {ok:false, reason:'no_client'};
    const target=instagramCarryoverTargetDateV154();
    const lockKey='lead_certo_ig_carryover_'+target;
    try{
      const last=Number(sessionStorage.getItem(lockKey)||0);
      if(Date.now()-last < 45000) return {ok:true, skipped:true, target};
      sessionStorage.setItem(lockKey,String(Date.now()));
    }catch(_){ }

    // Move apenas itens realmente pendentes/em fila de dias anteriores ao dia-alvo.
    // Antes das 20h: dia-alvo = hoje, então corrige pendentes de ontem para hoje.
    // A partir das 20h: dia-alvo = amanhã, então prepara a operação do próximo dia.
    const {data:oldItems,error:oldErr}=await c.from('instagram_dispatch_items')
      .select('*')
      .eq('user_id',user)
      .lt('scheduled_date',target)
      .order('scheduled_date',{ascending:true})
      .order('profile_username',{ascending:true})
      .order('block_number',{ascending:true})
      .order('position',{ascending:true})
      .limit(1000);
    if(oldErr){ console.warn('[instagram][carryover-old]',oldErr.message); return {ok:false,error:oldErr}; }
    const pending=(oldItems||[]).filter(x=>isActiveQueueStatus(x.status));
    if(!pending.length) return {ok:true,count:0,target};

    if(!profilesCache.length) await loadProfiles();
    const profilesById=new Map((profilesCache||[]).map(p=>[String(p.id),p]));
    const profileByUser=new Map((profilesCache||[]).map(p=>[cleanIgUsername(p.username),p]));

    const {data:targetItems,error:targetErr}=await c.from('instagram_dispatch_items')
      .select('id,profile_id,profile_username,status,block_number,position')
      .eq('user_id',user)
      .eq('scheduled_date',target)
      .order('profile_username',{ascending:true})
      .order('position',{ascending:true});
    if(targetErr){ console.warn('[instagram][carryover-target]',targetErr.message); return {ok:false,error:targetErr}; }

    const byProfile=new Map();
    for(const item of (targetItems||[])){
      const p=profilesById.get(String(item.profile_id||'')) || profileByUser.get(cleanIgUsername(item.profile_username||'')) || defaultInstagramProfile();
      const key=String(p?.id || item.profile_id || cleanIgUsername(item.profile_username||'') || 'sem-perfil');
      if(!byProfile.has(key)) byProfile.set(key,{profile:p||DEFAULTS, items:[]});
      byProfile.get(key).items.push(item);
    }

    let moved=0, skipped=0;
    for(const item of pending){
      const p=profilesById.get(String(item.profile_id||'')) || profileByUser.get(cleanIgUsername(item.profile_username||'')) || defaultInstagramProfile();
      if(!p){ skipped++; continue; }
      const key=String(p.id || cleanIgUsername(p.username));
      if(!byProfile.has(key)) byProfile.set(key,{profile:p, items:[]});
      const bucket=byProfile.get(key);
      let slot;
      try{ slot=computeNextInstagramSlot(bucket.profile,bucket.items); }
      catch(e){ skipped++; continue; }
      const patch={
        scheduled_date:target,
        profile_id:p.id || item.profile_id || null,
        profile_username:p.username || item.profile_username || null,
        block_number:slot.block_number,
        block_size:slot.block_size,
        position:slot.position,
        updated_at:new Date().toISOString()
      };
      const {error:upErr}=await c.from('instagram_dispatch_items').update(patch).eq('user_id',user).eq('id',item.id);
      if(upErr){ console.warn('[instagram][carryover-update]',item.id,upErr.message); skipped++; continue; }
      moved++;
      bucket.items.push({...item,...patch});
    }
    if(moved) notify(`✓ ${moved} pendentes do Instagram movidos para ${fmtDate(target)}`);
    if(skipped) console.warn('[instagram][carryover] itens sem capacidade ou perfil:', skipped);
    return {ok:true,count:moved,skipped,target};
  }

  async function refreshInstagramV94(){
    try{
      ensureInstagramPanel();
      await loadProfiles();
      await carryoverInstagramPending20hV154();
      await loadQueue();
      await loadBacklog();
      await loadWeekCounts();
      loadPreferredProfileFilter();
      renderQueue();
      if(typeof window.updateBadges==='function') window.updateBadges();
    }catch(e){
      console.error('[instagram-queue][refresh]', e);
      const panel=document.getElementById('panel-instagram');
      if(panel){
        panel.innerHTML = `
          <div class="page-header"><div><div class="page-title">Instagram <span>Fila.</span></div><div class="page-sub">// erro ao carregar fila</div></div></div>
          <div class="stretch-card" style="font-family:'DM Mono',monospace;font-size:10px;color:var(--danger);padding:24px">// ${esc(e?.message||e||'erro desconhecido')}</div>
        `;
      }
    }
  }

  function renderWeekCards(){
    const el=document.getElementById('igV112Week'); if(!el) return;
    const dates=weekDatesISO(activeDate);
    const totalLimit=(profilesCache||[]).reduce((acc,p)=>acc+Number(p.daily_limit||60),0) || 60;
    const backlogActive=activeStatus==='backlog';
    const backlogCard=`<button class="ig-v112-week-card ${backlogActive?'active':''}" onclick="window.instagramV142SetBacklog()" style="text-align:left;border:1px solid ${backlogActive?'var(--accent)':'var(--border2)'};background:${backlogActive?'rgba(164,255,64,.06)':'var(--card)'};border-radius:12px;padding:13px 12px;min-height:68px;cursor:pointer;color:var(--text);position:relative">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:${backlogActive?'var(--accent)':'var(--muted)'};margin-bottom:8px">📦 Backlog</div>
      <div style="font-size:18px;font-weight:900">${backlogCache.length}</div>
      <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:4px">aguardando alocação</div>
    </button>`;
    el.innerHTML=backlogCard + dates.map(d=>{
      const c=weekCountsCache[d] || {total:0,queued:0,sent:0,error:0,invalid:0};
      const active=(d===activeDate && activeStatus!=='backlog');
      const isToday=d===toDateInput(new Date());
      return `<button class="ig-v112-week-card ${active?'active':''} ${isToday?'today':''}" onclick="window.instagramV112SetDate('${esc(d)}')" style="text-align:left;border:1px solid ${active?'var(--accent)':(isToday?'rgba(184,240,89,.38)':'var(--border2)')};background:${active?'rgba(164,255,64,.06)':'var(--card)'};border-radius:12px;padding:13px 12px;min-height:68px;cursor:pointer;color:var(--text);position:relative">
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:${active||isToday?'var(--accent)':'var(--muted)'};margin-bottom:8px">${esc(fmtWeekCardDate(d))}</div>
        <div style="font-size:18px;font-weight:900">${c.total}/${totalLimit}</div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:4px">fila ${c.queued} · env ${c.sent} · erro ${c.error} · inv ${c.invalid||0}</div>
        ${isToday?`<div style="display:inline-flex;align-items:center;margin-top:8px;padding:2px 7px;border-radius:999px;border:1px solid rgba(184,240,89,.35);background:rgba(184,240,89,.08);color:var(--accent);font-family:'DM Mono',monospace;font-size:8px;font-weight:800;letter-spacing:.04em">HOJE</div>`:''}
      </button>`;
    }).join('');
  }

  window.instagramV142SetBacklog=function(){
    activeStatus='backlog';
    renderQueue();
  };

  window.instagramV112SetDate=function(date){
    if(activeStatus==='backlog') activeStatus='queued';
    activeDate=String(date||toDateInput(new Date())).slice(0,10);
    const input=document.getElementById('igV94Date'); if(input) input.value=activeDate;
    refreshInstagramV94();
  };

  function getProfile(id){ return profilesCache.find(p=>String(p.id)===String(id)); }
  function defaultInstagramProfile(){
    if(!profilesCache.length) return null;
    if(activeProfileFilter && activeProfileFilter!=='all'){
      const byFilter=getProfile(activeProfileFilter);
      if(byFilter) return byFilter;
    }
    let u='';
    try{ u=cleanIgUsername(localStorage.getItem('instagram_logged_profile_username')||''); }catch(_){ }
    if(u){
      const byUser=(profilesCache||[]).find(x=>cleanIgUsername(x.username)===u);
      if(byUser) return byUser;
    }
    return profilesCache[0] || null;
  }
  function effectiveProfileForItem(item){
    const p=getProfile(item?.profile_id);
    if(p) return p;
    const username=cleanIgUsername(item?.profile_username||'');
    if(username){
      const byUsername=(profilesCache||[]).find(x=>cleanIgUsername(x.username)===username);
      if(byUsername) return byUsername;
      return {id:item?.profile_id||'', username};
    }
    return defaultInstagramProfile() || {id:'sem-perfil',username:'sem-perfil'};
  }
  function effectiveProfileKeyForItem(item){
    const p=effectiveProfileForItem(item);
    return String(p?.id || cleanIgUsername(p?.username) || 'sem-perfil');
  }
  async function normalizeOrphanInstagramItems(){
    const c=sb(), user=uid();
    const p=defaultInstagramProfile();
    if(!c || !user || !p?.id) return false;
    const orphans=(queueCache||[]).filter(item=>!item.profile_id || !cleanIgUsername(item.profile_username||''));
    if(!orphans.length) return false;
    const ids=orphans.map(x=>x.id).filter(Boolean);
    if(!ids.length) return false;
    const {error}=await c.from('instagram_dispatch_items')
      .update({profile_id:p.id,profile_username:p.username,updated_at:new Date().toISOString()})
      .in('id',ids)
      .eq('user_id',user);
    if(error){ console.warn('[instagram][normalize-orphan-items]', error.message); return false; }
    queueCache=(queueCache||[]).map(item=>ids.includes(item.id)?{...item,profile_id:p.id,profile_username:p.username}:item);
    return true;
  }
  function selectedProfileForAllocation(){
    return defaultInstagramProfile();
  }
  function getItemLead(item){ return leadsById[String(item.lead_id)] || {}; }
  function counters(status){
    const list=queueCache||[];
    return {
      queued:list.filter(x=>isActiveQueueStatus(x.status)).length,
      sent:list.filter(x=>isSentStatus(x.status)).length,
      error:list.filter(x=>isErrorStatus(x.status)).length,
      invalid:list.filter(x=>isInvalidStatus(x.status)).length
    };
  }

  function ensureInstagramV119Styles(){
    if(document.getElementById('ig-v119-style')) return;
    const st=document.createElement('style');
    st.id='ig-v119-style';
    st.textContent=`
      #panel-instagram{overflow-y:auto!important;height:100vh!important;align-items:stretch!important;}
      #igV94Content.ig-v119-content{max-height:none!important;overflow:visible!important;}
      #igV94Content .stretch-card{overflow:visible!important;}
      .ig-v119-row>summary::-webkit-details-marker,.ig-v119-lote summary::-webkit-details-marker{display:none;}
      .ig-v119-row:hover{background:rgba(255,255,255,.025)!important;}
      @media (max-width: 900px){
        #igV112Week{grid-template-columns:repeat(2,minmax(130px,1fr))!important;}
        .insta-msg-blocks{grid-template-columns:1fr!important;}
      }
    `;
    document.head.appendChild(st);
  }

  function ensureInstagramPanel(){
    const panel=document.getElementById('panel-instagram'); if(!panel) return;
    if(panel.dataset.v94==='1') return;
    panel.dataset.v94='1';
    ensureInstagramV119Styles();
    panel.innerHTML=`
      <div class="page-header" style="flex-shrink:0">
        <div>
          <div class="page-title">Instagram <span>Fila.</span></div>
          <div class="page-sub">// perfis · 60/dia · 4 lotes de 15 · 2h entre lotes</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="date" id="igV94Date" value="${esc(activeDate)}" style="width:auto;min-width:150px">
          <button class="btn btn-ghost" id="igV94Refresh">Atualizar</button>
        </div>
      </div>
      <div id="igV112Week" style="flex-shrink:0;display:grid;grid-template-columns:repeat(8,minmax(110px,1fr));gap:10px;margin:10px 0 14px 0"></div>
      <div class="status-tabs" id="igV94Tabs" style="flex-shrink:0"></div>
      <div id="igV113ProfileFilters" style="flex-shrink:0;display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px 0"></div>
      <div class="stats-row" id="igV94Stats" style="flex-shrink:0"></div>
      <div id="igV94Content" class="ig-v119-content" style="flex:0 0 auto;min-height:0;overflow:visible;max-height:none;display:flex;flex-direction:column;gap:12px;padding-bottom:36px"></div>
    `;
    document.getElementById('igV94Date')?.addEventListener('change',e=>{ activeDate=e.target.value||toDateInput(new Date()); refreshInstagramV94(); });
    document.getElementById('igV94Refresh')?.addEventListener('click',refreshInstagramV94);
  }
  function renderTabs(){
    const c=counters();
    const tabs=[['backlog','Backlog',backlogCache.length],['queued','Em fila',c.queued],['sent','Enviadas',c.sent],['error','Erro',c.error],['invalid','Invalidados',c.invalid||0]];
    const el=document.getElementById('igV94Tabs'); if(!el) return;
    el.innerHTML=tabs.map(([k,l,n])=>`<button class="status-tab ${activeStatus===k?'active':''}" onclick="window.setInstagramStatusV94('${k}')">${l} <span class="st-count">${n}</span></button>`).join('');
  }
  function renderStats(){
    const c=counters();
    const el=document.getElementById('igV94Stats'); if(!el) return;
    el.innerHTML=`
      <div class="stat-card"><div class="stat-label">PERFIS</div><div class="stat-value">${profilesCache.length}</div></div>
      <div class="stat-card"><div class="stat-label">EM FILA</div><div class="stat-value">${c.queued}</div></div>
      <div class="stat-card"><div class="stat-label">ENVIADAS</div><div class="stat-value">${c.sent}</div></div>
      <div class="stat-card"><div class="stat-label">ERROS</div><div class="stat-value">${c.error}</div></div>
      <div class="stat-card"><div class="stat-label">INVALIDADOS</div><div class="stat-value">${c.invalid||0}</div></div>`;
  }

  function renderProfileFilters(){
    const el=document.getElementById('igV113ProfileFilters'); if(!el) return;
    const totals={};
    (profilesCache||[]).forEach(p=>{ totals[String(p.id)]={queued:0,sent:0,error:0,invalid:0,total:0}; });
    (queueCache||[]).forEach(item=>{
      const pid=effectiveProfileKeyForItem(item);
      if(!totals[pid]) totals[pid]={queued:0,sent:0,error:0,invalid:0,total:0};
      totals[pid].total++;
      if(isSentStatus(item.status)) totals[pid].sent++; else if(isErrorStatus(item.status)) totals[pid].error++; else if(isInvalidStatus(item.status)) totals[pid].invalid++; else totals[pid].queued++;
    });
    const mk=(key,label,sub)=>`<button class="status-tab ${String(activeProfileFilter)===String(key)?'active':''}" onclick="window.instagramV113SetProfileFilter('${esc(key)}')"><b>${esc(label)}</b> <span class="st-count">${esc(sub||'')}</span></button>`;
    const allCount=queueCache.length;
    el.innerHTML=[mk('all','Todos',allCount),...(profilesCache||[]).map(p=>{
      const t=totals[String(p.id)]||{queued:0,sent:0,error:0,invalid:0,total:0};
      return mk(String(p.id),'@'+(p.username||'perfil'), `${t.queued}/${p.daily_limit||60}`);
    })].join('');
  }
  window.instagramV113SetProfileFilter=function(profileId){ activeProfileFilter=String(profileId||'all'); renderQueue(); };
  window.instagramV113SetLoggedProfile=function(username){
    const u=cleanIgUsername(username);
    if(!u){ notify('Perfil logado inválido','err'); return; }
    try{ localStorage.setItem('instagram_logged_profile_username',u); }catch(_){ }
    const p=(profilesCache||[]).find(x=>cleanIgUsername(x.username)===u);
    if(p) activeProfileFilter=String(p.id);
    notify('✓ Extensão/aba vinculada ao perfil @'+u);
    renderQueue();
  };
  function loadPreferredProfileFilter(){
    if(activeProfileFilter!=='all') return;
    let u=''; try{ u=cleanIgUsername(localStorage.getItem('instagram_logged_profile_username')||''); }catch(_){ }
    if(!u) return;
    const p=(profilesCache||[]).find(x=>cleanIgUsername(x.username)===u);
    if(p) activeProfileFilter=String(p.id);
  }
  function groupByProfileAndBlock(items){
    const map=new Map();
    items.forEach(item=>{
      const p=effectiveProfileForItem(item);
      const pid=String(p?.id || cleanIgUsername(p?.username) || 'sem-perfil');
      if(!map.has(pid)) map.set(pid,{profile:p,blocks:new Map()});
      const g=map.get(pid); const b=Number(item.block_number||1);
      if(!g.blocks.has(b)) g.blocks.set(b,[]);
      g.blocks.get(b).push(item);
    });
    return [...map.values()];
  }

  function renderBacklogList(){
    renderWeekCards(); renderTabs(); renderProfileFilters(); renderStats();
    const el=document.getElementById('igV94Content'); if(!el) return;
    if(!backlogCache.length){
      el.innerHTML=`<div class="stretch-card" style="text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px;padding:28px">// nenhum lead no Backlog Instagram</div>`;
      return;
    }
    el.innerHTML=`<div class="stretch-card" style="padding:0;overflow:hidden">
      <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
        <div><div class="card-title" style="margin:0">BACKLOG</div><div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${backlogCache.length} empresas aguardando alocação</div></div>
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="window.instagramV142AutoAllocateBacklog()">Alocar automaticamente</button>
      </div>
      <div style="padding:12px 18px;display:flex;flex-direction:column;gap:10px">
        ${backlogCache.map((lead,i)=>renderBacklogLeadRow(lead,i+1)).join('')}
      </div>
    </div>`;
  }

  function renderBacklogLeadRow(lead,idx){
    const username=instagramFromLead(lead);
    const ramo=parentCategoryOf(lead,{});
    return `<div class="ig-v119-row" style="border:1px solid var(--border2);border-radius:12px;background:rgba(255,255,255,.01);padding:12px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div style="min-width:260px;flex:1">
        <div style="font-size:13px;font-weight:900">${esc(idx)} - ${esc(lead.company_name||lead.name||'Lead sem nome')}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">@${esc(username||'sem instagram')} ${lead.city||lead.state?` · ${esc([lead.city,lead.state].filter(Boolean).join('/'))}`:''} ${lead.rating?` · ⭐ ${esc(lead.rating)} · ${esc(lead.reviews_count||0)} avaliações`:''}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <span class="q-badge">${esc(ramo)}</span>
        ${username?`<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" href="${esc(igUrl(username))}">Abrir</a>`:''}
        <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="window.openLeadDrawer && window.openLeadDrawer('${esc(lead.id)}')">Ficha</button>
        <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="window.instagramV142AllocateLead('${esc(lead.id)}')">→ Alocar</button>
      </div>
    </div>`;
  }

  function renderQueue(){
    if(activeStatus==='backlog') return renderBacklogList();
    renderWeekCards(); renderTabs(); renderProfileFilters(); renderStats();
    const el=document.getElementById('igV94Content'); if(!el) return;
    if(!profilesCache.length){
      el.innerHTML=`<div class="stretch-card" style="text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px;padding:28px">// nenhum perfil Instagram configurado. Vá em Configurações → Perfis Instagram.</div>`;
      return;
    }
    const list=queueCache.filter(item=>{
      if(activeProfileFilter!=='all' && effectiveProfileKeyForItem(item)!==String(activeProfileFilter)) return false;
      const s=String(item.status||'queued').toLowerCase();
      if(activeStatus==='sent') return isSentStatus(s);
      if(activeStatus==='error') return isErrorStatus(s);
      if(activeStatus==='invalid') return isInvalidStatus(s);
      return isActiveQueueStatus(s);
    });
    if(!list.length){
      el.innerHTML=`<div class="stretch-card" style="text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px;padding:28px">// nenhum item em ${esc(statusVisual(activeStatus).toLowerCase())} para ${esc(fmtDate(activeDate))}</div>`;
      return;
    }
    const groups=groupByProfileAndBlock(list);
    el.innerHTML=groups.map(g=>{
      const p=g.profile||{}; const blocks=[...g.blocks.entries()].sort((a,b)=>a[0]-b[0]);
      const total=blocks.reduce((acc,[,arr])=>acc+arr.length,0);
      return `<details class="stretch-card" open style="margin-bottom:12px;padding:0;overflow:hidden">
        <summary style="cursor:pointer;list-style:none;padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;align-items:center">
          <div><div class="card-title" style="margin:0">@${esc(p.username||p.profile_username||'perfil')}</div><div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${total}/${p.daily_limit||60} no dia · ${p.blocks||4} lotes · ${p.block_size||15}/lote · ${p.interval_minutes||120}min</div></div>
          <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="event.preventDefault();window.instagramV94FillProfile('${esc(String(p.id||''))}')">Preencher perfil</button>
        </summary>
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px">${blocks.map(([b,arr])=>renderBlock(b,arr,p)).join('')}</div>
      </details>`;
    }).join('');
  }
  function renderBlock(b,items,p){
    const sent=items.filter(x=>['sent','enviado'].includes(String(x.status||'').toLowerCase())).length;
    const errors=items.filter(x=>isErrorStatus(x.status)).length;
    const invalids=items.filter(x=>isInvalidStatus(x.status)).length;
    const queued=items.length-sent-errors-invalids;
    return `<div class="ig-v119-lote" style="border:1px solid var(--border2);border-radius:12px;overflow:hidden;background:var(--bg);margin-bottom:10px">
      <div style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border2)">
        <div style="font-weight:900;font-size:15px">Lote ${b}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${items.length}/${p.block_size||15} leads · fila ${queued} · env ${sent} · erro ${errors} · inv ${invalids}</div>
      </div>
      <div>${items.map((item,i)=>renderLeadRow(item,i+1)).join('')}</div>
    </div>`;
  }
  function renderLeadRow(item,idx){
    const lead=getItemLead(item);
    const name=item.company_name || lead.company_name || lead.name || 'Lead sem nome';
    const username=cleanIgUsername(item.instagram_username || lead.instagram_username || lead.instagram_url || lead.instagram || item.instagram_url);
    const ramo=item.parent_category || parentCategoryOf(lead,item);
    const tipo=leadTypeOf(lead,item);
    const msg1=(item.message_1||'').trim();
    const msg2=(item.message_2||'').trim();
    const rowBg=isErrorStatus(item.status)?'rgba(255,92,92,.035)':(isInvalidStatus(item.status)?'rgba(255,92,92,.045)':'rgba(255,255,255,.01)');
    return `<details class="ig-v119-row" style="border-bottom:1px solid var(--border2);background:${rowBg}">
      <summary style="list-style:none;cursor:pointer;padding:10px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;min-height:42px">
        <div style="min-width:0;flex:1">
          <div style="font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(Number(idx)||1)} - ${esc(name)}</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:1px">@${esc(username||'sem instagram')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <span class="q-badge">${esc(ramo)}</span>
          <span class="q-badge insta">${tipo==='com-site'?'Com site':tipo==='agregador'?'Agregador':'Sem site'}</span>
          <span class="q-badge ${statusClass(item.status)}">${esc(statusVisual(item.status))}</span>
          <span style="color:var(--muted)">›</span>
        </div>
      </summary>
      <div style="padding:0 14px 12px 14px;display:grid;gap:10px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${username?`<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" href="${esc(igUrl(username))}">Abrir perfil</a>`:''}
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="window.instagramV115EditInstagram('${esc(item.id)}')">Editar Instagram</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94Copy('${esc(item.id)}','1')">Copiar Msg 1</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94Copy('${esc(item.id)}','2')">Copiar Msg 2</button>
          <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94MarkSent('${esc(item.id)}')">Marcar enviada</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94MarkError('${esc(item.id)}')">Erro</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="window.instagramV113MarkInvalid('${esc(item.id)}')">Invalidar</button>
        </div>
        <div class="insta-msg-blocks" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="insta-msg-block"><div class="insta-msg-block-label">Mensagem 1</div><div class="insta-msg-text">${esc(msg1||'Template não encontrado')}</div></div>
          <div class="insta-msg-block"><div class="insta-msg-block-label">Mensagem 2</div><div class="insta-msg-text">${esc(msg2||'Template não encontrado')}</div></div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">Follow: ${esc(item.follow_status||'not_checked')} · Imagem: usar imagem do ramo no processo assistido</div>
      </div>
    </details>`;
  }

  window.instagramV94Copy=function(id,n){
    const item=queueCache.find(x=>String(x.id)===String(id)); if(!item) return;
    const txt=String(n)==='2'?item.message_2:item.message_1;
    navigator.clipboard?.writeText(txt||'').then(()=>notify('✓ Mensagem copiada'));
  };
  window.instagramV94MarkSent=async function(id){
    const c=sb(); if(!c) return;
    const item=queueCache.find(x=>String(x.id)===String(id));
    const lead=getItemLead(item||{});
    const now=new Date().toISOString();
    const {error}=await c.from('instagram_dispatch_items').update({status:'sent',sent_at:now,last_action_at:now,error_message:null}).eq('id',id);
    if(error){ notify('Erro ao marcar enviada: '+error.message,'err'); return; }
    try { await upsertBaseInstagramSent(lead,item,now); } catch(e){ console.warn('[v94][base-permanente]',e?.message||e); }
    notify('✓ Instagram marcado como enviado');
    await refreshInstagramV94();
  };
  window.instagramV94MarkError=async function(id){
    const reason=prompt('Motivo do erro:', 'erro operacional'); if(reason===null) return;
    const c=sb(); if(!c) return;
    const {error}=await c.from('instagram_dispatch_items').update({status:'error',error_message:reason,last_action_at:new Date().toISOString()}).eq('id',id);
    if(error){ notify('Erro ao marcar erro: '+error.message,'err'); return; }
    notify('✓ Marcado como erro'); await refreshInstagramV94();
  };

  window.instagramV115EditInstagram=async function(id){
    const c=sb(), user=uid(); if(!c||!user) return notify('// Supabase indisponível','err');
    const item=queueCache.find(x=>String(x.id)===String(id));
    if(!item) return notify('Item da fila não encontrado','err');
    const lead=getItemLead(item||{});
    const atual=cleanIgUsername(item.instagram_username || item.instagram_url || lead.instagram_username || lead.instagram_url || lead.instagram || '');
    const raw=prompt('Novo Instagram do lead:', atual ? '@'+atual : '');
    if(raw===null) return;
    const username=cleanIgUsername(raw);
    if(!username) return notify('Instagram inválido. Use @perfil ou instagram.com/perfil.','warn');
    const url=igUrl(username);
    try{
      const q=await c.from('instagram_dispatch_items')
        .select('id,lead_id,status,company_name,profile_username')
        .eq('user_id',user)
        .or(`instagram_username.eq.${username},instagram_url.eq.${url}`)
        .neq('id',String(id))
        .limit(1);
      const dup=(q.data||[])[0];
      if(dup && !isErrorStatus(dup.status)) return notify('Instagram já está em outra fila/perfil: @'+username,'warn');
      const b=await c.from('base_permanente')
        .select('id,status,company_name')
        .eq('user_id',user)
        .or(`instagram_username.eq.${username},instagram_url.eq.${url}`)
        .limit(1);
      if((b.data||[])[0]) return notify('Instagram já está na Base Permanente: @'+username,'warn');
    }catch(e){ console.warn('[v115][edit-instagram-dup-check]',e?.message||e); }
    const now=new Date().toISOString();
    const {error:e1}=await c.from('instagram_dispatch_items').update({instagram_username:username,instagram_url:url,error_message:null,last_action_at:now,updated_at:now}).eq('user_id',user).eq('id',id);
    if(e1) return notify('Erro ao editar Instagram: '+e1.message,'err');
    if(item.lead_id){
      const {error:e2}=await c.from('leads').update({instagram:url,instagram_url:url,instagram_username:username,lead_channel:'instagram',updated_at:now}).eq('user_id',user).eq('id',String(item.lead_id));
      if(e2) console.warn('[v115][edit-instagram-lead]',e2.message);
    }
    notify('✓ Instagram atualizado para @'+username);
    await refreshInstagramV94();
  };

  window.instagramV113MarkInvalid=async function(id){
    const reason='outro';
    const c=sb(); if(!c) return;
    const item=queueCache.find(x=>String(x.id)===String(id));
    const lead=getItemLead(item||{});
    const now=new Date().toISOString();
    const {error}=await c.from('instagram_dispatch_items').update({status:'invalidated',error_message:reason,last_action_at:now,updated_at:now}).eq('id',id);
    if(error){ notify('Erro ao invalidar: '+error.message,'err'); return; }
    try{ await upsertBaseInstagramInvalid(lead,item,reason,now); }catch(e){ console.warn('[v113][invalid-base]',e?.message||e); }
    notify('✓ Lead invalidado e protegido na Base Permanente');
    await refreshInstagramV94();
  };

  async function upsertBaseInstagramInvalid(lead,item,reason,when){
    const c=sb(), user=uid(); if(!c||!user||!item) return;
    lead=lead||{};
    const phone=String(lead.normalized_phone||lead.phone||'').replace(/\D/g,'');
    const ig=cleanIgUsername(item.instagram_username||item.instagram_url||lead.instagram_username||lead.instagram_url||lead.instagram);
    const payload={
      user_id:user,
      company_name:lead.company_name||item.company_name||'Lead Instagram',
      phone:lead.phone||null,
      normalized_phone:phone||null,
      website:lead.website||null,
      website_domain:lead.website_domain||null,
      instagram_url:ig?igUrl(ig):(lead.instagram_url||item.instagram_url||null),
      instagram_username:ig||lead.instagram_username||null,
      category:lead.category||null,
      category_name:lead.category_name||item.parent_category||null,
      categories:Array.isArray(lead.categories)?lead.categories:(lead.categories||[]),
      city:lead.city||null,
      state:lead.state||null,
      country_code:lead.country_code||'BR',
      rating:lead.rating||null,
      reviews_count:lead.reviews_count||null,
      maps_url:lead.maps_url||null,
      source:'instagram_fila_manual',
      last_channel:'instagram',
      last_event_type:'instagram_invalidated',
      last_event_status:'invalidated',
      invalid_reason:reason||'outro',
      invalid_source:'instagram_fila',
      invalidated_at:when,
      last_contact_at:when,
      status:'invalidado',
      raw_payload:{...(lead.raw_payload||{}), instagram_dispatch_item_id:item.id||null, lead_id:item.lead_id||lead.id||null, invalid_reason:reason||'outro'},
      updated_at:new Date().toISOString()
    };
    const ors=[]; if(phone) ors.push(`normalized_phone.eq.${phone}`); if(ig) ors.push(`instagram_username.eq.${ig}`);
    let existing=[];
    if(ors.length){ const r=await c.from('base_permanente').select('id').eq('user_id',user).or(ors.join(',')).limit(1); if(!r.error) existing=r.data||[]; }
    let baseId=null;
    if(existing[0]?.id){ baseId=existing[0].id; await c.from('base_permanente').update(payload).eq('user_id',user).eq('id',baseId); }
    else { const r=await c.from('base_permanente').insert({...payload,created_at:new Date().toISOString()}).select('id').maybeSingle(); baseId=r.data?.id||null; }
    await c.from('contact_events').insert({user_id:user,lead_id:String(item.lead_id||lead.id||''),base_permanente_id:baseId,company_name:payload.company_name,normalized_phone:phone||null,website:payload.website,instagram_url:payload.instagram_url,maps_url:payload.maps_url,channel:'instagram',source_account:item.profile_username||null,source_instance:item.profile_id||null,event_type:'invalidated',status:'invalidated',sent_at:when,metadata:{instagram_dispatch_item_id:item.id||null,reason:reason||'outro'}});
    if(item.lead_id){ await c.from('leads').update({current_stage:'archived',current_status:'instagram_invalidated',status:'Invalidado Instagram',rejected_at:when,rejected_reason:reason||'outro',archived_at:when,updated_at:new Date().toISOString()}).eq('user_id',user).eq('id',String(item.lead_id)); }
  }

  async function upsertBaseInstagramSent(lead,item,when){
    const c=sb(), user=uid(); if(!c||!user||!item) return;
    lead = lead || {};
    const phoneRaw=lead.normalized_phone||lead.phone||'';
    const phone=String(phoneRaw||'').replace(/\D/g,'');
    const ig=cleanIgUsername(item?.instagram_username||lead.instagram_username||lead.instagram_url||lead.instagram||item?.instagram_url);
    if(!phone && !ig) return;
    const basePayload={
      user_id:user,
      company_name:lead.company_name||item?.company_name||'Lead Instagram',
      phone:lead.phone||null,
      normalized_phone:phone||null,
      website:lead.website||null,
      website_domain:lead.website_domain||null,
      instagram_url: ig?igUrl(ig):(lead.instagram_url||item?.instagram_url||null),
      instagram_username: ig||lead.instagram_username||null,
      category:lead.category||null,
      category_name:lead.category_name||item?.parent_category||null,
      categories:Array.isArray(lead.categories)?lead.categories:(lead.categories||[]),
      city:lead.city||null,
      state:lead.state||null,
      country_code:lead.country_code||'BR',
      rating:lead.rating||null,
      reviews_count:lead.reviews_count||null,
      maps_url:lead.maps_url||null,
      raw_payload:{...(lead.raw_payload||{}), instagram_dispatch_item_id:item.id||null, lead_id:item.lead_id||lead.id||null},
      source:'instagram_fila_manual',
      last_channel:'instagram',
      last_event_type:'instagram_sent',
      last_event_status:'sent',
      instagram_sent_at:when,
      last_contact_at:when,
      status:'instagram_sent',
      sent_channels:['instagram'],
      updated_at:new Date().toISOString()
    };
    try{
      const ors=[];
      if(phone) ors.push(`normalized_phone.eq.${phone}`);
      if(ig) ors.push(`instagram_username.eq.${ig}`);
      let existing=[];
      if(ors.length){
        const r=await c.from('base_permanente').select('id').eq('user_id',user).or(ors.join(',')).limit(1);
        if(!r.error) existing=r.data||[];
      }
      let baseId=null;
      if(existing[0]?.id){
        baseId=existing[0].id;
        const {error}=await c.from('base_permanente').update(basePayload).eq('user_id',user).eq('id',baseId);
        if(error) throw error;
      }else{
        const {data,error}=await c.from('base_permanente').insert({...basePayload,created_at:new Date().toISOString()}).select('id').maybeSingle();
        if(error) throw error;
        baseId=data?.id||null;
      }
      await c.from('contact_events').insert({
        user_id:user,
        lead_id:String(item.lead_id||lead.id||''),
        base_permanente_id:baseId,
        company_name:basePayload.company_name,
        normalized_phone:phone||null,
        website:basePayload.website,
        instagram_url:basePayload.instagram_url,
        maps_url:basePayload.maps_url,
        channel:'instagram',
        source_account:item.profile_username||null,
        source_instance:item.profile_id||null,
        event_type:'sent',
        status:'sent',
        message_template:item.template_id||null,
        sent_at:when,
        metadata:{instagram_dispatch_item_id:item.id||null, message_1:item.message_1||null, message_2:item.message_2||null}
      });
    }catch(e){ console.warn('[v112][base/contact-events]', e?.message||e); }

    if(phone){
      try{
        await safePersistSentContact({
          user_id:user,
          lead_id:String(item.lead_id||lead.id||''),
          company_name:basePayload.company_name,
          phone:lead.phone||phone,
          normalized_phone:phone,
          block_type:'already_sent',
          source:'instagram_fila',
          reason:'instagram_sent',
          active:true,
          dispatched_at:when,
          raw_payload:{instagram_dispatch_item_id:item.id||null, instagram_username:ig||null}
        });
      }catch(e){ console.warn('[v112][sent_contacts-instagram]', e?.message||e); }
    }
    try{
      if(item.lead_id){
        await c.from('leads').update({
          current_stage:'archived',
          current_status:'instagram_sent',
          status:'Enviada Instagram',
          archived_at:when,
          updated_at:new Date().toISOString()
        }).eq('user_id',user).eq('id',String(item.lead_id));
      }
    }catch(e){ console.warn('[v112][lead-instagram-sent]', e?.message||e); }
  }


  function resolveRamoForTemplateV110(lead){
    try{
      if(typeof window.resolveParentRamoForLeadV76==='function'){
        const r=window.resolveParentRamoForLeadV76(lead);
        if(r&&typeof r==='object') return {id:String(r.id||r.nome||''),nome:String(r.nome||r.id||'')};
        if(r) return {id:String(r),nome:String(r)};
      }
    }catch(_){}
    try{
      const raw=[lead?.parent_category,lead?.category_name,lead?.category,Array.isArray(lead?.categories)?lead.categories.join(' '):lead?.categories].filter(Boolean).join(' ');
      const n=norm(raw).replace(/-/g,' ');
      const ramos=typeof window.getRamos==='function'?(window.getRamos()||[]):[];
      for(const r of ramos){
        const keys=[r.id,r.nome,...(r.keywords||[]),...(r.subcategories||[])].filter(Boolean).map(x=>norm(x).replace(/-/g,' '));
        if(keys.some(k=>k&&(n===k||n.includes(k)||k.includes(n)))) return {id:String(r.id||r.nome||''),nome:String(r.nome||r.id||'')};
      }
    }catch(_){}
    const fb=lead?.parent_category||lead?.category_name||lead?.category||'';
    return {id:String(lead?.ramo_id||lead?.branch_id||fb||''),nome:String(fb||'')};
  }
  function localTemplatePairV110(lead,tipo){
    const name=lead?.company_name||lead?.name||'sua empresa';
    const rr=resolveRamoForTemplateV110(lead);
    try{
      if(typeof window.pickTemplate==='function'){
        const p1=window.pickTemplate(name,rr.id||null,tipo||'sem-site');
        const p2=typeof window.pickOtherTemplate==='function'?window.pickOtherTemplate(name,p1?.idx??-1,rr.id||null,tipo||'sem-site'):null;
        const m1=String(p1?.msg1||p1?.text||'').trim();
        const m2=String(p1?.msg2||p2?.msg2||p2?.text||'').trim();
        if(m1||m2) return {message_1:m1||'Olá, tudo bem? Me chamo Samuel.',message_2:m2||'',template_id:null,ramo_nome:rr.nome||rr.id};
      }
    }catch(e){ console.warn('[v110][ig-local-template]', e?.message||e); }
    return null;
  }

  async function getTemplatesFlexible(){
    const c=sb(), user=uid(); if(!c||!user) return [];
    const {data,error}=await c.from('message_templates').select('*').eq('user_id',user).eq('active',true);
    if(error){ console.warn('[instagram][templates-db]', error.message); return []; }
    return data||[];
  }

  function templateAliasesV150(value=''){
    const base=norm(value).replace(/_/g,'-').replace(/\s+/g,'-');
    const spaced=base.replace(/-/g,' ');
    const out=new Set([base, spaced].filter(Boolean));
    if(spaced.includes('moveis') || spaced.includes('movel') || spaced.includes('marcen') || spaced.includes('planejad')){
      ['moveis-planejados','móveis-planejados','moveis planejados','móveis planejados','marcenaria','marcenarias','moveis','móveis'].forEach(x=>out.add(norm(x).replace(/\s+/g,'-')));
    }
    return [...out].filter(Boolean);
  }

  function typeAliasesV150(tipo=''){
    const t=norm(tipo).replace(/_/g,'-').replace(/\s+/g,'-');
    if(t.includes('agreg')) return new Set(['agregador','agregadores','bio-link','biolink','linktree','com-agregador']);
    if(t.includes('com') && t.includes('site')) return new Set(['com-site','com_site','com site','site','whatsapp-com-site']);
    return new Set(['sem-site','sem_site','sem site','semsite','whatsapp','whatsapp-sem-site']);
  }

  function rowRamoAliasesV150(t){
    return new Set([t.ramo_id,t.branch_id,t.ramo,t.ramo_pai,t.category,t.category_name,t.parent_category,t.niche]
      .filter(Boolean).flatMap(templateAliasesV150));
  }

  function rowTypeAliasesV150(t){
    return typeAliasesV150(t.tipo || t.lead_type || t.type || t.template_type || '');
  }

  function templateScoreV150(t, wantedRamos, wantedTypes){
    if(t.active===false) return -9999;
    const rAliases=rowRamoAliasesV150(t);
    const tAliases=rowTypeAliasesV150(t);
    const ch=norm(t.channel || t.canal || t.channels || '');
    let score=0;
    const hasRamo=[...rAliases].some(a=>[...wantedRamos].some(b=>a===b || a.includes(b) || b.includes(a)));
    const hasType=[...tAliases].some(a=>[...wantedTypes].some(b=>norm(a).replace(/\s+/g,'-')===norm(b).replace(/\s+/g,'-')));
    if(hasRamo) score+=100;
    if(hasType) score+=60;
    if(ch.includes('instagram')) score+=10;
    if(!ch || ch.includes('ambos') || ch.includes('whatsapp')) score+=2;
    if(!hasRamo) score-=100;
    if(!hasType) score-=80;
    return score;
  }

  function applyEmpresaVarsV150(text, empresa){
    return String(text||'')
      .replace(/\{EMPRESA\}/g, empresa)
      .replace(/\{\{\s*empresa\s*\}\}/gi, empresa)
      .replace(/\{company_name\}/gi, empresa);
  }

  function selectTemplate(templates, ramo, tipo, lead){
    const empresa=lead?.company_name || lead?.name || 'sua empresa';
    const wantedRamos=new Set([
      ...templateAliasesV150(ramo),
      ...templateAliasesV150(lead?.ramo_id || lead?.branch_id || ''),
      ...templateAliasesV150(lead?.parent_category || lead?.category_name || lead?.category || '')
    ]);
    const wantedTypes=typeAliasesV150(tipo);

    const ranked=(templates||[])
      .map(t=>({t,score:templateScoreV150(t,wantedRamos,wantedTypes)}))
      .filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score || String(a.t.name||'').localeCompare(String(b.t.name||'')));

    const exact=ranked[0]?.t || null;
    if(!exact){
      return {
        message_1:`Olá, tudo bem? Me chamo Samuel. Encontrei a ${empresa} e vi uma oportunidade de apresentar melhor o trabalho de vocês pela internet.`,
        message_2:'Vi que existe potencial para melhorar a primeira impressão de quem conhece a empresa online. Posso te mostrar uma amostra simples?',
        template_id:null,
        template_source:'fallback'
      };
    }
    const m1=applyEmpresaVarsV150(exact.part_1||exact.message_1||exact.msg1||exact.texto1||exact.body1||exact.mensagem1||exact.content||'', empresa);
    const m2=applyEmpresaVarsV150(exact.part_2||exact.message_2||exact.msg2||exact.texto2||exact.body2||exact.mensagem2||'', empresa);
    return {message_1:m1,message_2:m2,template_id:exact.id||null,template_source:'message_templates'};
  }

  function isDefaultOrMissingMsgV150(item){
    const m1=String(item?.message_1||'').trim();
    const m2=String(item?.message_2||'').trim();
    if(!m1 || !m2) return true;
    if(m1 === 'Olá, tudo bem? Me chamo Samuel.') return true;
    if(m2 === 'Vi uma oportunidade de apresentar melhor o trabalho de vocês na internet.') return true;
    return false;
  }

  async function repairFrozenInstagramMessagesV150(){
    const c=sb(), user=uid(); if(!c||!user) return;
    const templates=await getTemplatesFlexible();
    if(!templates.length) return;
    const toFix=[];
    for(const item of queueCache||[]){
      if(!isActiveQueueStatus(item.status)) continue;
      const lead=getItemLead(item);
      const ramo=item.parent_category || parentCategoryOf(lead,item);
      const tipo=leadTypeOf(lead,item);
      // Regra final: item em fila sempre usa par congelado do mesmo template correto do ramo + tipo.
      // Isso corrige filas antigas que misturaram Msg1 de um template e Msg2 de outro.
      const tpl=selectTemplate(templates,ramo,tipo,{...lead,company_name:item.company_name||lead.company_name,parent_category:ramo});
      const changed = String(item.message_1||'').trim() !== String(tpl.message_1||'').trim()
        || String(item.message_2||'').trim() !== String(tpl.message_2||'').trim()
        || String(item.template_id||'') !== String(tpl.template_id||'');
      if(changed && tpl.message_1 && tpl.message_2){
        toFix.push({id:item.id, message_1:tpl.message_1, message_2:tpl.message_2, template_id:tpl.template_id||null, updated_at:new Date().toISOString()});
        item.message_1=tpl.message_1; item.message_2=tpl.message_2; item.template_id=tpl.template_id||null;
      }
    }
    for(const row of toFix){
      try{ await c.from('instagram_dispatch_items').update({message_1:row.message_1,message_2:row.message_2,template_id:row.template_id,updated_at:row.updated_at}).eq('user_id',user).eq('id',row.id); }
      catch(e){ console.warn('[instagram][template-repair]', row.id, e?.message||e); }
    }
    if(toFix.length) notify(`✓ ${toFix.length} mensagens da fila Instagram foram congeladas pelo template correto`);
  }

  function profileEffectiveLimit(profile){
    const daily=Number(profile?.daily_limit||DEFAULTS.daily_limit||60);
    const blocks=Number(profile?.blocks||DEFAULTS.blocks||4);
    const blockSize=Number(profile?.block_size||DEFAULTS.block_size||15);
    return Math.max(0, Math.min(daily, blocks * blockSize));
  }

  function computeNextInstagramSlot(profile, dayItems=[]){
    const blockSize=Math.max(1, Number(profile?.block_size||DEFAULTS.block_size||15));
    const blocks=Math.max(1, Number(profile?.blocks||DEFAULTS.blocks||4));
    const limit=profileEffectiveLimit(profile);
    const active=(dayItems||[]).filter(x=>!isErrorStatus(x.status)&&!isInvalidStatus(x.status));
    const count=active.length;
    if(count>=limit) throw new Error('Perfil já atingiu o limite do dia');
    const position=count+1;
    const blockNumber=Math.floor(count/blockSize)+1;
    if(blockNumber>blocks) throw new Error('Todos os lotes do perfil já estão completos');
    return {position, block_number:blockNumber, block_size:blockSize, count, limit};
  }

  async function allocateBacklogLeadToProfile(lead, profile){
    const c=sb(), user=uid(); if(!c||!user) throw new Error('Supabase indisponível');
    if(!profile) throw new Error('Cadastre ou selecione um perfil Instagram');
    const registeredRamo=resolveRegisteredParentRamoStrictV111(lead,{});
    if(!registeredRamo) throw new Error('Ramo não cadastrado para este lead');
    const ig=instagramFromLead(lead);
    if(!ig) throw new Error('Lead sem Instagram válido');

    const {data:existing}=await c.from('instagram_dispatch_items')
      .select('id,status,profile_id,scheduled_date')
      .eq('user_id',user)
      .eq('lead_id',String(lead.id))
      .limit(20);
    if((existing||[]).some(x=>!isErrorStatus(x.status)&&!isInvalidStatus(x.status))){
      throw new Error('Lead já está em fila/enviado');
    }

    const {data:dayItems,error:dayErr}=await c.from('instagram_dispatch_items')
      .select('id,position,block_number,status')
      .eq('user_id',user)
      .eq('profile_id',profile.id)
      .eq('scheduled_date',activeDate)
      .order('position',{ascending:true});
    if(dayErr) throw dayErr;

    const slot=computeNextInstagramSlot(profile, dayItems||[]);
    const templates=await getTemplatesFlexible();
    const tipo=leadTypeOf(lead,{});
    const tpl=selectTemplate(templates,registeredRamo.nome||lead.parent_category||lead.category||'',tipo,{...lead,parent_category:registeredRamo.nome,ramo_id:registeredRamo.id});
    const row={
      user_id:user,
      lead_id:String(lead.id),
      profile_id:profile.id,
      profile_username:profile.username,
      scheduled_date:activeDate,
      block_number:slot.block_number,
      block_size:slot.block_size,
      position:slot.position,
      status:'queued',
      follow_status:'not_checked',
      company_name:lead.company_name||lead.name||'',
      instagram_username:ig,
      instagram_url:igUrl(ig),
      parent_category:registeredRamo.nome,
      lead_type:tipo,
      message_1:tpl.message_1,
      message_2:tpl.message_2,
      template_id:tpl.template_id||null,
      created_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    };
    const {error:insErr}=await c.from('instagram_dispatch_items').upsert(row,{onConflict:'profile_id,scheduled_date,lead_id'});
    if(insErr) throw insErr;
    return row;
  }

  window.instagramV142AllocateLead=async function(leadId){
    try{
      const lead=backlogCache.find(l=>String(l.id)===String(leadId));
      if(!lead) return notify('Lead não está mais no Backlog','warn');
      const p=selectedProfileForAllocation();
      await allocateBacklogLeadToProfile(lead,p);
      notify('✓ Lead alocado para '+fmtDate(activeDate));
      // Não redireciona: permanece no Backlog para continuar alocando.
      activeStatus='backlog';
      await refreshInstagramV94();
    }catch(e){ notify('Erro ao alocar: '+(e?.message||e),'err'); }
  };

  window.instagramV142AutoAllocateBacklog=async function(){
    try{
      const p=selectedProfileForAllocation();
      if(!p) return notify('Cadastre um perfil Instagram antes de alocar','warn');
      const c=sb(), user=uid();
      if(!c||!user) return notify('Supabase indisponível','err');
      const {data:dayItems,error}=await c.from('instagram_dispatch_items')
        .select('id,status')
        .eq('user_id',user)
        .eq('profile_id',p.id)
        .eq('scheduled_date',activeDate);
      if(error) throw error;
      const slot=computeNextInstagramSlot(p, dayItems||[]);
      const limit=Math.max(0, slot.limit - slot.count);
      if(!limit) return notify('Perfil já atingiu o limite do dia','warn');
      const list=backlogCache.slice(0,limit);
      let ok=0;
      for(const lead of list){
        try{ await allocateBacklogLeadToProfile(lead,p); ok++; }catch(e){ console.warn('[instagram][auto-allocate]',lead.id,e?.message||e); }
      }
      notify(`✓ ${ok} leads alocados para ${fmtDate(activeDate)}`);
      // Não redireciona: continua no Backlog após alocação automática.
      activeStatus='backlog';
      await refreshInstagramV94();
    }catch(e){ notify('Erro ao alocar backlog: '+(e?.message||e),'err'); }
  };

  window.instagramV94FillProfile=async function(profileId){
    const p=getProfile(profileId); if(!p){ notify('Perfil não encontrado','err'); return; }
    const c=sb(), user=uid(); if(!c||!user) return;
    try{
      await loadBacklog();
      const {data:dayItems,error:dayErr}=await c.from('instagram_dispatch_items')
        .select('id,status,position,block_number')
        .eq('user_id',user)
        .eq('profile_id',p.id)
        .eq('scheduled_date',activeDate)
        .order('position',{ascending:true});
      if(dayErr) throw dayErr;
      const slot=computeNextInstagramSlot(p, dayItems||[]);
      const remaining=Math.max(0, slot.limit - slot.count);
      if(!remaining){ notify('Perfil já atingiu o limite do dia','warn'); await refreshInstagramV94(); return; }

      const list=(backlogCache||[]).slice(0,remaining);
      if(!list.length){ notify('Nenhum lead no Backlog Instagram para alocar','warn'); await refreshInstagramV94(); return; }

      let ok=0;
      for(const lead of list){
        try{ await allocateBacklogLeadToProfile(lead,p); ok++; }
        catch(e){ console.warn('[instagram][fill-profile-backlog]', lead?.id, e?.message||e); }
      }
      notify(`✓ ${ok} leads alocados no perfil @${p.username} para ${fmtDate(activeDate)}`);
      // Não redireciona depois de preencher/alocar.
      activeStatus='backlog';
      await refreshInstagramV94();
    }catch(e){
      notify('Erro ao preencher perfil: '+(e?.message||e),'err');
    }
  };

  // Configurações — adiciona Perfis Instagram e esconde Templates Instagram antigo.
  function ensureInstagramConfig(){
    const configPanel=document.getElementById('panel-configuracoes');
    if(!configPanel) return;
    configPanel.querySelectorAll('.card-title').forEach(title=>{
      if((title.textContent||'').toLowerCase().includes('templates instagram')){
        const card=title.closest('.card'); if(card) card.style.display='none';
      }
      if((title.textContent||'').toLowerCase().includes('templates de mensagem')){
        const sub=title.parentElement?.querySelector('div[style*="font-family"]');
        if(sub) sub.innerHTML='Templates de Prospecção usados no WhatsApp e Instagram. Separe por ramo e tipo: Sem site, Com site ou Agregador.';
      }
    });
    if(document.getElementById('igProfilesConfigV94')) return;
    const ramosTitle=[...configPanel.querySelectorAll('.card-title')].find(x=>(x.textContent||'').toLowerCase().includes('ramos de prospecção'));
    const insertBefore=ramosTitle?.closest('.card') || configPanel.querySelector('.card');
    const card=document.createElement('div');
    card.className='card'; card.id='igProfilesConfigV94'; card.style.marginTop='16px';
    card.innerHTML=`
      <div class="card-title" style="color:var(--insta)">Perfis Instagram</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:12px">Cada perfil funciona como um chip: limite diário, lotes, leads por lote e delay entre lotes.</div>
      <div id="igProfilesListV94" style="margin-bottom:12px"></div>
      <div style="display:grid;grid-template-columns:1.2fr .7fr .6fr .6fr .8fr auto;gap:8px;align-items:end">
        <div><label>@perfil</label><input id="igProfileUsernameV94" placeholder="ex: meu_perfil"></div>
        <div><label>Limite/dia</label><input id="igProfileLimitV94" type="number" value="60"></div>
        <div><label>Lotes</label><input id="igProfileBlocksV94" type="number" value="4"></div>
        <div><label>Por lote</label><input id="igProfileBlockSizeV94" type="number" value="15"></div>
        <div><label>Delay lotes</label><input id="igProfileIntervalV94" type="number" value="120"></div>
        <button class="btn btn-primary" onclick="window.instagramV94AddProfile()">+ Perfil</button>
      </div>`;
    if(insertBefore) insertBefore.parentNode.insertBefore(card, insertBefore); else configPanel.appendChild(card);
    renderProfilesConfig();
  }
  async function renderProfilesConfig(){
    await loadProfiles();
    const el=document.getElementById('igProfilesListV94'); if(!el) return;
    if(!profilesCache.length){ el.innerHTML=`<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">// nenhum perfil Instagram cadastrado</div>`; return; }
    el.innerHTML=profilesCache.map(p=>`<div style="background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div><b style="color:var(--text)">@${esc(p.username)}</b><div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${p.daily_limit}/dia · ${p.blocks} lotes · ${p.block_size}/lote · ${p.interval_minutes}min</div></div>
      <div style="display:flex;gap:6px"><button class="btn btn-ghost" style="font-size:10px;padding:6px 10px" onclick="window.instagramV94FillProfile('${esc(String(p.id))}')">Preencher hoje</button><button class="btn btn-danger" style="font-size:10px;padding:6px 10px" onclick="window.instagramV94RemoveProfile('${esc(String(p.id))}')">Remover</button></div>
    </div>`).join('');
  }
  window.instagramV94AddProfile=async function(){
    const username=cleanIgUsername(document.getElementById('igProfileUsernameV94')?.value);
    if(!username){ notify('Informe o @perfil','err'); return; }
    const payload={username,display_name:username,active:true,
      daily_limit:Number(document.getElementById('igProfileLimitV94')?.value||60),
      blocks:Number(document.getElementById('igProfileBlocksV94')?.value||4),
      block_size:Number(document.getElementById('igProfileBlockSizeV94')?.value||15),
      interval_minutes:Number(document.getElementById('igProfileIntervalV94')?.value||120),
      status:'active'};
    try{
      await apiInstagram('instagram_profile_upsert', payload);
    }catch(apiErr){
      const c=sb(), user=uid();
      if(!c||!user){ notify('Erro ao salvar perfil: '+apiErr.message,'err'); return; }
      const {error}=await c.from('instagram_profiles').upsert({user_id:user,...payload,updated_at:new Date().toISOString()},{onConflict:'user_id,username'});
      if(error){ notify('Erro ao salvar perfil: '+error.message,'err'); return; }
    }
    document.getElementById('igProfileUsernameV94').value='';
    notify('✓ Perfil Instagram salvo'); await renderProfilesConfig(); await refreshInstagramV94();
  };
  window.instagramV94RemoveProfile=async function(id){
    if(!confirm('Remover este perfil Instagram?')) return;
    try{
      await apiInstagram('instagram_profile_remove',{id});
    }catch(apiErr){
      const c=sb(); if(!c){ notify('Erro ao remover perfil: '+apiErr.message,'err'); return; }
      const {error}=await c.from('instagram_profiles').update({active:false,updated_at:new Date().toISOString()}).eq('id',id);
      if(error){ notify('Erro ao remover perfil: '+error.message,'err'); return; }
    }
    notify('✓ Perfil removido'); await renderProfilesConfig(); await refreshInstagramV94();
  };

  // Lead Certo v139: este módulo não é dono da navegação.
  // A rota Instagram é controlada exclusivamente por core/router-final.js.
  const prevRenderConfig=window.renderConfiguracoes;
  window.renderConfiguracoes=function(){
    const out=typeof prevRenderConfig==='function' ? prevRenderConfig.apply(this,arguments) : undefined;
    setTimeout(ensureInstagramConfig,100);
    return out;
  };

  // Lead Certo v139: Atribuição Instagram pertence somente a modules/attribution.js.
  // Bloco legado V100 removido para não sobrescrever Aprovar -> Backlog.


  // Lead Certo v139: aprovação manual antiga V102 removida.
  // O fluxo oficial é Atribuição -> Backlog -> Alocar no dia.


  function ensureInstagramApprovalButtons(){
    // V106: desativado. A aprovação da aba Instagram é controlada somente pelo handler definitivo v106.
    try{ document.querySelectorAll('[data-ig-v102-approve], .ig-v102-approve-btn').forEach(btn=>btn.remove()); }catch(_){}
  }


  const prevUpdateBadges=window.updateBadges;
  window.updateBadges=function(){
    const out=typeof prevUpdateBadges==='function' ? prevUpdateBadges.apply(this,arguments) : undefined;
    try { const b=document.getElementById('badge-instagram'); if(b){ const c=counters(); b.textContent=String(c.queued+c.error); } } catch(e){}
    return out;
  };
  window.renderInstagram=refreshInstagramV94;
  window.renderInstagramQueuePanel=refreshInstagramV94;
  window.instagramCarryoverPending20hV154=carryoverInstagramPending20hV154;

  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>{ ensureInstagramPanel(); ensureInstagramConfig(); refreshInstagramV94(); ensureInstagramApprovalButtons(); },900);
    setTimeout(()=>{ ensureInstagramConfig(); ensureInstagramApprovalButtons(); },1800);
    setInterval(()=>{ try{ ensureInstagramApprovalButtons(); }catch(e){} },2500);
  });
  console.log('[v94][instagram-v1] ativo',VERSION);
})();


/* Lead Certo — proteção de enviados/backfill */
/* V121 — Instagram enviado protegido na base + limpeza real do Backlog.
   Problema corrigido:
   - Antes, envios antigos do Instagram podiam ter ficado apenas como instagram_dispatch_items.status='sent',
     sem gravar base_permanente/contact_events/sent_contacts e sem arquivar o lead.
   - Resultado: esses leads continuavam aparecendo no Backlog/Atribuição Instagram e podiam voltar para fila.
   Solução:
   - Backfill automático dos itens Instagram já enviados para base_permanente/contact_events/sent_contacts.
   - Arquiva o lead como instagram_sent.
   - Roda antes de abrir Instagram, antes de preencher perfil e antes de renderizar Atribuição.
*/
(function(){
  const VERSION='20260621-v121-instagram-sent-backfill-protection';
  let running=null;
  let lastRun=0;
  const TTL=30000;

  function sb(){ try { return window.sbClient || (typeof sbClient !== 'undefined' ? sbClient : null); } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || (typeof currentUser !== 'undefined' && currentUser?.id) || localStorage.getItem('vs_auth_local_user_v423') || null; } catch(e){ return null; } }
  function clean(v){ return String(v||'').trim(); }
  function digits(v){ return String(v||'').replace(/\D/g,''); }
  function igUser(v){
    let s=clean(v).toLowerCase();
    if(!s) return '';
    s=s.replace(/^@+/,'');
    try{
      if(/^https?:\/\//i.test(s) || /^www\./i.test(s) || /^instagram\.com\//i.test(s)){
        const u=new URL(/^https?:\/\//i.test(s)?s:'https://'+s.replace(/^www\./i,''));
        const host=(u.hostname||'').replace(/^www\./,'');
        if(!host.endsWith('instagram.com')) return '';
        const parts=u.pathname.split('/').filter(Boolean);
        const first=(parts[0]||'').toLowerCase();
        if(!first || ['p','reel','reels','tv','explore','stories','accounts','direct'].includes(first)) return '';
        s=first;
      }
    }catch(_){ }
    s=s.split(/[/?#&\s]/)[0].replace(/^@+/,'').trim();
    if(!/^[a-z0-9._]{2,30}$/.test(s)) return '';
    if(['instagram','www','explore','reels','reel','p','stories','direct','accounts'].includes(s)) return '';
    return s;
  }
  function igUrl(u){ const v=igUser(u); return v ? `https://instagram.com/${v}` : null; }
  function safeJson(x){ return (x && typeof x==='object') ? x : {}; }

  async function findBase(c,user,phone,ig){
    const ors=[];
    if(phone) ors.push(`normalized_phone.eq.${phone}`);
    if(ig) ors.push(`instagram_username.eq.${ig}`);
    if(!ors.length) return null;
    const r=await c.from('base_permanente').select('id').eq('user_id',user).or(ors.join(',')).limit(1);
    if(r.error) return null;
    return r.data?.[0]?.id || null;
  }

  async function putBaseForSent(c,user,item,lead,when){
    const phone=digits(lead?.normalized_phone || lead?.phone || item?.normalized_phone || item?.phone || '');
    const ig=igUser(item?.instagram_username || item?.instagram_url || lead?.instagram_username || lead?.instagram_url || lead?.instagram || '');
    if(!phone && !ig) return null;
    const payload={
      user_id:user,
      company_name:lead?.company_name || item?.company_name || 'Lead Instagram',
      phone:lead?.phone || null,
      normalized_phone:phone || null,
      website:lead?.website || null,
      website_domain:lead?.website_domain || null,
      instagram_url:ig ? igUrl(ig) : (lead?.instagram_url || item?.instagram_url || null),
      instagram_username:ig || lead?.instagram_username || null,
      category:lead?.category || null,
      category_name:lead?.category_name || item?.parent_category || null,
      categories:Array.isArray(lead?.categories) ? lead.categories : (lead?.categories || []),
      city:lead?.city || null,
      state:lead?.state || null,
      country_code:lead?.country_code || 'BR',
      rating:lead?.rating || null,
      reviews_count:lead?.reviews_count || null,
      maps_url:lead?.maps_url || null,
      source:'instagram_backfill_sent',
      last_channel:'instagram',
      last_event_type:'instagram_sent',
      last_event_status:'sent',
      instagram_sent_at:when,
      last_contact_at:when,
      status:'instagram_sent',
      sent_channels:['instagram'],
      raw_payload:{...safeJson(lead?.raw_payload), instagram_dispatch_item_id:item?.id||null, lead_id:item?.lead_id||lead?.id||null, backfill:true},
      updated_at:new Date().toISOString()
    };
    let baseId=await findBase(c,user,phone,ig);
    if(baseId){
      const u=await c.from('base_permanente').update(payload).eq('user_id',user).eq('id',baseId);
      if(u.error) throw u.error;
    }else{
      const ins=await c.from('base_permanente').insert({...payload, created_at:new Date().toISOString()}).select('id').maybeSingle();
      if(ins.error) throw ins.error;
      baseId=ins.data?.id || null;
    }
    try{
      await c.from('contact_events').insert({
        user_id:user,
        lead_id:String(item?.lead_id || lead?.id || ''),
        base_permanente_id:baseId,
        company_name:payload.company_name,
        normalized_phone:phone || null,
        website:payload.website,
        instagram_url:payload.instagram_url,
        maps_url:payload.maps_url,
        channel:'instagram',
        source_account:item?.profile_username || null,
        source_instance:item?.profile_id || null,
        event_type:'sent',
        status:'sent',
        message_template:item?.template_id || null,
        sent_at:when,
        metadata:{instagram_dispatch_item_id:item?.id||null, backfill:true}
      });
    }catch(e){ console.warn('[v121][contact_events]', e?.message||e); }
    if(phone){
      try{
        await safePersistSentContact({
          user_id:user,
          lead_id:String(item?.lead_id || lead?.id || ''),
          company_name:payload.company_name,
          phone:lead?.phone || phone,
          normalized_phone:phone,
          block_type:'already_sent',
          source:'instagram_backfill_sent',
          reason:'instagram_sent',
          active:true,
          dispatched_at:when,
          raw_payload:{instagram_dispatch_item_id:item?.id||null, instagram_username:ig||null, backfill:true}
        });
      }catch(e){ console.warn('[v121][sent_contacts]', e?.message||e); }
    }
    return baseId;
  }

  async function runBackfill(force=false){
    const nowTs=Date.now();
    if(!force && nowTs-lastRun<TTL) return {ok:true, skipped:true};
    if(running) return running;
    running=(async()=>{
      const c=sb(), user=uid();
      if(!c||!user) return {ok:false, reason:'no_client'};
      lastRun=Date.now();
      const q=await c.from('instagram_dispatch_items')
        .select('id,lead_id,user_id,status,sent_at,last_action_at,profile_id,profile_username,company_name,instagram_username,instagram_url,parent_category,template_id,message_1,message_2')
        .eq('user_id',user)
        .in('status',['sent','enviado'])
        .limit(1000);
      if(q.error){ console.warn('[v121][sent-items]', q.error.message); return {ok:false,error:q.error}; }
      const items=q.data||[];
      if(!items.length) return {ok:true,count:0};
      const leadIds=[...new Set(items.map(x=>String(x.lead_id||'')).filter(Boolean))];
      let leadsById={};
      if(leadIds.length){
        const lr=await c.from('leads').select('*').eq('user_id',user).in('id',leadIds);
        if(!lr.error) (lr.data||[]).forEach(l=>{ leadsById[String(l.id)]=l; });
      }
      let changed=0;
      for(const item of items){
        const lead=leadsById[String(item.lead_id||'')] || {};
        const when=item.sent_at || item.last_action_at || new Date().toISOString();
        try{
          await putBaseForSent(c,user,item,lead,when);
          if(item.lead_id){
            await c.from('leads').update({
              current_stage:'archived',
              current_status:'instagram_sent',
              status:'Enviada Instagram',
              archived_at:when,
              updated_at:new Date().toISOString()
            }).eq('user_id',user).eq('id',String(item.lead_id));
          }
          changed++;
        }catch(e){ console.warn('[v121][backfill-item]', item.id, e?.message||e); }
      }
      if(changed) console.info(`[v121] ${changed} envios antigos do Instagram protegidos na base.`);
      return {ok:true,count:changed};
    })().finally(()=>{ running=null; });
    return running;
  }

  window.instagramV121BackfillSentProtection=runBackfill;

  const prevRenderInstagram=window.renderInstagram;
  window.renderInstagram=async function renderInstagramV121(){
    try{ await runBackfill(false); }catch(e){ console.warn('[v121][renderInstagram]', e?.message||e); }
    return typeof prevRenderInstagram==='function' ? prevRenderInstagram.apply(this,arguments) : undefined;
  };

  const prevFill=window.instagramV94FillProfile;
  window.instagramV94FillProfile=async function fillProfileV121(){
    try{ await runBackfill(true); }catch(e){ console.warn('[v121][fillProfile]', e?.message||e); }
    return typeof prevFill==='function' ? prevFill.apply(this,arguments) : undefined;
  };

  // Lead Certo v139: não sobrescrever render da Atribuição.
  // Backfill do Instagram roda apenas ao abrir a Fila Instagram/preencher perfil.

  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>runBackfill(false),1800));
  window.__V121_INSTAGRAM_SENT_BACKFILL__=VERSION;
})();
