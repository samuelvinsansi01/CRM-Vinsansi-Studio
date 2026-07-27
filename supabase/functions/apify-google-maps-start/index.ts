import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APIFY_ACTOR_ID = "compass~google-maps-extractor";
const ACTOR_DATABASE_NAME = "compass/google-maps-extractor";

const JOB_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  PENDING: 3,
  PROCESSING: 4,
  COMPLETED: 5,
  ERROR: 6,
  CANCELED: 7,
  PAUSED: 8,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Erro desconhecido.";
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        error: "Método não permitido.",
      },
      405,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SB_PUBLISHABLE_KEY");

  const serviceRoleKey = Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  let adminClient: ReturnType<typeof createClient> | null =
    null;

  let jobId: number | null = null;

  try {
    console.log("1. Requisição recebida");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Variáveis obrigatórias ausentes", {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasAnonKey: Boolean(anonKey),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      });

      return jsonResponse(
        {
          error:
            "Configuração interna do Supabase ausente na Edge Function.",
        },
        500,
      );
    }

    const authorization = request.headers.get(
      "Authorization",
    );

    if (!authorization) {
      return jsonResponse(
        {
          error: "Sessão não encontrada.",
        },
        401,
      );
    }

    const authClient = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    /*
     * 1. Valida o usuário autenticado
     */
    const {
      data: authData,
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !authData.user) {
      console.error("Erro de autenticação", authError);

      return jsonResponse(
        {
          error: "Sessão inválida ou expirada.",
        },
        401,
      );
    }

    console.log("2. Usuário autenticado", {
      authUserId: authData.user.id,
    });

    /*
     * 2. Lê o corpo da requisição
     */
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonResponse(
        {
          error: "Corpo da requisição inválido.",
        },
        400,
      );
    }

    const apifyAccountId = Number(
      body.apifyAccountId ??
        body.apify_account_id ??
        body.apifyAccountsId ??
        body.apify_accounts_id,
    );

    const rawSearchTerms = Array.isArray(body.searchTerms)
      ? body.searchTerms
      : Array.isArray(body.search_terms)
        ? body.search_terms
        : [
            body.search ??
              body.searchQuery ??
              body.search_query ??
              "",
          ];

    const searchTerms = rawSearchTerms
      .map((term: unknown) =>
        String(term ?? "").trim()
      )
      .filter(
        (term: string) => term.length > 0,
      );

    const locationQuery = String(
      body.locationQuery ??
        body.location_query ??
        body.location ??
        "",
    ).trim();

    const requestedLimit = Number(
      body.maxCrawledPlacesPerSearch ??
        body.requestedLimit ??
        body.requested_limit ??
        body.limit ??
        50,
    );

    const limit = Math.min(
      500,
      Math.max(
        1,
        Number.isFinite(requestedLimit)
          ? Math.floor(requestedLimit)
          : 50,
      ),
    );

    console.log("3. Parâmetros recebidos", {
      apifyAccountId,
      searchTerms,
      locationQuery,
      limit,
    });

    if (
      !Number.isInteger(apifyAccountId) ||
      apifyAccountId <= 0
    ) {
      return jsonResponse(
        {
          error:
            "Selecione manualmente uma conta Apify.",
        },
        400,
      );
    }

    if (searchTerms.length === 0) {
      return jsonResponse(
        {
          error:
            "Informe ao menos um termo de busca.",
        },
        400,
      );
    }

    if (!locationQuery) {
      return jsonResponse(
        {
          error:
            "Informe a localização da busca.",
        },
        400,
      );
    }

    /*
     * 3. Resolve o usuário interno
     */
    const {
      data: internalUser,
      error: internalUserError,
    } = await adminClient
      .from("users")
      .select("users_id")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (internalUserError) {
      console.error(
        "Erro ao localizar usuário interno",
        internalUserError,
      );

      return jsonResponse(
        {
          error:
            internalUserError.message ||
            "Não foi possível localizar o usuário interno.",
          details:
            internalUserError.details ?? null,
          hint: internalUserError.hint ?? null,
          code: internalUserError.code ?? null,
        },
        500,
      );
    }

    if (!internalUser?.users_id) {
      return jsonResponse(
        {
          error:
            "Usuário interno não encontrado.",
        },
        403,
      );
    }

    const usersId = Number(
      internalUser.users_id,
    );

    console.log("4. Usuário interno resolvido", {
      usersId,
    });

    /*
     * 4. Busca a conta Apify escolhida
     */
    const {
      data: account,
      error: accountError,
    } = await adminClient
      .from("apify_accounts")
      .select(`
        apify_accounts_id,
        users_id,
        account_name,
        token_secret,
        is_active
      `)
      .eq(
        "apify_accounts_id",
        apifyAccountId,
      )
      .eq("users_id", usersId)
      .maybeSingle();

    if (accountError) {
      console.error(
        "Erro ao consultar conta Apify",
        accountError,
      );

      return jsonResponse(
        {
          error:
            accountError.message ||
            "Não foi possível consultar a conta Apify.",
          details: accountError.details ?? null,
          hint: accountError.hint ?? null,
          code: accountError.code ?? null,
        },
        500,
      );
    }

    if (!account) {
      return jsonResponse(
        {
          error:
            "A conta Apify selecionada não existe ou não pertence ao usuário.",
        },
        404,
      );
    }

    if (!account.is_active) {
      return jsonResponse(
        {
          error:
            "A conta Apify selecionada está desativada.",
        },
        400,
      );
    }

    const apifyToken = String(
      account.token_secret ?? "",
    ).trim();

    if (!apifyToken) {
      return jsonResponse(
        {
          error:
            "A conta selecionada não possui token Apify.",
        },
        400,
      );
    }

    console.log("5. Conta Apify validada", {
      accountId: account.apify_accounts_id,
      accountName: account.account_name,
    });

    /*
     * 5. Cria o job como pendente/iniciando
     */
    const startedAt = new Date().toISOString();
    const branchId = Number(body.branchId ?? body.branches_id);
    const branchName = String(body.branchName ?? body.branch_name ?? searchTerms[0] ?? "").trim();

    const {
      data: job,
      error: jobError,
    } = await adminClient
      .from("apify_import_jobs")
      .insert({
        users_id: usersId,

        apify_accounts_id:
          account.apify_accounts_id,

        apify_job_status_id:
          JOB_STATUS.PENDING,

        actor_id: ACTOR_DATABASE_NAME,

        search_query:
          searchTerms.join(" | "),

        search_terms: searchTerms,

        location_query: locationQuery,

        branches_id: Number.isInteger(branchId) && branchId > 0 ? branchId : null,

        branch_name: branchName || null,

        requested_limit: limit,

        status: "starting",

        started_at: startedAt,

        updated_at: startedAt,
      })
      .select("apify_import_jobs_id")
      .single();

    if (jobError || !job) {
      console.error(
        "Erro ao criar job",
        jobError,
      );

      return jsonResponse(
        {
          error:
            jobError?.message ||
            "Não foi possível registrar a execução da Apify.",
          details: jobError?.details ?? null,
          hint: jobError?.hint ?? null,
          code: jobError?.code ?? null,
        },
        500,
      );
    }

    jobId = Number(
      job.apify_import_jobs_id,
    );

    console.log("6. Job criado", {
      jobId,
      apifyJobStatusId:
        JOB_STATUS.PENDING,
      status: "starting",
    });

    /*
     * 6. Atualiza para processando/running
     *
     * A constraint aceita:
     * starting
     * ready
     * running
     * succeeded
     * failed
     * aborted
     * timed_out
     */
    const processingAt =
      new Date().toISOString();

    const {
      error: processingJobError,
    } = await adminClient
      .from("apify_import_jobs")
      .update({
        apify_job_status_id:
          JOB_STATUS.PROCESSING,

        status: "running",

        updated_at: processingAt,
      })
      .eq(
        "apify_import_jobs_id",
        jobId,
      );

    if (processingJobError) {
      console.error(
        "Erro ao atualizar job para running",
        processingJobError,
      );

      throw new Error(
        processingJobError.message ||
          "Não foi possível atualizar o job para running.",
      );
    }

    console.log(
      "7. Job atualizado para running",
      {
        jobId,
        apifyJobStatusId:
          JOB_STATUS.PROCESSING,
        status: "running",
      },
    );

    /*
     * 7. Payload do Google Maps Extractor
     */
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

      scrapeSocialMediaProfiles: {
        facebooks: false,
        instagrams: false,
        tiktoks: false,
        twitters: false,
        youtubes: false,
      },

      scrapeTableReservationProvider: false,

      searchStringsArray: searchTerms,

      skipClosedPlaces: false,

      verifyLeadsEnrichmentEmails: false,
    };

    /*
     * 8. Chama a Apify
     *
     * Não existe consulta à tabela app_settings.
     */
    const apifyUrl =
      `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs` +
      `?token=${encodeURIComponent(apifyToken)}`;

    console.log(
      "8. Iniciando execução na Apify",
      {
        actorId: APIFY_ACTOR_ID,
        searchTerms,
        locationQuery,
        limit,
      },
    );

    console.log(
      "Payload enviado para Apify:",
      JSON.stringify(actorInput, null, 2),
    );

    const apifyResponse = await fetch(
      apifyUrl,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(actorInput),
      },
    );

    const responseText =
      await apifyResponse.text();

    let apifyPayload:
      | Record<string, any>
      | null = null;

    if (responseText) {
      try {
        apifyPayload =
          JSON.parse(responseText);
      } catch {
        apifyPayload = {
          rawResponse: responseText,
        };
      }
    }

    /*
     * 9. Trata erro da Apify
     */
    if (!apifyResponse.ok) {
      const apifyErrorMessage = String(
        apifyPayload?.error?.message ??
          apifyPayload?.message ??
          apifyPayload?.rawResponse ??
          `A Apify retornou HTTP ${apifyResponse.status}.`,
      );

      console.error(
        "Erro retornado pela Apify",
        {
          status: apifyResponse.status,
          message: apifyErrorMessage,
          payload: apifyPayload,
        },
      );

      const failedAt =
        new Date().toISOString();

      await adminClient
        .from("apify_import_jobs")
        .update({
          apify_job_status_id:
            JOB_STATUS.ERROR,

          status: "failed",

          error_message:
            apifyErrorMessage,

          finished_at: failedAt,

          updated_at: failedAt,
        })
        .eq(
          "apify_import_jobs_id",
          jobId,
        );

      await adminClient
        .from("apify_accounts")
        .update({
          connection_status:
            apifyResponse.status === 401 ||
            apifyResponse.status === 403
              ? "error"
              : "not_verified",

          last_error:
            apifyErrorMessage,

          last_checked_at:
            failedAt,

          updated_at: failedAt,
        })
        .eq(
          "apify_accounts_id",
          account.apify_accounts_id,
        );

      return jsonResponse(
        {
          error: apifyErrorMessage,
          apifyStatus:
            apifyResponse.status,
          jobId,
        },
        apifyResponse.status === 401 ||
          apifyResponse.status === 403
          ? 401
          : 502,
      );
    }

    const run = apifyPayload?.data;

    if (!run?.id) {
      const message =
        "A Apify respondeu, mas não retornou o ID da execução.";

      console.error(message, {
        response: apifyPayload,
      });

      const failedAt =
        new Date().toISOString();

      await adminClient
        .from("apify_import_jobs")
        .update({
          apify_job_status_id:
            JOB_STATUS.ERROR,

          status: "failed",

          error_message: message,

          finished_at: failedAt,

          updated_at: failedAt,
        })
        .eq(
          "apify_import_jobs_id",
          jobId,
        );

      return jsonResponse(
        {
          error: message,
          jobId,
        },
        502,
      );
    }

    /*
     * 10. Normaliza status retornado pela Apify
     */
    const rawRunStatus = String(
      run.status ?? "RUNNING",
    ).toUpperCase();

    const allowedStatuses = new Set([
      "starting",
      "ready",
      "running",
      "succeeded",
      "failed",
      "aborted",
      "timed_out",
    ]);

    const normalizedRunStatus =
      rawRunStatus === "SUCCEEDED"
        ? "succeeded"
        : rawRunStatus === "FAILED"
          ? "failed"
          : rawRunStatus === "ABORTED"
            ? "aborted"
            : rawRunStatus === "TIMED-OUT" ||
                rawRunStatus === "TIMED_OUT"
              ? "timed_out"
              : rawRunStatus === "READY"
                ? "ready"
                : rawRunStatus === "RUNNING"
                  ? "running"
                  : rawRunStatus === "STARTING"
                    ? "starting"
                    : "running";

    const safeRunStatus =
      allowedStatuses.has(
        normalizedRunStatus,
      )
        ? normalizedRunStatus
        : "running";

    let numericJobStatus:
      | number
      | null =
      JOB_STATUS.PROCESSING;

    if (safeRunStatus === "succeeded") {
      numericJobStatus =
        JOB_STATUS.COMPLETED;
    } else if (
      safeRunStatus === "failed" ||
      safeRunStatus === "timed_out"
    ) {
      numericJobStatus =
        JOB_STATUS.ERROR;
    } else if (
      safeRunStatus === "aborted"
    ) {
      numericJobStatus =
        JOB_STATUS.CANCELED;
    } else if (
      safeRunStatus === "starting" ||
      safeRunStatus === "ready"
    ) {
      numericJobStatus =
        JOB_STATUS.PENDING;
    }

    const updatedAt =
      new Date().toISOString();

    const jobUpdate: Record<
      string,
      unknown
    > = {
      apify_job_status_id:
        numericJobStatus,

      external_run_id: run.id,

      external_dataset_id:
        run.defaultDatasetId ?? null,

      status: safeRunStatus,

      updated_at: updatedAt,
    };

    if (
      safeRunStatus === "succeeded" ||
      safeRunStatus === "failed" ||
      safeRunStatus === "aborted" ||
      safeRunStatus === "timed_out"
    ) {
      jobUpdate.finished_at =
        updatedAt;
    }

    const {
      error: updateJobError,
    } = await adminClient
      .from("apify_import_jobs")
      .update(jobUpdate)
      .eq(
        "apify_import_jobs_id",
        jobId,
      );

    if (updateJobError) {
      console.error(
        "Execução iniciada, mas houve erro ao atualizar o job",
        updateJobError,
      );

      return jsonResponse(
        {
          error:
            "A coleta foi iniciada na Apify, mas o CRM não conseguiu atualizar o histórico.",

          details:
            updateJobError.message,

          hint:
            updateJobError.hint ?? null,

          code:
            updateJobError.code ?? null,

          runId: run.id,

          datasetId:
            run.defaultDatasetId ?? null,

          jobId,
        },
        500,
      );
    }

    /*
     * 11. Atualiza dados da conta Apify
     */
    const {
      error: accountUpdateError,
    } = await adminClient
      .from("apify_accounts")
      .update({
        connection_status:
          "connected",

        last_checked_at:
          updatedAt,

        last_used_at:
          updatedAt,

        last_error: null,

        updated_at: updatedAt,
      })
      .eq(
        "apify_accounts_id",
        account.apify_accounts_id,
      );

    if (accountUpdateError) {
      console.error(
        "Erro não bloqueante ao atualizar conta Apify",
        accountUpdateError,
      );
    }

    console.log(
      "9. Execução iniciada com sucesso",
      {
        jobId,
        runId: run.id,
        datasetId:
          run.defaultDatasetId ?? null,
        status: safeRunStatus,
        apifyJobStatusId:
          numericJobStatus,
      },
    );

    return jsonResponse(
      {
        success: true,

        message:
          "Coleta iniciada com sucesso.",

        jobId,

        runId: run.id,

        datasetId:
          run.defaultDatasetId ?? null,

        status: safeRunStatus,

        apifyJobStatusId:
          numericJobStatus,

        accountName:
          account.account_name,

        account: {
          id:
            account.apify_accounts_id,

          name:
            account.account_name,
        },
      },
      200,
    );
  } catch (error) {
    const message =
      getErrorMessage(error);

    console.error(
      "ERRO APIFY GOOGLE MAPS START:",
      error,
    );

    /*
     * Registra o job como erro
     */
    if (jobId && adminClient) {
      const failedAt =
        new Date().toISOString();

      try {
        const {
          error: failedJobError,
        } = await adminClient
          .from("apify_import_jobs")
          .update({
            apify_job_status_id:
              JOB_STATUS.ERROR,

            status: "failed",

            error_message: message,

            finished_at: failedAt,

            updated_at: failedAt,
          })
          .eq(
            "apify_import_jobs_id",
            jobId,
          );

        if (failedJobError) {
          console.error(
            "Erro ao registrar falha no job",
            failedJobError,
          );
        }
      } catch (updateError) {
        console.error(
          "Erro inesperado ao registrar falha no job",
          updateError,
        );
      }
    }

    return jsonResponse(
      {
        error: message,
        jobId,
      },
      500,
    );
  }
});