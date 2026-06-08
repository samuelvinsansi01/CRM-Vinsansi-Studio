(function(){
  'use strict';

  const PANEL_MAP = {
    inicio: { table: 'leads', stage: null, label: 'Início / visão semanal' },
    importar: { table: 'import_batches + lead_imports + leads + lead_locations + lead_snapshots', stage: 'imported', label: 'Importação' },
    validacao: { table: 'leads + lead_validation_attempts + backlog_items', stage: 'validation', label: 'Validação + envio ao Backlog' },
    instagram: { table: 'backlog_items + leads', channel: 'instagram', label: 'Backlog/Fila Instagram' },
    'fila-zap': { table: 'queue_items + dispatch_batches + dispatch_items + dispatch_ledger', channel: 'whatsapp', label: 'Fila WhatsApp' },
    redirecionamentos: { table: 'settings', scope: 'redirects', label: 'Redirecionamentos' },
    kanban: { table: 'crm_profiles + leads', stage: 'crm', label: 'Kanban CRM' },
    followups: { table: 'followups + leads', label: 'Follow-ups' },
    acompanhamento: { table: 'lead_events + dispatch_message_logs + whatsapp_messages', label: 'Acompanhamentos' },
    protecao: { table: 'contact_suppression_entries + dispatch_ledger', label: 'Protecao Operacional' },
    conta: { table: 'auth.users + settings', label: 'Conta' },
    configuracoes: { table: 'settings + whatsapp_instances + message_templates', label: 'Configurações' },
    audit: { table: 'audit_logs + operational_health_logs + lead_events', label: 'Auditoria' },
    conversations: { table: 'whatsapp_messages + whatsapp_contact_map + leads', label: 'Conversas' },
    inbox: { table: 'whatsapp_messages + whatsapp_contact_map + leads', direction: 'in', label: 'Caixa de Entrada' }
  };

  window.CRM_REBUILD_PANEL_MAP = PANEL_MAP;

  function getSupabaseClient(){
    if (window.supabaseClient) return window.supabaseClient;
    if (window.crmSupabase) return window.crmSupabase;
    if (window.sb) return window.sb;
    if (window.supabase && window.CRM_CONFIG && window.CRM_CONFIG.SUPABASE_URL && (window.CRM_CONFIG.SUPABASE_ANON_KEY || window.CRM_CONFIG.SUPABASE_PUBLISHABLE_KEY)) {
      const key = window.CRM_CONFIG.SUPABASE_ANON_KEY || window.CRM_CONFIG.SUPABASE_PUBLISHABLE_KEY;
      try {
        window.crmSupabase = window.supabase.createClient(window.CRM_CONFIG.SUPABASE_URL, key);
        return window.crmSupabase;
      } catch(e) {}
    }
    return null;
  }

  function setBadge(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value ?? 0);
  }

  async function refreshRebuildBadges(){
    const client = getSupabaseClient();
    if (!client) return;

    try {
      const { data, error } = await client.rpc('rpc_rebuild_panel_counts');
      if (error || !data) return;
      const counts = Array.isArray(data) ? data.reduce((acc, row) => {
        acc[row.panel_key] = row.total;
        return acc;
      }, {}) : data;

      setBadge('badge-inicio', counts.inicio || 0);
      setBadge('badge-importar', counts.importar || 0);
      setBadge('badge-validacao', counts.validacao || 0);
      setBadge('badge-fila-zap', counts.fila_zap || 0);
      setBadge('badge-instagram', counts.instagram || 0);
      setBadge('badge-inbox', counts.inbox || 0);
      setBadge('badge-followups', counts.followups || 0);
      setBadge('badge-acompanhamento', counts.acompanhamento || 0);
    } catch(e) {
      console.warn('[rebuild] badges não atualizados:', e?.message || e);
    }
  }

  function validateRealDom(){
    const requiredPanels = Object.keys(PANEL_MAP).map(k => `panel-${k}`);
    const missing = requiredPanels.filter(id => !document.getElementById(id));
    window.CRM_REBUILD_FRONTEND_HEALTH = {
      ok: missing.length === 0,
      missingPanels: missing,
      panelMap: PANEL_MAP
    };
    if (missing.length) console.warn('[rebuild] painéis ausentes:', missing);
    else console.info('[rebuild] frontend real reconciliado com banco novo.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    validateRealDom();
    refreshRebuildBadges();
    window.refreshRebuildBadges = refreshRebuildBadges;
  });
})();
