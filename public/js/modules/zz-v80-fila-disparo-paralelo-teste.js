/* V80 — Fila WhatsApp: disparo real por chip, pausar/retomar sem reiniciar e lead teste.
   - Não cria tabela nova.
   - Usa Supabase como fonte de verdade para status dos leads.
   - Cada chip roda sua própria fila em paralelo, respeitando o intervalo do chip.
   - Pausar/retomar não reenviam leads já marcados como sent. */
(function(){
  'use strict';
  const VERSION='20260618-V82-TESTE-LEAD-REAL-FILA';
  const USER_ID_FALLBACK='c02fe973-4eb5-4036-9f8d-8787937e8b11';
  const runtime={chips:{},log:[],lastData:null,startedAt:null};
  const LS_KEY='vs_dispatch_runtime_v80';

  function sb(){try{return window.sbClient||(typeof sbClient!=='undefined'?sbClient:null);}catch(_){return null;}}
  function uid(){try{return window.currentUser?.id||(typeof currentUser!=='undefined'&&currentUser?.id)||localStorage.getItem('vs_auth_local_user_v423')||USER_ID_FALLBACK;}catch(_){return USER_ID_FALLBACK;}}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function digits(v){return String(v||'').replace(/\D/g,'');}
  function phone(v){let d=digits(v); if(!d)return ''; if(d.startsWith('00'))d=d.slice(2); if(d.startsWith('55'))return d; if(d.length===10||d.length===11)return '55'+d; return d;}
  function todayIso(){const d=new Date();d.setHours(0,0,0,0);return d.toISOString().slice(0,10);}
  function chipKey(ch){return String(ch?.instance||ch?.chip_id||ch?.label||ch?.id||'').trim();}
  function chipTitle(ch){return String(ch?.label||ch?.name||ch?.chip_id||ch?.instance||'Chip').trim();}
  function rowChipKey(r){return String(r?.chip_instance||r?.chip_label||'').trim();}
  function rowChipTitle(r){return String(r?.chip_label||r?.chip_instance||'Chip').trim();}
  function chipRef(ch){return String(ch?.id||chipKey(ch)||chipTitle(ch)||'chip');}
  function leadName(l){return l?.company_name||l?.nome||l?.title||'Lead';}
  function leadPhone(l){return phone(l?.normalized_phone||l?.phone||l?.whatsapp||l?.telefone||'');}
  function statusKey(s){const raw=String(s||'').toLowerCase(); if(['sent','enviado','enviada'].includes(raw))return 'sent'; if(['error','erro','failed','dispatch_error'].includes(raw))return 'error'; return 'queue';}
  function isConnected(ch){const s=String(ch?.connection_state||ch?.connectionState||ch?.status||'').toLowerCase(); return ['connected','open','online','conectado'].includes(s);}
  function hasConfig(ch){return !!(String(ch?.instance||'').trim() && String(ch?.api_key||ch?.apiKey||ch?.key||'').trim() && String(ch?.base_url||ch?.evolution_url||ch?.url||'').trim());}
  function cfg(ch){return {url:String(ch?.base_url||ch?.evolution_url||ch?.url||'').replace(/\/$/,''),instance:String(ch?.instance||''),apiKey:String(ch?.api_key||ch?.apiKey||ch?.key||'')};}
  function headers(c){return {'Content-Type':'application/json',apikey:c.apiKey};}
  function addLog(msg){const line=`${new Date().toLocaleTimeString('pt-BR')} · ${msg}`; runtime.log.unshift(line); runtime.log=runtime.log.slice(0,80); saveRuntime(); renderV80Log();}
  function saveRuntime(){try{localStorage.setItem(LS_KEY,JSON.stringify({chips:runtime.chips,log:runtime.log.slice(0,20),startedAt:runtime.startedAt,updatedAt:new Date().toISOString()}));}catch(_){}}
  function hydrateRuntime(){try{const r=JSON.parse(localStorage.getItem(LS_KEY)||'{}'); if(r&&typeof r==='object'){runtime.log=Array.isArray(r.log)?r.log:[]; runtime.startedAt=r.startedAt||null;}}catch(_){}}

  function currentDate(){const btn=document.querySelector('#panel-fila-zap .day-tab.active'); const on=btn?.getAttribute('onclick')||''; const m=on.match(/['"](\d{4}-\d{2}-\d{2})['"]/); return m?m[1]:todayIso();}
  function currentStatus(){const btn=document.querySelector('#panel-fila-zap .status-tab.active'); const on=btn?.getAttribute('onclick')||''; const m=on.match(/['"]([^'"]+)['"]/); return m?m[1]:'queue';}
  function currentOpenChip(){const acc=document.querySelector('#panel-fila-zap .v73-chip-acc.open .v73-chip-head'); const on=acc?.getAttribute('onclick')||''; const m=on.match(/['"]([^'"]*)['"]/); return m&&m[1]?m[1]:'';}

  function normalize(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
  function categoriesOf(l){
    const out=[]; ['category_name','category','categoria','parent_category'].forEach(k=>{if(l&&l[k])out.push(String(l[k]));});
    const cats=l?.categories;
    if(Array.isArray(cats))cats.forEach(c=>out.push(String(c)));
    else if(typeof cats==='string'){try{const p=JSON.parse(cats); if(Array.isArray(p))p.forEach(c=>out.push(String(c))); else out.push(cats);}catch(_){cats.split(/[;,|]/).forEach(c=>out.push(c));}}
    const raw=l?.raw_payload||{}; ['category','category_name','categoria','categories'].forEach(k=>{const v=raw[k]; if(Array.isArray(v))v.forEach(x=>out.push(String(x))); else if(v)out.push(String(v));});
    return [...new Set(out.map(x=>x.trim()).filter(Boolean))];
  }
  function resolveRamo(l){
    try{if(typeof window.resolveLeadParentRamoV73==='function')return window.resolveLeadParentRamoV73(l)||{id:'__fora_do_ramo__',nome:'Fora do ramo',unknown:true};}catch(_){ }
    return {id:'__fora_do_ramo__',nome:'Fora do ramo',unknown:true};
  }
  function blockSize(ch){const n=Number(ch?.block_size||ch?.blockSize||0); if(n>0)return n; try{if(typeof window.getLoteSize==='function')return Math.max(1,Number(window.getLoteSize())||60);}catch(_){} return 60;}
  function loteNum(row,ch){return Math.floor((Number(row?.position||1)-1)/blockSize(ch))+1;}
  async function loteImage(ch,row){const ramo=resolveRamo(row.lead||{}); const lote=loteNum(row,ch); try{if(typeof window.loadLoteImagemPorRamoV73==='function')return await window.loadLoteImagemPorRamoV73(chipRef(ch),lote,ramo.id);}catch(_){} try{if(typeof window.getLoteImagemPorRamoV73==='function')return window.getLoteImagemPorRamoV73(chipRef(ch),lote,ramo.id);}catch(_){} return null;}

  function templatePair(row){
    const l=row.lead||{}; const nome=leadName(l); const tipo=String(row.lead_type||l.lead_type||'').trim();
    const raw=row.raw_payload||{};
    const m1=raw.message_1||raw.mensagem1||raw.msg1||raw.template_msg1||l.message_1||'';
    const m2=raw.message_2||raw.mensagem2||raw.msg2||raw.template_msg2||l.message_2||'';
    if(m1||m2) return {m1:m1||`Olá, tudo bem? Me chamo Samuel. Encontrei a ${nome} pelo Google.`, m2:m2||`Tenho um exemplo para te mostrar: bichopreguicaplanejados.com.br`};
    try{
      if(typeof window.pickTemplate==='function'){
        const ramo=resolveRamo(l); const p=window.pickTemplate(nome,ramo.id,tipo); const p2=typeof window.pickOtherTemplate==='function'?window.pickOtherTemplate(nome,p?.idx??-1,ramo.id,tipo):null;
        return {m1:p?.text||`Olá, tudo bem? Me chamo Samuel. Encontrei a ${nome} pelo Google.`,m2:p2?.text||`Tenho um exemplo para te mostrar: bichopreguicaplanejados.com.br`};
      }
    }catch(_){ }
    return {m1:`Olá, tudo bem? Me chamo Samuel. Encontrei a ${nome} pelo Google e notei que vocês têm um trabalho bem avaliado.`,m2:`Tenho um exemplo de projeto que desenvolvi para a Bicho Preguiça: bichopreguicaplanejados.com.br. Posso te enviar uma amostra rápida para a ${nome}?`};
  }

  async function sendText(c,number,text){
    const res=await fetch(`${c.url}/message/sendText/${encodeURIComponent(c.instance)}`,{method:'POST',headers:headers(c),body:JSON.stringify({number,options:{delay:1000},textMessage:{text}})});
    const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data?.message||data?.error||`sendText HTTP ${res.status}`); return data;
  }
  async function sendMedia(c,number,img){
    const b64=String(img||'').includes(',')?String(img).split(',')[1]:String(img||''); if(!b64)return null;
    const mime=String(img||'').match(/^data:([^;]+);/)?.[1]||'image/jpeg';
    const res=await fetch(`${c.url}/message/sendMedia/${encodeURIComponent(c.instance)}`,{method:'POST',headers:headers(c),body:JSON.stringify({number,options:{delay:1000},mediaMessage:{mediatype:'image',media:b64,mimetype:mime,fileName:'amostra.jpg',caption:''}})});
    const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data?.message||data?.error||`sendMedia HTTP ${res.status}`); return data;
  }
  async function persistOutgoing(row,ch,number,text,response,type='text'){
    try{
      if(typeof window.persistOutgoingWhatsappMessageV412==='function'){
        await window.persistOutgoingWhatsappMessageV412({id:response?.key?.id||response?.id||`${row.id}-${type}-${Date.now()}`,leadId:row.lead_id||'',instance:ch.instance,phone:number,text,occurredAt:new Date().toISOString(),response});
      }
    }catch(e){console.warn('[v80][persist outgoing]',e?.message||e);}
  }
  async function setStatus(id,st){
    const c=sb(); if(!c)return; const db=st==='sent'?'sent':st==='error'?'error':st==='sending'?'sending':'queued';
    await c.from('pre_dispatch_items').update({status:db,updated_at:new Date().toISOString()}).eq('user_id',uid()).eq('id',id);
  }
  async function readCurrentStatus(id){
    const c=sb(); if(!c)return null; const {data}=await c.from('pre_dispatch_items').select('id,status').eq('user_id',uid()).eq('id',id).maybeSingle(); return data?.status||null;
  }
  async function markSent(row){
    const c=sb(); const l=row.lead||{}; const p=leadPhone(l); const now=new Date().toISOString(); if(!c||!p)return;
    await c.from('leads').update({current_stage:'sent',current_status:'sent',status:'sent',updated_at:now}).eq('user_id',uid()).eq('id',row.lead_id);
    try{const {data:exists}=await c.from('sent_contacts').select('id').eq('user_id',uid()).eq('normalized_phone',p).limit(1); if(!exists?.length){await c.from('sent_contacts').insert({user_id:uid(),lead_id:row.lead_id||null,company_name:l.company_name||null,phone:l.phone||p,normalized_phone:p,block_type:'already_sent',source:'dispatch_queue',reason:'',active:true,dispatched_at:now,created_at:now,raw_payload:{pre_dispatch_item_id:row.id,website:l.website||'',maps_url:l.maps_url||'',category:l.category_name||l.category||'',categories:l.categories||[],raw_payload:l.raw_payload||{}}});}}catch(e){console.warn('[v80][sent_contacts]',e?.message||e);}
    try{await c.from('base_permanente').upsert({user_id:uid(),company_name:l.company_name||null,phone:l.phone||p,normalized_phone:p,website:l.website||null,instagram_url:l.instagram_url||null,maps_url:l.maps_url||null,city:l.city||null,state:l.state||null,category:l.category||null,category_name:l.category_name||l.category||null,categories:Array.isArray(l.categories)?l.categories:[],rating:l.rating||null,reviews_count:l.reviews_count||null,status:'ja_enviado',whatsapp_sent_at:now,last_channel:'whatsapp',last_contact_at:now,last_event_type:'sent',last_event_status:'sent',source:'dispatch_queue',raw_payload:l.raw_payload||{},updated_at:now},{onConflict:'user_id,normalized_phone'});}catch(e){console.warn('[v80][base]',e?.message||e);}
  }

  async function fetchData(date){
    const c=sb(); if(!c)return {items:[],chips:[],error:new Error('Supabase indisponível')};
    const statuses=['ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled','sending','sent','enviado','paused','error','erro','failed'];
    const [it,ch]=await Promise.all([
      c.from('pre_dispatch_items').select('id,lead_id,user_id,chip_instance,chip_label,scheduled_date,lead_type,status,position,raw_payload,updated_at').eq('user_id',uid()).eq('scheduled_date',date).in('status',statuses).order('chip_label',{ascending:true}).order('position',{ascending:true}),
      c.from('whatsapp_instances').select('id,chip_id,label,name,instance,base_url,evolution_url,url,api_key,status,connection_state,active,daily_limit,block_size,interval_seconds').eq('user_id',uid()).eq('active',true).order('label',{ascending:true})
    ]);
    if(it.error)return {items:[],chips:[],error:it.error};
    const rows=it.data||[]; const ids=[...new Set(rows.map(r=>r.lead_id).filter(Boolean))]; const leads={};
    if(ids.length){const {data,error}=await c.from('leads').select('id,company_name,phone,normalized_phone,website,instagram_url,maps_url,street,city,state,country_code,rating,reviews_count,category,category_name,categories,parent_category,lead_type,current_stage,raw_payload').eq('user_id',uid()).in('id',ids); if(error)console.warn('[v80][leads]',error.message); (data||[]).forEach(l=>leads[l.id]=l);}
    const chips=(ch.data||[]).filter(x=>x.active!==false && x.instance);
    const items=rows.filter(r=>{const l=leads[r.lead_id]||{}; const stage=String(l.current_stage||'').toLowerCase(); const st=String(r.status||'').toLowerCase(); return stage==='dispatch_queue' && ['ready_to_dispatch','queued','dispatch_queue','not_sent','waiting','scheduled','sending','sent','enviado','paused','error','erro','failed'].includes(st);}).map(r=>({...r,lead:leads[r.lead_id]||{}}));
    return {items,chips,error:null};
  }
  function chipForRow(row,chips){return (chips||[]).find(ch=>chipKey(ch)===rowChipKey(row)||chipTitle(ch)===rowChipTitle(row)||chipKey(ch)===rowChipTitle(row)||chipTitle(ch)===rowChipKey(row))||null;}
  function runnableRows(data,chipFilter){
    return (data.items||[]).filter(r=>statusKey(r.status)==='queue').filter(r=>!chipFilter||chipFilter==='all'||rowChipKey(r)===chipFilter||rowChipTitle(r)===chipFilter).sort((a,b)=>(a.position||0)-(b.position||0));
  }

  async function sendOne(row,ch,{test=false,simulate=false,testName='Lead teste',targetPhone=''}={}){
    const c=cfg(ch); if(!c.url||!c.apiKey||!c.instance)throw new Error(`Chip ${chipTitle(ch)} sem URL/instância/api_key`);
    if(!test && !row?.id)throw new Error('Item ausente');
    const l=test?{company_name:testName,phone:row.phone,normalized_phone:row.phone,category:'teste'}:(row.lead||{});
    const number=phone(targetPhone)||leadPhone(l)||phone(row.phone); if(!number)throw new Error('Telefone ausente');
    if(!test && !simulate){const cur=await readCurrentStatus(row.id); if(statusKey(cur)==='sent')return {skipped:true,reason:'já enviado'}; await setStatus(row.id,'sending');}
    const {m1,m2}=test?{m1:`Teste de envio da plataforma — Mensagem 1`,m2:`Teste de envio da plataforma — Mensagem 2`} : templatePair(row);
    const r1=await sendText(c,number,m1); if(!simulate) await persistOutgoing(row||{},ch,number,m1,r1,'text1');
    await sleep(10000);
    const r2=await sendText(c,number,m2); if(!simulate) await persistOutgoing(row||{},ch,number,m2,r2,'text2');
    await sleep(5000);
    let img=null;
    if(test){
      const data=runtime.lastData||await fetchData(currentDate()); const first=(data.items||[]).find(x=>chipForRow(x,data.chips||[])?.id===ch.id)||data.items?.[0]; if(first)img=await loteImage(ch,first);
    } else img=await loteImage(ch,row);
    if(simulate && !img){const ramo=resolveRamo(row.lead||{}); throw new Error(`Imagem do ramo não encontrada: ${ramo.nome||ramo.id}`);}
    if(img){const r3=await sendMedia(c,number,img); if(!simulate) await persistOutgoing(row||{},ch,number,'[imagem]',r3,'image');}
    if(!test && !simulate){await setStatus(row.id,'sent'); await markSent(row);}
    return {ok:true};
  }

  async function chipLoop(ch,rows){
    const key=chipKey(ch); const run=runtime.chips[key]||(runtime.chips[key]={});
    run.running=true; run.paused=false; run.stopped=false; run.total=rows.length; run.sent=run.sent||0; run.errors=run.errors||0; run.current=run.current||0; run.label=chipTitle(ch); saveRuntime(); renderV80Controls();
    addLog(`Chip ${chipTitle(ch)} iniciado com ${rows.length} lead(s).`);
    for(let i=run.current||0;i<rows.length;i++){
      if(run.stopped)break;
      while(run.paused && !run.stopped){run.state='Pausado'; renderV80Controls(); await sleep(1000);}
      if(run.stopped)break;
      const row=rows[i]; run.current=i; run.lead=leadName(row.lead); run.state='Enviando'; saveRuntime(); renderV80Controls();
      try{
        if(!isConnected(ch)) throw new Error('chip desconectado');
        const res=await sendOne(row,ch);
        if(res?.skipped){addLog(`${chipTitle(ch)} · pulado: ${leadName(row.lead)} (${res.reason})`);} else {run.sent=(run.sent||0)+1; addLog(`${chipTitle(ch)} · enviado: ${leadName(row.lead)}`);}
      }catch(e){
        run.errors=(run.errors||0)+1; addLog(`${chipTitle(ch)} · erro em ${leadName(row.lead)}: ${e.message}`);
        const msg=String(e?.message||'');
        if(msg.includes('desconectado')||msg.includes('sem URL')||msg.includes('api_key')||msg.includes('Failed to fetch')||msg.includes('NetworkError')){
          run.paused=true; run.state='Pausado por erro do chip'; notify(`Chip ${chipTitle(ch)} pausado: ${msg}`,'err'); break;
        }
        await setStatus(row.id,'error');
      }
      const sec=Math.max(10,Number(ch?.interval_seconds||ch?.intervalSeconds||120)||120);
      run.nextAt=new Date(Date.now()+sec*1000).toISOString(); run.state=`Aguardando ${sec}s`; saveRuntime(); renderV80Controls();
      for(let s=0;s<sec && !run.stopped;s++){while(run.paused && !run.stopped){run.state='Pausado'; renderV80Controls(); await sleep(1000);} await sleep(1000);}
    }
    run.running=false; run.state=run.stopped?'Parado':'Finalizado'; saveRuntime(); renderV80Controls(); addLog(`Chip ${chipTitle(ch)} ${run.state.toLowerCase()}.`);
    try{if(typeof window.renderFilaZapV74==='function')window.renderFilaZapV74(); else if(typeof window.renderFilaZap==='function')window.renderFilaZap();}catch(_){ }
  }

  async function startDispatchV80(){
    const date=currentDate(); const chipFilter=currentOpenChip()||'all'; const data=await fetchData(date); runtime.lastData=data;
    if(data.error)return notify(data.error.message,'err');
    const rows=runnableRows(data,chipFilter); if(!rows.length)return notify('Nenhum lead em fila para disparar neste dia/filtro.','warn');
    const invalidRows=rows.filter(r=>{const ramo=resolveRamo(r.lead||{}); return ramo.unknown||ramo.id==='__fora_do_ramo__';});
    if(invalidRows.length){
      addLog(`Disparo bloqueado: ${invalidRows.length} lead(s) fora dos ramos cadastrados.`);
      return notify(`Disparo bloqueado: existem ${invalidRows.length} lead(s) fora dos ramos cadastrados. Corrija/remova antes de disparar.`, 'err');
    }
    const missingImgs=[];
    for(const r of rows){
      const ch=chipForRow(r,data.chips); if(!ch) continue;
      const ramo=resolveRamo(r.lead||{});
      const img=await loteImage(ch,r);
      if(!img) missingImgs.push(`${chipTitle(ch)} · ${leadName(r.lead)} · ${ramo.nome||ramo.id}`);
    }
    if(missingImgs.length){
      addLog(`Disparo bloqueado: ${missingImgs.length} lead(s) sem imagem do ramo.`);
      return notify(`Disparo bloqueado: falta imagem de ramo em ${missingImgs.length} lead(s).`, 'err');
    }
    const groups=new Map();
    rows.forEach(r=>{const ch=chipForRow(r,data.chips); if(!ch)return; const key=chipKey(ch); if(!groups.has(key))groups.set(key,{chip:ch,rows:[]}); groups.get(key).rows.push(r);});
    const runnable=[...groups.values()].filter(g=>hasConfig(g.chip)&&isConnected(g.chip));
    const blocked=[...groups.values()].filter(g=>!hasConfig(g.chip)||!isConnected(g.chip));
    blocked.forEach(g=>addLog(`Chip ${chipTitle(g.chip)} ignorado: ${!hasConfig(g.chip)?'não configurado':'desconectado'}`));
    if(!runnable.length)return notify('Nenhum chip conectado/configurado para disparar.','warn');
    runtime.startedAt=new Date().toISOString();
    runnable.forEach(g=>{const key=chipKey(g.chip); runtime.chips[key]={label:chipTitle(g.chip),running:true,paused:false,stopped:false,current:0,total:g.rows.length,sent:0,errors:0,state:'Iniciando'}; chipLoop(g.chip,g.rows);});
    notify(`Disparo iniciado em ${runnable.length} chip(s).`);
    injectControls();
  }
  function pauseAllV80(){Object.values(runtime.chips).forEach(r=>{if(r.running)r.paused=true;}); saveRuntime(); renderV80Controls(); addLog('Disparo pausado.');}
  function resumeAllV80(){Object.values(runtime.chips).forEach(r=>{if(r.running){r.paused=false;r.stopped=false;}}); saveRuntime(); renderV80Controls(); addLog('Disparo retomado.');}
  function stopAllV80(){Object.values(runtime.chips).forEach(r=>{r.stopped=true;r.paused=false;r.running=false;r.state='Parado';}); saveRuntime(); renderV80Controls(); addLog('Disparo parado.');}
  function pauseChipV80(key){const r=runtime.chips[key]; if(r){r.paused=true;saveRuntime();renderV80Controls();}}
  function resumeChipV80(key){const r=runtime.chips[key]; if(r){r.paused=false;r.stopped=false;saveRuntime();renderV80Controls();}}

  async function sendTestV80(){
    const p=phone(document.getElementById('v80TestPhone')?.value||''); if(!p)return notify('Informe um número para teste.','warn');
    const date=currentDate(); const data=await fetchData(date); runtime.lastData=data;
    const chips=(data.chips||[]).filter(ch=>hasConfig(ch)&&isConnected(ch)); if(!chips.length)return notify('Nenhum chip conectado para teste.','warn');
    const selected=document.getElementById('v80TestChip')?.value||''; const ch=chips.find(c=>chipKey(c)===selected)||chips[0];
    try{addLog(`Teste: enviando para +${p} via ${chipTitle(ch)}`); await sendOne({phone:p,id:`teste-${Date.now()}`,lead:{company_name:'Lead teste',phone:p,normalized_phone:p}},ch,{test:true,testName:'Lead teste'}); addLog('Teste enviado com sucesso.'); notify('Teste enviado.');}catch(e){addLog(`Erro no teste: ${e.message}`); notify(e.message,'err');}
  }

  async function sendFilaLeadTestV80(){
    const date=currentDate();
    let data=runtime.lastData;
    if(!data||!data.items){data=await fetchData(date); runtime.lastData=data;}
    const id=document.getElementById('v80FilaTestLead')?.value||'';
    if(!id)return notify('Selecione um lead da fila para testar.','warn');
    const row=(data.items||[]).find(x=>String(x.id)===String(id));
    if(!row)return notify('Lead selecionado não encontrado na fila atual. Atualize a lista.','warn');
    const ch=chipForRow(row,data.chips||[]);
    if(!ch)return notify('Chip do lead não encontrado.','warn');
    if(!hasConfig(ch))return notify(`Chip ${chipTitle(ch)} não configurado.`, 'warn');
    if(!isConnected(ch))return notify(`Chip ${chipTitle(ch)} desconectado.`, 'warn');
    const target=phone(document.getElementById('v80FilaTestTarget')?.value||'');
    const ramo=resolveRamo(row.lead||{});
    const destino=target||leadPhone(row.lead||{});
    if(ramo.unknown||ramo.id==='__fora_do_ramo__')return notify('Lead fora dos ramos cadastrados. Ajuste a subcategoria/ramo antes de testar como lead real.', 'err');
    if(!destino)return notify('Lead sem telefone e nenhum destino de teste informado.','warn');
    try{
      addLog(`Teste real: ${leadName(row.lead)} · ${ramo.nome||ramo.id} · via ${chipTitle(ch)} · destino +${destino}`);
      await sendOne(row,ch,{simulate:true,targetPhone:target});
      addLog('Teste real enviado sem alterar status, limite ou base permanente.');
      notify('Teste real enviado. O lead não foi marcado como enviado.');
    }catch(e){
      addLog(`Erro no teste real: ${e.message}`);
      notify(e.message,'err');
    }
  }

  async function previewV80(){const date=currentDate(); const data=await fetchData(date); runtime.lastData=data; const rows=runnableRows(data,currentOpenChip()||'all'); const by={}; rows.forEach(r=>{by[rowChipTitle(r)]=(by[rowChipTitle(r)]||0)+1;}); addLog(`Prévia ${date}: ${rows.length} lead(s) · ${Object.entries(by).map(([k,v])=>`${k}: ${v}`).join(' · ')||'sem chip'}`); renderV80Controls();}

  function applyStyle(){if(document.getElementById('v80-dispatch-style'))return; const st=document.createElement('style'); st.id='v80-dispatch-style'; st.textContent=`
    .v80-dispatch-box{border:1px solid var(--border2);background:rgba(255,255,255,.024);border-radius:12px;padding:12px;margin:0 0 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;flex-shrink:0}
    .v80-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:900;color:var(--text);margin-bottom:4px}.v80-sub{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);line-height:1.55}.v80-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.v80-btn{border:1px solid var(--border2);background:rgba(255,255,255,.025);border-radius:8px;color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:7px 9px;cursor:pointer;white-space:nowrap}.v80-btn:hover{border-color:var(--accent);color:var(--accent)}.v80-btn.primary{background:var(--accent);color:#111;border-color:var(--accent);font-weight:900}.v80-btn.blue{border-color:rgba(74,179,255,.45);color:#4ab3ff}.v80-btn.danger{border-color:rgba(255,80,80,.45);color:#ff6b6b}.v80-chip-run{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)}.v80-pill{display:inline-flex;border:1px solid var(--border2);border-radius:999px;padding:3px 7px;gap:5px;align-items:center}.v80-pill.run{color:var(--accent);border-color:rgba(184,240,89,.35)}.v80-pill.pause{color:#ffd166;border-color:rgba(255,209,102,.35)}.v80-pill.done{color:var(--ok);border-color:rgba(78,203,113,.35)}.v80-pill.err{color:var(--error);border-color:rgba(255,80,80,.35)}.v80-test{grid-column:1/-1;border-top:1px dashed var(--border2);padding-top:9px;display:flex;gap:7px;align-items:center;flex-wrap:wrap}.v80-test input,.v80-test select{background:var(--bg);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:7px 9px;font-family:'DM Mono',monospace;font-size:9px;min-width:160px}.v80-test.real{align-items:flex-end}.v80-test.real select{min-width:280px;max-width:520px}.v80-field{display:flex;flex-direction:column;gap:4px}.v80-field label{font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.v80-log{grid-column:1/-1;max-height:74px;overflow:auto;border-top:1px dashed var(--border2);padding-top:8px;font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);line-height:1.55}@media(max-width:900px){.v80-dispatch-box{grid-template-columns:1fr}.v80-actions{justify-content:flex-start}}
  `; document.head.appendChild(st);}
  function renderV80Log(){const el=document.getElementById('v80DispatchLog'); if(el)el.innerHTML=runtime.log.length?runtime.log.slice(0,8).map(esc).join('<br>'):'// nenhum evento ainda';}
  async function renderV80Controls(){
    const holder=document.getElementById('v80DispatchBox'); if(!holder)return;
    const date=currentDate(); let data=runtime.lastData; if(!data||!data.items){try{data=await fetchData(date); runtime.lastData=data;}catch(_){data={items:[],chips:[]};}}
    const rows=runnableRows(data,currentOpenChip()||'all');
    const chips=(data.chips||[]).filter(hasConfig);
    const leadOptions=rows.slice(0,300).map(r=>{const ramo=resolveRamo(r.lead||{}); const tipo=String(r.lead_type||r.lead?.lead_type||'sem-site').replace(/_/g,' '); return `<option value="${esc(r.id)}">${esc(rowChipTitle(r))} · ${esc(leadName(r.lead))} · ${esc(ramo.nome||ramo.id)} · ${esc(tipo)}</option>`;}).join('');
    const running=Object.values(runtime.chips).some(r=>r.running&&!r.stopped);
    const chipLines=Object.entries(runtime.chips).map(([key,r])=>{const cls=r.paused?'pause':r.running?'run':r.errors?'err':'done'; return `<span class="v80-pill ${cls}">${esc(r.label||key)} · ${esc(r.state||'parado')} · ${Number(r.current||0)+1}/${r.total||0} · ok ${r.sent||0} · erro ${r.errors||0} ${r.running?`<button class="v80-btn" style="padding:2px 5px" onclick="pauseChipV80('${esc(key)}')">Pausar</button><button class="v80-btn" style="padding:2px 5px" onclick="resumeChipV80('${esc(key)}')">Retomar</button>`:''}</span>`;}).join('');
    holder.innerHTML=`<div><div class="v80-title">Disparo operacional</div><div class="v80-sub">Dia: <b>${esc(date)}</b> · Prontos: <b>${rows.length}</b> · Regra: cada chip envia 1 lead por ciclo e aguarda o intervalo configurado. Sequência: Msg1 → 10s → Msg2 → 5s → imagem do ramo.</div><div class="v80-chip-run">${chipLines||'<span class="v80-pill">Nenhum disparo em execução</span>'}</div></div><div class="v80-actions"><button class="v80-btn" onclick="previewDispatchV80()">Prévia</button><button class="v80-btn primary" onclick="startDispatchV80()" ${running?'disabled style="opacity:.5"':''}>Disparar</button><button class="v80-btn blue" onclick="pauseDispatchV80()">Pausar</button><button class="v80-btn blue" onclick="resumeDispatchV80()">Retomar</button><button class="v80-btn danger" onclick="stopDispatchV80()">Parar</button></div><div class="v80-test"><span class="v80-sub">Lead teste manual:</span><input id="v80TestPhone" placeholder="+55 DDD número" inputmode="tel"><select id="v80TestChip">${chips.map(ch=>`<option value="${esc(chipKey(ch))}">${esc(chipTitle(ch))} ${isConnected(ch)?'✓':'(desconectado)'}</option>`).join('')}</select><button class="v80-btn" onclick="sendTestDispatchV80()">Enviar teste</button><span class="v80-sub">Teste simples, fora da fila.</span></div><div class="v80-test real"><span class="v80-sub">Teste com lead da fila:</span><div class="v80-field"><label>Lead real simulado</label><select id="v80FilaTestLead">${leadOptions||'<option value="">Nenhum lead em fila nesta visão</option>'}</select></div><div class="v80-field"><label>Destino opcional</label><input id="v80FilaTestTarget" placeholder="se vazio, usa o telefone do lead" inputmode="tel"></div><button class="v80-btn primary" onclick="sendFilaLeadTestDispatchV80()">Enviar como teste</button><span class="v80-sub">Usa template + ramo + imagem do lote. Não muda status, limite ou base.</span></div><div class="v80-log" id="v80DispatchLog">${runtime.log.length?runtime.log.slice(0,8).map(esc).join('<br>'):'// nenhum evento ainda'}</div>`;
  }
  function injectControls(){
    applyStyle(); const body=document.querySelector('#panel-fila-zap .zapLeft-body'); if(!body)return; let box=document.getElementById('v80DispatchBox'); if(!box){box=document.createElement('div'); box.id='v80DispatchBox'; box.className='v80-dispatch-box'; const stats=body.querySelector('.stats-row'); if(stats&&stats.parentNode)stats.parentNode.insertBefore(box,stats.nextSibling); else body.insertBefore(box,body.firstChild);} renderV80Controls();
  }
  function scheduleInject(){setTimeout(injectControls,60);setTimeout(injectControls,400);}

  const prevRender=window.renderFilaZapV74||window.renderFilaZapV73||window.renderFilaZap;
  window.renderFilaZap=async function(){const out=typeof prevRender==='function'?await prevRender.apply(this,arguments):undefined; scheduleInject(); return out;};
  window.renderFilaZapV80=window.renderFilaZap;
  const prevSwitch=window.switchPanel;
  window.switchPanel=function(name){const r=typeof prevSwitch==='function'?prevSwitch.apply(this,arguments):undefined; const n=String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); if(['whatsapp','fila-zap','fila_whatsapp','zap'].includes(n)||name==='WhatsApp')scheduleInject(); return r;};
  document.addEventListener('click',e=>{if(e.target.closest?.('.nav-item[data-label="WhatsApp"],.day-tab,.status-tab,.v73-chip-head'))scheduleInject();},true);
  document.addEventListener('DOMContentLoaded',()=>{hydrateRuntime(); scheduleInject();});
  window.startDispatchV80=startDispatchV80; window.pauseDispatchV80=pauseAllV80; window.resumeDispatchV80=resumeAllV80; window.stopDispatchV80=stopAllV80; window.previewDispatchV80=previewV80; window.sendTestDispatchV80=sendTestV80; window.sendFilaLeadTestDispatchV80=sendFilaLeadTestV80; window.pauseChipV80=pauseChipV80; window.resumeChipV80=resumeChipV80;
  window.__V82_TESTE_LEAD_REAL_FILA__=VERSION;
})();
