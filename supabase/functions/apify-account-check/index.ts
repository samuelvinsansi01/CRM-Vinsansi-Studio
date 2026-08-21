import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Erro desconhecido.";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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

  try {
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const accountId = Number(body?.apifyAccountId ?? body?.apify_accounts_id);
    if (!Number.isInteger(accountId) || accountId <= 0) return jsonResponse({ error: "Conta Apify inválida." }, 400);

    const { data: organizationContext, error: contextError } = await admin.rpc("resolve_organization_context_for_auth_user", { p_auth_user_id: authData.user.id, p_organization_id: Number(request.headers.get("x-vinsansi-organization-id") ?? 0) || null });
    if (contextError) throw new Error(contextError.message);
    const usersId = Number(organizationContext?.scopeUsersId ?? 0);
    if (!usersId) return jsonResponse({ error: "Contexto da organização não encontrado." }, 403);
    const organizationId = Number(organizationContext?.organizationId ?? 0);
    if (!organizationId) return jsonResponse({ error: "Organização inválida." }, 403);
    const { data: allowed, error: permissionError } = await admin.rpc("auth_user_has_organization_permission", {
      p_auth_user_id: authData.user.id,
      p_organization_id: organizationId,
      p_permission_key: "settings.manage",
    });
    if (permissionError) throw new Error(permissionError.message);
    if (!allowed) return jsonResponse({ error: "Sem permissão para esta ação." }, 403);

    const { data: account, error: accountError } = await admin
      .from("apify_accounts")
      .select("apify_accounts_id")
      .eq("apify_accounts_id", accountId)
      .eq("users_id", usersId)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (!account) return jsonResponse({ error: "Conta Apify não encontrada." }, 404);

    const { data: secretRows, error: secretError } = await admin.rpc("service_get_apify_account_secret", {
      p_users_id: Number(usersId),
      p_apify_accounts_id: accountId,
    });
    if (secretError) throw new Error(secretError.message);
    const secretRow = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const token = String(secretRow?.token_secret ?? "").trim();
    if (!token) return jsonResponse({ error: "A conta não possui token Apify." }, 409);

    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchWithTimeout("https://api.apify.com/v2/users/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null) as Record<string, any> | null;
      if (!response.ok) {
        const message = String(payload?.error?.message ?? `A Apify retornou HTTP ${response.status}.`);
        await admin.from("apify_accounts").update({
          connection_status: "error",
          last_checked_at: checkedAt,
          last_error: message,
          updated_at: checkedAt,
        }).eq("apify_accounts_id", accountId).eq("users_id", usersId);
        return jsonResponse({ error: message }, response.status === 401 || response.status === 403 ? 401 : 502);
      }

      const user = payload?.data ?? {};
      const username = String(user.username ?? user.name ?? "").trim();
      const plan = String(user.plan?.id ?? user.plan?.name ?? user.plan ?? "").trim();
      const { error: updateError } = await admin.from("apify_accounts").update({
        connection_status: "connected",
        external_username: username || null,
        last_checked_at: checkedAt,
        last_error: null,
        updated_at: checkedAt,
      }).eq("apify_accounts_id", accountId).eq("users_id", usersId);
      if (updateError) throw new Error(updateError.message);

      return jsonResponse({ accountId, connected: true, username, plan, checkedAt });
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError" ? "Tempo limite ao conectar com a Apify." : messageOf(error);
      await admin.from("apify_accounts").update({
        connection_status: "error",
        last_checked_at: checkedAt,
        last_error: message,
        updated_at: checkedAt,
      }).eq("apify_accounts_id", accountId).eq("users_id", usersId);
      return jsonResponse({ error: message }, 502);
    }
  } catch (error) {
    console.error("ERRO APIFY ACCOUNT CHECK:", error);
    return jsonResponse({ error: messageOf(error) }, 500);
  }
});
