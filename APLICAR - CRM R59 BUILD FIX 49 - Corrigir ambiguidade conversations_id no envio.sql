-- CRM R59 BUILD FIX 49
-- Corrige ambiguidade PL/pgSQL em service_prepare_outgoing_chat_message.
-- A função RETURNS TABLE possui um campo de saída chamado conversations_id;
-- por isso toda referência à coluna homônima precisa ser qualificada com alias.

BEGIN;

CREATE OR REPLACE FUNCTION public.service_prepare_outgoing_chat_message(
  p_users_id bigint,
  p_conversations_id bigint,
  p_message_body text,
  p_client_idempotency_key uuid
)
RETURNS TABLE(
  conversation_messages_id bigint,
  conversations_id bigint,
  chips_id bigint,
  instances_id bigint,
  instance_name text,
  instance_url text,
  api_key text,
  recipient text,
  remote_jid text,
  message_body text,
  message_status text,
  external_message_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
DECLARE
  v_conversation public.conversations%ROWTYPE;
  v_message_id bigint;
  v_body text := trim(coalesce(p_message_body, ''));
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  IF p_users_id IS NULL OR p_client_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'chat_outgoing_identity_required';
  END IF;

  IF v_body = '' OR length(v_body) > 4096 THEN
    RAISE EXCEPTION 'chat_message_body_invalid';
  END IF;

  SELECT c.*
    INTO v_conversation
    FROM public.conversations AS c
   WHERE c.conversations_id = p_conversations_id
     AND c.users_id = p_users_id
   FOR UPDATE;

  IF v_conversation.conversations_id IS NULL THEN
    RAISE EXCEPTION 'chat_conversation_not_found';
  END IF;

  IF v_conversation.conversation_status = 'archived' THEN
    RAISE EXCEPTION 'chat_conversation_archived';
  END IF;

  SELECT m.conversation_messages_id
    INTO v_message_id
    FROM public.conversation_messages AS m
   WHERE m.users_id = p_users_id
     AND m.client_idempotency_key = p_client_idempotency_key;

  IF v_message_id IS NULL THEN
    INSERT INTO public.conversation_messages AS inserted(
      users_id,
      conversations_id,
      chips_id,
      instances_id,
      leads_id,
      client_idempotency_key,
      remote_jid,
      direction,
      from_me,
      message_type,
      message_body,
      message_status,
      provider_timestamp
    )
    VALUES(
      p_users_id,
      v_conversation.conversations_id,
      v_conversation.chips_id,
      v_conversation.instances_id,
      v_conversation.leads_id,
      p_client_idempotency_key,
      v_conversation.remote_jid,
      'outbound',
      true,
      'text',
      v_body,
      'pending',
      now()
    )
    RETURNING inserted.conversation_messages_id INTO v_message_id;

    UPDATE public.conversations AS c
       SET last_message_at = now(),
           last_message_preview = left(v_body, 240),
           last_message_direction = 'outbound',
           conversations_updated_at = now()
     WHERE c.conversations_id = v_conversation.conversations_id;
  END IF;

  RETURN QUERY
  SELECT
    m.conversation_messages_id,
    m.conversations_id,
    m.chips_id,
    m.instances_id,
    i.instances_name,
    i.instances_url,
    d.decrypted_secret,
    coalesce(
      nullif(v_conversation.contact_phone, ''),
      CASE
        WHEN v_conversation.remote_jid ~* '@(s\\.whatsapp\\.net|c\\.us)$'
          THEN public.normalize_identity_phone(split_part(split_part(v_conversation.remote_jid, '@', 1), ':', 1))
        ELSE ''
      END
    ),
    m.remote_jid,
    m.message_body,
    m.message_status,
    m.external_message_id
  FROM public.conversation_messages AS m
  JOIN public.instances AS i
    ON i.instances_id = m.instances_id
   AND i.users_id = m.users_id
  JOIN public.instance_credentials AS ic
    ON ic.instances_id = i.instances_id
   AND ic.users_id = i.users_id
  JOIN vault.decrypted_secrets AS d
    ON d.id = ic.vault_secret_id
  WHERE m.conversation_messages_id = v_message_id;
END;
$function$;

COMMIT;

-- Homologação rápida: a definição deve conter c.conversations_id = p_conversations_id
-- e não mais "WHERE conversations_id=p_conversations_id" sem alias.
SELECT
  p.proname,
  position('c.conversations_id = p_conversations_id' in pg_get_functiondef(p.oid)) > 0 AS qualified_conversation_reference
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'service_prepare_outgoing_chat_message';
