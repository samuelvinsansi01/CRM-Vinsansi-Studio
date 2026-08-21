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
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Erro desconhecido.";
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
function safeCount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
function claimMarker(token: string) {
  return `import_claim:${token}`;
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
    const action = String(body.action ?? "status");

    const { data: organizationContext, error: contextError } = await admin.rpc("resolve_organization_context_for_auth_user", { p_auth_user_id: authData.user.id, p_organization_id: Number(request.headers.get("x-vinsansi-organization-id") ?? 0) || null });
    if (contextError) throw new Error(contextError.message);
    const usersId = Number(organizationContext?.scopeUsersId ?? 0);
    if (!usersId) return jsonResponse({ error: "Contexto da organização não encontrado." }, 403);
    const organizationId = Number(organizationContext?.organizationId ?? 0);
    if (!organizationId) return jsonResponse({ error: "Organização inválida." }, 403);
    const { data: allowed, error: permissionError } = await admin.rpc("auth_user_has_organization_permission", {
      p_auth_user_id: authData.user.id,
      p_organization_id: organizationId,
      p_permission_key: "capture.use",
    });
    if (permissionError) throw new Error(permissionError.message);
    if (!allowed) return jsonResponse({ error: "Sem permissão para esta ação." }, 403);

    if (action === "recover_stale") {
      const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      const { data: stale, error: staleError } = await admin
        .from("apify_import_jobs")
        .select("apify_import_jobs_id")
        .eq("users_id", usersId)
        .like("error_message", "import_claim:%")
        .lt("imported_at", cutoff);
      if (staleError) throw new Error(staleError.message);
      const ids = (stale ?? []).map((row: any) => Number(row.apify_import_jobs_id)).filter(Boolean);
      if (ids.length) {
        const { error: releaseError } = await admin.from("apify_import_jobs").update({ imported_at: null, error_message: null, updated_at: new Date().toISOString() }).eq("users_id", usersId).in("apify_import_jobs_id", ids);
        if (releaseError) throw new Error(releaseError.message);
      }
      return jsonResponse({ success: true, jobId: -1, runId: "recovery", datasetId: null, status: "succeeded", imported: false, items: null, totalItems: ids.length });
    }

    const jobId = Number(body.jobId ?? body.apify_import_jobs_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return jsonResponse({ error: "Job inválido." }, 400);

    const { data: job, error: jobError } = await admin
      .from("apify_import_jobs")
      .select(`apify_import_jobs_id, users_id, apify_accounts_id, external_run_id, external_dataset_id, status, imported_at, error_message`)
      .eq("apify_import_jobs_id", jobId)
      .eq("users_id", usersId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return jsonResponse({ error: "Job não encontrado." }, 404);

    const runId = String(job.external_run_id ?? "").trim();
    const { data: secretRows, error: secretError } = await admin.rpc("service_get_apify_account_secret", {
      p_users_id: usersId,
      p_apify_accounts_id: Number(job.apify_accounts_id),
    });
    if (secretError) throw new Error(secretError.message);
    const secretRow = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const token = String(secretRow?.token_secret ?? "").trim();
    if (!runId) return jsonResponse({ error: "O job não possui runId." }, 409);
    if (!token) return jsonResponse({ error: "A conta Apify não possui token." }, 409);

    if (action === "finalize" || action === "release") {
      const claimToken = String(body.claimToken ?? "").trim();
      const claimedAt = String(body.claimedAt ?? "").trim();
      if (!claimToken || !claimedAt) return jsonResponse({ error: "Claim de importação ausente." }, 400);
      const expectedMarker = claimMarker(claimToken);
      if (job.error_message !== expectedMarker || !job.imported_at) {
        return jsonResponse({ error: "O claim de importação não pertence a esta operação ou já foi finalizado." }, 409);
      }

      if (action === "release") {
        const reason = String(body.reason ?? "").trim();
        const { data: released, error } = await admin.from("apify_import_jobs").update({
          imported_at: null,
          error_message: reason ? `Importação liberada após falha: ${reason.slice(0, 500)}` : null,
          updated_at: new Date().toISOString(),
        }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId).eq("error_message", expectedMarker).eq("imported_at", claimedAt).select("apify_import_jobs_id");
        if (error) throw new Error(error.message);
        if (!released?.length) return jsonResponse({ error: "O claim mudou antes de ser liberado." }, 409);
        return jsonResponse({ success: true, jobId, runId, datasetId: job.external_dataset_id ?? null, status: normalizeRunStatus(job.status), imported: false, items: null });
      }

      const processed = safeCount(body.processed);
      const imported = safeCount(body.imported);
      const duplicates = safeCount(body.duplicates);
      const rejected = safeCount(body.rejected);
      if (imported + duplicates + rejected > processed) return jsonResponse({ error: "Totais da importação são inconsistentes." }, 400);
      const now = new Date().toISOString();
      const { data: finalized, error } = await admin.from("apify_import_jobs").update({
        total_received: processed,
        total_imported: imported,
        total_duplicates: duplicates,
        total_rejected: rejected,
        imported_at: now,
        error_message: null,
        updated_at: now,
      }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId).eq("error_message", expectedMarker).eq("imported_at", claimedAt).select("apify_import_jobs_id");
      if (error) throw new Error(error.message);
      if (!finalized?.length) return jsonResponse({ error: "O claim mudou antes da finalização." }, 409);
      return jsonResponse({ success: true, jobId, runId, datasetId: job.external_dataset_id ?? null, status: "succeeded", imported: true, items: null });
    }

    if (action === "abort") {
      if (["succeeded", "failed", "aborted", "timed_out"].includes(String(job.status))) {
        return jsonResponse({ error: "Este job já está finalizado e não pode ser cancelado." }, 409);
      }
      const response = await fetchWithTimeout(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      }, 20000);
      const payload = await response.json().catch(() => null) as Record<string, any> | null;
      if (!response.ok) throw new Error(String(payload?.error?.message ?? `A Apify retornou HTTP ${response.status}.`));
      const now = new Date().toISOString();
      const { error } = await admin.from("apify_import_jobs").update({ status: "aborted", apify_job_status_id: JOB_STATUS.CANCELED, finished_at: now, updated_at: now }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId);
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true, jobId, runId, datasetId: job.external_dataset_id ?? null, status: "aborted", imported: Boolean(job.imported_at), items: null });
    }

    const runResponse = await fetchWithTimeout(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }, 20000);
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
      error_message: status === "failed" ? String(run?.statusMessage ?? "Falha na execução da Apify.") : (String(job.error_message ?? "").startsWith("import_claim:") ? job.error_message : null),
      updated_at: now,
    }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId);
    if (updateError) throw new Error(updateError.message);

    if (status !== "succeeded") return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: Boolean(job.imported_at), items: null });
    if (!datasetId) return jsonResponse({ error: "Execução concluída sem datasetId." }, 502);

    if (action === "status") return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: Boolean(job.imported_at), items: null });

    if (action === "claim") {
      if (job.imported_at) return jsonResponse({ error: "Este dataset já está em processamento ou foi importado." }, 409);
      const claimToken = crypto.randomUUID();
      const claimedAt = new Date().toISOString();
      const marker = claimMarker(claimToken);
      const { data: claimed, error: claimError } = await admin.from("apify_import_jobs").update({ imported_at: claimedAt, error_message: marker, updated_at: claimedAt })
        .eq("apify_import_jobs_id", jobId).eq("users_id", usersId).eq("status", "succeeded").is("imported_at", null).select("apify_import_jobs_id");
      if (claimError) throw new Error(claimError.message);
      if (!claimed?.length) return jsonResponse({ error: "Outro processo já assumiu a importação deste dataset." }, 409);

      try {
        const datasetResponse = await fetchWithTimeout(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        }, 45000);
        const items = await datasetResponse.json().catch(() => null);
        if (!datasetResponse.ok || !Array.isArray(items)) throw new Error(`Não foi possível carregar o dataset da Apify (HTTP ${datasetResponse.status}).`);
        await admin.from("apify_import_jobs").update({ total_received: items.length, updated_at: new Date().toISOString() }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId).eq("error_message", marker);
        return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: false, items, totalItems: items.length, claimToken, claimedAt });
      } catch (error) {
        await admin.from("apify_import_jobs").update({ imported_at: null, error_message: messageOf(error), updated_at: new Date().toISOString() }).eq("apify_import_jobs_id", jobId).eq("users_id", usersId).eq("error_message", marker);
        throw error;
      }
    }

    const previewLimit = Math.min(100, Math.max(1, safeCount(body.previewLimit) || 100));
    const datasetResponse = await fetchWithTimeout(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${previewLimit}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }, 30000);
    const items = await datasetResponse.json().catch(() => null);
    if (!datasetResponse.ok || !Array.isArray(items)) throw new Error(`Não foi possível carregar a prévia do dataset da Apify (HTTP ${datasetResponse.status}).`);
    return jsonResponse({ success: true, jobId, runId, datasetId, status, imported: Boolean(job.imported_at), items, totalItems: Number(run?.stats?.datasetItemCount ?? items.length), previewTruncated: items.length >= previewLimit });
  } catch (error) {
    console.error("ERRO APIFY GOOGLE MAPS SYNC:", error);
    const message = error instanceof DOMException && error.name === "AbortError" ? "Tempo limite ao consultar a Apify." : messageOf(error);
    return jsonResponse({ error: message }, 500);
  }
});
