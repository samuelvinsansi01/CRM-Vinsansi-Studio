import conversationSend from '../../whatsapp/conversation-send.js';
import { body, integer, send, text, type Stage5Request, type Stage5Response } from '../../../whatsapp/stage5.js';

export const maxDuration = 45;

// Compatibilidade do endpoint antigo: normaliza o payload e delega integralmente
// ao fluxo canônico Stage 5. Não existe mais um segundo caminho de envio.
export default async function handler(req: Stage5Request, res: Stage5Response) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  const input = body(req);
  const conversationId = integer(input.conversation_id ?? input.conversations_id ?? input.conversationId, 'conversation_id_required') as number;
  const message = text(input.message ?? input.body ?? input.text);
  const idempotencyKey = text(input.idempotency_key ?? input.client_idempotency_key ?? input.idempotencyKey);
  if (!message || message.length > 4096) return send(res, 400, { ok: false, error: 'message_body_invalid' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return send(res, 400, { ok: false, error: 'idempotency_key_uuid_required' });
  }
  req.body = { conversationId, body: message, idempotencyKey, messageType: 'text' };
  return conversationSend(req, res);
}
