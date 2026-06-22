/* V76 — Ramos de prospecção com subcategorias editáveis
   - Mantém categoria pai como rótulo do ramo.
   - Permite adicionar/remover/renomear subcategorias por ramo.
   - Ao salvar, a fila e atribuição passam a resolver o ramo pai atualizado automaticamente.
   - Não altera banco, chips, pré-envio, disparo, Evolution ou conversas. */
(function(){
  'use strict';
  const VERSION='20260618-V76-RAMOS-SUBCATEGORIAS-DINAMICAS';
  const MOVEIS_KEYS=['marcenaria','marceneiro','moveleiro','moveis planejados','móveis planejados','movelaria','móveis sob medida','moveis sob medida','carpintaria','armarios planejados','armários planejados','cozinhas planejadas','dormitórios planejados','dormitorios planejados','móveis','moveis'];

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');}
  function slug(v){return norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||('ramo-'+Date.now());}
  function notify(msg,type){try{if(typeof window.notify==='function')return window.notify(msg,type);}catch(_){} console[type==='err'?'error':'log'](msg);}
  function gen(){try{if(typeof window.genId==='function')return window.genId();}catch(_){} return 'r_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);}
  function sb(){try{return window.sbClient||(typeof sbClient!=='undefined'?sbClient:null)||window.supabaseClient||null;}catch(_){return null;}}
  function uid(){try{return window.currentUser?.id||(typeof currentUser!=='undefined'&&currentUser?.id)||localStorage.getItem('vs_auth_local_user_v423')||'';}catch(_){return '';}}
  function safeFileName(v){
    return String(v||'').trim()
      .replace(/\\/g,'/')
      .split('/').pop()
      .replace(/[^a-zA-Z0-9._-]/g,'-')
      .replace(/-+/g,'-');
  }

  function readRamos(){try{return (typeof window.getRamos==='function'?window.getRamos():getRamos())||[];}catch(_){return [];}}
  function writeRamos(ramos){try{if(typeof window.saveRamos==='function')window.saveRamos(ramos);else saveRamos(ramos);}catch(e){console.error('[v76][saveRamos]',e);} }

  function uniqueKeywords(arr){
    const seen=new Set();
    const out=[];
    (Array.isArray(arr)?arr:[]).forEach(k=>{
      const raw=String(k||'').trim();
      const key=norm(raw);
      if(!key||seen.has(key))return;
      seen.add(key); out.push(raw);
    });
    return out;
  }

  function normalizeRamo(r){
    const nome=String(r?.nome||'').trim()||'Novo ramo';
    const id=String(r?.id||'').trim()||slug(nome);
    let keywords=uniqueKeywords(Array.isArray(r?.keywords)?r.keywords:[]);
    const hay=norm([id,nome,...keywords].join(' '));
    const isMoveis=hay.includes('marcenaria')||hay.includes('marceneiro')||hay.includes('moveleiro')||hay.includes('movelaria')||hay.includes('moveis planejados')||hay.includes('moveis sob medida')||nome==='Móveis Planejados';
    const worker_image_file=safeFileName(r?.worker_image_file || r?.image_file || r?.local_image_file || '');
    if(isMoveis){
      keywords=uniqueKeywords([...keywords,...MOVEIS_KEYS]);
      return {...r,id:id||'moveis-planejados',nome:'Móveis Planejados',keywords,worker_image_file};
    }
    if(!keywords.length)keywords=[norm(nome)];
    return {...r,id,nome,keywords,worker_image_file};
  }

  function normalizeAll(ramos){return (Array.isArray(ramos)?ramos:[]).map(normalizeRamo);}

  function refreshAfterRamoChange(){
    try{ if(typeof window.renderRamoSelect==='function') window.renderRamoSelect(); }catch(_){}
    try{ if(typeof window.renderTemplatesConfig==='function') window.renderTemplatesConfig(); }catch(_){}
    try{ if(typeof window.renderFilaZapV74==='function') window.renderFilaZapV74(); else if(typeof window.renderFilaZapV73==='function') window.renderFilaZapV73(); else if(typeof window.renderFilaZap==='function') window.renderFilaZap(); }catch(_){}
    try{ if(typeof window.renderAtribuicao==='function') window.renderAtribuicao(); }catch(_){}
    try{ if(typeof window.updateBadges==='function') window.updateBadges(); }catch(_){}
  }

  async function syncWorkerImageFilesV160(ramos){
    const c=sb(), userId=uid();
    if(!c||!userId) return;
    const normalized=normalizeAll(ramos);
    const images={};
    normalized.forEach(r=>{
      const file=safeFileName(r.worker_image_file||'');
      if(!file) return;
      const keys=[r.id,r.nome,norm(r.nome),slug(r.nome)];
      (r.keywords||[]).forEach(k=>keys.push(k,norm(k),slug(k)));
      keys.filter(Boolean).forEach(k=>{ images[String(k)]=file; });
    });
    const payload={images,updated_at:new Date().toISOString(),source:'crm_ramos_config'};
    try{
      await c.from('operational_data').upsert({
        user_id:userId,
        scope:'whatsapp_worker_image_files',
        payload,
        updated_at:new Date().toISOString()
      },{onConflict:'user_id,scope'});
    }catch(e){ console.warn('[ramos][worker-images] falha ao sincronizar nomes das imagens',e); }
  }

  function saveNormalized(ramos){
    const normalized=normalizeAll(ramos);
    writeRamos(normalized);
    try{ syncWorkerImageFilesV160(normalized); }catch(_){}
    refreshAfterRamoChange();
  }

  function renderRamosConfigV76(){
    const wrap=document.getElementById('ramosConfigList');
    if(!wrap)return;
    const ramos=normalizeAll(readRamos());
    // Persiste normalização para corrigir bases antigas assim que abrir configurações.
    writeRamos(ramos);
    if(!ramos.length){
      wrap.innerHTML='<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">// nenhum ramo cadastrado</div>';
      return;
    }
    wrap.innerHTML=ramos.map(r=>{
      const kws=uniqueKeywords(r.keywords||[]);
      return `<div class="v76-ramo-card" style="background:var(--bg);border:1px solid var(--border2);border-radius:12px;padding:13px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="flex:1;min-width:180px">
            <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:.12em;margin-bottom:5px">CATEGORIA PAI / RÓTULO DO RAMO</div>
            <input value="${esc(r.nome)}" oninput="renomearRamoV76('${esc(r.id)}',this.value)" style="font-size:13px;font-weight:700;padding:9px 10px"/>
          </div>
          <button class="del-btn" onclick="deletarRamo('${esc(r.id)}')">✕</button>
        </div>
        <div style="margin:0 0 12px">
          <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:.12em;margin:0 0 5px">ARQUIVO DA IMAGEM NO WORKER</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input value="${esc(r.worker_image_file||'')}" placeholder="ex: moveis-planejados.jpg" oninput="atualizarImagemWorkerRamoV160('${esc(r.id)}',this.value)" style="flex:1;min-width:220px;font-size:11px;padding:8px 10px"/>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">Pasta: worker-whatsapp/images/</span>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:6px;line-height:1.5">O CRM salva apenas o nome. O arquivo real precisa existir localmente no worker com o mesmo nome.</div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:.12em;margin:0 0 7px">SUBCATEGORIAS QUE SERÃO AGRUPADAS NESTE RAMO</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
          ${kws.map((k,i)=>`<span class="v76-subcat-chip" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border2);color:var(--text2);font-family:'DM Mono',monospace;font-size:8px;padding:3px 8px;border-radius:100px">
            ${esc(k)} <button title="Remover subcategoria" onclick="removerSubcategoriaRamoV76('${esc(r.id)}',${i})" style="border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:10px;padding:0">×</button>
          </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="subcatInput_${esc(r.id)}" placeholder="Adicionar subcategoria: ex. moveleiro" onkeydown="if(event.key==='Enter'){event.preventDefault();adicionarSubcategoriaRamoV76('${esc(r.id)}')}" style="flex:1;min-width:220px;font-size:11px;padding:8px 10px"/>
          <button class="btn btn-ghost" onclick="adicionarSubcategoriaRamoV76('${esc(r.id)}')">+ Subcategoria</button>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-top:8px;line-height:1.5">Quando uma categoria importada bater com qualquer subcategoria acima, o lead será exibido como <b style="color:var(--accent)">${esc(r.nome)}</b> na fila e usará os templates/imagens desse ramo.</div>
      </div>`;
    }).join('');
  }

  function adicionarRamoV76(){
    const input=document.getElementById('novoRamoInput');
    const nome=String(input?.value||'').trim();
    if(!nome){notify('// informe o nome do ramo','err');return;}
    const ramos=normalizeAll(readRamos());
    const id=slug(nome);
    if(ramos.some(r=>norm(r.nome)===norm(nome)||String(r.id)===id)){notify('// ramo já existe','err');return;}
    ramos.push({id:gen(),nome,keywords:[]});
    saveNormalized(ramos);
    renderRamosConfigV76();
    if(input)input.value='';
    notify('✓ Ramo adicionado. Agora inclua as subcategorias.');
  }

  function deletarRamoV76(id){
    if(!confirm('Remover este ramo e suas subcategorias?'))return;
    const ramos=normalizeAll(readRamos()).filter(r=>String(r.id)!==String(id));
    saveNormalized(ramos);
    renderRamosConfigV76();
    notify('✓ Ramo removido');
  }

  function renomearRamoV76(id,nome){
    const ramos=normalizeAll(readRamos());
    const r=ramos.find(x=>String(x.id)===String(id));
    if(!r)return;
    r.nome=String(nome||'').trim()||r.nome;
    saveNormalized(ramos);
    // não re-render imediato para não perder foco; atualiza fila em debounce
    clearTimeout(window.__v76RamosRefresh);
    window.__v76RamosRefresh=setTimeout(refreshAfterRamoChange,350);
  }

  function adicionarSubcategoriaRamoV76(id){
    const inp=document.getElementById('subcatInput_'+id);
    const val=String(inp?.value||'').trim();
    if(!val){notify('// informe a subcategoria','err');return;}
    const ramos=normalizeAll(readRamos());
    const r=ramos.find(x=>String(x.id)===String(id));
    if(!r)return;
    r.keywords=uniqueKeywords([...(r.keywords||[]),val]);
    saveNormalized(ramos);
    renderRamosConfigV76();
    notify('✓ Subcategoria adicionada');
  }

  function removerSubcategoriaRamoV76(id,idx){
    const ramos=normalizeAll(readRamos());
    const r=ramos.find(x=>String(x.id)===String(id));
    if(!r)return;
    const kws=uniqueKeywords(r.keywords||[]);
    kws.splice(Number(idx),1);
    r.keywords=kws;
    saveNormalized(ramos);
    renderRamosConfigV76();
    notify('✓ Subcategoria removida');
  }

  function atualizarImagemWorkerRamoV160(id,file){
    const ramos=normalizeAll(readRamos());
    const r=ramos.find(x=>String(x.id)===String(id));
    if(!r)return;
    r.worker_image_file=safeFileName(file);
    saveNormalized(ramos);
    clearTimeout(window.__v160RamosWorkerImgRender);
    window.__v160RamosWorkerImgRender=setTimeout(()=>{ try{renderRamosConfigV76();}catch(_){} },700);
  }

  // Expõe/override as funções antigas usadas pelo HTML.
  window.renderRamosConfig=renderRamosConfigV76;
  window.adicionarRamo=adicionarRamoV76;
  window.deletarRamo=deletarRamoV76;
  window.renomearRamoV76=renomearRamoV76;
  window.adicionarSubcategoriaRamoV76=adicionarSubcategoriaRamoV76;
  window.removerSubcategoriaRamoV76=removerSubcategoriaRamoV76;
  window.atualizarImagemWorkerRamoV160=atualizarImagemWorkerRamoV160;

  // Garante que Móveis Planejados já fique com a lista completa ao carregar.
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
    try{saveNormalized(readRamos());}catch(_){}
    try{renderRamosConfigV76();}catch(_){}
    console.log('[v76][ramos-subcategorias] ativo',VERSION);
  },900));
})();
