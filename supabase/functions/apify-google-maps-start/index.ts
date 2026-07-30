import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APIFY_ACTOR_ID = "compass~google-maps-extractor";
const ACTOR_DATABASE_NAME = "compass/google-maps-extractor";
const JOB_STATUS = { PENDING: 3, PROCESSING: 4, COMPLETED: 5, ERROR: 6, CANCELED: 7 } as const;

type JobStatus = "starting" | "ready" | "running" | "succeeded" | "failed" | "aborted" | "timed_out";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Erro desconhecido.";
}
function normalizeStatus(value: unknown): JobStatus {
  const status = String(value ?? "RUNNING").toUpperCase();
  if (status === "STARTING") return "starting";
  if (status === "READY") return "ready";
  if (status === "RUNNING") return "running";
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED") return "failed";
  if (status === "ABORTED") return "aborted";
  if (status === "TIMED-OUT" || status === "TIMED_OUT") return "timed_out";
  return "running";
}
function numericStatus(status: JobStatus) {
  if (status === "succeeded") return JOB_STATUS.COMPLETED;
  if (status === "failed" || status === "timed_out") return JOB_STATUS.ERROR;
  if (status === "aborted") return JOB_STATUS.CANCELED;
  if (status === "starting" || status === "ready") return JOB_STATUS.PENDING;
  return JOB_STATUS.PROCESSING;
}
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração interna do Supabase ausente." }, 500);
  if (!authorization) return jsonResponse({ error: "Sessão não encontrada." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let jobId: number | null = null;

  try {
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonResponse({ error: "Corpo inválido." }, 400);

    const accountId = Number(body.apifyAccountId ?? body.apify_accounts_id);
    const branchId = Number(body.branchId ?? body.branches_id);
    const cityId = Number(body.locationCityId ?? body.cities_id);
    const requestedLimit = Number(body.maxCrawledPlacesPerSearch ?? body.limit ?? 50);
    const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));

    if (!Number.isInteger(accountId) || accountId <= 0) return jsonResponse({ error: "Selecione uma conta Apify válida." }, 400);
    if (!Number.isInteger(branchId) || branchId <= 0) return jsonResponse({ error: "Selecione um ramo cadastrado." }, 400);
    if (!Number.isInteger(cityId) || cityId <= 0) return jsonResponse({ error: "Selecione uma localidade cadastrada." }, 400);

    const { data: internalUser, error: userError } = await admin.from("users").select("users_id").eq("auth_user_id", authData.user.id).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!internalUser?.users_id) return jsonResponse({ error: "Usuário interno não encontrado." }, 403);
    const usersId = Number(internalUser.users_id);

    const [{ data: account, error: accountError }, { data: branch, error: branchError }, { data: city, error: cityError }] = await Promise.all([
      admin.from("apify_accounts").select("apify_accounts_id, account_name, token_secret, is_active").eq("apify_accounts_id", accountId).eq("users_id", usersId).maybeSingle(),
      admin.from("branches").select("branches_id, branches_name, status_id").eq("branches_id", branchId).eq("users_id", usersId).maybeSingle(),
      admin.from("cities").select("cities_id, cities_name, states_id, states:states_id(states_id, states_name, states_code)").eq("cities_id", cityId).maybeSingle(),
    ]);
    if (accountError) throw new Error(accountError.message);
    if (branchError) throw new Error(branchError.message);
    if (cityError) throw new Error(cityError.message);
    if (!account) return jsonResponse({ error: "Conta Apify não encontrada ou não pertence ao usuário." }, 404);
    if (!account.is_active) return jsonResponse({ error: "A conta Apify selecionada está desativada." }, 409);
    if (!branch || Number(branch.status_id ?? 1) !== 1) return jsonResponse({ error: "Ramo não encontrado ou inativo." }, 404);
    if (!city) return jsonResponse({ error: "Localidade não encontrada." }, 404);

    const token = String(account.token_secret ?? "").trim();
    if (!token) return jsonResponse({ error: "A conta selecionada não possui token Apify." }, 409);

    const state = Array.isArray(city.states) ? city.states[0] : city.states;
    const cityName = String(city.cities_name ?? "").trim();
    const stateCode = String(state?.states_code ?? state?.states_name ?? "").trim();
    if (!cityName || !stateCode) return jsonResponse({ error: "A localidade selecionada está incompleta no banco." }, 409);
    const locationQuery = `${cityName}, ${stateCode}`;
    const branchName = String(branch.branches_name ?? "").trim();
    if (branchName.length < 2 || branchName.length > 100) return jsonResponse({ error: "O ramo selecionado possui um nome inválido para a busca." }, 409);
    const searchStrings = [branchName];

    const { data: existing, error: existingError } = await admin.from("apify_import_jobs")
      .select("apify_import_jobs_id, external_run_id, external_dataset_id, status")
      .eq("users_id", usersId)
      .eq("branches_id", branchId)
      .eq("location_query", locationQuery)
      .in("status", ["starting", "ready", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.external_run_id) {
      return jsonResponse({
        success: true,
        message: "Já existe uma coleta ativa para este ramo e localidade.",
        jobId: Number(existing.apify_import_jobs_id),
        runId: String(existing.external_run_id),
        datasetId: existing.external_dataset_id ? String(existing.external_dataset_id) : null,
        status: normalizeStatus(existing.status),
        accountId,
        accountName: String(account.account_name ?? "Conta Apify"),
        reusedExistingJob: true,
      });
    }

    const startedAt = new Date().toISOString();
    const { data: job, error: jobError } = await admin.from("apify_import_jobs").insert({
      users_id: usersId,
      apify_accounts_id: accountId,
      apify_job_status_id: JOB_STATUS.PENDING,
      actor_id: ACTOR_DATABASE_NAME,
      search_query: searchStrings.join(" | "),
      search_terms: searchStrings,
      location_query: locationQuery,
      branches_id: branchId,
      branch_name: branchName,
      requested_limit: limit,
      status: "starting",
      started_at: startedAt,
      updated_at: startedAt,
    }).select("apify_import_jobs_id").single();
    if (jobError || !job) throw new Error(jobError?.message ?? "Não foi possível registrar a execução da Apify.");
    jobId = Number(job.apify_import_jobs_id);

    const actorInput = {
      enableCompetitorAnalysis: false,
      includeWebResults: false,
      language: "pt-BR",
      locationQuery,
      maxCrawledPlacesPerSearch: limit,
      maximumLeadsEnrichmentRecords: 0,
      scrapeContacts: false,
      scrapeDirectories: false,
      scrapeImageAuthors: false,
      scrapeOrderOnline: false,
      scrapePlaceDetailPage: false,
      scrapeReviewsPersonalData: true,
      scrapeSocialMediaProfiles: { facebooks: false, instagrams: false, tiktoks: false, twitters: false, youtubes: false },
      scrapeTableReservationProvider: false,
      searchStringsArray: searchStrings,
      skipClosedPlaces: false,
      verifyLeadsEnrichmentEmails: false,
    };

    const response = await fetchWithTimeout(`https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(actorInput),
    }, 30000);
    const payload = await response.json().catch(() => null) as Record<string, any> | null;
    if (!response.ok) {
      const message = String(payload?.error?.message ?? `A Apify retornou HTTP ${response.status}.`);
      const failedAt = new Date().toISOString();
      await admin.from("apify_import_jobs").update({ apify_job_status_id: JOB_STATUS.ERROR, status: "failed", error_message: message, finished_at: failedAt, updated_at: failedAt }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId);
      await admin.from("apify_accounts").update({ connection_status: response.status === 401 || response.status === 403 ? "error" : "not_verified", last_error: message, last_checked_at: failedAt, updated_at: failedAt }).eq("apify_accounts_id", accountId).eq("users_id", usersId);
      return jsonResponse({ error: message, jobId }, response.status === 401 || response.status === 403 ? 401 : 502);
    }

    const run = payload?.data;
    if (!run?.id) throw new Error("A Apify respondeu sem o ID da execução.");
    const status = normalizeStatus(run.status);
    const updatedAt = new Date().toISOString();
    const finished = ["succeeded", "failed", "aborted", "timed_out"].includes(status);
    const { error: updateError } = await admin.from("apify_import_jobs").update({
      apify_job_status_id: numericStatus(status),
      external_run_id: run.id,
      external_dataset_id: run.defaultDatasetId ?? null,
      status,
      finished_at: finished ? String(run.finishedAt ?? updatedAt) : null,
      updated_at: updatedAt,
    }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId);
    if (updateError) throw new Error(`A coleta foi iniciada, mas o histórico não pôde ser atualizado: ${updateError.message}`);

    await admin.from("apify_accounts").update({ connection_status: "connected", last_checked_at: updatedAt, last_used_at: updatedAt, last_error: null, updated_at: updatedAt }).eq("apify_accounts_id", accountId).eq("users_id", usersId);

    return jsonResponse({
      success: true,
      message: "Coleta iniciada com sucesso.",
      jobId,
      runId: String(run.id),
      datasetId: run.defaultDatasetId ?? null,
      status,
      apifyJobStatusId: numericStatus(status),
      accountId,
      accountName: String(account.account_name ?? "Conta Apify"),
      account: { id: accountId, name: String(account.account_name ?? "Conta Apify") },
    });
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError" ? "Tempo limite ao iniciar a coleta na Apify." : messageOf(error);
    if (jobId) {
      const failedAt = new Date().toISOString();
      await admin.from("apify_import_jobs").update({ apify_job_status_id: JOB_STATUS.ERROR, status: "failed", error_message: message, finished_at: failedAt, updated_at: failedAt }).eq("apify_import_jobs_id", jobId);
    }
    console.error("ERRO APIFY GOOGLE MAPS START:", error);
    return jsonResponse({ error: message, jobId }, 500);
  }
});
