
function debugDispatchPersistV413(step, data = {}) {
  try {
    console.groupCollapsed(`[dispatch][persist] ${step}`);
    console.log(data);
    console.groupEnd();
  } catch (e) {
    console.log(`[dispatch][persist] ${step}`, data);
  }
}
/* ════════════════════════════
   DISPARO — LOTES
════════════════════════════ */
function getLoteSize() {
  return Math.max(30, parseInt(document.getElementById('loteTamanho')?.value) || 30);
}
function getLoteConfig() {
  const tam = Math.max(30, parseInt(document.getElementById('loteTamanho')?.value)||30);
  const esp = Math.max(60, parseInt(document.getElementById('loteEsperaMin')?.value)||60);
  return { ativo: document.getElementById('loteAtivo')?.checked||false, tamanho: tam, esperaMin: esp };
}

function cancelarLotes() {
  if (loteEsperaTimer)  { clearTimeout(loteEsperaTimer);  loteEsperaTimer = null; }
  if (loteCountdownInt) { clearInterval(loteCountdownInt); loteCountdownInt = null; }
  filaLotes = []; loteAtual = 0; lotesTotal = 0; aguardandoLote = false; loteEsperaFim = null;
  document.getElementById('loteEsperaPanel').style.display = 'none';
  notify('// fila cancelada','warn');
}

function iniciarCountdownLote(msRestante) {
  const btnProx = document.getElementById('btnProximoLote');
  const countEl = document.getElementById('loteCountdown');
  const barEl   = document.getElementById('loteProgressBar');
  const duracaoMs = msRestante;
  if (loteCountdownInt) clearInterval(loteCountdownInt);
  function tick() {
    const restante = loteEsperaFim - Date.now();
    if (restante <= 0) { clearInterval(loteCountdownInt); loteCountdownInt=null; countEl.textContent='00:00'; barEl.style.width='100%'; btnProx.disabled=false; btnProx.style.background='var(--accent)'; notify('✓ Lote liberado!'); return; }
    const min = Math.floor(restante/60000), seg = Math.floor((restante%60000)/1000);
    countEl.textContent = `${String(min).padStart(2,'0')}:${String(seg).padStart(2,'0')}`;
    barEl.style.width = Math.min(100, ((duracaoMs-restante)/duracaoMs)*100) + '%';
  }
  tick(); loteCountdownInt = setInterval(tick, 500);
  loteEsperaTimer = setTimeout(() => { loteEsperaTimer = null; }, msRestante);
}

async function confirmarProximoLote() {
  if (!filaLotes.length) return;
  document.getElementById('btnProximoLote').disabled = true;
  document.getElementById('loteEsperaPanel').style.display = 'none';
  if (loteCountdownInt) { clearInterval(loteCountdownInt); loteCountdownInt = null; }
  if (loteEsperaTimer)  { clearTimeout(loteEsperaTimer);  loteEsperaTimer = null; }
  await dispararLote();
}

