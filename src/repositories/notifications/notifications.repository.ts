import { getSupabaseClient } from '../../lib/supabase';

export type CrmNotificationType = 'whatsapp_message' | 'whatsapp_disconnected' | 'dispatch_error';
export type CrmNotificationChannel = 'whatsapp' | 'instagram' | null;

export type CrmNotification = {
  id: string;
  type: CrmNotificationType;
  channel: CrmNotificationChannel;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  targetPage: string;
  targetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  eventCount: number;
  firstEventAt: string;
  lastEventAt: string;
  readAt: string | null;
};

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function listCrmNotifications(limit = 60): Promise<CrmNotification[]> {
  const result = await getSupabaseClient().from('crm_notifications')
    .select('crm_notifications_id,notification_type,channel,title,message,entity_type,entity_id,target_page,target_payload,metadata,event_count,first_event_at,last_event_at,read_at')
    .order('last_event_at', { ascending: false })
    .limit(limit);
  if (result.error) throw new Error(result.error.message);
  const data: unknown = result.data;
  const rows = Array.isArray(data) ? data.filter((row): row is Row => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [];
  return rows.map((row) => ({
    id: text(row.crm_notifications_id),
    type: text(row.notification_type) as CrmNotificationType,
    channel: (text(row.channel) || null) as CrmNotificationChannel,
    title: text(row.title),
    message: text(row.message),
    entityType: text(row.entity_type),
    entityId: text(row.entity_id),
    targetPage: text(row.target_page),
    targetPayload: object(row.target_payload),
    metadata: object(row.metadata),
    eventCount: Math.max(1, Number(row.event_count ?? 1)),
    firstEventAt: text(row.first_event_at),
    lastEventAt: text(row.last_event_at),
    readAt: row.read_at ? text(row.read_at) : null,
  }));
}

export async function markCrmNotificationRead(notificationId: string) {
  const result = await getSupabaseClient().rpc('mark_crm_notification_read', { p_crm_notifications_id: Number(notificationId) });
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}

export async function markAllCrmNotificationsRead() {
  const result = await getSupabaseClient().rpc('mark_all_crm_notifications_read');
  if (result.error) throw new Error(result.error.message);
  return Number(result.data ?? 0);
}
