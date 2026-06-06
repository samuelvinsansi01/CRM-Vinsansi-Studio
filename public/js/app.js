/* ════════════════════════════
   INIT
════════════════════════════ */
(async function() {
  try {
    const s = document.getElementById('sidebar');

    if (s && typeof SIDEBAR_KEY !== 'undefined' && sessionStorage.getItem(SIDEBAR_KEY) === '1') {
      s.classList.remove('collapsed');
    }

    if (typeof initAuth === 'function') {
      await initAuth();
    } else {
      console.warn('[CRM] initAuth não encontrada. Login antigo não inicializado.');
    }

    const cfg = (typeof loadEvoConfig === 'function' ? loadEvoConfig() : {}) || {};

    if (document.getElementById('delayMin')) {
      document.getElementById('delayMin').value = cfg.delayMin || 120;
    }

    if (document.getElementById('delayMax')) {
      document.getElementById('delayMax').value = cfg.delayMax || 120;
    }

    if (document.getElementById('loteTamanho')) {
      document.getElementById('loteTamanho').value = 30;
    }

    if (document.getElementById('loteEsperaMin')) {
      document.getElementById('loteEsperaMin').value = 60;
    }

    if (document.getElementById('horarioInicio') && cfg.horarioInicio) {
      document.getElementById('horarioInicio').value = cfg.horarioInicio;
    }

    if (typeof atualizarStatsDisparo === 'function') atualizarStatsDisparo();

    if (typeof getChips === 'function') {
      const chips = getChips();

      if (chips.length) {
        const chipPriority =
          chips.find(c => c.nome && c.nome.includes('8457')) ||
          chips.find(c => c.nome && c.nome.toLowerCase().includes('ativação')) ||
          chips[1] ||
          chips[0];

        if (typeof disparoChipId !== 'undefined') disparoChipId = chipPriority.id;
        if (typeof activeChipId !== 'undefined') activeChipId = chipPriority.id;
      }
    }

    if (typeof checkHorarioDisparo === 'function') {
      checkHorarioDisparo(new Date());
      setInterval(() => checkHorarioDisparo(new Date()), 30000);
    }

    if (typeof renderRamoSelect === 'function') renderRamoSelect();
    if (typeof ensureMessageTemplateDefaultsV434 === 'function') ensureMessageTemplateDefaultsV434();
    if (typeof ensureWeekData === 'function') ensureWeekData();
    if (typeof reconcilePermanentLeadBase === 'function') reconcilePermanentLeadBase();
    if (typeof migrarChavesInstaWeek === 'function') migrarChavesInstaWeek();
    if (typeof sincronizarFilaComEnviados === 'function') sincronizarFilaComEnviados();

    let recuperadosValidacao = 0;

    if (typeof recuperarValidacaoZapDoDia === 'function') {
      recuperadosValidacao = recuperarValidacaoZapDoDia();
    }

    if (typeof renderInicio === 'function') renderInicio();
    if (typeof renderExcluidos === 'function') renderExcluidos();
    if (typeof updateBadges === 'function') updateBadges();
    if (typeof restoreLastActivePanelV434 === 'function') restoreLastActivePanelV434();

    if (recuperadosValidacao && typeof notify === 'function') {
      setTimeout(() => notify(`↩ ${recuperadosValidacao} lead(s) voltaram para Validação`), 0);
    }

    if (typeof limparImagensOlfas === 'function') {
      setTimeout(limparImagensOlfas, 2000);
    }

    setTimeout(() => {
      if (typeof getChips !== 'function') return;

      const chips = getChips();

      if (chips.length) {
        const acc = document.getElementById('chipAccordion0');
        if (acc) acc.classList.add('open');
      }
    }, 50);

    if (window.CRMRebuildReconciliation?.init) {
      await window.CRMRebuildReconciliation.init();
    }

    console.log('[CRM] App iniciado com segurança.');
  } catch (error) {
    console.error('[CRM] Erro ao iniciar app.js:', error);
  }
})();

function getPipelineStats() {
  const store = getLeadCrmStore();
  const stats = {};
  LEAD_PIPELINE_STEPS.forEach(s => stats[s.key]=0);
  Object.values(store).forEach(crm => {
    const k = crm.pipelineStatus || LEAD_PIPELINE_STEPS[0].key;
    if (stats[k] !== undefined) stats[k]++;
  });
  return stats;
}


function getPipelineConversionMetrics() {
  const stats = getPipelineStats();
  const total = Object.values(stats).reduce((a,b)=>a+b,0);
  return {
    total,
    responded: stats.responded || 0,
    meetings: stats.meeting || 0,
    proposals: stats.proposal || 0,
    closed: stats.closed || 0
  };
}


/* ===== V13 TIMELINE ===== */

function getLeadTimelineEvents(leadId){
  const store = (typeof getLeadCrmStore === 'function') ? getLeadCrmStore() : {};
  const crm = store[leadId] || {};
  const events = [];

  (crm.history || []).forEach(h => events.push({
    type:'history',
    icon:'🧭',
    at:h.at || '',
    text:h.text || ''
  }));

  (crm.notes || []).forEach(n => events.push({
    type:'note',
    icon:'📝',
    at:n.at || '',
    text:n.text || ''
  }));

  (crm.presentations || []).forEach(p => events.push({
    type:'presentation',
    icon:'🔗',
    at:p.createdAtLabel || p.createdAt || '',
    text:`Apresentação vinculada: ${p.title || 'Apresentação'}`
  }));

  if (crm.followUpDate) {
    events.push({
      type:'followup',
      icon:'⏰',
      at:crm.followUpDate,
      text:'Follow-up agendado'
    });
  }

  return events.reverse();
}

function renderLeadTimeline(leadId){
  const box = document.getElementById('leadTimelineList');
  if (!box || !leadId) return;

  const events = getLeadTimelineEvents(leadId);

  if (!events.length) {
    box.innerHTML = '<div class="lead-timeline-empty">// nenhuma atividade registrada ainda</div>';
    return;
  }

  box.innerHTML = events.map(ev => `
    <div class="lead-timeline-item">
      <div class="lead-timeline-icon">${ev.icon || '•'}</div>
      <div>
        <div class="lead-timeline-date">${escHtml(ev.at || '')}</div>
        <div class="lead-timeline-text">${escHtml(ev.text || '')}</div>
      </div>
    </div>
  `).join('');
}



function authGateSelfTest() {
  const gate = document.getElementById('authGate');
  return {
    hasGate: !!gate,
    gateOpen: !!gate?.classList.contains('open'),
    bodyLocked: document.body.classList.contains('auth-locked'),
    currentUser: currentUser ? { id: currentUser.id, email: currentUser.email } : null
  };
}

// V27 panel hook fallback

// chips panel fallback


/* CONFIG DISPARO V33 */
function getDispatchConfigTextV33() {
  return {
    dailyLimitTitle: 'LIMITE DIÁRIO POR CHIP',
    dailyLimitValue: '180 msg',
    dailyLimitHint: '6 lotes × 30 · espera 1h',
    batchValue: '30 msg',
    batchHint: 'por chip · 6 lotes por dia',
    intervalValue: '2 min',
    intervalHint: '120 seg fixo entre cada lead',
    blocks: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00']
  };
}

// audit panel fallback

document.addEventListener('DOMContentLoaded', () => { try { updateAuditBadgeV35(); } catch(e){} });
