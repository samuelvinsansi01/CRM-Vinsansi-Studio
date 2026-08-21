import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Row = Record<string, unknown>;

type ConnectionSnapshot = {
  state: string;
  operationalState: "online" | "reconnecting" | "session_saved" | "disconnected" | "unavailable";
  connected: boolean;
  loggedIn: boolean;
  sessionSaved: boolean;
  socketConnected: boolean;
  jid: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  const candidate = normalized(value);
  if (["true", "1", "yes", "sim"].includes(candidate)) return true;
  if (["false", "0", "no", "nao"].includes(candidate)) return false;
  return null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Erro desconhecido.";
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function connectionSnapshot(payload: Row | null): ConnectionSnapshot {
  const root = object(payload);
  const data = object(root.data);
  const instance = object(root.instance);
  const dataInstance = object(data.instance);

  const connected = booleanValue(root.connected ?? data.connected ?? data.Connected) ?? false;
  const loggedIn = booleanValue(root.loggedIn ?? root.logged_in ?? data.loggedIn ?? data.logged_in ?? data.LoggedIn) ?? false;
  const explicitSession = booleanValue(root.sessionSaved ?? root.session_saved ?? data.sessionSaved ?? data.session_saved);
  const explicitSocket = booleanValue(root.socketConnected ?? root.socket_connected ?? data.socketConnected ?? data.socket_connected);
  const jid = firstText(
    root.jid, root.JID, root.Jid,
    data.jid, data.JID, data.Jid,
    instance.jid, instance.JID, instance.Jid,
    dataInstance.jid, dataInstance.JID, dataInstance.Jid,
  );
  const providerState = normalized(
    root.operationalState ?? root.operational_state ?? data.operationalState ?? data.operational_state
      ?? instance.state ?? dataInstance.state ?? data.state ?? root.state ?? root.connection ?? root.status,
  );

  const stateSaysOnline = ["open", "opened", "connected", "connectado", "conectado", "online", "ready"].includes(providerState);
  const stateSaysSaved = ["session_saved", "session_save", "session", "session_linked", "linked"].includes(providerState);
  const stateSaysReconnecting = ["reconnecting", "reconnect", "connecting", "restoring", "recovering"].includes(providerState);

  const socketConnected = explicitSocket ?? ((connected && loggedIn) || stateSaysOnline);
  const sessionSaved = explicitSession ?? (socketConnected || loggedIn || Boolean(jid) || stateSaysSaved || stateSaysReconnecting);
  const operationalState: ConnectionSnapshot["operationalState"] = socketConnected
    ? "online"
    : sessionSaved
      ? (stateSaysReconnecting ? "reconnecting" : "session_saved")
      : "disconnected";

  return {
    state: providerState || (socketConnected ? "open" : sessionSaved ? "session_saved" : "close"),
    operationalState,
    connected,
    loggedIn,
    sessionSaved,
    socketConnected,
    jid,
  };
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

async function configureConnectionWebhook(row: Row, supabaseUrl: string, webhookSecret: string) {
  const instanceId = Number(row.instances_id);
  const instanceName = text(row.instances_name);
  const baseUrl = text(row.instances_url).replace(/\/$/, "");
  const apiKey = text(row.api_key);
  if (!instanceId || !instanceName || !baseUrl || !apiKey) throw new Error("Credenciais da instância incompletas.");

  const token = await hmacToken(webhookSecret, `${instanceId}:${instanceName}`);
  const webhookUrl = new URL(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/evolution-connection-webhook`);
  webhookUrl.searchParams.set("instance_id", String(instanceId));

  let existingEvents: string[] = [];
  const findResponse = await fetchWithTimeout(`${baseUrl}/v1/whatsapp/instances/${encodeURIComponent(instanceName)}/webhook`, {
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
  const response = await fetchWithTimeout(`${baseUrl}/v1/whatsapp/instances/${encodeURIComponent(instanceName)}/webhook`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json", apikey: apiKey },
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
  if (!response.ok) throw new Error(text(payload?.message ?? payload?.error ?? raw ?? `Evolution HTTP ${response.status}`));
  return true;
}

async function persistRuntimeState(
  admin: ReturnType<typeof createClient>,
  instanceId: number,
  usersId: number,
  snapshot: ConnectionSnapshot,
  checkedAt: string,
  errorMessage: string,
) {
  let persistedSnapshot = snapshot;
  const operationalState = errorMessage ? "unavailable" : snapshot.operationalState;

  // Falha de rede/Gateway nao prova perda da sessao. Preserve a ultima prova
  // conhecida (JID/session_saved) e altere somente a disponibilidade da leitura.
  if (errorMessage) {
    const { data: previous } = await admin
      .from("instance_runtime_states")
      .select("session_saved,socket_connected,connected,logged_in,jid,provider_state")
      .eq("instances_id", instanceId)
      .eq("users_id", usersId)
      .maybeSingle();
    if (previous) {
      persistedSnapshot = {
        ...snapshot,
        sessionSaved: previous.session_saved === true,
        socketConnected: false,
        connected: false,
        loggedIn: previous.logged_in === true,
        jid: text(previous.jid),
        state: text(previous.provider_state) || snapshot.state,
      };
    }
  }

  const { error } = await admin.from("instance_runtime_states").upsert({
    instances_id: instanceId,
    users_id: usersId,
    provider: "evolution-go",
    operational_state: operationalState,
    session_saved: persistedSnapshot.sessionSaved,
    socket_connected: persistedSnapshot.socketConnected,
    connected: persistedSnapshot.connected,
    logged_in: persistedSnapshot.loggedIn,
    jid: persistedSnapshot.jid || null,
    provider_state: persistedSnapshot.state || null,
    last_error: errorMessage || null,
    source: "poll",
    checked_at: checkedAt,
    instance_runtime_states_updated_at: checkedAt,
  }, { onConflict: "instances_id" });
  if (error) throw new Error(error.message);
  return { operationalState, persistedSnapshot };
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
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

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

    const usersId = Number(internalUser.users_id);
    const body = await request.json().catch(() => ({})) as Row;
    const requestedId = Number(body.instanceId ?? body.instances_id ?? 0);
    const configureWebhook = body.configureWebhook !== false;

    const { data: rows, error: rowsError } = await admin.rpc("service_get_evolution_instances", {
      p_users_id: usersId,
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
      let snapshot: ConnectionSnapshot = {
        state: "unavailable",
        operationalState: "unavailable",
        connected: false,
        loggedIn: false,
        sessionSaved: false,
        socketConnected: false,
        jid: "",
      };
      let errorMessage = "";
      let webhookConfigured = false;
      let webhookError = "";

      try {
        if (!instanceName || !baseUrl || !apiKey) throw new Error("Nome, URL ou API key ausente.");
        const response = await fetchWithTimeout(`${baseUrl}/v1/whatsapp/instances/${encodeURIComponent(instanceName)}/status`, {
          method: "GET",
          headers: { Accept: "application/json", apikey: apiKey },
        });
        const raw = await response.text();
        let payload: Row | null = null;
        try { payload = raw ? JSON.parse(raw) as Row : null; } catch { payload = null; }
        if (!response.ok) throw new Error(text(payload?.message ?? payload?.error ?? raw ?? `Evolution HTTP ${response.status}`));
        snapshot = connectionSnapshot(payload);
      } catch (error) {
        errorMessage = error instanceof DOMException && error.name === "AbortError"
          ? "Tempo limite ao consultar a Evolution."
          : messageOf(error);
      }

      const persisted = await persistRuntimeState(admin, instanceId, usersId, snapshot, checkedAt, errorMessage);
      const operationalState = persisted.operationalState;
      snapshot = persisted.persistedSnapshot;

      if (configureWebhook) {
        if (!webhookSecret) webhookError = "Secret EVOLUTION_WEBHOOK_SECRET não configurado.";
        else {
          try { webhookConfigured = await configureConnectionWebhook(row, supabaseUrl, webhookSecret); }
          catch (error) { webhookError = messageOf(error); }
        }
      }

      results.push({
        instanceId: String(instanceId),
        instanceName,
        state: snapshot.state,
        operationalState,
        active: snapshot.socketConnected,
        online: snapshot.socketConnected,
        connected: snapshot.connected,
        loggedIn: snapshot.loggedIn,
        sessionSaved: snapshot.sessionSaved,
        socketConnected: snapshot.socketConnected,
        ...(snapshot.jid ? { jid: snapshot.jid } : {}),
        changed: false,
        webhookConfigured,
        ...(errorMessage ? { error: errorMessage } : {}),
        ...(webhookError ? { webhookError } : {}),
      });
    }

    return jsonResponse({
      checkedAt,
      total: results.length,
      active: results.filter((item) => item.socketConnected === true).length,
      inactive: results.filter((item) => item.socketConnected !== true).length,
      online: results.filter((item) => item.socketConnected === true).length,
      sessionSaved: results.filter((item) => item.sessionSaved === true && item.socketConnected !== true).length,
      disconnected: results.filter((item) => item.sessionSaved !== true && !item.error).length,
      unavailable: results.filter((item) => Boolean(item.error)).length,
      changed: 0,
      webhookConfigured: results.filter((item) => item.webhookConfigured).length,
      results,
    });
  } catch (error) {
    console.error("ERRO EVOLUTION INSTANCE SYNC:", error);
    return jsonResponse({ error: messageOf(error) }, 500);
  }
});
