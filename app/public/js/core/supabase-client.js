(function () {
  'use strict';

  function assertEnv() {
    if (!window.CRM_ENV || !window.CRM_ENV.SUPABASE_URL || !window.CRM_ENV.SUPABASE_ANON_KEY) {
      throw new Error('Configure app/public/js/core/env.js com SUPABASE_URL e SUPABASE_ANON_KEY.');
    }
  }

  assertEnv();

  window.crmSupabase = window.supabase.createClient(
    window.CRM_ENV.SUPABASE_URL,
    window.CRM_ENV.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
})();
