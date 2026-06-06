window.CRMDb = (() => {
  let client = null;

  function getClient() {
    if (client) return client;

    const cfg = window.CRM_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes('COLE_AQUI')) {
      throw new Error('Configure public/js/core/crm-config.js com Supabase URL e Anon Key.');
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase JS não foi carregado. Confira o CDN no HTML.');
    }

    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    return client;
  }

  return { getClient };
})();
