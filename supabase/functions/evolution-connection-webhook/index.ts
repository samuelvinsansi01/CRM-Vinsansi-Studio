import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = Record<string, unknown>;

const ACTIVE_STATES = new Set(["open", "opened", "connected", "connectado", "conectado", "online", "ready"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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

function connectionState(payload: Row) {
  const data = payload.data as Row | undefined;
  const instance = payload.instance as Row | undefined;
  const dataInstance = data?.instance as Row | undefined;
  return normalized(
    data?.state ??
      dataInstance?.state ??
      instance?.state ??
      payload.state ??
      payload.connection ??
      payload.status,
  );
}

function payloadInstanceName(payload: Row) {
  const data = payload.data as Row | undefined;
  const instance = payload.instance;
  if (typeof instance === "string") return text(instance);
  const instanceRecord = instance as Row | undefined;
  const dataInstance = data?.instance;
  if (typeof dataInstance === "string") return text(dataInstance);
  const dataInstanceRecord = dataInstance as Row | undefined;
  return text(
    payload.instanceName ??
      data?.instanceName ??
      instanceRecord?.instanceName ??
      instanceRecord?.name ??
      dataInstanceRecord?.instanceName ??
      dataInstanceRecord?.name,
  );
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

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) return jsonResponse({ error: "Webhook não configurado." }, 503);

  const url = new URL(request.url);
  const instanceId = Number(url.searchParams.get("instance_id") ?? request.headers.get("x-evolution-instance-id") ?? 0);
  const receivedToken = text(url.searchParams.get("token"));
  if (!Number.isSafeInteger(instanceId) || instanceId <= 0 || !receivedToken) return jsonResponse({ error: "Identificação do webhook inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: instanceRow, error: instanceError } = await admin
    .from("instances")
    .select("instances_id,users_id,status_id,instances_name")
    .eq("instances_id", instanceId)
    .maybeSingle();
  if (instanceError) return jsonResponse({ error: instanceError.message }, 500);
  if (!instanceRow) return jsonResponse({ error: "Instância não encontrada." }, 404);

  const expectedToken = await hmacToken(webhookSecret, `${instanceId}:${text(instanceRow.instances_name)}`);
  if (!timingSafeEqual(receivedToken, expectedToken)) return jsonResponse({ error: "Assinatura inválida." }, 401);

  const payload = await request.json().catch(() => null) as Row | null;
  if (!payload) return jsonResponse({ error: "Payload inválido." }, 400);

  const event = normalized(payload.event ?? payload.type ?? payload.eventType);
  if (event && !["connection_update", "connection"].includes(event)) {
    return jsonResponse({ ok: true, ignored: true, event }, 202);
  }

  const receivedName = payloadInstanceName(payload);
  if (receivedName && receivedName !== text(instanceRow.instances_name)) {
    return jsonResponse({ error: "O nome da instância não corresponde ao webhook configurado." }, 409);
  }

  const state = connectionState(payload);
  if (!state) return jsonResponse({ error: "Estado de conexão ausente." }, 422);

  const active = ACTIVE_STATES.has(state);
  const nextStatus = active ? 1 : 2;
  const changed = Number(instanceRow.status_id) !== nextStatus;

  if (changed) {
    const { error: updateError } = await admin
      .from("instances")
      .update({ status_id: nextStatus, instances_updated_at: new Date().toISOString() })
      .eq("instances_id", instanceId)
      .eq("users_id", instanceRow.users_id);
    if (updateError) return jsonResponse({ error: updateError.message }, 500);
  }

  return jsonResponse({ ok: true, instanceId, instanceName: instanceRow.instances_name, state, active, changed });
});
