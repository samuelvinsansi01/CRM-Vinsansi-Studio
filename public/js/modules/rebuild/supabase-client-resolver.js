(function () {
  function getUrl() {
    return window.SUPABASE_URL || window.supabaseUrl || 'https://txyknazfufashgzlxkqh.supabase.co';
  }

  function getKey() {
    return window.SUPABASE_ANON_KEY ||
      window.SUPABASE_PUBLISHABLE_KEY ||
      window.supabaseAnonKey ||
      window.supabaseKey ||
      'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';
  }

  function resolveSupabaseClient() {
    if (window.supabaseClient?.from && window.supabaseClient?.auth) return window.supabaseClient;
    if (window.crmSupabase?.from && window.crmSupabase?.auth) return (window.supabaseClient = window.crmSupabase);
    if (window.sb?.from && window.sb?.auth) return (window.supabaseClient = window.sb);

    if (window.supabase?.createClient) {
      window.supabaseClient = window.supabase.createClient(getUrl(), getKey(), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      console.log('[CRM] Supabase client criado pelo resolver.');
      return window.supabaseClient;
    }

    console.warn('[CRM] Biblioteca Supabase não encontrada.');
    return null;
  }

  window.resolveSupabaseClient = resolveSupabaseClient;
  resolveSupabaseClient();
})();
