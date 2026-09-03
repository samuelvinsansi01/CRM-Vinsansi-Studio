import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = Record<string, unknown>;

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
    payload.operationalState ?? payload.operational_state ?? data.operationalState ?? data.operational_state ??
      data.state ?? dataInstance.state ?? instance.state ?? payload.state ?? payload.connection ?? payload.status,
  );
}

function connectionRuntimeSnapshot(payload: Row, current: Row = {}) {
  const data = row(payload.data);
  const state = connectionState(payload);
  const connectedRaw = payload.connected ?? data.connected ?? data.Connected;
  const loggedInRaw = payload.loggedIn ?? payload.logged_in ?? data.loggedIn ?? data.logged_in ?? data.LoggedIn;
  const sessionRaw = payload.sessionSaved ?? payload.session_saved ?? data.sessionSaved ?? data.session_saved;
  const socketRaw = payload.socketConnected ?? payload.socket_connected ?? data.socketConnected ?? data.socket_connected;
  const explicitSession = typeof sessionRaw === 'boolean' ? sessionRaw : null;
  const explicitSocket = typeof socketRaw === 'boolean' ? socketRaw : null;
  const connected = typeof connectedRaw === 'boolean' ? connectedRaw : false;
  const loggedIn = typeof loggedInRaw === 'boolean' ? loggedInRaw : false;
  const jid = text(
    payload.jid ?? payload.JID ?? payload.Jid ?? data.jid ?? data.JID ?? data.Jid ??
      current.jid,
  );
  const stateOnline = ['open','opened','connected','connectado','conectado','online','ready'].includes(state);
  const stateSaved = ['session_saved','session_save','session','session_linked','linked'].includes(state);
  const stateReconnecting = ['reconnecting','reconnect','connecting','restoring','recovering'].includes(state);
  const socketConnected = explicitSocket ?? ((connected && loggedIn) || stateOnline);

  // Um CONNECTION_UPDATE de socket fechado não prova que a sessão foi apagada.
  // Sem sinal explícito de logout, preservamos a sessão/JID conhecido até o próximo
  // polling autoritativo do Gateway 1.2.0 (/status + /instance/all).
  const explicitLogout = ['logged_out','logout','unpaired','removed','deleted','session_removed'].includes(state);
  const sessionSaved = explicitLogout
    ? false
    : explicitSession ?? (socketConnected || loggedIn || Boolean(jid) || stateSaved || stateReconnecting || current.session_saved === true);
  const operationalState = socketConnected
    ? 'online'
    : sessionSaved
      ? (stateReconnecting ? 'reconnecting' : 'session_saved')
      : 'disconnected';

  return { state: state || (socketConnected ? 'open' : sessionSaved ? 'session_saved' : 'close'), connected, loggedIn, sessionSaved, socketConnected, jid, operationalState };
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

function evolutionInfo(item: Row) {
  const data = row(item.data);
  return row(item.Info ?? item.info ?? data.Info ?? data.info);
}

function messageKey(item: Row) {
  const message = row(item.message ?? item.Message);
  return row(item.key ?? message.key ?? row(item.data).key);
}

function messagePayload(item: Row) {
  const candidate = item.message ?? item.Message;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return row(candidate);
  const data = row(item.data);
  return row(data.message ?? data.Message);
}

function externalMessageId(item: Row) {
  const key = messageKey(item);
  const info = evolutionInfo(item);
  return text(key.id ?? key.ID ?? info.ID ?? info.Id ?? info.id ?? item.messageId ?? item.message_id ?? item.id ?? row(item.update).id);
}

function remoteJid(item: Row) {
  const key = messageKey(item);
  const chat = row(item.chat);
  const info = evolutionInfo(item);
  const candidates = [
    key.remoteJidAlt,key.remote_jid_alt,item.remoteJidAlt,item.remote_jid_alt,chat.remoteJidAlt,
    info.ChatAlt,info.chatAlt,info.SenderAlt,info.senderAlt,
    key.remoteJid,key.remote_jid,item.remoteJid,item.remote_jid,item.jid,chat.remoteJid,chat.id,
    info.Chat,info.chat,info.Sender,info.sender,item.id,
  ].map(text).filter(Boolean);
  const phone = candidates.find((value) => /@(s\.whatsapp\.net|c\.us)$/i.test(value));
  if (phone) return `${phone.split("@")[0].replace(/\D/g, "")}@s.whatsapp.net`;
  return candidates[0] ?? "";
}

function messageFromMe(item: Row) {
  const key = messageKey(item);
  const info = evolutionInfo(item);
  return booleanOf(key.fromMe ?? key.from_me ?? item.fromMe ?? item.from_me ?? info.IsFromMe ?? info.isFromMe);
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
      extended.text || image.caption || video.caption || document.caption ||
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
    base64: text(source.base64 ?? source.data ?? item.base64 ?? row(item.media).base64),
  };
}

