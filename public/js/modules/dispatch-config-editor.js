(function(){
  'use strict';

  const KEY = (typeof EVO_KEY !== 'undefined' && EVO_KEY) ? EVO_KEY : 'vs_evo_config';
  const DEFAULTS = {
    horarioInicio: '13:00',
    delayMin: 120,
    delayMax: 120,
    loteTamanho: 60,
    loteEsperaMin: 60,
    loteAtivo: 1,
    blocoQuantidade: 2
  };

  function toInt(value, fallback, min){
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min ?? 0, n);
  }

  function readStored(){
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem('vs_evo_config') || localStorage.getItem('evo_config') || localStorage.getItem('vs_disparo_config') || localStorage.getItem('disparoConfig') || '{}';
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch(e){
      return { ...DEFAULTS };
    }
  }

  function normalizeConfig(cfg){
    const interval = toInt(cfg.delayMin ?? cfg.intervaloSegundos, DEFAULTS.delayMin, 30);
    const blockSize = toInt(cfg.loteTamanho ?? cfg.disparosPorBloco, DEFAULTS.loteTamanho, 1);
    const blockCount = toInt(cfg.blocoQuantidade ?? cfg.quantidadeBlocos, DEFAULTS.blocoQuantidade, 1);
    const blockDelay = toInt(cfg.loteEsperaMin ?? cfg.delayEntreBlocosMin, DEFAULTS.loteEsperaMin, 0);
    return {
      horarioInicio: cfg.horarioInicio || DEFAULTS.horarioInicio,
      delayMin: interval,
      delayMax: interval,
      loteTamanho: blockSize,
      loteEsperaMin: blockDelay,
      loteAtivo: 1,
      blocoQuantidade: blockCount
    };
  }

  function setValue(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }

  function getCurrentConfig(){
    const stored = normalizeConfig(readStored());
    const interval = toInt(document.getElementById('dispatchIntervalSec')?.value || document.getElementById('delayMin')?.value, stored.delayMin, 30);
    const blockSize = toInt(document.getElementById('dispatchBlockSize')?.value || document.getElementById('loteTamanho')?.value, stored.loteTamanho, 1);
    const blockCount = toInt(document.getElementById('dispatchBlockCount')?.value || stored.blocoQuantidade, stored.blocoQuantidade, 1);
    const blockDelay = toInt(document.getElementById('dispatchBlockDelayMin')?.value || document.getElementById('loteEsperaMin')?.value, stored.loteEsperaMin, 0);
    const horario = document.getElementById('horarioInicio')?.value || stored.horarioInicio;
    return normalizeConfig({ horarioInicio: horario, delayMin: interval, loteTamanho: blockSize, loteEsperaMin: blockDelay, blocoQuantidade: blockCount });
  }

  function applyConfig(cfg){
    cfg = normalizeConfig(cfg || readStored());
    setValue('horarioInicio', cfg.horarioInicio);
    setValue('dispatchIntervalSec', cfg.delayMin);
    setValue('dispatchBlockSize', cfg.loteTamanho);
    setValue('dispatchBlockCount', cfg.blocoQuantidade);
    setValue('dispatchBlockDelayMin', cfg.loteEsperaMin);
    setValue('delayMin', cfg.delayMin);
    setValue('delayMax', cfg.delayMax);
    setValue('loteTamanho', cfg.loteTamanho);
    setValue('loteEsperaMin', cfg.loteEsperaMin);
    setValue('loteAtivo', true);
    updateCards(cfg);
    return cfg;
  }

  function updateCards(cfg){
    cfg = normalizeConfig(cfg || getCurrentConfig());
    const total = cfg.loteTamanho * cfg.blocoQuantidade;
    const intervalMin = cfg.delayMin / 60;
    const intervalLabel = Number.isInteger(intervalMin) ? `${intervalMin} min` : `${cfg.delayMin}s`;
    const elIntervalVal = document.getElementById('statIntervalVal');
    const elIntervalSub = document.getElementById('statIntervalSub');
    const elLoteVal = document.getElementById('statLoteVal');
    const elLoteSub = document.getElementById('statLoteSub');
    const elDiaVal = document.getElementById('statDiaVal');
    const elDiaSub = document.getElementById('statDiaSub');
    if (elIntervalVal) elIntervalVal.textContent = intervalLabel;
    if (elIntervalSub) elIntervalSub.textContent = `${cfg.delayMin} seg entre cada lead`;
    if (elLoteVal) elLoteVal.textContent = `${cfg.loteTamanho} msg`;
    if (elLoteSub) elLoteSub.textContent = `por chip · ${cfg.blocoQuantidade} bloco${cfg.blocoQuantidade > 1 ? 's' : ''} por dia`;
    if (elDiaVal) elDiaVal.textContent = `${total} msg`;
    if (elDiaSub) elDiaSub.textContent = `${cfg.blocoQuantidade} bloco${cfg.blocoQuantidade > 1 ? 's' : ''} × ${cfg.loteTamanho} · espera ${cfg.loteEsperaMin}min`;
  }

  function save(){
    const cfg = applyConfig(getCurrentConfig());
    localStorage.setItem(KEY, JSON.stringify(cfg));
    try { localStorage.setItem('vs_evo_config', JSON.stringify(cfg)); } catch(e){}
    if (typeof uiSyncLogV426 === 'function') uiSyncLogV426('optimistic-update', { entity:'dispatch-config', action:'save-editable', cfg });
    if (typeof scheduleLegacyOperationalSyncV36 === 'function') scheduleLegacyOperationalSyncV36({ delay:0, reason:'dispatch-config-editable-save' });
    if (typeof atualizarStatsDisparo === 'function') atualizarStatsDisparo();
    try { if (typeof renderFilaDisparo === 'function') renderFilaDisparo(); } catch(e){}
    return cfg;
  }

  window.saveDispatchEditableConfigV49 = save;
  window.applyDispatchEditableConfigV49 = applyConfig;
  window.getDispatchEditableConfigV49 = getCurrentConfig;

  const previousSave = window.saveEvoConfig;
  window.saveEvoConfig = function(){
    const cfg = save();
    try { if (previousSave && previousSave !== window.saveEvoConfig) previousSave(); } catch(e){}
    return cfg;
  };

  function init(){
    const cfg = applyConfig(readStored());
    const listeners = ['horarioInicio','dispatchIntervalSec','dispatchBlockSize','dispatchBlockCount','dispatchBlockDelayMin'];
    listeners.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.__dispatchV49Bound) {
        el.__dispatchV49Bound = true;
        el.addEventListener('change', save);
        el.addEventListener('input', () => applyConfig(getCurrentConfig()));
      }
    });
    localStorage.setItem(KEY, JSON.stringify(cfg));
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, 0);
    setTimeout(init, 300);
    setTimeout(init, 1000);
  });
  if (document.readyState !== 'loading') init();
})();
