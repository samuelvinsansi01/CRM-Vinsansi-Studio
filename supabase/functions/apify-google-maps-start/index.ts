import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Configuração do Supabase ausente.' }, 500);

  const authHeader = request.headers.get('Authorization') ?? '';
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Sessão inválida.' }, 401);

  const body = await request.json().catch(() => ({}));
  const apifyAccountId = Number(body.apifyAccountId);
  const search = String(body.search ?? '').trim();
  const location = String(body.location ?? '').trim();
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 50));

  if (!Number.isInteger(apifyAccountId) || apifyAccountId <= 0) return json({ error: 'Selecione manualmente uma conta Apify.' }, 400);
  if (!search) return json({ error: 'Informe a busca.' }, 400);
  if (!location) return json({ error: 'Informe a localização.' }, 400);

  const { data: userRow, error: userError } = await admin
    .from('users')
    .select('users_id')
    .eq('auth_user_id', authData.user.id)
    .single();
  if (userError || !userRow) return json({ error: 'Usuário interno não encontrado.' }, 403);

  const { data: account, error: accountError } = await admin
    .from('apify_accounts')
    .select('apify_accounts_id, account_name, token_secret, is_active')
    .eq('apify_accounts_id', apifyAccountId)
    .eq('users_id', userRow.users_id)
    .single();

  if (accountError || !account) return json({ error: 'Conta Apify não encontrada para este usuário.' }, 404);
  if (!account.is_active) return json({ error: 'A conta Apify selecionada está desativada.' }, 400);
  if (!account.token_secret) return json({ error: 'A conta selecionada não possui token.' }, 400);

  const { data: job, error: jobError } = await admin
    .from('apify_import_jobs')
    .insert({
      users_id: userRow.users_id,
      apify_accounts_id: account.apify_accounts_id,
      actor_id: 'compass/google-maps-extractor',
      search_query: search,
      location_query: location,
      requested_limit: limit,
      status: 'starting',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('apify_import_jobs_id')
    .single();

  if (jobError || !job) return json({ error: jobError?.message ?? 'Não foi possível registrar a execução.' }, 500);

  try {
    const actorInput = {
      searchStringsArray: [search],
      locationQuery: location,
      maxCrawledPlacesPerSearch: limit,
      language: 'pt-BR',
      scrapeSocialMediaProfiles: {
        facebooks: false,
        instagrams: true,
        youtubes: false,
        tiktoks: false,
        twitters: false,
      },
      maximumLeadsEnrichmentRecords: 0,
    };

    const response = await fetch(
      `https://api.apify.com/v2/acts/compass~google-maps-extractor/runs?token=${encodeURIComponent(account.token_secret)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actorInput),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data?.id) {
      const message = payload?.error?.message ?? `Apify respondeu com HTTP ${response.status}.`;
      await admin.from('apify_import_jobs').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('apify_import_jobs_id', job.apify_import_jobs_id);
      await admin.from('apify_accounts').update({ connection_status: response.status === 401 ? 'error' : 'not_verified', last_error: message, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('apify_accounts_id', account.apify_accounts_id);
      return json({ error: message }, response.status === 401 ? 401 : 502);
    }

    const run = payload.data;
    await admin.from('apify_import_jobs').update({
      external_run_id: run.id,
      external_dataset_id: run.defaultDatasetId ?? null,
      status: String(run.status ?? 'ready').toLowerCase(),
      updated_at: new Date().toISOString(),
    }).eq('apify_import_jobs_id', job.apify_import_jobs_id);

    await admin.from('apify_accounts').update({
      connection_status: 'connected',
      last_checked_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('apify_accounts_id', account.apify_accounts_id);

    return json({
      jobId: job.apify_import_jobs_id,
      runId: run.id,
      datasetId: run.defaultDatasetId ?? null,
      status: String(run.status ?? 'READY').toLowerCase(),
      accountId: account.apify_accounts_id,
      accountName: account.account_name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada ao iniciar a Apify.';
    await admin.from('apify_import_jobs').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('apify_import_jobs_id', job.apify_import_jobs_id);
    return json({ error: message }, 500);
  }
});
