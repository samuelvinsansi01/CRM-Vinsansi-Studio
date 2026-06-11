/* ════════════════════════════
   RITMO E BLOCOS V31
════════════════════════════ */
function getChipBlockUsageV31(chipId) {
  const usage = getChipUsageV29 ? getChipUsageV29() : { day: todayUsageKeyV29(), chips:{} };
  usage.blocks = usage.blocks || {};
  usage.blocks[chipId] = usage.blocks[chipId] || {};
  return usage.blocks[chipId];
}

function setChipBlockUsageV31(chipId, block, count) {
  const usage = getChipUsageV29 ? getChipUsageV29() : { day: todayUsageKeyV29(), chips:{} };
  usage.blocks = usage.blocks || {};
  usage.blocks[chipId] = usage.blocks[chipId] || {};
  usage.blocks[chipId][block] = Number(count || 0);
  saveChipUsageV29(usage);
}

function getCurrentDispatchBlockV31(chip) {
  const blocks = chip?.blocks?.length ? chip.blocks : WHATSAPP_CHIP_BLOCKS_V426;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let selected = blocks[0];

  blocks.forEach(block => {
    const [h, m] = String(block).split(':').map(Number);
    const blockMinutes = (h || 0) * 60 + (m || 0);
    if (currentMinutes >= blockMinutes) selected = block;
  });

  return selected;
}

function canSendByChipRulesV31(chip) {
  if (!chip) return { ok:false, reason:'chip ausente' };
  if (chip.paused || chip.status === 'disabled') return { ok:false, reason:'chip pausado/desativado' };

  const dailyLimit = Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426);
  const blockSize = Number(chip.blockSize || WHATSAPP_CHIP_BLOCK_SIZE_V426);
  const usedToday = getChipUsedToday(chip.id);

  if (usedToday >= dailyLimit) {
    return { ok:false, reason:'limite diário atingido' };
  }

  const block = getCurrentDispatchBlockV31(chip);
  const blockUsage = getChipBlockUsageV31(chip.id);
  const usedInBlock = Number(blockUsage[block] || 0);

  if (usedInBlock >= blockSize) {
    return { ok:false, reason:`bloco ${block} cheio` };
  }

  return { ok:true, block, usedToday, usedInBlock };
}

function registerChipSendV31(chip) {
  const block = getCurrentDispatchBlockV31(chip);
  setChipUsedToday(chip.id, getChipUsedToday(chip.id) + 1);

  const blockUsage = getChipBlockUsageV31(chip.id);
  setChipBlockUsageV31(chip.id, block, Number(blockUsage[block] || 0) + 1);

  return block;
}

function getDispatchScheduleSummaryV31() {
  const chips = getWhatsappChipsV29 ? getWhatsappChipsV29() : [];
  const active = chips.filter(c => c.status !== 'disabled' && !c.paused);
  const totalDaily = active.reduce((sum, chip) => sum + Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426), 0);
  const remaining = active.reduce((sum, chip) => sum + Math.max(0, Number(chip.dailyLimit || WHATSAPP_CHIP_DAILY_LIMIT_V426) - getChipUsedToday(chip.id)), 0);
  const currentBlock = active[0] ? getCurrentDispatchBlockV31(active[0]) : '--:--';

  return {
    chips: active.length,
    totalDaily,
    remaining,
    currentBlock
  };
}

function renderDispatchScheduleV31() {
  const summary = getDispatchScheduleSummaryV31();

  return `
    <div class="dispatch-v31-schedule">
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Chips ativos</div>
        <div class="dispatch-v31-slot-value">${summary.chips}</div>
      </div>
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Capacidade/dia</div>
        <div class="dispatch-v31-slot-value">${summary.totalDaily}</div>
      </div>
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Restante hoje</div>
        <div class="dispatch-v31-slot-value">${summary.remaining}</div>
      </div>
      <div class="dispatch-v31-slot">
        <div class="dispatch-v31-slot-title">Bloco atual</div>
        <div class="dispatch-v31-slot-value">${summary.currentBlock}</div>
      </div>
    </div>
    <div class="dispatch-v31-warning">
      Regra ativa: 180 mensagens por chip · 6 blocos de 30 · 120 segundos entre envios · espera 1h entre blocos.
    </div>
  `;
}


