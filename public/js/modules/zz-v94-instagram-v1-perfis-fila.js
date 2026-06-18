/* V94 — Instagram V1: perfis, fila por perfil/dia/lote e base para extensão Chrome.
   - Usa instagram_profiles e instagram_dispatch_items.
   - Não cria templates separados: usa Templates de Prospecção.
   - Configuração por perfil: 60/dia, 4 lotes, 15/lote, 120min entre lotes.
   - Instagram: Em fila / Enviadas / Erro.
*/
(function(){
  'use strict';
  const VERSION='20260618-V94-INSTAGRAM-V1-PERFIS-FILA';
  const DEFAULTS={daily_limit:60,blocks:4,block_size:15,interval_minutes:120};
  let activeStatus='queued';
  let activeDate=toDateInput(new Date());
  let profilesCache=[];
  let queueCache=[];
  let leadsById={};

  function sb(){ try { return window.sbClient || window.supabaseClient || window.supabase || null; } catch(e){ return null; } }
  function uid(){ try { return window.currentUser?.id || window.authUser?.id || ''; } catch(e){ return ''; } }
  function notify(msg,type){ try { if(typeof window.notify==='function') window.notify(msg,type); else console.log(msg); } catch(e){} }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function cleanIgUsername(v){
    let s=String(v||'').trim();
    if(!s) return '';
    s=s.replace(/^https?:\/\/(www\.)?instagram\.com\//i,'').replace(/^instagram\.com\//i,'').replace(/^@/,'').split(/[/?#]/)[0].trim();
    return s.replace(/[^a-zA-Z0-9._]/g,'').toLowerCase();
  }
  function igUrl(username){ const u=cleanIgUsername(username); return u?`https://www.instagram.com/${u}/`:''; }
  function toDateInput(d){ const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,10); }
  function fmtDate(s){ try { const [y,m,d]=String(s).split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.',''); } catch(e){ return s; } }
  function statusVisual(s){ s=String(s||'queued').toLowerCase(); if(['sent','enviado'].includes(s)) return 'Enviada'; if(['error','failed','erro'].includes(s)) return 'Erro'; return 'Em fila'; }
  function statusClass(s){ s=String(s||'queued').toLowerCase(); if(['sent','enviado'].includes(s)) return 'ok'; if(['error','failed','erro'].includes(s)) return 'err'; return 'queue'; }
  function leadTypeOf(lead,item){
    const t=String(item?.lead_type || lead?.lead_type || lead?.website_type || '').toLowerCase();
    if(t.includes('agreg')) return 'agregador';
    if(t.includes('site') && !t.includes('sem')) return 'com-site';
    return 'sem-site';
  }
  function parentCategoryOf(lead,item){
    if(item?.parent_category) return item.parent_category;
    if(lead?.parent_category) return lead.parent_category;
    if(typeof window.resolveParentRamoForLeadV76==='function') { try { return window.resolveParentRamoForLeadV76(lead)?.nome || window.resolveParentRamoForLeadV76(lead) || ''; } catch(e){} }
    if(typeof window.getRamos==='function'){
      try{
        const raw=[lead?.category,lead?.category_name,Array.isArray(lead?.categories)?lead.categories.join(' '):lead?.categories].filter(Boolean).join(' ');
        const n=norm(raw);
        for(const r of window.getRamos()){
          const keys=[r.nome,...(r.keywords||[]),...(r.subcategories||[])].map(norm);
          if(keys.some(k=>k && (n===k || n.includes(k) || k.includes(n)))) return r.nome;
        }
      }catch(e){}
    }
    return lead?.category_name || lead?.category || 'Ramo não identificado';
  }
  async function loadProfiles(){
    const c=sb(), user=uid(); if(!c||!user) return [];
    const {data,error}=await c.from('instagram_profiles').select('*').eq('user_id',user).eq('active',true).order('username',{ascending:true});
    if(error){ console.warn('[v94][profiles]',error.message); return []; }
    profilesCache=(data||[]).map(p=>({ ...DEFAULTS, ...p, username:cleanIgUsername(p.username) }));
    return profilesCache;
  }
  async function loadQueue(){
    const c=sb(), user=uid(); if(!c||!user) return [];
    const {data,error}=await c.from('instagram_dispatch_items').select('*').eq('user_id',user).eq('scheduled_date',activeDate).order('profile_username',{ascending:true}).order('block_number',{ascending:true}).order('position',{ascending:true});
    if(error){ console.warn('[v94][queue]',error.message); return []; }
    queueCache=data||[];
    const ids=[...new Set(queueCache.map(x=>String(x.lead_id||'')).filter(Boolean))];
    leadsById={};
    if(ids.length){
      const {data:leads,error:leadsErr}=await c.from('leads').select('*').in('id',ids);
      if(!leadsErr){ (leads||[]).forEach(l=>leadsById[String(l.id)]=l); }
    }
    return queueCache;
  }
  function getProfile(id){ return profilesCache.find(p=>String(p.id)===String(id)); }
  function getItemLead(item){ return leadsById[String(item.lead_id)] || {}; }
  function counters(status){
    const list=queueCache||[];
    return {
      queued:list.filter(x=>!['sent','enviado','error','failed','erro'].includes(String(x.status||'queued').toLowerCase())).length,
      sent:list.filter(x=>['sent','enviado'].includes(String(x.status||'').toLowerCase())).length,
      error:list.filter(x=>['error','failed','erro'].includes(String(x.status||'').toLowerCase())).length
    };
  }

  function ensureInstagramPanel(){
    const panel=document.getElementById('panel-instagram'); if(!panel) return;
    if(panel.dataset.v94==='1') return;
    panel.dataset.v94='1';
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
      <div class="status-tabs" id="igV94Tabs" style="flex-shrink:0"></div>
      <div class="stats-row" id="igV94Stats" style="flex-shrink:0"></div>
      <div id="igV94Content" class="stretch-list" style="flex:1;min-height:0;overflow:auto"></div>
    `;
    document.getElementById('igV94Date')?.addEventListener('change',e=>{ activeDate=e.target.value||toDateInput(new Date()); refreshInstagramV94(); });
    document.getElementById('igV94Refresh')?.addEventListener('click',refreshInstagramV94);
  }
  function renderTabs(){
    const c=counters();
    const tabs=[['queued','Em fila',c.queued],['sent','Enviadas',c.sent],['error','Erro',c.error]];
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
      <div class="stat-card"><div class="stat-label">ERROS</div><div class="stat-value">${c.error}</div></div>`;
  }
  function groupByProfileAndBlock(items){
    const map=new Map();
    items.forEach(item=>{
      const pid=String(item.profile_id||item.profile_username||'sem-perfil');
      if(!map.has(pid)) map.set(pid,{profile:getProfile(item.profile_id)||{username:item.profile_username||'sem-perfil'},blocks:new Map()});
      const g=map.get(pid); const b=Number(item.block_number||1);
      if(!g.blocks.has(b)) g.blocks.set(b,[]);
      g.blocks.get(b).push(item);
    });
    return [...map.values()];
  }
  function renderQueue(){
    renderTabs(); renderStats();
    const el=document.getElementById('igV94Content'); if(!el) return;
    if(!profilesCache.length){
      el.innerHTML=`<div class="stretch-card" style="text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:10px;padding:28px">// nenhum perfil Instagram configurado. Vá em Configurações → Perfis Instagram.</div>`;
      return;
    }
    const list=queueCache.filter(item=>{
      const s=String(item.status||'queued').toLowerCase();
      if(activeStatus==='sent') return ['sent','enviado'].includes(s);
      if(activeStatus==='error') return ['error','failed','erro'].includes(s);
      return !['sent','enviado','error','failed','erro'].includes(s);
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
    return `<details class="ig-v94-block" open style="border:1px solid var(--border2);border-radius:12px;overflow:hidden;background:var(--bg)">
      <summary style="cursor:pointer;list-style:none;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border2)">
        <div style="font-weight:800">Lote ${b}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${items.length}/${p.block_size||15} leads · ${sent} enviados</div>
      </summary>
      <div>${items.map(renderLeadRow).join('')}</div>
    </details>`;
  }
  function renderLeadRow(item,idx){
    const lead=getItemLead(item);
    const name=item.company_name || lead.company_name || lead.name || 'Lead sem nome';
    const username=cleanIgUsername(item.instagram_username || lead.instagram_username || lead.instagram_url || lead.instagram || item.instagram_url);
    const ramo=item.parent_category || parentCategoryOf(lead,item);
    const tipo=leadTypeOf(lead,item);
    const msg1=(item.message_1||'').trim(); const msg2=(item.message_2||'').trim();
    return `<details style="border-top:1px solid var(--border2)">
      <summary style="list-style:none;cursor:pointer;padding:12px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center">
        <div style="min-width:0;flex:1">
          <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.position||'')} - ${esc(name)}</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">@${esc(username||'sem instagram')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <span class="q-badge">${esc(ramo)}</span>
          <span class="q-badge insta">${tipo==='com-site'?'Com site':tipo==='agregador'?'Agregador':'Sem site'}</span>
          <span class="q-badge ${statusClass(item.status)}">${esc(statusVisual(item.status))}</span>
          <span style="color:var(--muted)">›</span>
        </div>
      </summary>
      <div style="padding:0 14px 14px 14px;display:grid;gap:10px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${username?`<a class="btn btn-ghost" style="font-size:10px;padding:7px 12px;text-decoration:none" target="_blank" href="${esc(igUrl(username))}">Abrir perfil</a>`:''}
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94Copy('${esc(item.id)}','1')">Copiar Msg 1</button>
          <button class="btn btn-ghost" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94Copy('${esc(item.id)}','2')">Copiar Msg 2</button>
          <button class="btn btn-primary" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94MarkSent('${esc(item.id)}')">Marcar enviada</button>
          <button class="btn btn-danger" style="font-size:10px;padding:7px 12px" onclick="window.instagramV94MarkError('${esc(item.id)}')">Erro</button>
        </div>
        <div class="insta-msg-blocks" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="insta-msg-block"><div class="insta-msg-block-label">Mensagem 1</div><div class="insta-msg-text">${esc(msg1||'Template não encontrado')}</div></div>
          <div class="insta-msg-block"><div class="insta-msg-block-label">Mensagem 2</div><div class="insta-msg-text">${esc(msg2||'Template não encontrado')}</div></div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">Follow: ${esc(item.follow_status||'not_checked')} · Imagem: ${item.image_url?'configurada':'usar imagem do ramo no processo assistido'}</div>
      </div>
    </details>`;
  }

  async function refreshInstagramV94(){
    ensureInstagramPanel();
    await loadProfiles();
    await loadQueue();
    renderQueue();
    try{ if(typeof window.updateBadges==='function') window.updateBadges(); }catch(e){}
  }
  window.refreshInstagramV94=refreshInstagramV94;
  window.setInstagramStatusV94=function(s){ activeStatus=s; renderQueue(); };
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
  async function upsertBaseInstagramSent(lead,item,when){
    const c=sb(), user=uid(); if(!c||!user||!lead) return;
    const phone=lead.normalized_phone||lead.phone||null;
    const ig=cleanIgUsername(item?.instagram_username||lead.instagram_username||lead.instagram_url||lead.instagram||item?.instagram_url);
    if(!phone && !ig) return;
    const payload={
      user_id:user,
      company_name:lead.company_name||item?.company_name||'',
      phone:lead.phone||null,
      normalized_phone:lead.normalized_phone||phone,
      website:lead.website||null,
      instagram_url: ig?igUrl(ig):(lead.instagram_url||null),
      instagram_username: ig||lead.instagram_username||null,
      category:lead.category||null,
      category_name:lead.category_name||item?.parent_category||null,
      categories:lead.categories||null,
      city:lead.city||null,
      state:lead.state||null,
      country_code:lead.country_code||'BR',
      rating:lead.rating||null,
      reviews_count:lead.reviews_count||null,
      maps_url:lead.maps_url||null,
      raw_payload:lead.raw_payload||null,
      source:'instagram_extension_v1',
      last_channel:'instagram',
      last_event_type:'instagram_sent',
      last_event_status:'sent',
      instagram_sent_at:when,
      last_contact_at:when,
      status:'instagram_sent',
      updated_at:new Date().toISOString()
    };
    await c.from('base_permanente').upsert(payload,{onConflict: phone?'user_id,normalized_phone':'user_id,instagram_username'});
  }

  async function getTemplatesFlexible(){
    const c=sb(), user=uid(); if(!c||!user) return [];
    const {data}=await c.from('message_templates').select('*').eq('user_id',user);
    return data||[];
  }
  function selectTemplate(templates,ramo,tipo,lead){
    const nr=norm(ramo), nt=norm(tipo).replace('_','-');
    const candidates=(templates||[]).filter(t=>{
      const tr=norm(t.ramo||t.ramo_pai||t.category||t.category_name||t.parent_category||t.niche||'');
      const tt=norm(t.tipo||t.lead_type||t.type||'');
      const ch=norm(t.channel||t.canal||t.channels||'ambos');
      const ramoOk=!tr || tr===nr || nr.includes(tr) || tr.includes(nr);
      const tipoOk=!tt || tt===nt || tt.includes(nt) || nt.includes(tt) || (nt==='sem-site' && tt.includes('sem')) || (nt==='com-site' && tt.includes('com'));
      const canalOk=!ch || ch.includes('ambos') || ch.includes('instagram') || ch.includes('whatsapp');
      return ramoOk && tipoOk && canalOk;
    });
    const t=candidates[0] || templates[0] || {};
    const name=lead?.company_name||lead?.name||'sua empresa';
    const m1=String(t.message_1||t.msg1||t.texto1||t.body1||t.mensagem1||t.content||'Olá, tudo bem? Me chamo Samuel.').replace(/\{EMPRESA\}/g,name);
    const m2=String(t.message_2||t.msg2||t.texto2||t.body2||t.mensagem2||'Vi uma oportunidade de apresentar melhor o trabalho de vocês na internet.').replace(/\{EMPRESA\}/g,name);
    return {message_1:m1,message_2:m2};
  }
  window.instagramV94FillProfile=async function(profileId){
    const p=getProfile(profileId); if(!p){ notify('Perfil não encontrado','err'); return; }
    const capacity=Number(p.daily_limit||60);
    const already=queueCache.filter(x=>String(x.profile_id)===String(profileId) && !['error','failed','erro'].includes(String(x.status||'').toLowerCase())).length;
    const remaining=Math.max(0,capacity-already);
    if(!remaining){ notify('Perfil já preenchido para o dia','warn'); return; }
    const c=sb(), user=uid(); if(!c||!user) return;
    const {data:existing}=await c.from('instagram_dispatch_items').select('lead_id').eq('user_id',user).eq('scheduled_date',activeDate);
    const existingIds=new Set((existing||[]).map(x=>String(x.lead_id)));
    const {data:leads,error}=await c.from('leads').select('*').eq('user_id',user).eq('current_stage','attribution_instagram').limit(1000);
    if(error){ notify('Erro ao buscar leads Instagram: '+error.message,'err'); return; }
    const candidates=(leads||[]).filter(l=>{
      if(existingIds.has(String(l.id))) return false;
      const ig=cleanIgUsername(l.instagram_username||l.instagram_url||l.instagram||l.website||'');
      if(!ig) return false;
      const stage=String(l.current_stage||'');
      return stage==='attribution_instagram';
    }).slice(0,remaining);
    if(!candidates.length){ notify('Nenhum lead Instagram elegível para preencher','warn'); return; }
    const templates=await getTemplatesFlexible();
    const blockSize=Number(p.block_size||15);
    const rows=candidates.map((lead,i)=>{
      const pos=already+i+1;
      const block=Math.floor((pos-1)/blockSize)+1;
      const ramo=parentCategoryOf(lead,{});
      const tipo=leadTypeOf(lead,{});
      const tpl=selectTemplate(templates,ramo,tipo,lead);
      const ig=cleanIgUsername(lead.instagram_username||lead.instagram_url||lead.instagram||lead.website||'');
      return {
        user_id:user,
        lead_id:String(lead.id),
        profile_id:p.id,
        profile_username:p.username,
        scheduled_date:activeDate,
        block_number:block,
        block_size:blockSize,
        position:pos,
        status:'queued',
        follow_status:'not_checked',
        company_name:lead.company_name||lead.name||'',
        instagram_username:ig,
        instagram_url:igUrl(ig),
        parent_category:ramo,
        lead_type:tipo,
        message_1:tpl.message_1,
        message_2:tpl.message_2,
        created_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      };
    });
    const {error:insErr}=await c.from('instagram_dispatch_items').upsert(rows,{onConflict:'profile_id,scheduled_date,lead_id'});
    if(insErr){ notify('Erro ao preencher perfil: '+insErr.message,'err'); return; }
    notify(`✓ ${rows.length} leads inseridos na fila Instagram`);
    await refreshInstagramV94();
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
    const c=sb(), user=uid(); if(!c||!user) return;
    const username=cleanIgUsername(document.getElementById('igProfileUsernameV94')?.value);
    if(!username){ notify('Informe o @perfil','err'); return; }
    const payload={user_id:user,username,display_name:username,active:true,
      daily_limit:Number(document.getElementById('igProfileLimitV94')?.value||60),
      blocks:Number(document.getElementById('igProfileBlocksV94')?.value||4),
      block_size:Number(document.getElementById('igProfileBlockSizeV94')?.value||15),
      interval_minutes:Number(document.getElementById('igProfileIntervalV94')?.value||120),
      status:'active',updated_at:new Date().toISOString()};
    const {error}=await c.from('instagram_profiles').upsert(payload,{onConflict:'user_id,username'});
    if(error){ notify('Erro ao salvar perfil: '+error.message,'err'); return; }
    document.getElementById('igProfileUsernameV94').value='';
    notify('✓ Perfil Instagram salvo'); await renderProfilesConfig(); await refreshInstagramV94();
  };
  window.instagramV94RemoveProfile=async function(id){
    if(!confirm('Remover este perfil Instagram?')) return;
    const c=sb(); if(!c) return;
    const {error}=await c.from('instagram_profiles').update({active:false,updated_at:new Date().toISOString()}).eq('id',id);
    if(error){ notify('Erro ao remover perfil: '+error.message,'err'); return; }
    notify('✓ Perfil removido'); await renderProfilesConfig(); await refreshInstagramV94();
  };

  const prevSwitch=window.switchPanel;
  window.switchPanel=function(panel){
    const out=typeof prevSwitch==='function' ? prevSwitch.apply(this,arguments) : undefined;
    if(panel==='instagram') setTimeout(refreshInstagramV94,80);
    if(panel==='configuracoes') setTimeout(ensureInstagramConfig,150);
    return out;
  };
  const prevRenderConfig=window.renderConfiguracoes;
  window.renderConfiguracoes=function(){
    const out=typeof prevRenderConfig==='function' ? prevRenderConfig.apply(this,arguments) : undefined;
    setTimeout(ensureInstagramConfig,100);
    return out;
  };
  const prevUpdateBadges=window.updateBadges;
  window.updateBadges=function(){
    const out=typeof prevUpdateBadges==='function' ? prevUpdateBadges.apply(this,arguments) : undefined;
    try { const b=document.getElementById('badge-instagram'); if(b){ const c=counters(); b.textContent=String(c.queued+c.error); } } catch(e){}
    return out;
  };
  window.renderInstagram=refreshInstagramV94;

  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>{ ensureInstagramPanel(); ensureInstagramConfig(); refreshInstagramV94(); },900);
    setTimeout(()=>{ ensureInstagramConfig(); },1800);
  });
  console.log('[v94][instagram-v1] ativo',VERSION);
})();
