/* Lead Certo — Pré-envio final consolidado.
   Substitui safe-weekly-flow-v31 e patches de pré-envio.
   Fluxo único: Atribuição -> Pré-envio por chip/dia -> Fila WhatsApp.
*/
(function(){
  'use strict';
  const VERSION='20260621-PRE-DISPATCH-FINAL';
  let state={date:new Date().toISOString().slice(0,10), chip:'all', loading:false};
  const operationalStatuses=['review','approved','validation_retry','invalid','invalid_whatsapp','ready_to_dispatch','dispatch_queue','queued','not_sent','waiting','scheduled','sending','sent','enviado'];
  const listStatuses=['review','approved','validation_retry','invalid','invalid_whatsapp'];

  function db(){return window.sbClient||window.supabaseClient||window.supabase||null;}
  function uid(){return window.currentUser?.id||window.authUser?.id||localStorage.getItem('vs_auth_local_user_v423')||'';}
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function today(){return new Date().toISOString().slice(0,10);}
  function addDays(d,n){const x=new Date(d+'T00:00:00');x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);}
  function brDate(d){const [y,m,day]=String(d).split('-');return `${day}/${m}`;}
  function weekday(d){return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][new Date(d+'T00:00:00').getDay()];}
  function normPhone(v){let d=String(v||'').replace(/\D/g,'');if(!d)return '';if(d.startsWith('55'))return d;if(d.length===10||d.length===11)return '55'+d;return d;}
  function root(){return document.getElementById('preEnvioRoot')||document.getElementById('panel-pre-envio');}
  function currentDate(){return state.date||today();}
  function chipLabel(ch){return String(ch?.label||ch?.name||ch?.instance||ch?.chip_id||'Chip');}

  function parseJsonSafe(v){try{return JSON.parse(v||'null');}catch(_){return null;}}
  function getDispatchConfigCapacity(){
    try{
      const cfg = typeof window.getDispatchEditableConfigV49==='function' ? window.getDispatchEditableConfigV49() : null;
      const blockSize = Number(cfg?.loteTamanho || cfg?.block_size || cfg?.blockSize || 0);
      const blocks = Number(cfg?.blocoQuantidade || cfg?.blocks || 0);
      const total = blockSize>0 && blocks>0 ? blockSize*blocks : 0;
      if(total>0) return total;
    }catch(_){ }
    const keys=['vs_evo_config','evo_config','vs_disparo_config','disparoConfig'];
    for(const k of keys){
      const cfg=parseJsonSafe(localStorage.getItem(k)); if(!cfg) continue;
      const blockSize=Number(cfg.loteTamanho ?? cfg.disparosPorBloco ?? cfg.block_size ?? cfg.blockSize ?? 0);
      const blocks=Number(cfg.blocoQuantidade ?? cfg.quantidadeBlocos ?? cfg.blocks ?? 0);
      const total=blockSize>0 && blocks>0 ? blockSize*blocks : 0;
      if(total>0) return total;
    }
    return 0;
  }
  function getLocalChipConfig(instance){
    const target=String(instance||'').trim(); if(!target) return null;
    const keys=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k && k.includes('vs_whatsapp_chips_v29')) keys.push(k);}
    for(const k of keys){
      const arr=parseJsonSafe(localStorage.getItem(k)); if(!Array.isArray(arr)) continue;
      const found=arr.find(ch=>String(ch.instance||ch.chip_id||ch.id||ch.name||'').trim()===target || String(ch.label||ch.nome||'').trim()===target);
      if(found) return found;
    }
    return null;
  }
  function chipDailyLimit(chip){
    const local=getLocalChipConfig(chip?.instance||chip?.chip_id||chip?.label);
    const dbLimit=Number(chip?.daily_limit||chip?.dailyLimit||0);
    const localLimit=Number(local?.dailyLimit||local?.daily_limit||0);
    const cfgLimit=Number(getDispatchConfigCapacity()||0);
    // Prioriza valores configurados de verdade, especialmente quando o usuário troca 120 para outro limite.
    if(dbLimit>0 && dbLimit!==120) return dbLimit;
    if(localLimit>0 && localLimit!==120) return localLimit;
    if(cfgLimit>0 && cfgLimit!==120) return cfgLimit;
    return dbLimit>0 ? dbLimit : (localLimit>0 ? localLimit : (cfgLimit>0 ? cfgLimit : 120));
  }
  const PRE_CAPACITY_STATUSES=['review','approved','validation_retry','ready_to_dispatch','dispatch_queue','queued','not_sent','waiting','scheduled','sending','sent','enviado'];
  const PRE_BLOCKED_STATUSES=['review','approved','validation_retry','ready_to_dispatch','dispatch_queue','queued','not_sent','waiting','scheduled','sending','sent','enviado'];
  const PRE_PENDING_ROLLOVER_STATUSES=['ready_to_dispatch','dispatch_queue','queued','not_sent','waiting','scheduled'];
  let carryoverRunning=false;
  function localIso(d=new Date()){const x=new Date(d); x.setHours(0,0,0,0); return x.toLocaleDateString('sv-SE');}
  function planningBaseDate(){const n=new Date(); return n.getHours()>=20 ? addDays(localIso(n),1) : localIso(n);}
  function canRunCarryover(){const n=new Date(); return n.getHours()>=20;}
  async function countOccupancyForChip(date, chipInstance){
    const c=db(), user=uid(); if(!c||!user||!date||!chipInstance)return 0;
    const {data,error}=await c.from('pre_dispatch_items').select('id').eq('user_id',user).eq('scheduled_date',date).eq('chip_instance',chipInstance).in('status',PRE_CAPACITY_STATUSES);
    if(error){console.warn('[pre-final capacity count]',error.message);return 0;}
    return (data||[]).length;
  }
  async function maxPositionForChip(date, chipInstance){
    const c=db(), user=uid(); if(!c||!user||!date||!chipInstance)return 0;
    const {data,error}=await c.from('pre_dispatch_items').select('position').eq('user_id',user).eq('scheduled_date',date).eq('chip_instance',chipInstance).order('position',{ascending:false}).limit(1);
    if(error)return 0;
    return Number(data?.[0]?.position||0)||0;
  }
  async function movePendingGroupToNextSlots(chip, rows){
    const c=db(), user=uid(); if(!c||!user||!chip||!rows?.length)return 0;
    let moved=0;
    let remaining=[...rows];
    let target=addDays(localIso(new Date()),1);
    // Se amanhã estiver cheio, empurra o excedente para os dias seguintes, sempre respeitando o limite diário do chip.
    for(let guard=0; remaining.length && guard<14; guard++){
      const occupied=await countOccupancyForChip(target, chip.instance);
      const limit=chipDailyLimit(chip);
      const available=Math.max(0, limit-occupied);
      if(available>0){
        const batch=remaining.splice(0, available);
        let pos=await maxPositionForChip(target, chip.instance);
        for(const item of batch){
          pos += 1;
          const {error}=await c.from('pre_dispatch_items').update({scheduled_date:target,position:pos,updated_at:new Date().toISOString()}).eq('user_id',user).eq('id',item.id);
          if(error) console.warn('[pre-final carryover item]',error.message); else moved++;
        }
      }
      target=addDays(target,1);
    }
    return moved;
  }
  async function carryPendingWhatsappAfter20(){
    if(carryoverRunning||!canRunCarryover())return 0;
    const c=db(), user=uid(); if(!c||!user)return 0;
    carryoverRunning=true;
    try{
      const chips=await getChips(); if(!chips.length)return 0;
      const todayLocal=localIso(new Date());
      const {data,error}=await c.from('pre_dispatch_items')
        .select('id,lead_id,chip_instance,chip_label,scheduled_date,status,position')
        .eq('user_id',user)
        .lte('scheduled_date',todayLocal)
        .in('status',PRE_PENDING_ROLLOVER_STATUSES)
        .order('scheduled_date',{ascending:true})
        .order('position',{ascending:true});
      if(error){console.warn('[pre-final carryover fetch]',error.message);return 0;}
      const rows=data||[]; if(!rows.length)return 0;
      let total=0;
      for(const chip of chips){
        const list=rows.filter(r=>String(r.chip_instance||r.chip_label||'')===String(chip.instance)||String(r.chip_label||'')===String(chip.label));
        if(list.length) total += await movePendingGroupToNextSlots(chip,list);
      }
      if(total) console.log(`[Lead Certo] ${total} pendente(s) da Fila WhatsApp movidos para o próximo dia às 20h.`);
      return total;
    }finally{carryoverRunning=false;}
  }

  function leadType(lead){
    const stage=String(lead?.current_stage||'').toLowerCase();
    const wt=String(lead?.website_type||'').toLowerCase();
    const type=String(lead?.lead_type||'').toLowerCase();
    if(stage.includes('agreg')||wt.includes('agreg')||type.includes('agreg')) return 'agregador';
    if(stage.includes('site')||lead?.has_own_site||String(lead?.website||'').trim()) return 'com-site';
    return 'sem-site';
  }
  function isNoSiteLead(lead){
    const stage=String(lead?.current_stage||'').toLowerCase();
    const type=String(leadType(lead)||'');
    return stage==='attribution_whatsapp' || type==='sem-site';
  }
  function initialPreDispatchStatus(lead){
    // Regra oficial: leads WhatsApp/sem site não precisam de aprovação manual no Pré-envio.
    // Eles entram como aprovados para seguir direto para a Fila WhatsApp quando você enviar aprovados.
    return isNoSiteLead(lead) ? 'approved' : 'review';
  }
  function originStage(item,lead){
    const raw=item?.raw_payload||{};
    if(raw.origin_stage) return raw.origin_stage;
    const t=String(item?.lead_type||leadType(lead));
    if(t.includes('agreg')) return 'attribution_agregadores_approved';
    if(t.includes('site')) return 'attribution_site_approved';
    return 'attribution_whatsapp';
  }
  function isApprovedLead(l){return String(l?.pipeline_status||'')==='approved_for_queue'||String(l?.current_status||'')==='approved_for_queue'||String(l?.current_stage||'').endsWith('_approved');}

  function isWithinConfiguredRamo(lead){
    try{ if(typeof window.isLeadWithinConfiguredRamoV86==='function') return window.isLeadWithinConfiguredRamoV86(lead); }catch(_){ }
    return true;
  }
  async function invalidateOutOfBranch(lead,itemId){
    try{ if(typeof window.invalidateOutOfBranchLeadV149==='function') return await window.invalidateOutOfBranchLeadV149(lead,'pre_dispatch',itemId); }catch(e){ console.warn('[pre-final branch invalid]',e?.message||e); }
    return false;
  }
  async function sweepBranchGuard(){
    try{ if(typeof window.sweepOutOfBranchLeadsV149==='function') return await window.sweepOutOfBranchLeadsV149('attribution'); }catch(_){ }
  }

  async function getChips(){
    const c=db(), user=uid(); if(!c||!user)return [];
    const {data,error}=await c.from('whatsapp_instances').select('id,instance,label,name,chip_id,daily_limit,block_size,active,status,created_at').eq('user_id',user).eq('active',true).order('created_at',{ascending:true});
    if(error){console.warn('[pre-final chips]',error.message);return [];}
    return (data||[]).filter(x=>x.instance||x.chip_id||x.label).map(x=>({...x,instance:String(x.instance||x.chip_id||x.label),label:chipLabel(x),daily_limit:chipDailyLimit(x), block_size:Number(x.block_size||0)||0}));
  }
  async function getCounts(dates){
    const c=db(), user=uid(); const out={}; dates.forEach(d=>out[d]={total:0,review:0,approved:0,retry:0,invalid:0,ready:0});
    if(!c||!user||!dates.length)return out;
    const {data,error}=await c.from('pre_dispatch_items').select('scheduled_date,status').eq('user_id',user).in('scheduled_date',dates).in('status',operationalStatuses);
    if(error){console.warn('[pre-final counts]',error.message);return out;}
    for(const r of data||[]){const d=r.scheduled_date;if(!out[d])continue;const s=String(r.status||'');out[d].total++; if(s==='approved')out[d].approved++; else if(s.includes('retry'))out[d].retry++; else if(s.includes('invalid'))out[d].invalid++; else if(s==='ready_to_dispatch')out[d].ready++; else out[d].review++;}
    return out;
  }
  async function getChipOccupancyMap(date){
    const c=db(), user=uid(); const out={};
    if(!c||!user||!date) return out;
    const {data,error}=await c.from('pre_dispatch_items')
      .select('chip_instance,chip_label,status')
      .eq('user_id',user)
      .eq('scheduled_date',date)
      .in('status',PRE_CAPACITY_STATUSES);
    if(error){ console.warn('[pre-final chip occupancy]',error.message); return out; }
    for(const r of data||[]){
      const keys=[r.chip_instance,r.chip_label].filter(Boolean).map(String);
      for(const k of keys) out[k]=(out[k]||0)+1;
    }
    return out;
  }

  async function getItems(date,chip){
    const c=db(), user=uid(); if(!c||!user)return [];
    let q=c.from('pre_dispatch_items').select('id,lead_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,validation_status,invalid_reason,raw_payload,created_at,updated_at,leads(*)').eq('user_id',user).eq('scheduled_date',date).in('status',listStatuses).order('chip_label',{ascending:true}).order('position',{ascending:true});
    if(chip&&chip!=='all') q=q.eq('chip_instance',chip);
    const {data,error}=await q; if(error){notify('Erro ao carregar Pré-envio: '+error.message,'err');return [];}
    const rows=data||[];
    const valid=[];
    for(const item of rows){
      const lead=item.leads||{};
      if(!isWithinConfiguredRamo(lead)){ await invalidateOutOfBranch(lead,item.id); continue; }
      valid.push(item);
    }
    return valid;
  }
  async function fetchAlreadyBlockedIds(){
    const c=db(), user=uid(); const ids=new Set(); if(!c||!user)return ids;
    try{const {data}=await c.from('pre_dispatch_items').select('lead_id').eq('user_id',user).in('status',PRE_BLOCKED_STATUSES);(data||[]).forEach(x=>ids.add(String(x.lead_id)));}catch(_){ }
    try{const {data}=await c.from('instagram_dispatch_items').select('lead_id').eq('user_id',user).in('status',['scheduled','queued','sent']);(data||[]).forEach(x=>ids.add(String(x.lead_id)));}catch(_){ }
    return ids;
  }
  async function fetchLeads(mode,limit,exclude){
    const c=db(), user=uid(); if(!c||!user||limit<=0)return [];
    const excluded=exclude||new Set(); const out=[];
    async function grab(stages,approvedOnly,lim){
      if(lim<=0)return [];
      const {data,error}=await c.from('leads').select('id,company_name,phone,normalized_phone,website,has_own_site,website_type,maps_url,current_stage,current_status,status,pipeline_status,created_at,lead_score,rating,reviews_count,lead_type').eq('user_id',user).in('current_stage',stages).order('lead_score',{ascending:false}).order('created_at',{ascending:true}).limit(lim+150);
      if(error){console.warn('[pre-final leads]',stages,error.message);return [];}      
      const accepted=[];
      for(const l of (data||[])){
        if(excluded.has(String(l.id))) continue;
        if(approvedOnly && !isApprovedLead(l)) continue;
        if(!isWithinConfiguredRamo(l)){ await invalidateOutOfBranch(l,null); excluded.add(String(l.id)); continue; }
        accepted.push(l);
        if(accepted.length>=lim) break;
      }
      return accepted;
    }
    async function add(rows){for(const r of rows){if(out.length>=limit)break;const id=String(r.id);if(!excluded.has(id)){out.push(r);excluded.add(id);}}}
    if(mode==='whatsapp'){
      await add(await grab(['attribution_whatsapp'],false,limit));
    }else if(mode==='site_agg'){
      await add(await grab(['attribution_site_approved'],true,limit-out.length));
      await add(await grab(['attribution_agregadores_approved','attribution_aggregator_approved'],true,limit-out.length));
    }else{
      await add(await grab(['attribution_whatsapp'],false,limit-out.length));
      await add(await grab(['attribution_site_approved'],true,limit-out.length));
      await add(await grab(['attribution_agregadores_approved','attribution_aggregator_approved'],true,limit-out.length));
    }
    return out.slice(0,limit);
  }

  async function fillByMode(mode){
    const c=db(), user=uid(); if(!c||!user)return notify('Supabase/auth indisponível.','err');
    await sweepBranchGuard();
    const chips=await getChips(); if(!chips.length)return notify('Nenhum chip ativo encontrado.','warn');
    const use=state.chip&&state.chip!=='all'?chips.filter(x=>x.instance===state.chip):chips;
    if(!use.length)return notify('Chip selecionado não encontrado.','warn');
    const blocked=await fetchAlreadyBlockedIds(); let total=0;
    for(const chip of use){
      const {data:existing,error:exErr}=await c.from('pre_dispatch_items').select('lead_id').eq('user_id',user).eq('scheduled_date',state.date).eq('chip_instance',chip.instance).in('status',PRE_CAPACITY_STATUSES);
      if(exErr){console.warn('[pre-final existing]',exErr.message);continue;}
      const current=(existing||[]).length; (existing||[]).forEach(x=>blocked.add(String(x.lead_id)));
      const need=Math.max(0,chipDailyLimit(chip)-current); if(need<=0)continue;
      const leads=await fetchLeads(mode,need,blocked); if(!leads.length)continue;
      const rows=leads.map((lead,i)=>({
        user_id:user,
        lead_id:lead.id,
        chip_instance:chip.instance,
        chip_label:chip.label,
        scheduled_date:state.date,
        lead_type:leadType(lead),
        status:initialPreDispatchStatus(lead),
        position:current+i+1,
        raw_payload:{origin_stage:lead.current_stage,source_filter:mode,approved_in_attribution:isApprovedLead(lead),auto_approved_no_site:isNoSiteLead(lead),origin:VERSION}
      }));
      const {error}=await c.from('pre_dispatch_items').insert(rows); if(error){console.warn('[pre-final insert]',error.message);continue;}
      await c.from('leads').update({current_stage:'pre_send',current_status:'pre_dispatch_review',updated_at:new Date().toISOString()}).eq('user_id',user).in('id',leads.map(l=>l.id));
      total+=leads.length;
    }
    if(!total){
      const label=mode==='whatsapp'?'WhatsApp':mode==='site_agg'?'Com site + Agregadores aprovados':'Geral';
      return notify(`Nenhum lead encontrado para ${label}.`+(mode==='site_agg'?' Verifique se existem aprovados.':''),'warn');
    }
    notify(`✓ ${total} lead(s) inseridos no Pré-envio.`); await render();
  }
  async function setItemStatus(id,status){const c=db(),user=uid();if(!c||!user)return;const {error}=await c.from('pre_dispatch_items').update({status,updated_at:new Date().toISOString()}).eq('user_id',user).eq('id',id);if(error)return notify('Erro: '+error.message,'err');await render();}
  async function returnItem(id){
    const c=db(),user=uid();if(!c||!user)return;
    const {data:item,error}=await c.from('pre_dispatch_items').select('id,lead_id,lead_type,raw_payload,leads(*)').eq('user_id',user).eq('id',id).maybeSingle();
    if(error||!item)return notify('Item não encontrado.','warn');
    const stage=originStage(item,item.leads||{});
    await c.from('leads').update({current_stage:stage,current_status:stage.includes('approved')?'approved_for_queue':'new',pipeline_status:stage.includes('approved')?'approved_for_queue':null,updated_at:new Date().toISOString()}).eq('user_id',user).eq('id',item.lead_id);
    await c.from('pre_dispatch_items').delete().eq('user_id',user).eq('id',id);
    notify('✓ Lead voltou para Atribuição.'); await render();
  }
  async function returnDay(){
    const rows=await getItems(state.date,state.chip); if(!rows.length)return notify('Nenhum item para devolver.','warn');
    for(const item of rows){
      const stage=originStage(item,item.leads||{});
      await db().from('leads').update({current_stage:stage,current_status:stage.includes('approved')?'approved_for_queue':'new',pipeline_status:stage.includes('approved')?'approved_for_queue':null,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',item.lead_id);
    }
    await db().from('pre_dispatch_items').delete().eq('user_id',uid()).in('id',rows.map(r=>r.id));
    notify('✓ Dia voltou para Atribuição.'); await render();
  }
  async function sendApprovedToQueue(){
    const c=db(),user=uid(); if(!c||!user)return;
    // Regra oficial: o lote sai montado no Pré-envio e deve ir direto para a Fila WhatsApp
    // do chip/dia correspondente. Para a fila enxergar corretamente, precisamos marcar o
    // item E o lead como dispatch_queue. Antes só o item mudava para ready_to_dispatch,
    // enquanto o lead continuava como pre_send/pre_dispatch_review, por isso não aparecia.
    let q=c.from('pre_dispatch_items')
      .select('id,lead_id,leads(*)')
      .eq('user_id',user)
      .eq('scheduled_date',state.date)
      .eq('status','approved');
    if(state.chip&&state.chip!=='all')q=q.eq('chip_instance',state.chip);
    const {data,error}=await q; if(error)return notify('Erro: '+error.message,'err');
    const rawRows=data||[];
    if(!rawRows.length)return notify('Nenhum aprovado para enviar à fila.','warn');
    const rows=[];
    let blocked=0;
    for(const row of rawRows){
      const lead=row.leads||{};
      if(!isWithinConfiguredRamo(lead)){ blocked++; await invalidateOutOfBranch(lead,row.id); continue; }
      rows.push(row);
    }
    if(!rows.length)return notify(`Nenhum aprovado válido para enviar. ${blocked} fora do perfil foram invalidados.`,'warn');
    const ids=rows.map(x=>x.id);
    const leadIds=[...new Set(rows.map(x=>x.lead_id).filter(Boolean))];
    const now=new Date().toISOString();
    const upItems=await c.from('pre_dispatch_items')
      .update({status:'ready_to_dispatch',updated_at:now})
      .eq('user_id',user)
      .in('id',ids);
    if(upItems.error)return notify('Erro ao enviar para fila: '+upItems.error.message,'err');
    if(leadIds.length){
      const upLeads=await c.from('leads')
        .update({current_stage:'dispatch_queue',current_status:'queued',status:'Em fila',updated_at:now})
        .eq('user_id',user)
        .in('id',leadIds);
      if(upLeads.error)return notify('Itens enviados, mas houve erro ao atualizar leads: '+upLeads.error.message,'err');
    }
    notify('✓ Leads válidos enviados para a Fila WhatsApp do chip selecionado.'+(typeof blocked!=='undefined'&&blocked?` ${blocked} fora do perfil foram invalidados.`:'')); await render();
    try{ if(typeof window.renderFilaZapV73==='function') window.renderFilaZapV73(); }catch(_){ }
  }

  function renderItem(item){
    const l=item.leads||{}; const status=String(item.status||'review');
    const autoApproved = status==='approved' && (item.raw_payload?.auto_approved_no_site || item.lead_type==='sem-site');
    const badge=status==='approved'?(autoApproved?'AUTO APROVADO':'APROVADO'):status.includes('invalid')?'INVÁLIDO':status.includes('retry')?'RETRY':'REVISÃO';
    const approveButton = status==='approved' ? '' : `<button class="btn btn-ghost" data-pre-action="approve" data-id="${esc(item.id)}">Aprovar</button>`;
    return `<div class="pre-final-row" data-pre-id="${esc(item.id)}">
      <div class="pre-final-main">
        <div class="pre-final-title">${esc(l.company_name||'Lead sem nome')}</div>
        <div class="pre-final-meta">${esc(item.chip_label||item.chip_instance)} · ${esc(leadType(l))} · ${esc(l.phone||l.normalized_phone||'sem telefone')} ${l.website?`· ${esc(l.website)}`:''}</div>
      </div>
      <div class="pre-final-status ${esc(status)}">${badge}</div>
      <div class="pre-final-actions">
        <button class="btn btn-ghost" data-pre-action="return" data-id="${esc(item.id)}">↩ Atribuição</button>
        ${approveButton}
        <button class="btn btn-ghost" data-pre-action="retry" data-id="${esc(item.id)}">Retry</button>
        <button class="btn btn-ghost" data-pre-action="invalid" data-id="${esc(item.id)}">Inválido</button>
      </div>
    </div>`;
  }

  async function render(){
    const r=root(); if(!r)return; if(state.loading)return; state.loading=true;
    try{
      await carryPendingWhatsappAfter20();
      const base=planningBaseDate();
      const dates=Array.from({length:7},(_,i)=>addDays(base,i)); if(!dates.includes(state.date)) state.date=dates[0];
      const [counts,chips,items,chipOccupancy]=await Promise.all([getCounts(dates),getChips(),getItems(state.date,state.chip),getChipOccupancyMap(state.date)]);
      const selectedChip = chips.find(ch=>ch.instance===state.chip);
      const cardLimit = selectedChip ? chipDailyLimit(selectedChip) : (chips.reduce((sum,ch)=>sum+chipDailyLimit(ch),0)||120);
      const totalOccupied = chips.reduce((sum,ch)=>sum+Number(chipOccupancy[ch.instance]||chipOccupancy[ch.label]||0),0);
      const chipOptions=`<button class="pre-chip ${state.chip==='all'?'active':''}" data-chip="all">Todos <small>${esc(totalOccupied)}/${esc(chips.reduce((sum,ch)=>sum+chipDailyLimit(ch),0)||120)}</small></button>`+chips.map(ch=>{const limit=chipDailyLimit(ch); const occupied=Number(chipOccupancy[ch.instance]||chipOccupancy[ch.label]||0); return `<button class="pre-chip ${state.chip===ch.instance?'active':''}" data-chip="${esc(ch.instance)}">${esc(ch.label)} <small>${esc(occupied)}/${esc(limit)}</small></button>`;}).join('');
      r.innerHTML=`<div class="pre-final">
        <div class="page-head"><div><div class="page-title">Pré-envio <span>semanal.</span></div><div class="page-subtitle">Fila por dia e chip, sem código legado.</div></div></div>
        <div id="preWeekCards" class="pre-week-cards-v129">${dates.map(d=>{const c=counts[d]||{};return `<button class="pre-day-card ${state.date===d?'active':''} ${d===today()?'today':''}" data-date="${d}"><span>${weekday(d)}, ${brDate(d)}</span><strong>${c.total||0}/${cardLimit}</strong><small>rev ${c.review||0} · ok ${c.approved||0} · retry ${c.retry||0} · inv ${c.invalid||0}</small>${d===today()?'<em>HOJE</em>':''}</button>`;}).join('')}</div>
        <div class="pre-final-card"><div class="card-title">Chips</div><div class="pre-chip-row">${chipOptions}</div></div>
        <div class="pre-final-card"><div class="card-title">Criar pré-envio</div><div class="pre-source-line"><b>Preencha a fila com leads de:</b><button class="btn btn-primary" data-fill="whatsapp">WhatsApp</button><button class="btn btn-primary" data-fill="site_agg">Com site + agregadores</button><button class="btn btn-primary" data-fill="general">Geral</button></div><div class="pre-final-help">WhatsApp/sem site entra automaticamente aprovado. Com site e Agregadores só entram se estiverem aprovados na Atribuição.</div></div>
        <div class="pre-final-card"><div class="pre-final-toolbar"><div><div class="card-title">Itens do dia</div><div class="pre-final-help">${esc(weekday(state.date))}, ${esc(brDate(state.date))} · ${state.chip==='all'?'Todos os chips':esc(state.chip)}</div></div><div><button class="btn btn-ghost" data-day-return="1">↩ Voltar dia para Atribuição</button><button class="btn btn-primary" data-send-approved="1">Enviar aprovados para Fila WhatsApp</button></div></div><div class="pre-final-list">${items.length?items.map(renderItem).join(''):`<div class="pre-empty">// nenhum lead neste dia/chip</div>`}</div></div>
      </div>`;
    }finally{state.loading=false;}
  }
  function style(){if(document.getElementById('pre-dispatch-final-style'))return;const st=document.createElement('style');st.id='pre-dispatch-final-style';st.textContent=`
    .pre-final{display:flex;flex-direction:column;gap:12px}.pre-final-card{background:var(--card);border:1px solid var(--border2);border-radius:14px;padding:14px}.pre-week-cards-v129{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr));gap:10px}.pre-day-card{background:var(--card);border:1px solid var(--border2);border-radius:12px;padding:13px 12px;text-align:left;color:var(--text);font-family:'DM Mono',monospace;min-height:92px;cursor:pointer}.pre-day-card span{display:block;font-size:10px;color:var(--muted);margin-bottom:8px}.pre-day-card strong{display:block;font-size:18px}.pre-day-card small{display:block;font-size:8px;color:var(--muted);margin-top:6px}.pre-day-card em{display:inline-flex;margin-top:8px;padding:2px 7px;border-radius:999px;border:1px solid rgba(184,240,89,.35);background:rgba(184,240,89,.08);color:var(--accent);font-style:normal;font-size:8px;font-weight:800}.pre-day-card.active{border-color:var(--accent);box-shadow:0 0 0 1px rgba(184,240,89,.15);background:rgba(184,240,89,.06)}.pre-chip-row,.pre-source-line{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pre-chip{border:1px solid var(--border2);background:rgba(255,255,255,.03);color:var(--text);border-radius:10px;padding:8px 10px;font-family:'DM Mono',monospace;font-size:10px;cursor:pointer}.pre-chip.active{border-color:var(--accent);background:rgba(184,240,89,.06)}.pre-chip small{color:var(--muted);margin-left:5px}.pre-final-help{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:8px}.pre-final-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.pre-final-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}.pre-final-row{display:flex;align-items:center;gap:10px;border:1px solid var(--border2);border-radius:12px;padding:10px;background:rgba(255,255,255,.025)}.pre-final-main{flex:1;min-width:0}.pre-final-title{font-weight:800;color:var(--text);font-size:13px}.pre-final-meta{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pre-final-status{font-family:'DM Mono',monospace;font-size:8px;border:1px solid var(--border2);border-radius:999px;padding:3px 7px;color:var(--muted)}.pre-final-status.approved{color:var(--accent);border-color:rgba(184,240,89,.35)}.pre-final-actions{display:flex;gap:6px;flex-wrap:wrap}.pre-final-actions .btn{font-size:9px;padding:7px 9px}.pre-empty{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:24px}@media(max-width:1100px){.pre-week-cards-v129{grid-template-columns:repeat(2,minmax(120px,1fr))}.pre-final-row{align-items:flex-start;flex-direction:column}.pre-final-actions{width:100%}}`;document.head.appendChild(st);}
  document.addEventListener('click',function(ev){
    const p=document.getElementById('panel-pre-envio'); if(!p||!p.contains(ev.target))return;
    const day=ev.target.closest('.pre-day-card'); if(day){ev.preventDefault();state.date=day.dataset.date||state.date;render();return;}
    const chip=ev.target.closest('.pre-chip'); if(chip){ev.preventDefault();state.chip=chip.dataset.chip||'all';render();return;}
    const fill=ev.target.closest('[data-fill]'); if(fill){ev.preventDefault();fillByMode(fill.dataset.fill);return;}
    const retDay=ev.target.closest('[data-day-return]'); if(retDay){ev.preventDefault();returnDay();return;}
    const send=ev.target.closest('[data-send-approved]'); if(send){ev.preventDefault();sendApprovedToQueue();return;}
    const act=ev.target.closest('[data-pre-action]'); if(act){ev.preventDefault();const id=act.dataset.id;const a=act.dataset.preAction;if(a==='return')returnItem(id);else if(a==='approve')setItemStatus(id,'approved');else if(a==='retry')setItemStatus(id,'validation_retry');else if(a==='invalid')setItemStatus(id,'invalid');return;}
  },true);
  window.renderPreEnvioPanelV31=function(){style();return render();};
  window.renderPreDispatchFinal=window.renderPreEnvioPanelV31;
  window.createPreSendBatchV31=function(){return fillByMode('general');};
  window.createPreSendBatchBySourceV128=function(mode){return fillByMode(mode||'general');};
  window.returnPreEnvioDayToAttributionV31=function(date){state.date=date||state.date;return returnDay();};
  window.returnPreEnvioItemToAttribution=function(id){return returnItem(id);};
  document.addEventListener('DOMContentLoaded',()=>{style();setTimeout(()=>{if(document.getElementById('panel-pre-envio')?.classList.contains('active'))render();},100);});
  if(document.readyState!=='loading')setTimeout(()=>{style(); if(document.getElementById('panel-pre-envio'))render();},150);
  console.log('[Lead Certo] Pré-envio final ativo',VERSION);
})();