function payloadWithoutMediaBytes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(payloadWithoutMediaBytes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Row).map(([key,item]) =>
    /^(base64|mediaData|fileData)$/i.test(key) ? [key,"[archived]"] : [key,payloadWithoutMediaBytes(item)]
  ));
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
  const info = evolutionInfo(item);
  const value = text(item.pushName ?? item.notifyName ?? item.verifiedBizName ?? item.name ?? item.contactName ?? contact.pushName ?? contact.name ?? info.PushName ?? info.pushName);
  return /[\p{L}\p{N}]/u.test(value) ? value : "";
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
  const info = evolutionInfo(item);
  const raw = item.messageTimestamp ?? item.timestamp ?? item.time ?? item.date ?? row(item.update).messageTimestamp ?? info.Timestamp ?? info.timestamp;
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


async function sendMobilePush(admin: any, organizationId: number, conversationId: number, messageId: number, preview: string) {
  const conversationResult = await admin.from("conversations")
    .select("conversations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,contact_name,assigned_to_member_id,conversation_version")
    .eq("organizations_id", organizationId).eq("conversations_id", conversationId).maybeSingle();
  if (conversationResult.error || !conversationResult.data) return;
  const conversation = row(conversationResult.data);
  const chipResult = await admin.from("chips").select("chips_name,chips_phone").eq("organizations_id", organizationId).eq("chips_id", Number(conversation.chips_id)).maybeSingle();
  const chip = row(chipResult.data);
  let devicesQuery = admin.from("mobile_push_devices").select("mobile_push_devices_id,expo_push_token").eq("organizations_id", organizationId).eq("enabled", true);
  const assignedMemberId = Number(conversation.assigned_to_member_id || 0);
  if (assignedMemberId > 0) devicesQuery = devicesQuery.eq("organization_members_id", assignedMemberId);
  const devicesResult = await devicesQuery.limit(200);
  if (devicesResult.error || !devicesResult.data?.length) return;
  const contact = text(conversation.contact_name) || text(conversation.contact_phone) || "Nova mensagem";
  const chipName = text(chip.chips_name) || "WhatsApp";
  const body = text(preview).slice(0, 180);
  const messages = devicesResult.data.map((device: Row) => ({
    to: text(device.expo_push_token),
    sound: "default",
    channelId: "mensagens",
    title: `${contact} · ${chipName}`,
    body,
    data: {
      organizationId, conversationId, messageId,
      chipId: Number(conversation.chips_id), instanceId: Number(conversation.instances_id), leadId: Number(conversation.leads_id || 0) || null,
      remoteJid: text(conversation.remote_jid), phone: text(conversation.contact_phone), contactName: contact,
      conversationVersion: Number(conversation.conversation_version || 1), chipName, chipPhone: text(chip.chips_phone),
    },
    priority: "high",
  })).filter((message: Row) => text(message.to));
  if (!messages.length) return;
  const invalidIds: number[] = [];
  for (let offset = 0; offset < messages.length; offset += 100) {
    const chunk = messages.slice(offset, offset + 100);
    let response = await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(chunk) });
    if ((response.status === 429 || response.status >= 500) && response.status <= 599) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      response = await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(chunk) });
    }
    if (!response.ok) continue;
    const payload = row(await response.json().catch(() => ({})));
    const tickets = Array.isArray(payload.data) ? payload.data.map(row) : [];
    const devices = devicesResult.data.slice(offset, offset + 100);
    devices.forEach((device: Row, index: number) => {
      const ticket = tickets[index] || {};
      if (text(row(ticket.details).error) === "DeviceNotRegistered") invalidIds.push(Number(device.mobile_push_devices_id));
    });
  }
  const validInvalidIds = invalidIds.filter(Number.isSafeInteger);
  if (validInvalidIds.length) await admin.from("mobile_push_devices").update({ enabled: false, updated_at: new Date().toISOString() }).in("mobile_push_devices_id", validInvalidIds);
}

