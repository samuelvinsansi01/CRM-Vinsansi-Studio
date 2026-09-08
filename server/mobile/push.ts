import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type PushDevice = { id: number; memberId: number; token: string };

type InboundPushInput = {
  instanceId: number;
  externalMessageId: string;
};

const text = (value: unknown) => String(value ?? '').trim();
const integer = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function env(...names: string[]) {
  for (const name of names) {
    const value = text(process.env[name]);
    if (value) return value;
  }
  return '';
}

function serviceClient() {
  const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validExpoPushToken(value: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(value);
}

async function findInboundMessage(admin: SupabaseClient, instanceId: number, externalMessageId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await admin.from('conversation_messages')
      .select('conversation_messages_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,remote_jid,message_type,message_body,external_message_id,direction,mobile_push_sent_at')
      .eq('instances_id', instanceId)
      .eq('external_message_id', externalMessageId)
      .eq('direction', 'inbound')
      .maybeSingle();
    if (!result.error && result.data) return result.data as Row;
    if (result.error && String(result.error.code || '') !== 'PGRST116') throw new Error(`mobile_push_message_lookup_failed:${result.error.message}`);
    if (attempt < 2) await delay(120 * (attempt + 1));
  }
  return null;
}

async function allowedDevices(admin: SupabaseClient, organizationId: number): Promise<PushDevice[]> {
  const result = await admin.from('mobile_push_devices')
    .select('mobile_push_devices_id,organization_members_id,expo_push_token')
    .eq('organizations_id', organizationId)
    .eq('enabled', true);

  if (result.error) {
    const code = text(result.error.code);
    if (code === '42P01' || /mobile_push_devices/i.test(result.error.message) && /does not exist/i.test(result.error.message)) return [];
    throw new Error(`mobile_push_devices_lookup_failed:${result.error.message}`);
  }

  const rows = (Array.isArray(result.data) ? result.data : []) as Row[];
  const permissionCache = new Map<number, boolean>();
  const devices: PushDevice[] = [];

  for (const row of rows) {
    const memberId = integer(row.organization_members_id);
    const token = text(row.expo_push_token);
    const id = integer(row.mobile_push_devices_id);
    if (!memberId || !id || !validExpoPushToken(token)) continue;

    if (!permissionCache.has(memberId)) {
      const permission = await admin.rpc('stage5_member_has_permission', {
        p_organizations_id: organizationId,
        p_organization_members_id: memberId,
        p_permission: 'whatsapp.view',
      });
      permissionCache.set(memberId, !permission.error && permission.data === true);
    }
    if (permissionCache.get(memberId)) devices.push({ id, memberId, token });
  }

  return devices;
}

async function disableInvalidTokens(admin: SupabaseClient, tokens: string[]) {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (!unique.length) return;
  try {
    await admin.from('mobile_push_devices').update({
      enabled: false,
      disabled_at: new Date().toISOString(),
      last_error: 'DeviceNotRegistered',
      updated_at: new Date().toISOString(),
    }).in('expo_push_token', unique);
  } catch { /* best effort */ }
}

async function claimMessagePush(admin: SupabaseClient, messageId: number) {
  const claimedAt = new Date().toISOString();
  const result = await admin.from('conversation_messages')
    .update({ mobile_push_sent_at: claimedAt })
    .eq('conversation_messages_id', messageId)
    .is('mobile_push_sent_at', null)
    .select('conversation_messages_id')
    .maybeSingle();
  if (result.error) throw new Error(`mobile_push_claim_failed:${result.error.message}`);
  return result.data ? claimedAt : '';
}

async function releaseMessagePushClaim(admin: SupabaseClient, messageId: number, claimedAt: string) {
  if (!claimedAt) return;
  try {
    await admin.from('conversation_messages')
      .update({ mobile_push_sent_at: null })
      .eq('conversation_messages_id', messageId)
      .eq('mobile_push_sent_at', claimedAt);
  } catch { /* best effort: permite retry futuro se Expo falhar */ }
}

