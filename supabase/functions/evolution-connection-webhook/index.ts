import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = Record<string, unknown>;

const ACTIVE_STATES = new Set(["open", "opened", "connected", "connectado", "conectado", "online", "ready"]);
const MESSAGE_EVENTS = new Set(["messages_upsert", "send_message"]);
const STATUS_EVENTS = new Set(["messages_update", "messages_delete"]);
const CHAT_EVENTS = new Set(["chats_upsert", "chats_update", "contacts_upsert", "contacts_update"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function row(value: unknown): Row {
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

function booleanOf(value: unknown) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "sim"].includes(normalized(value));
}

function numberOf(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventRows(payload: Row) {
  const data = payload.data;
  if (Array.isArray(data)) return data.map(row).filter((item) => Object.keys(item).length);
  if (data && typeof data === "object") return [row(data)];
  return [payload];
}

function connectionState(payload: Row) {
  const data = row(payload.data);
  const instance = row(payload.instance);
  const dataInstance = row(data.instance);
  return normalized(
    data.state ?? dataInstance.state ?? instance.state ?? payload.state ?? payload.connection ?? payload.status,
  );
}

function payloadInstanceName(payload: Row) {
  const data = row(payload.data);
  const instanceValue = payload.instance;
  const dataInstanceValue = data.instance;
  const instance = row(instanceValue);
  const dataInstance = row(dataInstanceValue);
  return text(
    payload.instanceName ?? data.instanceName ??
      (typeof instanceValue === "string" ? instanceValue : instance.instanceName ?? instance.name) ??
      (typeof dataInstanceValue === "string" ? dataInstanceValue : dataInstance.instanceName ?? dataInstance.name),
  );
}

function messageKey(item: Row) {
  const message = row(item.message);
  return row(item.key ?? message.key ?? row(item.data).key);
}

function messagePayload(item: Row) {
  const candidate = item.message;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return row(candidate);
  const dataMessage = row(item.data).message;
  return row(dataMessage);
}

function externalMessageId(item: Row) {
  const key = messageKey(item);
  return text(key.id ?? item.messageId ?? item.message_id ?? item.id ?? row(item.update).id);
}

function remoteJid(item: Row) {
  const key = messageKey(item);
  const chat = row(item.chat);
  const primary = text(key.remoteJid ?? key.remote_jid ?? item.remoteJid ?? item.remote_jid ?? item.jid ?? item.id ?? chat.remoteJid ?? chat.id);
  const alternate = text(key.remoteJidAlt ?? key.remote_jid_alt ?? item.remoteJidAlt ?? item.remote_jid_alt ?? chat.remoteJidAlt);
  const isPhoneJid = (value: string) => /@(s\.whatsapp\.net|c\.us)$/i.test(value);
  return isPhoneJid(primary) ? primary : isPhoneJid(alternate) ? alternate : primary || alternate;
}

function messageFromMe(item: Row) {
  const key = messageKey(item);
  return booleanOf(key.fromMe ?? key.from_me ?? item.fromMe ?? item.from_me);
}

function messageType(item: Row) {
  const message = messagePayload(item);
  const explicit = text(item.messageType ?? item.message_type ?? item.type);
  if (explicit && !["messages_upsert", "send_message"].includes(normalized(explicit))) return normalized(explicit);
  const keys = Object.keys(message).filter((key) => !["messageContextInfo", "senderKeyDistributionMessage"].includes(key));
  return normalized(keys[0] ?? "text").replace(/_message$/, "") || "text";
}

function messageBody(item: Row) {
  const message = messagePayload(item);
  const extended = row(message.extendedTextMessage);
  const image = row(message.imageMessage);
  const video = row(message.videoMessage);
  const document = row(message.documentMessage);
  const buttons = row(message.buttonsResponseMessage);
  const list = row(message.listResponseMessage);
  const template = row(message.templateButtonReplyMessage);
  return text(
    (typeof message.conversation === "string" ? message.conversation : "") ||
      extended.text || image.caption || video.caption || document.caption || document.fileName ||
      buttons.selectedDisplayText || buttons.selectedButtonId ||
      row(list.singleSelectReply).selectedRowId || template.selectedDisplayText || template.selectedId ||
      item.text || item.body || item.messageText || item.caption,
  );
}

function mediaMetadata(item: Row) {
  const message = messagePayload(item);
  const candidates = [
    row(message.imageMessage), row(message.videoMessage), row(message.documentMessage),
    row(message.audioMessage), row(message.stickerMessage), row(item.media),
  ];
  const source = candidates.find((candidate) => Object.keys(candidate).length) ?? {};
  return {
    url: text(source.url ?? source.mediaUrl ?? source.media_url ?? item.mediaUrl ?? item.media_url),
    mimeType: text(source.mimetype ?? source.mimeType ?? source.mime_type ?? item.mimetype),
    fileName: text(source.fileName ?? source.filename ?? source.file_name ?? item.fileName),
  };
}

function quotedMessageId(item: Row) {
  const message = messagePayload(item);
  const contexts = [
    row(row(message.extendedTextMessage).contextInfo), row(row(message.imageMessage).contextInfo),
    row(row(message.videoMessage).contextInfo), row(row(message.documentMessage).contextInfo),
    row(item.contextInfo),
  ];
  const context = contexts.find((candidate) => Object.keys(candidate).length) ?? {};
  return text(context.stanzaId ?? context.stanzaID ?? context.quotedMessageId ?? item.quotedMessageId);
}

function contactName(item: Row) {
  const contact = row(item.contact);
  return text(item.pushName ?? item.notifyName ?? item.verifiedBizName ?? item.name ?? item.contactName ?? contact.pushName ?? contact.name);
}

function contactAvatar(item: Row) {
  const contact = row(item.contact);
  return text(item.profilePicUrl ?? item.profilePictureUrl ?? item.avatarUrl ?? contact.profilePicUrl ?? contact.avatarUrl);
}

function unreadCount(item: Row) {
  const count = numberOf(item.unreadCount ?? item.unreadMessages ?? item.unread);
  return count === null ? null : Math.max(0, Math.trunc(count));
}

function providerTimestamp(item: Row) {
  const raw = item.messageTimestamp ?? item.timestamp ?? item.time ?? item.date ?? row(item.update).messageTimestamp;
  if (typeof raw === "number" || /^\d+(?:\.\d+)?$/.test(text(raw))) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(text(raw));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function mappedMessageStatus(value: unknown, fallback: string) {
  const numeric = numberOf(value);
  if (numeric !== null) {
    if (numeric <= 0) return "failed";
    if (numeric <= 2) return "sent";
    if (numeric === 3) return "delivered";
    if (numeric >= 4) return "read";
  }
  const status = normalized(value);
  if (["error", "failed", "failure"].includes(status)) return "failed";
  if (["pending", "queued"].includes(status)) return "pending";
  if (["server_ack", "sent", "send", "played"].includes(status)) return status === "played" ? "read" : "sent";
  if (["delivery_ack", "delivered", "delivery"].includes(status)) return "delivered";
  if (["read", "read_ack"].includes(status)) return "read";
  if (["deleted", "delete", "revoked"].includes(status)) return "deleted";
  return fallback;
}

function statusFromItem(item: Row, event: string, fromMe: boolean) {
  if (event === "messages_delete") return "deleted";
  const update = row(item.update);
  return mappedMessageStatus(update.status ?? item.status ?? item.messageStatus ?? item.message_status, fromMe ? "sent" : "delivered");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  if (webhookSecret.length < 32) return jsonResponse({ error: "EVOLUTION_WEBHOOK_SECRET deve ter no mínimo 32 caracteres." }, 503);

  const url = new URL(request.url);
  const instanceId = Number(url.searchParams.get("instance_id") ?? request.headers.get("x-evolution-instance-id") ?? 0);
  const receivedToken = text(request.headers.get("x-evolution-signature") ?? url.searchParams.get("token"));
  if (!Number.isSafeInteger(instanceId) || instanceId <= 0 || !receivedToken) return jsonResponse({ error: "Identificação do webhook inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: instanceRow, error: instanceError } = await admin
    .from("instances")
    .select("instances_id,users_id,status_id,instances_name")
    .eq("instances_id", instanceId)
    .maybeSingle();
  if (instanceError) return jsonResponse({ error: instanceError.message }, 500);
  if (!instanceRow) return jsonResponse({ error: "Instância não encontrada." }, 404);

  const expectedToken = await hmacToken(webhookSecret, `${instanceId}:${text(instanceRow.instances_name)}`);
  if (!timingSafeEqual(receivedToken, expectedToken)) return jsonResponse({ error: "Assinatura inválida." }, 401);

  const rawBody = await request.text();
  let payload: Row;
  try { payload = JSON.parse(rawBody) as Row; }
  catch { return jsonResponse({ error: "Payload inválido." }, 400); }

  const receivedName = payloadInstanceName(payload);
  if (receivedName && receivedName !== text(instanceRow.instances_name)) {
    return jsonResponse({ error: "O nome da instância não corresponde ao webhook configurado." }, 409);
  }

  const event = normalized(payload.event ?? payload.type ?? payload.eventType);
  if (!event) return jsonResponse({ error: "Evento ausente." }, 422);
  const payloadHash = await sha256(rawBody);
  let receiptId = 0;
  const receiptInsert = await admin.from("evolution_webhook_receipts").insert({
    users_id: Number(instanceRow.users_id),
    instances_id: instanceId,
    event_type: event,
    external_event_id: text(payload.id ?? payload.eventId) || null,
    payload_hash: payloadHash,
    raw_payload: payload,
    processing_status: "received",
  }).select("evolution_webhook_receipts_id,processing_status").maybeSingle();

  if (receiptInsert.error) {
    if (receiptInsert.error.code !== "23505") return jsonResponse({ error: receiptInsert.error.message }, 500);
    const existing = await admin.from("evolution_webhook_receipts")
      .select("evolution_webhook_receipts_id,processing_status")
      .eq("instances_id", instanceId).eq("event_type", event).eq("payload_hash", payloadHash).maybeSingle();
    if (existing.error || !existing.data) return jsonResponse({ error: existing.error?.message ?? "Recibo duplicado não localizado." }, 500);
    receiptId = Number(existing.data.evolution_webhook_receipts_id);
    if (["processed", "ignored"].includes(text(existing.data.processing_status))) {
      return jsonResponse({ ok: true, duplicate: true, event, receiptId });
    }
    await admin.from("evolution_webhook_receipts").update({ processing_status: "received", error_message: null, processed_at: null }).eq("evolution_webhook_receipts_id", receiptId);
  } else {
    receiptId = Number(receiptInsert.data?.evolution_webhook_receipts_id ?? 0);
  }

  try {
    let processed = 0;
    let ignored = 0;

    if (["connection_update", "connection"].includes(event)) {
      const state = connectionState(payload);
      if (!state) throw new Error("Estado de conexão ausente.");
      const active = ACTIVE_STATES.has(state);
      const nextStatus = active ? 1 : 2;
      const changed = Number(instanceRow.status_id) !== nextStatus;
      if (changed) {
        const { error } = await admin.from("instances").update({ status_id: nextStatus, instances_updated_at: new Date().toISOString() })
          .eq("instances_id", instanceId).eq("users_id", instanceRow.users_id);
        if (error) throw new Error(error.message);
      }
      processed = 1;
    } else if (MESSAGE_EVENTS.has(event)) {
      for (const item of eventRows(payload)) {
        const externalId = externalMessageId(item);
        const jid = remoteJid(item);
        if (!externalId || !jid) { ignored += 1; continue; }
        const fromMe = event === "send_message" ? true : messageFromMe(item);
        const media = mediaMetadata(item);
        const { data, error } = await admin.rpc("service_ingest_evolution_message", {
          p_instances_id: instanceId,
          p_event_type: event,
          p_external_message_id: externalId,
          p_remote_jid: jid,
          p_from_me: fromMe,
          p_message_type: messageType(item),
          p_message_body: messageBody(item) || null,
          p_message_status: statusFromItem(item, event, fromMe),
          p_contact_name: contactName(item) || null,
          p_provider_timestamp: providerTimestamp(item),
          p_raw_payload: item,
          p_media_url: media.url || null,
          p_media_mime_type: media.mimeType || null,
          p_media_file_name: media.fileName || null,
          p_quoted_external_message_id: quotedMessageId(item) || null,
        });
        if (error) throw new Error(error.message);
        if (row(data).ignored) ignored += 1; else processed += 1;
      }
    } else if (STATUS_EVENTS.has(event)) {
      for (const item of eventRows(payload)) {
        const externalId = externalMessageId(item);
        if (!externalId) { ignored += 1; continue; }
        const { data, error } = await admin.rpc("service_update_evolution_message_status", {
          p_instances_id: instanceId,
          p_external_message_id: externalId,
          p_message_status: statusFromItem(item, event, messageFromMe(item)),
          p_event_type: event,
          p_raw_payload: item,
          p_provider_timestamp: providerTimestamp(item),
        });
        if (error) throw new Error(error.message);
        if (row(data).updated) processed += 1; else ignored += 1;
      }
    } else if (CHAT_EVENTS.has(event)) {
      for (const item of eventRows(payload)) {
        const jid = remoteJid(item);
        if (!jid) { ignored += 1; continue; }
        const { data, error } = await admin.rpc("service_upsert_evolution_chat", {
          p_instances_id: instanceId,
          p_remote_jid: jid,
          p_contact_name: contactName(item) || null,
          p_contact_avatar_url: contactAvatar(item) || null,
          p_unread_count: unreadCount(item),
        });
        if (error) throw new Error(error.message);
        if (data) processed += 1; else ignored += 1;
      }
    } else {
      ignored = 1;
    }

    await admin.from("evolution_webhook_receipts").update({
      processing_status: processed > 0 ? "processed" : "ignored",
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("evolution_webhook_receipts_id", receiptId);

    return jsonResponse({ ok: true, event, receiptId, processed, ignored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar webhook.";
    await admin.from("evolution_webhook_receipts").update({
      processing_status: "error", error_message: message, processed_at: new Date().toISOString(),
    }).eq("evolution_webhook_receipts_id", receiptId);
    return jsonResponse({ ok: false, event, receiptId, error: message }, 500);
  }
});
