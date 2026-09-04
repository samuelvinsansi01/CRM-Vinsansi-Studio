import {
  body,
  evolutionCommand,
  failure,
  humanScope,
  integer,
  providerRecipientForConversation,
  record,
  rpc,
  send,
  text,
  type Stage5Request,
  type Stage5Response,
} from '../../../whatsapp/stage5.js';

type ProviderError = Error & { explicit?: boolean };

export const maxDuration = 45;

function externalMessageId(payload: Record<string, unknown>) {
  return text(payload.messageId || payload.id || payload.externalMessageId || payload.external_id);
}

async function gatewaySend(instanceUrl: string, instanceName: string, apiKey: string, recipient: string, message: string) {
  if (!instanceUrl || !instanceName || !apiKey || !recipient) throw new Error('chat_gateway_command_invalid');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const endpoint = `${instanceUrl.replace(/\/$/, '')}/v1/whatsapp/instances/${encodeURIComponent(instanceName)}/messages/text`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: recipient, text: message, delay: 0 }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { payload = { raw }; }
    if (!response.ok) {
      const error = new Error(String(payload.error || payload.message || `gateway_http_${response.status}`)) as ProviderError;
      error.explicit = true;
      throw error;
    }
    const id = externalMessageId(payload);
    if (!id) throw new Error('chat_gateway_provider_id_missing');
    return { externalMessageId: id, payload };
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw new Error('chat_gateway_timeout_uncertain');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: Stage5Request, res: Stage5Response) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const input = body(req);
    const scope = await humanScope(req, 'whatsapp.reply');
    const conversationId = integer(input.conversation_id ?? input.conversations_id ?? input.conversationId, 'conversation_id_required') as number;
    const message = text(input.message ?? input.body ?? input.text);
    const idempotencyKey = text(input.idempotency_key ?? input.client_idempotency_key ?? input.idempotencyKey);
    if (!message || message.length > 4096) throw new Error('message_body_invalid');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      throw new Error('idempotency_key_uuid_required');
    }

    const currentConversation = await scope.admin
      .from('conversations')
      .select('conversation_version')
      .eq('organizations_id', scope.context.organizationId)
      .eq('conversations_id', conversationId)
      .maybeSingle();
    if (currentConversation.error) throw new Error(currentConversation.error.message);
    if (!currentConversation.data) throw new Error('conversation_not_found');

    const expectedVersion = integer(currentConversation.data.conversation_version, 'conversation_version_required') as number;
    const prepared = record(await rpc(scope, 'service_stage5_prepare_manual_message', {
      p_conversations_id: conversationId,
      p_expected_version: expectedVersion,
      p_client_idempotency_key: idempotencyKey,
      p_message_body: message,
      p_message_type: 'text',
      p_media_storage_path: null,
      p_media_mime_type: null,
      p_media_file_name: null,
      p_media_size_bytes: null,
    }));

    const messageId = integer(prepared.messageId, 'message_id_required') as number;
    const currentStatus = text(prepared.status);
    if (prepared.idempotent === true && ['sent', 'delivered', 'read'].includes(currentStatus)) {
      return send(res, 200, { ok: true, idempotent: true, message_id: messageId, status: currentStatus });
    }
    if (prepared.idempotent === true && ['sending', 'reconciliation_required'].includes(currentStatus)) {
      return send(res, 409, { ok: false, error: 'chat_message_requires_reconciliation', message_id: messageId });
    }

    await rpc(scope, 'service_stage5_report_manual_message', {
      p_conversation_messages_id: messageId,
      p_status: 'sending',
      p_external_message_id: null,
      p_error_message: null,
      p_provider_payload: {},
    });

    try {
      const command = await evolutionCommand(scope, integer(prepared.instancesId, 'conversation_instance_required') as number);
      const recipient = await providerRecipientForConversation(scope, conversationId, text(prepared.recipient));
      if (!recipient) throw new Error('conversation_recipient_not_found');
      const sent = await gatewaySend(text(command.instanceUrl), text(command.instanceName), text(command.apiKey), recipient, message);
      const completed = record(await rpc(scope, 'service_stage5_report_manual_message', {
        p_conversation_messages_id: messageId,
        p_status: 'sent',
        p_external_message_id: sent.externalMessageId,
        p_error_message: null,
        p_provider_payload: sent.payload,
      }));
      return send(res, 200, {
        ok: true,
        message_id: Number(completed.messageId ?? messageId),
        external_message_id: text(completed.externalMessageId || sent.externalMessageId) || null,
        status: text(completed.status) || 'sent',
      });
    } catch (error) {
      const explicit = Boolean((error as ProviderError).explicit);
      const nextStatus = explicit ? 'failed' : 'reconciliation_required';
      const errorMessage = error instanceof Error ? error.message : 'Falha ao enviar pela Evolution.';
      await rpc(scope, 'service_stage5_report_manual_message', {
        p_conversation_messages_id: messageId,
        p_status: nextStatus,
        p_external_message_id: null,
        p_error_message: errorMessage,
        p_provider_payload: {},
      }).catch(() => undefined);
      return send(res, explicit ? 502 : 409, { ok: false, error: nextStatus, message: errorMessage, message_id: messageId });
    }
  } catch (error) {
    return failure(res, error);
  }
}
