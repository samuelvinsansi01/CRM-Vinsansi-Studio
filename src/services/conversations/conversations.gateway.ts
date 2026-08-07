import { getSupabaseClient } from '../../lib/supabase';

type SendResult = { ok: boolean; message_id?: number | string; external_message_id?: string | null; status?: string; error?: string; message?: string };

export async function sendConversationMessage(conversationId: string, message: string, idempotencyKey = crypto.randomUUID()): Promise<SendResult> {
  const session = await getSupabaseClient().auth.getSession();
  if (session.error) throw new Error(session.error.message);
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const response = await fetch('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversation_id: Number(conversationId), message, idempotency_key: idempotencyKey }),
  });
  const payload = await response.json().catch(() => null) as SendResult | null;
  if (!response.ok || !payload?.ok) {
    const error = payload?.message || payload?.error || `Falha ao enviar a mensagem (${response.status}).`;
    throw new Error(error);
  }
  return payload;
}
