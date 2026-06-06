(function () {
  const SUPABASE_URL = 'https://txyknazfufashgzlxkqh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ClGVAmaiS4tNWe8W_4EPew_aPvAzK0E';

  function createClientNow() {
    if (window.supabaseClient?.from && window.supabaseClient?.auth) {
      console.log('[CRM] window.supabaseClient já existe.');
      return window.supabaseClient;
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('[CRM] Biblioteca Supabase carregada, mas createClient não está disponível.', window.supabase);
      return null;
    }

    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'crm-supabase-auth'
      }
    });

    window.crmSupabase = window.supabaseClient;
    window.sb = window.supabaseClient;

    console.log('[CRM] Supabase client criado e exposto em window.supabaseClient.');
    return window.supabaseClient;
  }

  window.resolveSupabaseClient = createClientNow;

  createClientNow();
})();
