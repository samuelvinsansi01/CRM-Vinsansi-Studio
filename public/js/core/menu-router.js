(function(){
  'use strict';

  const ACTIVE_PANEL_KEY = 'vs_active_panel_v434';
  const PANELS = [
    'inicio',
    'inbox',
    'importar',
    'validacao',
    'arquivados',
    'base-permanente',
    'fila-zap',
    'instagram',
    'ramos',
    'templates',
    'chips',
    'conversations',
    'kanban',
    'followups',
    'acompanhamento',
    'protecao',
    'dominios',
    'configuracoes',
    'redirecionamentos',
    'audit',
    'conta'
  ];

  const ALIASES = {
    inicio: 'inicio',
    home: 'inicio',
    dashboard: 'inicio',

    inbox: 'inbox',
    caixa: 'inbox',
    caixaEntrada: 'inbox',
    'caixa-entrada': 'inbox',
    responses: 'inbox',

    importar: 'importar',
    import: 'importar',
    imports: 'importar',

    validacao: 'validacao',
    validation: 'validacao',
    assignment: 'validacao',
    atribuicao: 'validacao',
    atribuicaoZap: 'validacao',
    'panel-atribuicao': 'validacao',

    arquivados: 'arquivados',
    archived: 'arquivados',

    base: 'base-permanente',
    basePermanente: 'base-permanente',
    permanentBase: 'base-permanente',
    'base-permanente': 'base-permanente',

    whatsapp: 'fila-zap',
    whatsappQueue: 'fila-zap',
    filaZap: 'fila-zap',
    'fila-zap': 'fila-zap',

    instagram: 'instagram',
    ramos: 'ramos',
    branches: 'ramos',
    templates: 'templates',
    template: 'templates',
    templatesConfig: 'templates',
    chips: 'chips',
    whatsappChips: 'chips',

    conversas: 'conversations',
    conversations: 'conversations',

    crmKanban: 'kanban',
    kanban: 'kanban',

    followUp: 'followups',
    followup: 'followups',
    followups: 'followups',
    'follow-up': 'followups',

    acompanhamento: 'acompanhamento',

    protecao: 'protecao',
    protection: 'protecao',
    blockedContacts: 'protecao',

    dominios: 'dominios',
    domains: 'dominios',
    blockedDomains: 'dominios',
    'dominios-bloqueados': 'dominios',

    configuracoes: 'configuracoes',
    settings: 'configuracoes',
    chips: 'configuracoes',
    evolution: 'configuracoes',

    redirecionamentos: 'redirecionamentos',
    redirects: 'redirecionamentos',

    auditorias: 'audit',
    auditoria: 'audit',
    audit: 'audit',

    minhaConta: 'conta',
    minha_conta: 'conta',
    'minha-conta': 'conta',
    conta: 'conta',
    account: 'conta'
  };

  const LABEL_ALIASES = {
    inicio: 'inicio',
    'caixa de entrada': 'inbox',
    importar: 'importar',
    validacao: 'validacao',
    arquivados: 'arquivados',
    'base permanente': 'base-permanente',
    whatsapp: 'fila-zap',
    'fila whatsapp': 'fila-zap',
    instagram: 'instagram',
    ramos: 'ramos',
    templates: 'templates',
    chips: 'chips',
    conversas: 'conversations',
    kanban: 'kanban',
    'follow up': 'followups',
    followups: 'followups',
    acompanhamento: 'acompanhamento',
    protecao: 'protecao',
    'dominios bloqueados': 'dominios',
    configuracoes: 'configuracoes',
    redirecionamentos: 'redirecionamentos',
    auditoria: 'audit',
    auditorias: 'audit',
    'minha conta': 'conta'
  };

  const FALLBACKS = {
    kanban: ['Kanban Comercial', 'Pipeline comercial pronto para receber os leads sincronizados.'],
    followups: ['Central de Follow-ups', 'Acompanhe contatos vencidos, de hoje e dos proximos dias.'],
    acompanhamento: ['Acompanhamento', 'Resumo operacional para acompanhar resultados e status dos leads.'],
    redirecionamentos: ['Redirecionamentos', 'Ferramenta para criar e manter links curtos.'],
    audit: ['Auditorias', 'Historico tecnico de envios, erros e eventos do funil.'],
    conta: ['Minha Conta', 'Dados da sessao e sincronizacao da conta conectada.']
  };

  let legacySwitchPanel = typeof window.switchPanel === 'function' ? window.switchPanel : null;
  let exposing = false;

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizePanelName(name) {
    const raw = String(name || '').trim();
    if (!raw) return 'inicio';
    const withoutPanelPrefix = raw.replace(/^panel-/i, '');
    return ALIASES[raw] || ALIASES[withoutPanelPrefix] || ALIASES[normalizeText(withoutPanelPrefix)] || withoutPanelPrefix;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function safeCall(fnName, ...args) {
    try {
      const fn = window[fnName];
      if (typeof fn === 'function') return fn.apply(window, args);
    } catch (error) {
      console.error('[menu-router] erro em ' + fnName, error);
    }
    return undefined;
  }

  function mainContainer() {
    return document.querySelector('main.main, .main, main') || document.body;
  }

  function renderPlaceholderPanel(title, description, panelId) {
    const panel = ensurePanel(panelId || 'inicio', title, description);
    panel.innerHTML = [
      '<div class="page-header" style="flex-shrink:0">',
      '  <div>',
      '    <div class="page-title">' + escapeHtml(title || 'Tela') + '</div>',
      '    <div class="page-sub">// ' + escapeHtml(description || 'Conteudo em preparacao.') + '</div>',
      '  </div>',
      '</div>',
      '<div class="card" style="margin-top:16px">',
      '  <div class="card-title">Status</div>',
      '  <div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text2);line-height:1.7">',
      '    Esta area esta disponivel no menu e pronta para receber o modulo definitivo sem quebrar a navegacao.',
      '  </div>',
      '</div>'
    ].join('');
    return panel;
  }

  function ensurePanel(panelId, title, description) {
    let panel = document.getElementById('panel-' + panelId);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'panel-' + panelId;
    mainContainer().appendChild(panel);
    renderPlaceholderPanel(title || panelId, description || 'Tela sem estrutura HTML encontrada.', panelId);
    return panel;
  }

  function maybeFallback(panelId) {
    const panel = document.getElementById('panel-' + panelId);
    if (!panel) return;
    const hasVisibleStructure = panel.children.length > 0 && String(panel.textContent || '').trim().length > 0;
    if (hasVisibleStructure) return;

    const fallback = FALLBACKS[panelId] || ['Tela', 'Modulo carregado sem conteudo visivel.'];
    renderPlaceholderPanel(fallback[0], fallback[1], panelId);
  }

  function renderTemplatesPanel() {
    const rendered = safeCall('renderTemplatesPanelV656');
    if (rendered === undefined) {
      safeCall('renderTemplatesConfig');
      safeCall('renderInstaTemplatesConfig');
      safeCall('setTemplatesChannelV656', window.__templatesChannelV656 || 'whatsapp');
    }
  }

  function renderPanel(panelId) {
    if (panelId === 'inicio') safeCall('renderInicio');
    if (panelId === 'inbox') {
      safeCall('renderInbox');
      safeCall('fetchEvolutionResponsesV34', { silent: true });
    }
    if (panelId === 'importar') safeCall('renderImportarPanel');
    if (panelId === 'validacao') {
      safeCall('renderValidacao');
      setTimeout(() => safeCall('renderValidationStageFromSupabase'), 80);
    }
    if (panelId === 'arquivados') safeCall('renderArquivados');
    if (panelId === 'base-permanente') safeCall('renderLeadBasePanel');
    if (panelId === 'fila-zap') safeCall('renderFilaZap');
    if (panelId === 'instagram') safeCall('renderInstagram');
    if (panelId === 'ramos') safeCall('renderRamosPanel');
    if (panelId === 'templates') renderTemplatesPanel();
    if (panelId === 'chips') safeCall('renderChipsPanel');
    if (panelId === 'conversations') {
      safeCall('renderConversations');
      safeCall('fetchEvolutionResponsesV34', { silent: true });
    }
    if (panelId === 'kanban') safeCall('renderKanban');
    if (panelId === 'followups') safeCall('renderFollowups');
    if (panelId === 'acompanhamento') safeCall('renderAcompanhamento');
    if (panelId === 'protecao') {
      safeCall('renderProtecao');
      safeCall('loadContactSuppressionEntriesV629');
    }
    if (panelId === 'dominios') safeCall('renderExcluidos');
    if (panelId === 'configuracoes') {
      safeCall('renderConfiguracoes');
      safeCall('renderWebhookUrlV34');
    }
    if (panelId === 'redirecionamentos') safeCall('renderRedirecionamentos');
    if (panelId === 'audit') safeCall('renderAuditV35');
    if (panelId === 'conta') safeCall('renderMinhaConta');

    maybeFallback(panelId);
    safeCall('updateBadges');
  }

  function panelFromNavItem(item) {
    const onclick = item?.getAttribute?.('onclick') || '';
    const match = onclick.match(/switchPanel\((['"])(.*?)\1/);
    if (match) return normalizePanelName(match[2]);

    const label = normalizeText(item?.getAttribute?.('data-label') || item?.textContent || '');
    return LABEL_ALIASES[label] || '';
  }

  function closeOtherGroups(activeGroup) {
    document.querySelectorAll('details.menu-group-final').forEach((group) => {
      if (group !== activeGroup) group.open = false;
    });
  }

  function setActivePanel(panelId) {
    ensurePanel(panelId);

    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === 'panel-' + panelId);
    });

    let activeNav = null;
    document.querySelectorAll('.nav-item').forEach((item) => {
      const targetPanel = panelFromNavItem(item);
      const active = targetPanel === panelId;
      item.classList.toggle('active', active);
      if (active && !activeNav) activeNav = item;
    });

    const activeGroup = activeNav?.closest?.('details.menu-group-final') || null;
    if (activeGroup) activeGroup.open = true;
    closeOtherGroups(activeGroup);

    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.innerWidth <= 980) {
      sidebar.classList.remove('mobile-open');
      document.getElementById('mobileMenuOverlayV37')?.classList.remove('active');
      document.body.classList.remove('mobile-menu-open');
      document.body.style.overflow = '';
    }
  }

  function switchPanelRouter(name, options = {}) {
    const normalized = normalizePanelName(name);
    const panelId = PANELS.includes(normalized) ? normalized : 'inicio';

    setActivePanel(panelId);
    renderPanel(panelId);

    if (options.persist !== false) {
      try { sessionStorage.setItem(ACTIVE_PANEL_KEY, panelId); } catch (_) {}
    }

    return panelId;
  }

  function restoreLastActivePanel() {
    let panelId = 'inicio';
    try {
      const saved = sessionStorage.getItem(ACTIVE_PANEL_KEY) || '';
      panelId = normalizePanelName(saved);
    } catch (_) {}

    if (!PANELS.includes(panelId)) panelId = 'inicio';
    return switchPanelRouter(panelId, { persist: false });
  }

  function installExclusiveSubmenus() {
    document.querySelectorAll('details.menu-group-final').forEach((group) => {
      if (group.__menuRouterExclusive) return;
      group.__menuRouterExclusive = true;
      group.addEventListener('toggle', () => {
        if (group.open) closeOtherGroups(group);
      });
    });
  }

  function exposeRouter() {
    if (exposing) return;
    exposing = true;
    try {
      Object.defineProperty(window, 'switchPanel', {
        configurable: true,
        get: () => switchPanelRouter,
        set: (next) => {
          if (next === switchPanelRouter) return;
          if (typeof next === 'function') legacySwitchPanel = next;
        }
      });
    } catch (_) {
      window.switchPanel = switchPanelRouter;
    } finally {
      exposing = false;
    }

    window.restoreLastActivePanelV434 = restoreLastActivePanel;
    window.renderPlaceholderPanel = renderPlaceholderPanel;
    window.__menuRouterLegacySwitchPanel = legacySwitchPanel;
  }

  function boot() {
    exposeRouter();
    installExclusiveSubmenus();
    const active = document.querySelector('.panel.active');
    const activePanel = active?.id?.replace(/^panel-/, '') || 'inicio';
    setActivePanel(PANELS.includes(activePanel) ? activePanel : 'inicio');
  }

  switchPanelRouter.__menuRouterFinal = true;
  switchPanelRouter.__routerFinal658 = true;

  exposeRouter();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot();
      setTimeout(() => {
        exposeRouter();
        try { restoreLastActivePanel(); } catch (_) { switchPanelRouter('inicio', { persist: false }); }
      }, 160);
    });
  } else {
    boot();
    setTimeout(() => {
      exposeRouter();
      try { restoreLastActivePanel(); } catch (_) { switchPanelRouter('inicio', { persist: false }); }
    }, 160);
  }

  [0, 300, 900, 1800].forEach((delay) => setTimeout(() => {
    exposeRouter();
    installExclusiveSubmenus();
  }, delay));
})();
