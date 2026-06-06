/* ════════════════════════════
   HORÁRIO AUTOMÁTICO
════════════════════════════ */
let horarioJaDisparado = false;
let horarioUltimoDisparo = '';

function checkHorarioDisparo(now) {
  const cfg = loadEvoConfig() || {};
  if (!cfg.horarioInicio) return;
  const [hh, mm] = cfg.horarioInicio.split(':').map(Number);
  const nowH = now.getHours(), nowM = now.getMinutes();
  const key = `${todayStr()}_${cfg.horarioInicio}`;
  const slotsProntos = getChips()
    .map((chip, slot) => ({ chip, slot, st: chipSlotState[slot] }))
    .filter(({ chip, st }) =>
      st &&
      !st.disparoEmAndamento &&
      !st.aguardandoLote &&
      getFilaChipNoDia(chip.id, todayStr()).some(item => item.status === 'aguardando')
    );

  if (nowH === hh && nowM === mm && horarioUltimoDisparo !== key && slotsProntos.length) {
    horarioUltimoDisparo = key;
    notify(`⏰ Disparo automático iniciado — ${cfg.horarioInicio}`);
    slotsProntos.forEach(({ slot }) => {
      iniciarDisparoChip(slot).catch(e => notify(`// falha no disparo automático: ${e.message}`, 'err'));
    });
  }
  const el = document.getElementById('horarioStatus');
  if (el) {
    el.textContent = `próximo: ${cfg.horarioInicio}`;
    el.className = 'horario-status' + (chipSlotState.some(st => st.disparoEmAndamento || st.aguardandoLote) ? ' ativo' : '');
  }
  const el2 = document.getElementById('horarioStatusInline');
  if (el2) el2.textContent = cfg.horarioInicio || '--:--';
}

/* ════════════════════════════
   EVO CONFIG
════════════════════════════ */
function loadEvoConfig(){
  const defaults = {
    horarioInicio: '08:00',
    delayMin: 120,
    delayMax: 120,
    loteTamanho: 30,
    loteEsperaMin: 60,
    loteAtivo: 1
  };

  try {
    const supaCfg = (typeof v48StateGetObject === 'function') ? v48StateGetObject(EVO_KEY) : {};
    return { ...defaults, ...(supaCfg && typeof supaCfg === 'object' ? supaCfg : {}) };
  } catch {
    return defaults;
  }
}

function saveEvoConfig() {
  const loteTamanho = Math.min(
    WHATSAPP_CHIP_BLOCK_SIZE_V426 || 30,
    Math.max(1, parseInt(document.getElementById('loteTamanho')?.value || WHATSAPP_CHIP_BLOCK_SIZE_V426 || 30, 10) || 30)
  );
  const cfg = {
    delayMin: document.getElementById('delayMin')?.value,
    delayMax: document.getElementById('delayMax')?.value,
    loteTamanho,
    loteEsperaMin: document.getElementById('loteEsperaMin')?.value,
    horarioInicio: document.getElementById('horarioInicio')?.value,
  };
  const loteInput = document.getElementById('loteTamanho');
  if (loteInput) loteInput.value = String(loteTamanho);
  if (typeof v48StateSet === 'function') v48StateSet(EVO_KEY, cfg, 'evolution-config-save');
  uiSyncLog('optimistic-update', { entity:'evolution-config', action:'save-local-cache' });
  scheduleOperationalSync({ delay:0, reason:'evolution-config-save' });
  if (typeof atualizarStatsDisparo === 'function') atualizarStatsDisparo();
}
function toggleLoteConfig() {
  const fields = document.getElementById('loteConfigFields');
  if (fields) fields.style.display = document.getElementById('loteAtivo').checked ? 'flex' : 'none';
}

