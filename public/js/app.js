/* ════════════════════════════
   INIT
════════════════════════════ */
(function() {
  const s = document.getElementById('sidebar');
  if (localStorage.getItem(SIDEBAR_KEY)==='1') s.classList.remove('collapsed');

  // initAuth limpa caches sensiveis somente quando nao ha sessao ou quando a conta muda.

  // Inicializa login Google e recarrega os dados do usuário autenticado.
  initAuth();

  const cfg = loadEvoConfig() || {};
  if (cfg.delayMin)      (document.getElementById('delayMin')||{}).value      = cfg.delayMin; else (document.getElementById('delayMin')||{}).value = 120;
  if (cfg.delayMax)      (document.getElementById('delayMax')||{}).value      = cfg.delayMax; else (document.getElementById('delayMax')||{}).value = 120;
  // Parâmetros fixos da operação: 6 lotes de 30, com espera de 1h entre lotes.
  (document.getElementById('loteTamanho')||{}).value   = 30;
  (document.getElementById('loteEsperaMin')||{}).value = 60;
  if (cfg.horarioInicio) (document.getElementById('horarioInicio')||{}).value = cfg.horarioInicio;

  if (typeof atualizarStatsDisparo === 'function') atualizarStatsDisparo();

  // init chips — prioridade chip 2 com final 8457
  const chips = getChips();
  if (chips.length) {
    const chipPriority = chips.find(c => c.nome && c.nome.includes('8457')) || chips.find(c => c.nome && c.nome.toLowerCase().includes('ativação')) || chips[1] || chips[0];
    disparoChipId = chipPriority.id;
    activeChipId = chipPriority.id;
  }
  checkHorarioDisparo(new Date());
  setInterval(() => checkHorarioDisparo(new Date()), 30000);

  renderRamoSelect();
  ensureWeekData();
  if (typeof reconcilePermanentLeadBase === 'function') reconcilePermanentLeadBase();
  migrarChavesInstaWeek();
  sincronizarFilaComEnviados();
  const recuperadosValidacao = recuperarValidacaoZapDoDia();
  renderInicio();
  renderExcluidos();
  updateBadges();
  if (recuperadosValidacao) {
    setTimeout(() => notify(`↩ ${recuperadosValidacao} lead(s) voltaram para Validação`), 0);
  }
  // Migrar imagens antigas do localStorage para o IDB (executa uma vez)
  try {
    const oldCfg = JSON.parse(localStorage.getItem(LOTE_CFG_KEY)||'{}')||{};
    const migrKeys = Object.keys(oldCfg).filter(k => oldCfg[k] && oldCfg[k].imagem2Base64);
    if (migrKeys.length) {
      migrKeys.forEach(k => {
        const b64 = oldCfg[k].imagem2Base64;
        idbSet(k, b64).catch(()=>{});
        delete oldCfg[k].imagem2Base64;
        delete oldCfg[k].imagem2Nome;
      });
      localStorage.setItem(LOTE_CFG_KEY, JSON.stringify(oldCfg));
      console.log('[migrar] ' + migrKeys.length + ' imagem(ns) movida(s) do localStorage para o IDB');
    }
  } catch(e) {}
  // ── Migração v2: move leads INSTA de ATRIBUICAO_KEY para INSTA_KEY ──
  // O campo canal foi corrigido na v1, mas os leads ficaram na lista errada.
  // Leads com canal 'insta' (ou sem canal e sem whatsapp) devem estar em INSTA_KEY.
  try {
    const atribRaw = JSON.parse(localStorage.getItem(ATRIBUICAO_KEY) || '[]');
    const instaRaw = JSON.parse(localStorage.getItem(INSTA_KEY) || '[]');
    const instaIds = new Set(instaRaw.map(i => i.id));

    // Determina canal correto para cada lead (incluindo legados sem canal)
    const atribComCanal = atribRaw.map(a => ({
      ...a,
      canal: (a.canal && a.canal !== 'pendente') ? a.canal : (a.whatsapp ? 'zap' : 'insta')
    }));

    const ficamNoZap  = atribComCanal.filter(a => a.canal === 'zap');
    const vaoParaInsta = atribComCanal.filter(a => a.canal === 'insta');

    if (vaoParaInsta.length > 0) {
      // Adiciona na INSTA_KEY (sem duplicar)
      const novosInsta = vaoParaInsta
        .filter(a => !instaIds.has(a.id))
        .map(a => ({
          id: a.id,
          nome: a.nome || '',
          whatsapp: a.whatsapp || '',
          instagram: a.instagram || '',
          googleUrl: a.googleUrl || '',
          categoria: a.categoria || '',
          totalScore: a.totalScore || null,
          reviewsCount: a.reviewsCount || null,
          criadoEm: a.criadoEm || a.validadoEm || '',
          canal: 'insta',
        }));

      localStorage.setItem(INSTA_KEY, JSON.stringify([...instaRaw, ...novosInsta]));
      localStorage.setItem(ATRIBUICAO_KEY, JSON.stringify(ficamNoZap));
      console.log(`[migração v2] ${novosInsta.length} leads → INSTA_KEY · ${ficamNoZap.length} ficam em ATRIBUICAO_KEY (ZAP)`);
    }
  } catch(e) { console.warn('[migração v2] erro:', e); }

  // Limpeza de imagens de lotes obsoletos no IDB
  setTimeout(limparImagensOlfas, 2000);
  // Abrir o primeiro chip por padrão
  setTimeout(() => {
    const chips = getChips();
    if (chips.length) {
      const acc = document.getElementById('chipAccordion0');
      if (acc) acc.classList.add('open');
    }
  }, 50);
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


async function loadLeadsFromSupabase() {
  try {
    if (!window.supabaseAdapter || !window.sbClient) return;
    const userRes = await sbClient.auth.getUser();
    const user = userRes?.data?.user;
    if (!user) return;

    const { data, error } = await sbClient
      .from('leads')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Erro carregando leads', error);
      return;
    }

    window.__supabaseLeads = data || [];
    console.log('Leads carregados do Supabase:', window.__supabaseLeads.length);
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadLeadsFromSupabase();
});


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
