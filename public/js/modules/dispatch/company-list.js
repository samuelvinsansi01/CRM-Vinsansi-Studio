/* ════════════════════════════
   RENDER DISPARO EMPRESAS
   Popula disparoStatusTabs + disparoEmpresasList
════════════════════════════ */
function renderDisparoEmpresas() {
  const data     = ensureWeekData();
  const chips    = getChips();
  const weekDays = currentWeekDays();
  if (!weekDays.includes(disparoDay)) disparoDay = todayStr();

  const emps = data.days[disparoDay] || [];

  // ── Status tabs ──
  const statusTabsEl = document.getElementById('disparoStatusTabs');
  if (statusTabsEl) {
    const counts = {};
    STATUS_OPTIONS.forEach(s => { counts[s] = emps.filter(e => (e.status||'Não enviada')===s).length; });
    statusTabsEl.innerHTML = STATUS_OPTIONS.map(s =>
      `<div class="status-tab${disparoStatus===s?' active':''}" onclick="setDisparoStatus('${s}')">
        ${s} <span class="st-count">${counts[s]}</span>
      </div>`
    ).join('');
  }

  // ── Stats row ──
  const statsEl = document.getElementById('disparoStats');
  if (statsEl) {
    const total   = emps.length;
    const comWa   = emps.filter(e => e.whatsapp).length;
    const emFila  = emps.filter(e => (e.status||'Não enviada')==='Em fila').length;
    const enviado = emps.filter(e => (e.status||'Não enviada')==='Enviada').length;
    statsEl.innerHTML = total
      ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${total} leads · <span style="color:var(--ok)">${comWa} com WhatsApp</span> · <span style="color:var(--accent)">${emFila} na fila</span> · <span style="color:var(--text2)">${enviado} enviados</span></span>`
      : '';
  }

  // ── Lista de empresas ──
  const listEl = document.getElementById('disparoEmpresasList');
  if (!listEl) return;

  const filtered = emps.filter(e => (e.status||'Não enviada') === disparoStatus);
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / DISPARO_PG));
  if (disparoPage > totalPages) disparoPage = totalPages;
  const pageItems = filtered.slice((disparoPage-1)*DISPARO_PG, disparoPage*DISPARO_PG);

  if (!totalItems) {
    listEl.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:32px">// nenhuma empresa com status "${disparoStatus}" neste dia</div>`;
    renderPagination('disparoPagination', 1, 1, 0, DISPARO_PG, 'goDisparoPage', 'changeDisparoPgSize');
    return;
  }

  listEl.innerHTML = pageItems.map(e => {
    const googleUrl = e.googleUrl || '';
    const nomeDisplay = googleUrl
      ? `<a href="${escHtml(googleUrl)}" target="_blank" style="color:var(--text);text-decoration:none">${escHtml(e.nome)}</a>`
      : escHtml(e.nome);

    // Verificar em qual chip está na fila — cruza fila do chip com status real do lead
    const empStatus = e.status || 'Não enviada';
    const emFilaReal = empStatus === 'Em fila';
    const naFila = chips.map((c, slot) => {
      const fila = getFilaChip(c.id);
      const idx  = fila.findIndex(f => f.id === e.id);
      // Se está na fila do chip mas o status do lead não é "Em fila", remove a entrada fantasma
      if (idx >= 0 && !emFilaReal) {
        fila.splice(idx, 1);
        saveFilaDisparo();
        return { slot, nome: c.nome, naFila: false };
      }
      return { slot, nome: c.nome, naFila: idx >= 0 };
    });

    const botoes = chips.map((c, slot) => {
      const { naFila: emFila } = naFila[slot];
      const cor    = slot === 0 ? 'var(--accent)' : '#5bb8f5';
      const corBg  = slot === 0 ? 'rgba(184,240,89,0.08)' : 'rgba(91,184,245,0.08)';
      const qtdNoDia = getFilaChipNoDia(c.id, disparoDay).length;
      const cheio  = !emFila && qtdNoDia >= CHIP_LIMIT;
      const label  = emFila ? `✓ C${slot+1}` : cheio ? `✕ C${slot+1}` : `+ C${slot+1}`;
      const title  = emFila
        ? `Remover do Chip ${slot+1} — ${escHtml(c.nome)}`
        : cheio
          ? `Chip ${slot+1} cheio (${CHIP_LIMIT}/${CHIP_LIMIT}) · clique para redirecionar ao próximo disponível`
          : `Adicionar ao Chip ${slot+1} — ${escHtml(c.nome)} (${qtdNoDia}/${CHIP_LIMIT})`;
      return `<button onclick="toggleFilaSlotEmpresa(${slot},'${e.id}')"
        style="font-family:'DM Mono',monospace;font-size:8px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid ${emFila?cor:cheio?'rgba(255,92,92,0.4)':'var(--border2)'};background:${emFila?corBg:cheio?'rgba(255,92,92,0.06)':'transparent'};color:${emFila?cor:cheio?'var(--error)':'var(--muted)'};transition:all 0.15s;white-space:nowrap"
        title="${title}">
        ${label}
      </button>`;
    }).join('');

    const semChip = chips.length === 0;
    const isEnviada = STATUS_FORWARD_ONLY.includes(e.status||'') || (e.status||'') === 'Enviada';

    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nomeDisplay}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          ${e.whatsapp?`<span style="color:var(--ok)">📱 ${escHtml(e.whatsapp)}</span>`:'<span style="color:var(--error)">sem WhatsApp</span>'}
          ${e.site?`<a href="${escHtml(e.site)}" target="_blank" style="color:var(--muted);text-decoration:none">${escHtml(e.site.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])}</a>`:''}
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">
        <button class="lead-drawer-open-btn" onclick="openLeadDrawer('${e.id}')">Ficha</button>
        ${isEnviada
          ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--ok)">✓ enviado</span>`
          : semChip
            ? `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">configure chips primeiro</span>`
            : (e.whatsapp ? botoes : `<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--error)">sem WhatsApp</span>`)
        }
        <button onclick="moverParaBacklogZapDoDia('${e.id}','${disparoDay}')" title="Mover para Backlog Zap"
          style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:8px;padding:3px 8px;cursor:pointer;transition:all 0.15s;margin-left:2px"
          onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
          onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--muted)'">↩</button>
        <button onclick="abrirModalExcluirLead('${e.id}','${disparoDay}')"
          title="Excluir lead da plataforma"
          style="background:none;border:1px solid transparent;color:var(--muted);border-radius:6px;font-family:'DM Mono',monospace;font-size:10px;padding:3px 7px;cursor:pointer;transition:all 0.18s;margin-left:2px"
          onmouseover="this.style.borderColor='var(--error)';this.style.color='var(--error)';this.style.background='rgba(255,92,92,0.06)'"
          onmouseout="this.style.borderColor='transparent';this.style.color='var(--muted)';this.style.background='none'">✕</button>
      </div>
    </div>`;
  }).join('');

  renderPagination('disparoPagination', disparoPage, totalPages, totalItems, DISPARO_PG, 'goDisparoPage', 'changeDisparoPgSize');
}

function setDisparoChip(id) {
  disparoChipId = id;
  renderFilaZap();
}

/* ─── Accordion dos Chips (layout 50/50) ─── */
function toggleChipAccordion(slot) {
  const chips = getChips();
  // Fecha todos os outros accordions
  chips.forEach((_, s) => {
    if (s !== slot) {
      const acc = document.getElementById('chipAccordion' + s);
      if (acc) acc.classList.remove('open');
    }
  });
  // Toggle o clicado
  const accSel = document.getElementById('chipAccordion' + slot);
  if (accSel) accSel.classList.toggle('open');
}

function setDisparoDay(day) { disparoDay = day; disparoStatus = 'Não enviada'; disparoPage = 1; renderFilaZap(); }
function setDisparoStatus(st) { disparoStatus = st; disparoPage = 1; renderDisparoEmpresas(); }

function renderFila0() { renderFilaSlot(0, disparoDay); }
function renderFila1() { renderFilaSlot(1, disparoDay); }

function renderFilaSlot(slot, filterDay) {
  const today = todayStr();
  const dayFiltro = filterDay || disparoDay || today;
  const isToday = dayFiltro === today;
  const chips = getChips();
  const chip = chips[slot] || null;
  const chipId = chip ? chip.id : null;
  const st = chipSlotState[slot];

  // Filtrar fila pelo dia selecionado: cruzar IDs da fila com empresas do dia
  const filaGlobal = chipId ? getFilaChip(chipId) : [];
  const data = ensureWeekData();
  const idsNoDia = new Set((data.days[dayFiltro]||[]).map(e => e.id));
  const filaCompleta = filaGlobal.filter(f => idsNoDia.has(f.id));

  const countEl = document.getElementById(`filaCount${slot}`);
  const vaziEl  = document.getElementById(`filaVazia${slot}`);
  const itensEl = document.getElementById(`filaItens${slot}`);
  if (!countEl) return;

  // Botao Disparar: desativado se o dia selecionado nao for hoje
  const btnDisparar = document.getElementById(`btnDisparar${slot}`);
  const btnTxt = document.getElementById(`disparoBtn${slot}`);
  if (btnDisparar && !st.disparoEmAndamento && !st.aguardandoLote) {
    if (!isToday) {
      btnDisparar.disabled = true;
      btnDisparar.title = 'Disparo disponivel apenas no dia de hoje';
      if (btnTxt) btnTxt.textContent = slot === 0 ? '🟢 Disponivel em ' + dayLabelShort(dayFiltro) : '🔵 Disponivel em ' + dayLabelShort(dayFiltro);
    } else {
      btnDisparar.disabled = false;
      btnDisparar.title = '';
      if (btnTxt) btnTxt.textContent = slot === 0 ? '🟢 Disparar' : '🔵 Disparar';
    }
  }

  // Contagem: aguardando/erro ativos (do dia filtrado)
  const aguardando = filaCompleta.filter(f => f.status === 'aguardando').length;
  const erros = filaCompleta.filter(f => f.status === 'erro').length;
  const enviados = filaCompleta.filter(f => f.status === 'enviado').length;
  const totalNoDia = filaCompleta.length;
  const cheio = totalNoDia >= CHIP_LIMIT;
  countEl.textContent = `(${totalNoDia}/${CHIP_LIMIT} · ${aguardando} aguardando · ${erros} erro · ${enviados} enviado${enviados!==1?'s':''})`;
  countEl.style.color = cheio ? 'var(--error)' : totalNoDia >= CHIP_LIMIT * 0.8 ? 'var(--warning)' : '';
  const vazia = filaCompleta.length === 0 && (!st.loteHistorico || !st.loteHistorico.length);
  vaziEl.style.display  = vazia ? 'block' : 'none';
  itensEl.style.display = vazia ? 'none'  : 'flex';
  if (vazia) { itensEl.innerHTML = ''; return; }

  const LOTE_SIZE = getLoteSize();
  let html = '';

  // ── Histórico de lotes já disparados ──
  (st.loteHistorico || []).forEach(lhist => {
    const todosEnviados = lhist.items.every(i => i.status === 'enviado');
    const cor    = todosEnviados ? 'var(--ok)' : 'var(--warning)';
    const border = todosEnviados ? 'rgba(78,203,113,0.25)' : 'rgba(240,164,41,0.25)';
    const bg     = todosEnviados ? 'rgba(78,203,113,0.04)' : 'rgba(240,164,41,0.04)';
    const label  = `LOTE ${lhist.num} — ${lhist.env}/${lhist.items.length} enviados`;
    const histId = `lote-hist-${slot}-${lhist.num}`;
    html += `<div style="margin-bottom:6px;border-radius:8px;background:${bg};border:1px solid ${border};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer" onclick="toggleLoteHist('${histId}')">
        <span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;color:${cor}">${label}</span>
        <span style="flex:1;height:1px;background:${border}"></span>
        <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${todosEnviados?'✓ concluído':'parcial'}</span>
        <span id="${histId}-chev" style="font-size:9px;color:var(--muted);transition:transform 0.2s">▶</span>
      </div>
      <div id="${histId}" style="display:none;border-top:1px solid ${border}">
        ${lhist.items.map(item => {
          const ok = item.status === 'enviado';
          return `<div style="display:flex;align-items:center;gap:10px;padding:5px 12px;border-bottom:1px solid ${border};font-size:10px">
            <span style="font-family:'DM Mono',monospace;font-size:9px;color:${ok?'var(--ok)':'var(--error)'};flex-shrink:0">${ok?'✓':'✗'}</span>
            <span style="flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.nome)}</span>
            <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted)">${item.whatsapp||''}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  // ── Itens ativos ──
  // Usamos filaCompleta para agrupar lotes corretamente (enviados ocupam posição no lote)
  // e renderizamos todos — enviados aparecem com badge verde e sem interação de edição
  const loteHistLen = (st.loteHistorico||[]).length;
  const imgSrcsToSet = []; // { id, src } para setar após innerHTML

  // Agrupar filaCompleta em lotes de LOTE_SIZE
  const lotes = [];
  for (let i = 0; i < filaCompleta.length; i += LOTE_SIZE) {
    lotes.push(filaCompleta.slice(i, i + LOTE_SIZE));
  }

  lotes.forEach((loteItems, loteIdx) => {
    const loteNum = loteHistLen + loteIdx + 1;
    const pendentesNoLote = loteItems.filter(f => f.status !== 'enviado').length;
    const totalNoLote = loteItems.length;
    const todosEnviados = loteItems.every(f => f.status === 'enviado');
    // Lote é "completo" se tem LOTE_SIZE itens OU se não é o último (lotes intermediários sempre são completos)
    const isUltimoLote = loteIdx === lotes.length - 1;
    const completo = totalNoLote >= LOTE_SIZE || !isUltimoLote;
    const cor = todosEnviados ? 'var(--ok)' : completo ? 'var(--accent)' : 'var(--warning)';
    const borderCor = todosEnviados ? 'rgba(78,203,113,0.25)' : completo ? 'rgba(184,240,89,0.25)' : 'rgba(240,164,41,0.25)';
    const bgCor = todosEnviados ? 'rgba(78,203,113,0.04)' : completo ? 'rgba(184,240,89,0.05)' : 'rgba(240,164,41,0.05)';

    let label;
    if (todosEnviados) {
      label = `LOTE ${loteNum} — todos enviados`;
    } else if (completo) {
      label = `LOTE ${loteNum} — #${loteIdx*LOTE_SIZE+1}–${loteIdx*LOTE_SIZE+totalNoLote}`;
    } else {
      label = `LOTE ${loteNum} — #${loteIdx*LOTE_SIZE+1}–${loteIdx*LOTE_SIZE+totalNoLote} (${pendentesNoLote} aguardando)`;
    }

    const loteRamoId = getLoteRamo(chipId, loteNum);
    const loteImg    = getLoteImagem(chipId, loteNum); // do cache em memória
    const imgIdbKey  = getLoteImgKey(chipId, loteNum);
    const ramosOpts  = getRamos().map(r=>`<option value="${r.id}"${loteRamoId===r.id?' selected':''} style="background:var(--surface3)">${escHtml(r.nome)}</option>`).join('');
    const imgPreviewId = `lote-img-preview-${slot}-${loteNum}`;
    if (loteImg) imgSrcsToSet.push({ id: imgPreviewId, src: loteImg });

    html += `<div style="margin:${loteIdx===0&&!loteHistLen?'0':'10px'} 0 6px;border-radius:8px;background:${bgCor};border:1px solid ${borderCor};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:7px 12px">
        <span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.12em;color:${cor}">${label}</span>
        <span style="flex:1;height:1px;background:${borderCor}"></span>
        ${todosEnviados?'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--ok)">✓ concluído</span>':!completo?`<span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--warning)">${LOTE_SIZE-totalNoLote} restantes</span>`:'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--accent)">✓ completo</span>'}
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;padding:0 12px 10px;border-top:1px solid ${borderCor}">
        <div style="flex:1">
          <div style="font-family:'DM Mono',monospace;font-size:7px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px;padding-top:8px">RAMO DO TEMPLATE</div>
          <select style="background:var(--surface3);border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-family:'DM Mono',monospace;font-size:9px;padding:5px 8px;width:100%;outline:none" onchange="onLoteRamoChange('${chipId}',${loteNum},this.value,true,${slot})">
            <option value="" style="background:var(--surface3)">— sem ramo (geral) —</option>
            ${ramosOpts}
          </select>
        </div>
        <div style="flex-shrink:0;min-width:130px">
          <div style="font-family:'DM Mono',monospace;font-size:7px;letter-spacing:0.1em;color:var(--accent);margin-bottom:4px;padding-top:8px">IMAGEM DO LOTE</div>
          <div class="fila-img-area${loteImg?' has-img':''}" onclick="document.getElementById('lote-img-s${slot}-${loteNum}').click()">
            ${loteImg
              ? `<img id="${imgPreviewId}" data-lote-img-key="${imgIdbKey}" alt="preview" style="max-width:100%;max-height:100px;object-fit:contain;border-radius:5px;display:block"/>
                 <div class="fila-img-ok" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--ok);font-weight:700;margin-top:4px">✓ imagem inserida</div>
                 <button class="fila-remove-btn" onclick="event.stopPropagation();onLoteImgRemove('${chipId}',${loteNum},true,${slot})">×</button>`
              : `<img id="${imgPreviewId}" data-lote-img-key="${imgIdbKey}" alt="" style="display:none;max-width:100%;max-height:100px;object-fit:contain;border-radius:5px"/>
                 <div class="fila-img-ok" style="display:none;font-family:'DM Mono',monospace;font-size:9px;color:var(--ok);font-weight:700;margin-top:4px">✓ imagem inserida</div>
                 <button class="fila-remove-btn" style="display:none" onclick="event.stopPropagation();onLoteImgRemove('${chipId}',${loteNum},true,${slot})">×</button>
                 <span class="fila-img-label">📎 clique para inserir</span>`
            }
          </div>
          <input type="file" accept="image/*" class="fila-img-input" id="lote-img-s${slot}-${loteNum}" onchange="onLoteImgChange('${chipId}',${loteNum},this,true,${slot})"/>
        </div>
      </div>
    </div>`;

    // Renderizar itens do lote
    loteItems.forEach((item, itemIdx) => {
      const waNum = item.whatsapp.replace(/\D/g,'');
      const labels = { aguardando:'aguardando', enviando:'enviando...', enviado:'✓ enviado', erro:'✗ erro' };
      const aberto = item.aberto || false;
      const isEnviado = item.status === 'enviado';
      const isErro = item.status === 'erro';
      const posGlobal = loteIdx * LOTE_SIZE + itemIdx + 1;

      if (isEnviado) {
        // Enviados: linha compacta, sem edição, sem botão remover
        html += `<div class="fila-item enviado" id="fila-item-${slot}-${item.id}" style="opacity:0.55">
          <div class="fila-item-header" style="cursor:default">
            <div class="fila-item-num" style="color:var(--muted)">${posGlobal}</div>
            <div class="fila-item-nome" style="color:var(--muted)">${escHtml(item.nome)}</div>
            <div class="fila-item-wa" style="color:var(--muted)">+${waNum}</div>
            <div class="fila-item-status enviado">✓ enviado</div>
            <button class="lead-drawer-open-btn" onclick="event.stopPropagation();openLeadDrawer('${item.id}')">Ficha</button>
          </div>
        </div>`;
      } else {
        html += `<div class="fila-item ${item.status}" id="fila-item-${slot}-${item.id}">
          <div class="fila-item-header" onclick="toggleFilaItemSlot(${slot},'${item.id}')" style="cursor:pointer;user-select:none">
            <div class="fila-item-num">${posGlobal}</div>
            <div class="fila-item-nome">${item.site ? `<a href="${escHtml(item.site)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="${escHtml(item.site)}" onclick="event.stopPropagation()">${escHtml(item.nome)}</a>` : escHtml(item.nome)}</div>
            <div class="fila-item-wa">+${waNum}</div>
            <div class="fila-item-status ${item.status}">${labels[item.status]||item.status}</div>
            <button class="lead-drawer-open-btn" onclick="event.stopPropagation();openLeadDrawer('${item.id}')">Ficha</button>
            <div style="color:var(--muted);font-size:12px;margin-left:4px;transition:transform 0.2s;transform:rotate(${aberto?'90':'0'}deg)">▶</div>
            ${!isErro?`<button class="fila-remove-btn" style="position:static;top:auto;right:auto;width:22px;height:22px" onclick="event.stopPropagation();removerFilaSlot(${slot},'${item.id}')">×</button>`:''}
          </div>
          <div class="fila-item-body" style="display:${aberto?'flex':'none'}">
            <div style="width:100%">
              <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-bottom:4px">① APRESENTAÇÃO</div>
              <textarea class="fila-msg-area" id="fila-msg-${slot}-${item.id}" style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text2);line-height:1.7;min-height:80px;border:1px solid var(--border2);resize:vertical;width:100%;outline:none" oninput="atualizarMsgFilaSlot(${slot},'${item.id}',this.value)">${escHtml(item.mensagem||'')}</textarea>
              <button class="fila-msg-shuffle" onclick="shuffleFilaMsgSlot(${slot},'${item.id}')">↻ sortear</button>
            </div>
          </div>
        </div>`;
      }
    });
  });

  itensEl.innerHTML = html;

  // Setar src das imagens que ja estao no cache em memoria
  imgSrcsToSet.forEach(({ id, src }) => {
    const el = document.getElementById(id);
    if (el) el.src = src;
  });

  // Para lotes cujo cache ainda nao tem nada, busca do IDB de forma assincrona
  lotes.forEach((loteItems, loteIdx) => {
    const loteNum2 = loteHistLen + loteIdx + 1;
    const k = getLoteImgKey(chipId, loteNum2);
    if (_imgCache[k] !== undefined) return; // ja carregado (null ou base64)
    _imgCache[k] = null; // marca como "carregando" para nao buscar de novo
    idbGet(k).then(val => {
      if (!val) return;
      _imgCache[k] = val;
      const imgEl = document.getElementById(`lote-img-preview-${slot}-${loteNum2}`);
      if (!imgEl) return;
      imgEl.src = val;
      imgEl.style.display = 'block';
      const wrapper = imgEl.closest('.fila-img-area');
      if (wrapper) {
        wrapper.classList.add('has-img');
        const label = wrapper.querySelector('.fila-img-label');
        if (label) label.style.display = 'none';
        const ok = wrapper.querySelector('.fila-img-ok');
        if (ok) ok.style.display = 'flex';
        const rmBtn = wrapper.querySelector('.fila-remove-btn');
        if (rmBtn) rmBtn.style.display = 'flex';
      }
    }).catch(() => {});
  });
}

function toggleLoteHist(id) {
  const el = document.getElementById(id);
  const chev = document.getElementById(id + '-chev');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
}



