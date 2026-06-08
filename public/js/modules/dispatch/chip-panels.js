/* ════════════════════════════
   RENDER CHIP ACCORDIONS — dinâmico, baseado nos chips cadastrados
════════════════════════════ */
const CHIP_COLORS = [
  { cor: 'var(--accent)',  corHex: '#b8f059', borderAlpha: 'rgba(184,240,89,0.25)',  bgBtn: '',                   txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
  { cor: '#5bb8f5',        corHex: '#5bb8f5', borderAlpha: 'rgba(91,184,245,0.25)',  bgBtn: '#5bb8f5',            txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
  { cor: '#c084fc',        corHex: '#c084fc', borderAlpha: 'rgba(192,132,252,0.25)', bgBtn: '#c084fc',            txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
  { cor: '#fb923c',        corHex: '#fb923c', borderAlpha: 'rgba(251,146,60,0.25)',  bgBtn: '#fb923c',            txtBtn: '#0a0a0d', spinColor: '#0a0a0d' },
];

function renderChipAccordions() {
  const chips = getChips();
  const zapRight = document.getElementById('zapRight');
  if (!zapRight) return;

  // Garante que chipSlotState tem entradas suficientes
  while (chipSlotState.length < chips.length) {
    chipSlotState.push({ filaLotes:[], loteAtual:0, lotesTotal:0, aguardandoLote:false, disparoEmAndamento:false, loteEsperaFim:null, loteEsperaTimer:null, loteCountdownInt:null, loteHistorico:[], retryItems:[], retryDisparado:false, ultimoLoteFimTs:null, pausado:false });
  }

  if (!chips.length) {
    zapRight.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);padding:40px">// nenhum chip configurado</div>`;
    return;
  }

  // Salvar estado visual antes de reconstruir
  const _estadoAntes = chips.map((_, slot) => {
    const st = chipSlotState[slot];
    return {
      disparoEmAndamento: st ? st.disparoEmAndamento : false,
      aguardandoLote: st ? st.aguardandoLote : false,
      loteAtual: st ? st.loteAtual : 0,
      lotesTotal: st ? st.lotesTotal : 0,
      pausado: st ? st.pausado : false,
      accordionAberto: document.getElementById(`chipAccordion${slot}`)?.classList.contains('open') || false,
    };
  });

  zapRight.innerHTML = chips.map((chip, slot) => {
    const c = CHIP_COLORS[slot % CHIP_COLORS.length];
    const disparoIcon = slot === 0 ? '🟢' : slot === 1 ? '🔵' : '🟣';
    const bgBtnStyle  = c.bgBtn ? `background:${c.bgBtn};color:${c.txtBtn}` : '';
    const spinStyle   = `border-top-color:${c.spinColor}`;
    return `
    ${slot > 0 ? '<div style="height:1px;background:var(--border);flex-shrink:0;"></div>' : ''}
    <div class="chip-accordion" id="chipAccordion${slot}" data-slot="${slot}">
      <div class="chip-accordion-header" onclick="toggleChipAccordion(${slot})" style="border-color:${c.borderAlpha}">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:${c.cor}">CHIP ${slot+1}</span>
          <span id="chip${slot+1}Label" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400;">· ${escHtml(chip.nome)}</span>
          <span id="filaCount${slot}" style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-left:auto;white-space:nowrap">(0 empresas)</span>
        </div>
        <div class="chip-accordion-chevron" id="chevron${slot}">▶</div>
      </div>
      <div class="chip-accordion-body" id="chipBody${slot}">
        <div style="padding:16px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="margin-bottom:12px">
            <label>Chip</label>
            <div id="chip${slot+1}Info" style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text2);padding:8px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border2)">${escHtml(chip.nome)} · ${escHtml(chip.instance)}</div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:0">
            <button class="btn btn-danger" style="font-size:11px" onclick="limparFilaChip(${slot})">Limpar fila</button>
            <button class="btn btn-ghost" id="btnPausa${slot}" onclick="togglePausaChip(${slot})" style="display:none;font-size:11px;border-color:var(--warning);color:var(--warning)">⏸ Pausar</button>
            <button class="btn btn-primary" style="flex:1;${bgBtnStyle}" id="btnDisparar${slot}" onclick="iniciarDisparoChip(${slot})">
              <div class="spinner" id="spinner${slot}" style="${spinStyle}"></div>
              <span id="disparoBtn${slot}">${disparoIcon} Disparar</span>
            </button>
          </div>
          <div class="lote-espera-panel" id="loteEsperaPanel${slot}" style="display:none;margin-top:10px">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="flex:1">
                <div style="font-family:'DM Mono',monospace;font-size:10px;color:${c.cor};margin-bottom:4px" id="loteEsperaTitle${slot}">⏱ Aguardando lote...</div>
                <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">Próximo lote em <span id="loteCountdown${slot}" style="color:var(--text2)">--:--</span></div>
              </div>
              <button class="btn btn-ghost" style="font-size:10px;border-color:var(--warning);color:var(--warning)" onclick="cancelarLotesChip(${slot})">✕</button>
              <button class="btn btn-primary" style="width:auto;font-size:11px;${bgBtnStyle}" id="btnProximoLote${slot}" onclick="confirmarProximoLoteChip(${slot})" disabled>Próximo →</button>
            </div>
            <div style="margin-top:8px;background:var(--surface2);border-radius:6px;height:3px;overflow:hidden">
              <div id="loteProgressBar${slot}" style="height:100%;background:${c.cor};width:0%;transition:width 0.5s linear"></div>
            </div>
          </div>
        </div>
        <div style="padding:12px 16px 6px;flex-shrink:0">
          <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.12em;color:${c.cor};text-transform:uppercase;margin-bottom:8px">Fila Chip ${slot+1}</div>
          <div id="chip${slot+1}FilaButtons" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"></div>
        </div>
        <div class="chip-fila-scroll" id="chip${slot}FilaScroll">
          <div class="fila-empty" id="filaVazia${slot}">Nenhuma empresa na fila.</div>
          <div class="fila-items" id="filaItens${slot}" style="display:none;padding:0 16px 16px"></div>
        </div>
        <div class="disparo-log" id="disparoLog${slot}"></div>
      </div>
    </div>`;
  }).join('');

  // Restaurar estado visual dos chips que estavam em andamento
  chips.forEach((chip, slot) => {
    const est = _estadoAntes[slot];
    if (!est) return;
    if (est.accordionAberto) {
      const acc = document.getElementById(`chipAccordion${slot}`);
      if (acc) acc.classList.add('open');
    }
    const btnEl  = document.getElementById(`btnDisparar${slot}`);
    const spinEl = document.getElementById(`spinner${slot}`);
    const btnTxt = document.getElementById(`disparoBtn${slot}`);
    const pausaEl = document.getElementById(`btnPausa${slot}`);
    if (est.disparoEmAndamento) {
      if (btnEl)  btnEl.disabled = true;
      if (spinEl) spinEl.style.display = 'block';
      if (btnTxt) btnTxt.textContent = est.pausado
        ? `⏸ Pausado (${est.loteAtual}/${est.lotesTotal})`
        : `⏳ Enviando lote ${est.loteAtual}/${est.lotesTotal}...`;
      if (pausaEl) pausaEl.style.display = 'inline-flex';
    } else if (est.aguardandoLote) {
      if (btnEl)  btnEl.disabled = true;
      if (btnTxt) btnTxt.textContent = `⏱ Aguardando próximo lote...`;
      const panel = document.getElementById(`loteEsperaPanel${slot}`);
      if (panel) panel.style.display = 'block';
    }
  });
}

function renderFilaZap() {
  const devolvidos = devolverZapNaoValidadoParaValidacao();
  if (devolvidos) notify(`↩ ${devolvidos} lead(s) sem WhatsApp validado voltaram para Validação`, 'warn');
  const recovered = recoverSingleChipQueueAssignmentsV431();
  if (recovered) notify(`↻ ${recovered} lead(s) restaurado(s) na fila do chip`);
  sincronizarFilaComEnviados();
  const chips = getChips();
  const weekDays = currentWeekDays();
  const today = todayStr();

  // Só reconstrói os accordions se nenhum disparo estiver em andamento
  // (evita resetar botão/spinner ao trocar de aba durante o envio)
  const disparoAtivo = chipSlotState.some(st => st.disparoEmAndamento || st.aguardandoLote);
  if (!disparoAtivo) {
    renderChipAccordions();
  }

  // Populate chip panels (labels/info já inseridos pelo renderChipAccordions)
  chips.forEach((chip, slot) => {
    const infoEl  = document.getElementById(`chip${slot+1}Info`);
    const labelEl = document.getElementById(`chip${slot+1}Label`);
    if (infoEl)  infoEl.textContent  = `${chip.nome} · ${chip.instance}`;
    if (labelEl) labelEl.textContent = `· ${chip.nome}`;
  });

  // Set disparoChipId for empresa listing (use chip[0] by default)
  if (!disparoChipId && chips.length) disparoChipId = chips[0].id;

  if (!weekDays.includes(disparoDay) && disparoDay !== 'backlog') disparoDay = today;

  const backlogCount = getZapBacklog().length;
  const backlogTab = `<div class="day-tab${disparoDay==='backlog'?' active':''}" onclick="setDisparoDay('backlog')"
    style="${disparoDay==='backlog'?'':''}">
    📦 Backlog
    ${backlogCount>0?`<span class="day-count">${backlogCount}</span>`:''}
  </div>`;

  document.getElementById('disparoDayTabs').innerHTML = backlogTab + weekDays.map(day => {
    const data  = ensureWeekData();
    const count = (data.days[day]||[]).filter(e => e.whatsapp && (e.status||'Não enviada')==='Não enviada').length;
    const active= day === disparoDay;
    return `<div class="day-tab${active?' active':''}" onclick="setDisparoDay('${day}')">
      ${dayLabel(day)}${day===today?' <span style="color:var(--accent);font-size:8px">●</span>':''}
      ${count>0?`<span class="day-count">${count}</span>`:''}
    </div>`;
  }).join('');

  if (disparoDay === 'backlog') {
    renderZapBacklogPanel();
  } else {
    renderDisparoEmpresas();
    chips.forEach((_, s) => renderFilaSlot(s, disparoDay));
    if (!chips.length) { /* nada a renderizar */ }
  }
}

