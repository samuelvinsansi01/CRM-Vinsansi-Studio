import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTIVE_STATES = new Set(["open", "opened", "connected", "connectado", "conectado", "online", "ready"]);

type Row = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_.\s-]+/g, "_");
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Erro desconhecido.";
}

function connectionState(payload: Row | null) {
  const instance = payload?.instance as Row | undefined;
  const data = payload?.data as Row | undefined;
  const dataInstance = data?.instance as Row | undefined;
  return normalized(
    instance?.state ??
      dataInstance?.state ??
      data?.state ??
      payload?.state ??
      payload?.connection ??
      payload?.status,
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function hmacToken(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isManagedWebhookUrl(existingValue: string, expectedValue: string) {
  try {
    const existing = new URL(existingValue);
    const expected = new URL(expectedValue);
    return existing.origin === expected.origin
      && existing.pathname === expected.pathname
      && existing.searchParams.get("instance_id") === expected.searchParams.get("instance_id");
  } catch {
    return false;
  }
}

async function configureConnectionWebhook(
  row: Row,
  supabaseUrl: string,
  webhookSecret: string,
) {
  const instanceId = Number(row.instances_id);
  const instanceName = text(row.instances_name);
  const baseUrl = text(row.instances_url).replace(/\/$/, "");
  const apiKey = text(row.api_key);
  if (!instanceId || !instanceName || !baseUrl || !apiKey) throw new Error("Credenciais da instância incompletas.");

  const token = await hmacToken(webhookSecret, `${instanceId}:${instanceName}`);
  const webhookUrl = new URL(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/evolution-connection-webhook`);
  webhookUrl.searchParams.set("instance_id", String(instanceId));

  let existingEvents: string[] = [];
  const findResponse = await fetchWithTimeout(`${baseUrl}/webhook/find/${encodeURIComponent(instanceName)}`, {
    method: "GET",
    headers: { Accept: "application/json", apikey: apiKey },
  }).catch(() => null);
  if (findResponse?.ok) {
    const existing = await findResponse.json().catch(() => null) as Row | null;
    const existingUrl = text(existing?.url);
    const existingEnabled = existing?.enabled !== false;
    if (existingEnabled && existingUrl && !isManagedWebhookUrl(existingUrl, webhookUrl.toString())) {
      throw new Error("A instância já possui outro webhook configurado; ele não foi substituído automaticamente.");
    }
    existingEvents = Array.isArray(existing?.events) ? existing.events.map((event) => text(event)).filter(Boolean) : [];
  }

  const managedEvents = [
    "CONNECTION_UPDATE",
    "MESSAGES_UPSERT",
    "MESSAGES_UPDATE",
    "MESSAGES_DELETE",
    "SEND_MESSAGE",
    "CHATS_UPSERT",
    "CHATS_UPDATE",
    "CONTACTS_UPSERT",
    "CONTACTS_UPDATE",
  ];
  const events = Array.from(new Set([...existingEvents, ...managedEvents]));
  const response = await fetchWithTimeout(`${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      enabled: true,
      url: webhookUrl.toString(),
      events,
      headers: {
        "x-evolution-instance-id": String(instanceId),
        "x-evolution-signature": token,
      },
      base64: false,
    }),
  });
  const raw = await response.text();
  let payload: Row | null = null;
  try { payload = raw ? JSON.parse(raw) as Row : null; } catch { payload = null; }
  if (!response.ok) {
    throw new Error(text(payload?.message ?? payload?.error ?? raw ?? `Evolution HTTP ${response.status}`));
  }
  return true;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") ?? "";
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração interna do Supabase ausente." }, 500);
  if (webhookSecret && webhookSecret.length < 32) return jsonResponse({ error: "EVOLUTION_WEBHOOK_SECRET deve ter no mínimo 32 caracteres." }, 500);
  if (!authorization) return jsonResponse({ error: "Sessão não encontrada." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    const { data: internalUser, error: userError } = await admin
      .from("users")
      .select("users_id")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!internalUser?.users_id) return jsonResponse({ error: "Usuário interno não encontrado." }, 403);

    const body = await request.json().catch(() => ({})) as Row;
    const requestedId = Number(body.instanceId ?? body.instances_id ?? 0);
    const configureWebhook = body.configureWebhook !== false;

    const { data: rows, error: rowsError } = await admin.rpc("service_get_evolution_instances", {
      p_users_id: Number(internalUser.users_id),
      p_instances_id: requestedId > 0 ? requestedId : null,
      p_instance_name: null,
    });
    if (rowsError) throw new Error(rowsError.message);

    const checkedAt = new Date().toISOString();
    const results: Row[] = [];

    for (const row of (rows ?? []) as Row[]) {
      const instanceId = Number(row.instances_id);
      const instanceName = text(row.instances_name);
      const baseUrl = text(row.instances_url).replace(/\/$/, "");
      const apiKey = text(row.api_key);
      const previousStatus = Number(row.status_id);
      let state = "unavailable";
      let active = false;
      let errorMessage = "";
      let webhookConfigured = false;
      let webhookError = "";

      try {
        if (!instanceName || !baseUrl || !apiKey) throw new Error("Nome, URL ou API key ausente.");
        const response = await fetchWithTimeout(`${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
          method: "GET",
          headers: { Accept: "application/json", apikey: apiKey },
        });
        const raw = await response.text();
        let payload: Row | null = null;
        try { payload = raw ? JSON.parse(raw) as Row : null; } catch { payload = null; }
        if (!response.ok) throw new Error(text(payload?.message ?? payload?.error ?? raw ?? `Evolution HTTP ${response.status}`));
        state = connectionState(payload);
        if (!state) throw new Error("A Evolution não retornou o estado da conexão.");
        active = ACTIVE_STATES.has(state);
      } catch (error) {
        active = false;
        errorMessage = error instanceof DOMException && error.name === "AbortError"
          ? "Tempo limite ao consultar a Evolution."
          : messageOf(error);
      }

      const nextStatus = active ? 1 : 2;
      const changed = previousStatus !== nextStatus;
      if (changed) {
        const { error: updateError } = await admin
          .from("instances")
          .update({ status_id: nextStatus, instances_updated_at: checkedAt })
          .eq("instances_id", instanceId)
          .eq("users_id", internalUser.users_id);
        if (updateError) throw new Error(updateError.message);
      }

      if (configureWebhook) {
        if (!webhookSecret) {
          webhookError = "Secret EVOLUTION_WEBHOOK_SECRET não configurado.";
        } else {
          try {
            webhookConfigured = await configureConnectionWebhook(row, supabaseUrl, webhookSecret);
          } catch (error) {
            webhookError = messageOf(error);
          }
        }
      }

      results.push({
        instanceId: String(instanceId),
        instanceName,
        state,
        active,
        changed,
        webhookConfigured,
        ...(errorMessage ? { error: errorMessage } : {}),
        ...(webhookError ? { webhookError } : {}),
      });
    }

    return jsonResponse({
      checkedAt,
      total: results.length,
      active: results.filter((item) => item.active).length,
      inactive: results.filter((item) => !item.active).length,
      changed: results.filter((item) => item.changed).length,
      webhookConfigured: results.filter((item) => item.webhookConfigured).length,
      results,
    });
  } catch (error) {
    console.error("ERRO EVOLUTION INSTANCE SYNC:", error);
    return jsonResponse({ error: messageOf(error) }, 500);
  }
});