async function dispararLote() {
  loteAtual++;
  const lote     = filaLotes.shift();
  const loteConf = getLoteConfig();
  const chip     = getChipById(disparoChipId);
  if (!chip) { notify('// configure um chip primeiro','err'); return; }
  const delayMin = parseInt((document.getElementById('delayMin')||{}).value)||120;
  const delayMax = parseInt((document.getElementById('delayMax')||{}).value)||180;
  const MSG_DELAY = 15000; // 15s entre mensagens da mesma empresa
  const logEl    = document.getElementById('disparoLog');
  logEl.style.display = 'block';
  disparoEmAndamento = true;
  document.getElementById('btnDisparar').disabled = true;
  document.getElementById('disparoSpinner').style.display = 'block';
  document.getElementById('disparoBtn').textContent = `Lote ${loteAtual}/${lotesTotal}...`;

  function log(msg) { const l = document.createElement('div'); l.style.marginBottom='3px'; l.innerHTML=`<span style="color:var(--muted)">[${timeStr()}]</span> ${msg}`; logEl.appendChild(l); logEl.scrollTop=logEl.scrollHeight; }
  log(`<span style="color:var(--accent)">━━ LOTE ${loteAtual}/${lotesTotal} · ${lote.length} empresa${lote.length>1?'s':''} ━━</span>`);

  for (let i = 0; i < lote.length; i++) {
    const item = lote[i];
    if (item.status === 'enviado') continue;
    item.status = 'enviando'; atualizarStatusFila(item.id,'enviando');
    log(`Enviando para <span style="color:var(--text)">${escHtml(item.nome)}</span>...`);
    try {
      const waNum  = item.whatsapp.replace(/\D/g,'');
      const numero = waNum.startsWith('55') ? waNum : '55' + waNum;

      // MSG 1 — Apresentação
      const payload1 = { number: numero, options: { delay: 1000 }, textMessage: { text: item.mensagem } };
      const res1 = await fetch(`${chip.url}/message/sendText/${chip.instance}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload1) });
      const data1 = await res1.json().catch(() => ({}));
      if (!res1.ok) throw new Error((data1 && (data1.message || data1.error)) || `HTTP ${res1.status}`);
      log(`  ① apresentação enviada`);

      // Persistir o envio inicial no histórico de conversas somente após sucesso na Evolution.
      debugDispatchPersistV413('persist-function-check', { file: 'legacy-batch-send.js', available: typeof persistOutgoingWhatsappMessageV412 === 'function' });
      if (typeof persistOutgoingWhatsappMessageV412 === 'function') {
        const persistence = await persistOutgoingWhatsappMessageV412({
          id: typeof getEvolutionWhatsappExternalIdV412 === 'function'
            ? getEvolutionWhatsappExternalIdV412(data1, item.id)
            : '',
          leadId: item.leadId || item.id || '',
          instance: chip.instance,
          phone: numero,
          text: item.mensagem || '',
          occurredAt: new Date().toISOString(),
          response: data1
        }, { queueOnFailure: true });
        if (persistence?.ok) log(`  ↳ conversa salva no banco`);
        else log(`  ↳ <span style="color:var(--warning)">conversa pendente de sincronização</span>`);
      }
      await new Promise(r => setTimeout(r, MSG_DELAY));

      // MSG 2 — Imagem redesign (item ou padrão do lote)
      const loteNumSend = loteAtual;
      const imgRedesign = item.imagem2Base64 || getLoteImagem(disparoChipId, loteNumSend);
      if (imgRedesign) {
        await new Promise(r => setTimeout(r, MSG_DELAY));
        const b2 = imgRedesign.split(',')[1], m2 = imgRedesign.split(';')[0].split(':')[1] || 'image/jpeg';
        const payload3 = { number: numero, options: { delay: 1000 }, mediaMessage: { mediatype: 'image', media: b2, mimetype: m2, caption: '' } };
        await fetch(`${chip.url}/message/sendMedia/${chip.instance}`, { method:'POST', headers:{'Content-Type':'application/json','apikey':chip.key}, body: JSON.stringify(payload3) });
        log(`  ② imagem (redesign) enviada`);
      } else {
        log(`  ② <span style="color:var(--warning)">sem imagem (configure no cabeçalho do lote)</span>`);
      }

      item.status='enviado'; atualizarStatusFila(item.id,'enviado');
      log(`<span style="color:var(--accent)">✓ ${escHtml(item.nome)}</span>`);
      atualizarStatusEmpresa(item.id,'Enviada');
    } catch(e) {
      item.status='erro'; atualizarStatusFila(item.id,'erro');
      log(`<span style="color:var(--error)">✗ Erro — ${e.message}</span>`);
    }
    if (i < lote.length-1) {
      const delay = (delayMin + Math.random()*(delayMax-delayMin))*1000;
      log(`Aguardando ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const env = lote.filter(f=>f.status==='enviado').length, erros = lote.filter(f=>f.status==='erro').length;
  log(`<span style="color:var(--accent)">✓ Lote ${loteAtual} concluído! ${env} enviado${env>1?'s':''} · ${erros} erro${erros>1?'s':''}</span>`);
  disparoEmAndamento = false;
  document.getElementById('disparoSpinner').style.display = 'none';
  renderFilaZap(); renderInicio();

  if (filaLotes.length > 0) {
    const esperaMs = loteConf.esperaMin*60*1000; loteEsperaFim = Date.now()+esperaMs; aguardandoLote = true;
    document.getElementById('btnDisparar').disabled = true;
    document.getElementById('disparoBtn').textContent = `🟡 Aguardando lote ${loteAtual+1}/${lotesTotal}`;
    const panel = document.getElementById('loteEsperaPanel'); panel.style.display='block';
    document.getElementById('loteEsperaTitle').textContent = `⏱ Aguardando lote ${loteAtual+1}/${lotesTotal}...`;
    document.getElementById('btnProximoLote').disabled=true; document.getElementById('btnProximoLote').style.background='var(--surface3)';
    document.getElementById('loteProgressBar').style.width='0%';
    notify(`✓ Lote ${loteAtual} concluído · próximo em ${loteConf.esperaMin}min`);
    iniciarCountdownLote(esperaMs);
  } else {
    aguardandoLote=false; document.getElementById('btnDisparar').disabled=false; document.getElementById('disparoBtn').textContent='🟢 Disparar fila';
    const filaAtual = getFilaChip(disparoChipId);
    const totalEnv = filaAtual.filter(f=>f.status==='enviado').length;
    const totalErr = filaAtual.filter(f=>f.status==='erro').length;
    log(`<span style="color:var(--accent)">━━ CONCLUÍDO · ${totalEnv} enviados · ${totalErr} erros ━━</span>`);
    notify(`✓ ${lotesTotal} lote${lotesTotal>1?'s':''} concluído${lotesTotal>1?'s':''} · ${totalEnv} enviados`);
  }
}

async function iniciarDisparo() {
  if (disparoEmAndamento || aguardandoLote) return;
  const chip = getChipById(disparoChipId);
  if (!chip) { notify('// configure um chip primeiro','err'); return; }
  const filaAtual = getFilaChip(disparoChipId);
  if (!filaAtual.length) { notify('// fila vazia','warn'); return; }
  document.getElementById('disparoLog').innerHTML = '';
  const loteConf = getLoteConfig();
  if (loteConf.ativo && filaAtual.length > loteConf.tamanho) {
    filaLotes=[]; loteAtual=0;
    for (let i=0; i<filaAtual.length; i+=loteConf.tamanho) filaLotes.push(filaAtual.slice(i,i+loteConf.tamanho));
    lotesTotal=filaLotes.length;
    await dispararLote();
  } else {
    filaLotes=[]; loteAtual=1; lotesTotal=1; filaLotes.push([...filaAtual]);
    await dispararLote();
  }
}

function atualizarStatusFila(id, status) {
  const el = document.getElementById(`fila-item-${id}`); if (!el) return;
  el.className = `fila-item ${status}`;
  const st = el.querySelector('.fila-item-status'); if (!st) return;
  const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
  st.className=`fila-item-status ${status}`; st.textContent=labels[status]||status;
}
function atualizarStatusEmpresa(id, novoStatus) {
  const data = ensureWeekData();
  Object.keys(data.days).forEach(day => {
    const idx = data.days[day].findIndex(e => e.id===id);
    if (idx>=0) { data.days[day][idx].status=novoStatus; data.days[day][idx].enviadoEm=todayStr(); }
  });
  saveWeekData(data); updateBadges();
}