function whatsappPhoneVariants(value: unknown) {
  let digits = text(value).split("@")[0].replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  const variants = new Set<string>();
  if (digits) variants.add(digits);
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") variants.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
  if (digits.startsWith("55") && digits.length === 12) variants.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  return variants;
}

// Marcador invisível exclusivo do Worker de aquecimento. Ele não é persistido:
// o webhook testa a mensagem antes de criar recibo/conversa/mensagem.
const INTERNAL_CHIP_WARMUP_MARKER = "\u2063\u200B\u200C\u2063";

async function isInternalOwnedChipTraffic(admin: ReturnType<typeof createClient>, instanceRow: Row, event: string, payload: Row) {
  // FIX45: dois chips pertencerem à mesma organização NÃO basta para descartar a
  // mensagem. Tráfego normal entre chips próprios precisa continuar aparecendo em
  // Conversas. Só descartamos mensagens produzidas pelo Worker de aquecimento.
  if (!MESSAGE_EVENTS.includes(event)) return false;
  const organizationId = Number(instanceRow.organizations_id ?? 0);
  const instanceId = Number(instanceRow.instances_id ?? 0);
  if (!organizationId || !instanceId) return false;

  const rows = eventRows(payload);
  if (!rows.some((item) => messageBody(item).includes(INTERNAL_CHIP_WARMUP_MARKER))) return false;

  const current = await admin.from("chips")
    .select("chips_id,chips_phone")
    .eq("organizations_id", organizationId)
    .eq("instances_id", instanceId)
    .maybeSingle();
  if (current.error) throw new Error(`internal_chip_current_lookup_failed:${current.error.message}`);
  if (!current.data) return false;

  const peers = await admin.from("chips")
    .select("chips_id,chips_phone,instances_id")
    .eq("organizations_id", organizationId)
    .neq("instances_id", instanceId);
  if (peers.error) throw new Error(`internal_chip_peer_lookup_failed:${peers.error.message}`);
  const peerVariants = new Set<string>();
  for (const peer of peers.data ?? []) for (const variant of whatsappPhoneVariants(peer.chips_phone)) peerVariants.add(variant);
  if (!peerVariants.size) return false;

  const markedRows = rows.filter((item) => messageBody(item).includes(INTERNAL_CHIP_WARMUP_MARKER));
  if (!markedRows.length) return false;
  const contactRows = markedRows.map((item) => remoteJid(item)).filter(Boolean);
  if (!contactRows.length) return false;
  return contactRows.every((jid) => [...whatsappPhoneVariants(jid)].some((variant) => peerVariants.has(variant)));
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
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Webhook não configurado." }, 503);

  const url = new URL(request.url);
  const instanceId = Number(url.searchParams.get("instance_id") ?? request.headers.get("x-evolution-instance-id") ?? 0);
  const receivedToken = text(request.headers.get("x-evolution-signature") ?? url.searchParams.get("token"));
  if (!Number.isSafeInteger(instanceId) || instanceId <= 0 || !receivedToken) return jsonResponse({ error: "Identificação do webhook inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: instanceRow, error: instanceError } = await admin
    .from("instances")
    .select("instances_id,users_id,organizations_id,status_id,instances_name")
    .eq("instances_id", instanceId)
    .maybeSingle();
  if (instanceError) return jsonResponse({ error: instanceError.message }, 500);
  if (!instanceRow) return jsonResponse({ error: "Instância não encontrada." }, 404);

  const credentialResult = await admin.rpc("service_get_evolution_instances", {
    p_users_id: Number(instanceRow.users_id),
    p_instances_id: instanceId,
    p_instance_name: null,
  });
  if (credentialResult.error) return jsonResponse({ error: credentialResult.error.message }, 500);
  const credentialRows = Array.isArray(credentialResult.data) ? credentialResult.data : [credentialResult.data];
  const instanceApiKey = text(row(credentialRows[0]).api_key);
  if (!instanceApiKey) return jsonResponse({ error: "Credencial da instância indisponível." }, 503);
  const expectedToken = await hmacToken(instanceApiKey, `${instanceId}:${text(instanceRow.instances_name)}`);
  if (!timingSafeEqual(receivedToken, expectedToken)) return jsonResponse({ error: "Assinatura inválida." }, 401);

  const rawBody = await request.text();
  let payload: Row;
  try { payload = JSON.parse(rawBody) as Row; }
  catch { return jsonResponse({ error: "Payload inválido." }, 400); }

  const receivedName = payloadInstanceName(payload);
  if (receivedName && receivedName !== text(instanceRow.instances_name)) {
    return jsonResponse({ error: "O nome da instância não corresponde ao webhook configurado." }, 409);
  }

  const rawEvent = normalized(payload.event ?? payload.type ?? payload.eventType);
  const event = rawEvent === "message" ? "messages_upsert" : rawEvent === "sendmessage" ? "send_message" : rawEvent;
  if (!event) return jsonResponse({ error: "Evento ausente." }, 422);

  // Somente mensagens marcadas pelo Worker de aquecimento e trocadas entre chips
  // próprios são descartadas. Mensagens normais entre chips da organização seguem
  // o pipeline canônico e aparecem em Conversas.
  if (await isInternalOwnedChipTraffic(admin, row(instanceRow), event, payload)) {
    return jsonResponse({ ok: true, event, ignored: true, reason: "internal_owned_chip_traffic", persisted: false });
  }

  const payloadHash = await sha256(rawBody);
  let receiptId = 0;
  const receiptInsert = await admin.from("evolution_webhook_receipts").insert({
    users_id: Number(instanceRow.users_id),
    organizations_id: Number(instanceRow.organizations_id),
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
      const currentResult = await admin.from("instance_runtime_states")
        .select("session_saved,jid")
        .eq("instances_id", instanceId)
        .eq("organizations_id", instanceRow.organizations_id)
        .maybeSingle();
      if (currentResult.error) throw new Error(currentResult.error.message);
      const runtime = connectionRuntimeSnapshot(payload, row(currentResult.data));
      const checkedAt = new Date().toISOString();
      const { error } = await admin.from("instance_runtime_states").upsert({
        instances_id: instanceId,
        users_id: Number(instanceRow.users_id),
        organizations_id: Number(instanceRow.organizations_id),
        provider: "evolution-go",
        operational_state: runtime.operationalState,
        session_saved: runtime.sessionSaved,
        socket_connected: runtime.socketConnected,
        connected: runtime.connected,
        logged_in: runtime.loggedIn,
        jid: runtime.jid || null,
        provider_state: runtime.state || null,
        last_error: null,
        source: "webhook",
        checked_at: checkedAt,
        instance_runtime_states_updated_at: checkedAt,
      }, { onConflict: "instances_id" });
      if (error) throw new Error(error.message);
      processed = 1;
    } else if (MESSAGE_EVENTS.has(event)) {
      for (const item of eventRows(payload)) {
        const externalId = externalMessageId(item);
        const jid = remoteJid(item);
        if (!externalId || !jid) { ignored += 1; continue; }
        const fromMe = event === "send_message" ? true : messageFromMe(item);
        const detectedType = messageType(item);
        const bodyText = messageBody(item);
        if (!bodyText) { ignored += 1; continue; }
        const media = mediaMetadata(item);
        const hadMedia = Boolean(media.base64 || media.url || media.mimeType || media.fileName) || !["text","conversation","extendedtext","extended_text"].includes(detectedType);
        const rawPayload = hadMedia ? { textOnly: true, originalMessageType: detectedType } : payloadWithoutMediaBytes(item);
        const { data, error } = await admin.rpc("service_ingest_evolution_message", {
          p_instances_id: instanceId,
          p_event_type: event,
          p_external_message_id: externalId,
          p_remote_jid: jid,
          p_from_me: fromMe,
          p_message_type: "text",
          p_message_body: bodyText,
          p_message_status: statusFromItem(item, event, fromMe),
          p_contact_name: contactName(item) || null,
          p_provider_timestamp: providerTimestamp(item),
          p_raw_payload: rawPayload,
          p_media_url: null,
          p_media_mime_type: null,
          p_media_file_name: null,
          p_quoted_external_message_id: quotedMessageId(item) || null,
        });
        if (error) throw new Error(error.message);
        const result = row(data);
        if (result.ignored) ignored += 1; else {
          processed += 1;
          if (!fromMe && result.merged !== true) {
            await sendMobilePush(admin, Number(instanceRow.organizations_id), Number(result.conversationId), Number(result.messageId), bodyText).catch(() => undefined);
          }
        }
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
