import { getSupabaseClient } from '../../lib/supabase';

export type ChatChip = {
  id: string;
  instanceId: string;
  name: string;
  phone: string;
  active: boolean;
  connected: boolean;
  instanceName: string;
};

export type Conversation = {
  id: string;
  chipId: string;
  instanceId: string;
  leadId: string | null;
  remoteJid: string;
  phone: string;
  contactName: string;
  avatarUrl: string;
  status: 'open' | 'archived';
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  externalId: string | null;
  direction: 'inbound' | 'outbound';
  fromMe: boolean;
  type: string;
  body: string;
  mediaUrl: string;
  mediaMimeType: string;
  mediaFileName: string;
  quotedExternalId: string | null;
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'reconciliation_required';
  providerTimestamp: string | null;
  createdAt: string;
  errorMessage: string;
};

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
const id = (value: unknown) => text(value);
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export async function listChatChips(): Promise<ChatChip[]> {
  const client = getSupabaseClient();
  const chipsResult = await client.from('chips')
    .select('chips_id,instances_id,status_id,chips_name,chips_phone')
    .order('chips_name');
  if (chipsResult.error) throw new Error(chipsResult.error.message);
  const instanceIds = Array.from(new Set((chipsResult.data ?? []).map((item) => Number(item.instances_id)).filter(Number.isSafeInteger)));
  const instanceResult = instanceIds.length
    ? await client.from('instances').select('instances_id,status_id,instances_name').in('instances_id', instanceIds)
    : { data: [], error: null };
  if (instanceResult.error) throw new Error(instanceResult.error.message);
  const instances = new Map((instanceResult.data ?? []).map((item) => [id(item.instances_id), item as Row]));
  return (chipsResult.data ?? []).map((item) => {
    const instance = instances.get(id(item.instances_id));
    return {
      id: id(item.chips_id),
      instanceId: id(item.instances_id),
      name: text(item.chips_name),
      phone: text(item.chips_phone),
      active: number(item.status_id) === 1,
      connected: number(instance?.status_id) === 1,
      instanceName: text(instance?.instances_name),
    };
  }).sort((left, right) => Number(right.active && right.connected) - Number(left.active && left.connected) || left.name.localeCompare(right.name));
}

export async function listConversationUnreadCounts(): Promise<Record<string, number>> {
  const result = await getSupabaseClient().from('conversations')
    .select('chips_id,unread_count')
    .eq('conversation_status', 'open')
    .gt('unread_count', 0);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).reduce<Record<string, number>>((acc, item) => {
    const chipId = id(item.chips_id);
    acc[chipId] = (acc[chipId] ?? 0) + number(item.unread_count);
    return acc;
  }, {});
}

export async function listConversations(chipId: string | null, includeArchived = false): Promise<Conversation[]> {
  let query = getSupabaseClient().from('conversations')
    .select('conversations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,contact_name,contact_avatar_url,conversation_status,unread_count,last_message_at,last_message_preview,last_message_direction,conversations_updated_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('conversations_id', { ascending: false })
    .limit(500);
  if (chipId) query = query.eq('chips_id', Number(chipId));
  if (!includeArchived) query = query.eq('conversation_status', 'open');
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((item) => ({
    id: id(item.conversations_id),
    chipId: id(item.chips_id),
    instanceId: id(item.instances_id),
    leadId: item.leads_id == null ? null : id(item.leads_id),
    remoteJid: text(item.remote_jid),
    phone: text(item.contact_phone),
    contactName: text(item.contact_name),
    avatarUrl: text(item.contact_avatar_url),
    status: text(item.conversation_status) === 'archived' ? 'archived' : 'open',
    unreadCount: number(item.unread_count),
    lastMessageAt: item.last_message_at ? text(item.last_message_at) : null,
    lastMessagePreview: text(item.last_message_preview),
    lastMessageDirection: ['inbound', 'outbound'].includes(text(item.last_message_direction)) ? text(item.last_message_direction) as 'inbound' | 'outbound' : null,
    updatedAt: text(item.conversations_updated_at),
  }));
}

export async function listConversationMessages(conversationId: string, limit = 250): Promise<ConversationMessage[]> {
  const result = await getSupabaseClient().from('conversation_messages')
    .select('conversation_messages_id,conversations_id,external_message_id,direction,from_me,message_type,message_body,media_url,media_mime_type,media_file_name,quoted_external_message_id,message_status,provider_timestamp,conversation_messages_created_at,error_message')
    .eq('conversations_id', Number(conversationId))
    .order('provider_timestamp', { ascending: true, nullsFirst: false })
    .order('conversation_messages_id', { ascending: true })
    .limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((item) => ({
    id: id(item.conversation_messages_id),
    conversationId: id(item.conversations_id),
    externalId: item.external_message_id == null ? null : text(item.external_message_id),
    direction: text(item.direction) === 'outbound' ? 'outbound' : 'inbound',
    fromMe: Boolean(item.from_me),
    type: text(item.message_type) || 'text',
    body: text(item.message_body),
    mediaUrl: text(item.media_url),
    mediaMimeType: text(item.media_mime_type),
    mediaFileName: text(item.media_file_name),
    quotedExternalId: item.quoted_external_message_id == null ? null : text(item.quoted_external_message_id),
    status: text(item.message_status) as ConversationMessage['status'],
    providerTimestamp: item.provider_timestamp ? text(item.provider_timestamp) : null,
    createdAt: text(item.conversation_messages_created_at),
    errorMessage: text(item.error_message),
  }));
}

export async function markConversationRead(conversationId: string) {
  const result = await getSupabaseClient().rpc('mark_conversation_read', { p_conversations_id: Number(conversationId) });
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}

export async function setConversationArchived(conversationId: string, archived: boolean) {
  const result = await getSupabaseClient().rpc('set_conversation_archived', {
    p_conversations_id: Number(conversationId), p_archived: archived,
  });
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}
