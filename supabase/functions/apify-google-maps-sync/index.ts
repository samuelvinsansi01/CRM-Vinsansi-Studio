import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JOB_STATUS = { PENDING: 3, PROCESSING: 4, COMPLETED: 5, ERROR: 6, CANCELED: 7 } as const;
type JobStatus = "starting" | "ready" | "running" | "succeeded" | "failed" | "aborted" | "timed_out";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Erro desconhecido.";
}
function normalizeRunStatus(value: unknown): JobStatus {
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

  try {
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonResponse({ error: "Corpo inválido." }, 400);
    const jobId = Number(body.jobId ?? body.apify_import_jobs_id);
    const action = String(body.action ?? "status");
    if (!Number.isInteger(jobId) || jobId <= 0) return jsonResponse({ error: "Job inválido." }, 400);

    const { data: internalUser, error: userError } = await admin.from("users").select("users_id").eq("auth_user_id", authData.user.id).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!internalUser?.users_id) return jsonResponse({ error: "Usuário interno não encontrado." }, 403);

    const { data: job, error: jobError } = await admin
      .from("apify_import_jobs")
      .select(`apify_import_jobs_id, users_id, apify_accounts_id, external_run_id, external_dataset_id, status, imported_at, apify_accounts:apify_accounts_id ( apify_accounts_id, token_secret )`)
      .eq("apify_import_jobs_id", jobId)
      .eq("users_id", internalUser.users_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return jsonResponse({ error: "Job não encontrado." }, 404);

    if (action === "finalize") {
      const processed = Math.max(0, Number(body.processed ?? 0) || 0);
      const imported = Math.max(0, Number(body.imported ?? 0) || 0);
      const duplicates = Math.max(0, Number(body.duplicates ?? 0) || 0);
      const rejected = Math.max(0, Number(body.rejected ?? 0) || 0);
      const now = new Date().toISOString();
      const { error } = await admin.from("apify_import_jobs").update({
        total_received: processed,
        total_imported: imported,
        total_duplicates: duplicates,
        total_rejected: rejected,
        imported_at: now,
        updated_at: now,
      }).eq("apify_import_jobs_id", jobId).eq("users_id", internalUser.users_id);
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true, jobId, importedAt: now });
    }

    const runId = String(job.external_run_id ?? "").trim();
    const accountRelation = Array.isArray(job.apify_accounts) ? job.apify_accounts[0] : job.apify_accounts;
    const token = String(accountRelation?.token_secret ?? "").trim();
    if (!runId) return jsonResponse({ error: "O job não possui runId." }, 409);
    if (!token) return jsonResponse({ error: "A conta Apify não possui token." }, 409);

    const runResponse = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`);
    const runPayload = await runResponse.json().catch(() => null) as Record<string, any> | null;
    if (!runResponse.ok) throw new Error(String(runPayload?.error?.message ?? `A Apify retornou HTTP ${runResponse.status}.`));

    const run = runPayload?.data;
    const status = normalizeRunStatus(run?.status);
    const datasetId = String(run?.defaultDatasetId ?? job.external_dataset_id ?? "").trim() || null;
    const now = new Date().toISOString();
    const finished = ["succeeded", "failed", "aborted", "timed_out"].includes(status);
    const { error: updateError } = await admin.from("apify_import_jobs").update({
      external_dataset_id: datasetId,
      status,
      apify_job_status_id: numericStatus(status),
      finished_at: finished ? String(run?.finishedAt ?? now) : null,
      error_message: status === "failed" ? String(run?.statusMessage ?? "Falha na execução da Apify.") : null,
      updated_at: now,
    }).eq("apify_import_jobs_id", jobId).eq("users_id", internalUser.users_id);
    if (updateError) throw new Error(updateError.message);

    if (status !== "succeeded") return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: Boolean(job.imported_at), items: null });
    if (job.imported_at) return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: true, items: null });
    if (!datasetId) return jsonResponse({ error: "Execução concluída sem datasetId." }, 502);

    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&token=${encodeURIComponent(token)}`);
    const items = await datasetResponse.json().catch(() => null);
    if (!datasetResponse.ok || !Array.isArray(items)) throw new Error(`Não foi possível carregar o dataset da Apify (HTTP ${datasetResponse.status}).`);

    await admin.from("apify_import_jobs").update({ total_received: items.length, updated_at: new Date().toISOString() }).eq("apify_import_jobs_id", jobId).eq("users_id", internalUser.users_id);
    return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: false, items });
  } catch (error) {
    console.error("ERRO APIFY GOOGLE MAPS SYNC:", error);
    return jsonResponse({ error: messageOf(error) }, 500);
  }
});
