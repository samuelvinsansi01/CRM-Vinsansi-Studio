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
    const raw =
      localStorage.getItem(EVO_KEY) ||
      localStorage.getItem('vs_evo_config') ||
      localStorage.getItem('evo_config') ||
      localStorage.getItem('vs_disparo_config') ||
      localStorage.getItem('disparoConfig') ||
      '{}';

    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...(parsed && typeof parsed === 'object' ? parsed : {})
    };
  } catch {
    return defaults;
  }
}

function saveEvoConfig() {
  const cfg = {
    delayMin: document.getElementById('delayMin')?.value,
    delayMax: document.getElementById('delayMax')?.value,
    loteTamanho: document.getElementById('loteTamanho')?.value,
    loteEsperaMin: document.getElementById('loteEsperaMin')?.value,
    horarioInicio: document.getElementById('horarioInicio')?.value,
  };
  localStorage.setItem(EVO_KEY, JSON.stringify(cfg));
  uiSyncLogV426('optimistic-update', { entity:'evolution-config', action:'save-local-cache' });
  scheduleLegacyOperationalSyncV36({ delay:0, reason:'evolution-config-save' });
  if (typeof atualizarStatsDisparo === 'function') atualizarStatsDisparo();
}
function toggleLoteConfig() {
  const fields = document.getElementById('loteConfigFields');
  if (fields) fields.style.display = document.getElementById('loteAtivo').checked ? 'flex' : 'none';
}

