/* CRM Rebuild Fase 6.8 — Supabase client resolver */
(function(){
  function looksLikeClient(client){
    return !!client && typeof client.from === 'function' && typeof client.auth === 'object';
  }

  function resolveSupabaseClient(){
    const candidates = [
      window.supabaseClient,
      window.crmSupabase,
      window.sb,
      window.supabaseDb,
      window.__supabaseClient,
      window.supabase && typeof window.supabase.from === 'function' ? window.supabase : null,
      window._supabase
    ];

    for (const candidate of candidates) {
      if (looksLikeClient(candidate)) return candidate;
    }

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      const cfg = window.CRM_CONFIG || window.crmConfig || window.__CRM_CONFIG || {};
      const url = cfg.SUPABASE_URL || cfg.supabaseUrl || window.SUPABASE_URL;
      const key = cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || cfg.supabaseAnonKey || cfg.supabasePublishableKey || window.SUPABASE_ANON_KEY || window.SUPABASE_PUBLISHABLE_KEY;
      if (url && key) {
        const created = window.supabase.createClient(url, key);
        window.supabaseClient = created;
        window.crmSupabase = created;
        return created;
      }
    }

    return null;
  }

  async function resolveCurrentUser(client){
    if (window.currentUser?.id) return window.currentUser;
    if (!client?.auth?.getUser) return null;
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    if (data?.user) {
      window.currentUser = data.user;
      return data.user;
    }
    return null;
  }

  window.CRMResolveSupabaseClient = resolveSupabaseClient;
  window.CRMResolveCurrentUser = resolveCurrentUser;
})();
