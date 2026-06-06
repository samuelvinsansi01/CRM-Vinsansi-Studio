(function () {
  'use strict';

  function assertEnv() {
    if (!window.CRM_ENV || !window.CRM_ENV.SUPABASE_URL || !window.CRM_ENV.SUPABASE_ANON_KEY) {
      throw new Error('Configure app/public/js/core/env.js com SUPABASE_URL e SUPABASE_ANON_KEY.');
    }
    if (String(window.CRM_ENV.SUPABASE_URL).includes('/rest/v1')) {
      throw new Error('SUPABASE_URL deve ser a URL raiz do projeto, sem /rest/v1. Ex: https://xxxx.supabase.co');
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
  
  window.supabaseClient = window.crmSupabase;
  window.CRM = window.CRM || {};
  window.CRM.supabase = window.crmSupabase;
})();