async function expoSend(admin: SupabaseClient, devices: PushDevice[], payload: Row) {
  if (!devices.length) return { sent: 0, disabled: 0 };
  const messages = devices.map((device) => ({ to: device.token, ...payload }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const accessToken = env('EXPO_ACCESS_TOKEN');
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`expo_push_http_${response.status}:${raw.slice(0, 300)}`);
    let parsed: unknown = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
    const root = record(parsed);
    const tickets = Array.isArray(root.data) ? root.data.map(record) : [record(root.data)].filter((item) => Object.keys(item).length);
    const invalid: string[] = [];
    tickets.forEach((ticket, index) => {
      const details = record(ticket.details);
      if (text(ticket.status) === 'error' && text(details.error) === 'DeviceNotRegistered') {
        const token = devices[index]?.token;
        if (token) invalid.push(token);
      }
    });
    await disableInvalidTokens(admin, invalid);
    return { sent: devices.length, disabled: invalid.length };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyInboundWhatsappMessage(input: InboundPushInput) {
  const admin = serviceClient();
  if (!admin) return { skipped: true, reason: 'supabase_service_role_unconfigured' };
  if (!Number.isSafeInteger(input.instanceId) || input.instanceId <= 0 || !text(input.externalMessageId)) return { skipped: true, reason: 'invalid_input' };

  const message = await findInboundMessage(admin, input.instanceId, text(input.externalMessageId));
  if (!message) return { skipped: true, reason: 'message_not_found' };

  const organizationId = integer(message.organizations_id);
  const conversationId = integer(message.conversations_id);
  const chipId = integer(message.chips_id);
  if (!organizationId || !conversationId || !chipId) return { skipped: true, reason: 'message_scope_incomplete' };

  const [conversationResult, chipResult] = await Promise.all([
    admin.from('conversations')
      .select('conversations_id,instances_id,leads_id,remote_jid,contact_phone,contact_name,conversation_version')
      .eq('organizations_id', organizationId)
      .eq('conversations_id', conversationId)
      .maybeSingle(),
    admin.from('chips')
      .select('chips_id,chips_name,chips_phone')
      .eq('organizations_id', organizationId)
      .eq('chips_id', chipId)
      .maybeSingle(),
  ]);
  if (conversationResult.error || !conversationResult.data) throw new Error(`mobile_push_conversation_lookup_failed:${conversationResult.error?.message || 'not_found'}`);
  if (chipResult.error || !chipResult.data) throw new Error(`mobile_push_chip_lookup_failed:${chipResult.error?.message || 'not_found'}`);

  const conversation = conversationResult.data as Row;
  const chip = chipResult.data as Row;
  const devices = await allowedDevices(admin, organizationId);
  if (!devices.length) return { skipped: true, reason: 'no_registered_devices' };

  const messageId = integer(message.conversation_messages_id);
  if (!messageId) return { skipped: true, reason: 'message_id_missing' };
  const claimedAt = await claimMessagePush(admin, messageId);
  if (!claimedAt) return { skipped: true, reason: 'already_notified' };

  const contactName = text(conversation.contact_name) || text(conversation.contact_phone) || 'Nova mensagem';
  const messageBody = text(message.message_body);
  const messageType = text(message.message_type) || 'text';
  const body = messageBody ? messageBody.slice(0, 180) : messageType === 'text' ? 'Nova mensagem recebida.' : `Nova mensagem (${messageType}).`;

  let result: { sent: number; disabled: number };
  try {
    result = await expoSend(admin, devices, {
    title: contactName,
    body,
    sound: 'default',
    channelId: 'mensagens',
    priority: 'high',
    data: {
      chipId,
      conversationId,
      instanceId: integer(conversation.instances_id) || input.instanceId,
      leadId: integer(conversation.leads_id) || null,
      remoteJid: text(conversation.remote_jid) || text(message.remote_jid),
      phone: text(conversation.contact_phone),
      contactName,
      conversationVersion: Math.max(1, integer(conversation.conversation_version)),
      chipName: text(chip.chips_name) || 'WhatsApp',
      chipPhone: text(chip.chips_phone),
    },
    });
  } catch (error) {
    await releaseMessagePushClaim(admin, messageId, claimedAt);
    throw error;
  }

  return { skipped: false, ...result };
}
