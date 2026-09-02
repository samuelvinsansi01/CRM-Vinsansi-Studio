-- CRM R59 BUILD FIX 35
-- 1) Usa a identidade/aliases do Stage 5 ANTES de criar uma conversa recebida.
-- 2) Funde threads historicas do mesmo contato/chip preservando mensagens, leitura, lead e atribuicao.
-- 3) Vincula automaticamente a conversa ao lead canonico quando o telefone do WhatsApp ja existe no CRM.
-- 4) A listagem de conversas passa a priorizar Nome alternativo -> Nome da empresa -> nome util do provedor -> numero.
-- 5) Nao cria uma segunda base de contatos: leads continua sendo a fonte canonica do nome comercial.

BEGIN;

CREATE OR REPLACE FUNCTION public.stage5_conversation_phone_identity(
  p_contact_phone text,
  p_remote_jid text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_phone text := public.normalize_identity_phone(p_contact_phone);
  v_jid text := public.stage5_normalize_contact_jid(p_remote_jid);
BEGIN
  IF v_phone <> '' THEN RETURN v_phone; END IF;
  IF v_jid ~ '^[0-9]+@s\.whatsapp\.net$' THEN
    RETURN public.normalize_identity_phone(split_part(v_jid, '@', 1));
  END IF;
  RETURN '';
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_sync_conversation_lead_identity(
  p_conversations_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_c public.conversations%ROWTYPE;
  v_phone text;
  v_lead_id bigint;
BEGIN
  SELECT * INTO v_c
  FROM public.conversations
  WHERE conversations_id = p_conversations_id
  FOR UPDATE;

  IF v_c.conversations_id IS NULL THEN RETURN NULL; END IF;

  v_phone := public.stage5_conversation_phone_identity(v_c.contact_phone, v_c.remote_jid);

  IF v_phone = '' THEN
    SELECT public.normalize_identity_phone(split_part(a.alias_jid, '@', 1))
      INTO v_phone
      FROM public.conversation_contact_aliases a
     WHERE a.organizations_id = v_c.organizations_id
       AND a.chips_id = v_c.chips_id
       AND a.conversations_id = v_c.conversations_id
       AND a.alias_jid ~ '^[0-9]+@s\.whatsapp\.net$'
     ORDER BY a.conversation_contact_aliases_id
     LIMIT 1;
  END IF;

  IF coalesce(v_phone, '') = '' THEN
    SELECT public.normalize_identity_phone(split_part(public.stage5_payload_phone_jid(cm.raw_payload), '@', 1))
      INTO v_phone
      FROM public.conversation_messages cm
     WHERE cm.organizations_id = v_c.organizations_id
       AND cm.conversations_id = v_c.conversations_id
       AND public.stage5_payload_phone_jid(cm.raw_payload) IS NOT NULL
     ORDER BY cm.conversation_messages_id DESC
     LIMIT 1;
  END IF;

  IF coalesce(v_phone, '') <> '' THEN
    SELECT coalesce(canonical.leads_id, l.leads_id)
      INTO v_lead_id
      FROM public.leads l
      LEFT JOIN public.leads canonical
        ON canonical.leads_id = l.canonical_lead_id
       AND canonical.organizations_id = l.organizations_id
     WHERE l.organizations_id = v_c.organizations_id
       AND (
         l.leads_normalized_phone = v_phone
         OR public.normalize_identity_phone(public.effective_whatsapp_phone(l.leads_whatsapp, l.leads_phone)) = v_phone
       )
     ORDER BY
       CASE WHEN l.canonical_lead_id IS NULL THEN 0 ELSE 1 END,
       l.leads_id
     LIMIT 1;

    UPDATE public.conversations
       SET contact_phone = v_phone,
           leads_id = coalesce(leads_id, v_lead_id),
           conversations_updated_at = CASE
             WHEN contact_phone IS DISTINCT FROM v_phone OR (leads_id IS NULL AND v_lead_id IS NOT NULL) THEN now()
             ELSE conversations_updated_at
           END
     WHERE conversations_id = v_c.conversations_id;
  END IF;

  RETURN coalesce(v_lead_id, v_c.leads_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.stage5_conversation_phone_identity(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_sync_conversation_lead_identity(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage5_conversation_phone_identity(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_sync_conversation_lead_identity(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.service_ingest_evolution_message(
  p_instances_id bigint,
  p_event_type text,
  p_external_message_id text,
  p_remote_jid text,
  p_from_me boolean,
  p_message_type text,
  p_message_body text,
  p_message_status text,
  p_contact_name text,
  p_provider_timestamp timestamp with time zone,
  p_raw_payload jsonb,
  p_media_url text,
  p_media_mime_type text,
  p_media_file_name text,
  p_quoted_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_instance record;
  v_chip record;
  v_scope bigint;
  v_conversation public.conversations%ROWTYPE;
  v_message public.conversation_messages%ROWTYPE;
  v_direction text := CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END;
  v_member bigint;
  v_queue bigint;
  v_remote_jid text;
  v_contact_name text;
  v_chip_id bigint;
  v_any_chip_id bigint;
  v_active_count integer;
  v_total_count integer;
  v_aliases text[];
  v_resolved_id bigint;
  v_final_id bigint;
BEGIN
  v_aliases := public.stage5_payload_contact_aliases(p_remote_jid, coalesce(p_raw_payload, '{}'::jsonb));
  v_remote_jid := public.stage5_preferred_contact_jid(p_remote_jid, coalesce(p_raw_payload, '{}'::jsonb));
  v_contact_name := public.stage5_meaningful_contact_name(p_contact_name);

  IF v_remote_jid IS NULL THEN RETURN jsonb_build_object('ignored', true, 'reason', 'remote_jid_missing'); END IF;
  IF v_remote_jid ILIKE '%@g.us' OR v_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored', true, 'reason', 'unsupported_chat_kind'); END IF;
  IF nullif(trim(coalesce(p_message_body, '')), '') IS NULL THEN RETURN jsonb_build_object('ignored', true, 'reason', 'text_body_empty'); END IF;

  SELECT i.instances_id, i.organizations_id
    INTO v_instance
    FROM public.instances i
   WHERE i.instances_id = p_instances_id;
  IF v_instance.instances_id IS NULL THEN RAISE EXCEPTION 'webhook_instance_not_found'; END IF;

  SELECT count(*) FILTER(WHERE c.status_id = 1)::integer,
         count(*)::integer,
         min(c.chips_id) FILTER(WHERE c.status_id = 1),
         min(c.chips_id)
    INTO v_active_count, v_total_count, v_chip_id, v_any_chip_id
    FROM public.chips c
   WHERE c.instances_id = p_instances_id
     AND c.organizations_id = v_instance.organizations_id;

  IF v_active_count = 1 THEN NULL;
  ELSIF v_active_count > 1 THEN RAISE EXCEPTION 'webhook_chip_ambiguous_active';
  ELSIF v_total_count = 1 THEN v_chip_id := v_any_chip_id;
  ELSIF v_total_count = 0 THEN RETURN jsonb_build_object('ignored', true, 'reason', 'webhook_chip_not_found');
  ELSE RAISE EXCEPTION 'webhook_chip_ambiguous'; END IF;

  SELECT c.chips_id, c.instances_id
    INTO v_chip
    FROM public.chips c
   WHERE c.chips_id = v_chip_id
     AND c.organizations_id = v_instance.organizations_id;

  SELECT legacy_scope_users_id
    INTO v_scope
    FROM public.organizations
   WHERE organizations_id = v_instance.organizations_id;

  -- Idempotencia continua antes da criacao da conversa. Em retries, aliases novos
  -- sao registrados na thread ja persistida e podem fundir uma thread historica paralela.
  SELECT * INTO v_message
    FROM public.conversation_messages
   WHERE organizations_id = v_instance.organizations_id
     AND instances_id = p_instances_id
     AND external_message_id = p_external_message_id;

  IF v_message.conversation_messages_id IS NOT NULL THEN
    v_final_id := public.stage5_register_conversation_aliases(
      v_instance.organizations_id,
      v_chip.chips_id,
      v_message.conversations_id,
      v_aliases
    );
    PERFORM public.stage5_sync_conversation_lead_identity(v_final_id);

    UPDATE public.conversation_messages
       SET message_status = CASE
             WHEN public.stage5_status_rank(p_message_status) >= public.stage5_status_rank(message_status)
               OR message_status IN ('failed', 'reconciliation_required')
             THEN p_message_status ELSE message_status END,
           message_body = coalesce(nullif(p_message_body, ''), message_body),
           remote_jid = v_remote_jid,
           raw_payload = coalesce(raw_payload, '{}') || coalesce(p_raw_payload, '{}'),
           leads_id = coalesce(leads_id, (SELECT leads_id FROM public.conversations WHERE conversations_id = v_final_id)),
           conversation_messages_updated_at = now()
     WHERE conversation_messages_id = v_message.conversation_messages_id
     RETURNING * INTO v_message;

    UPDATE public.conversations
       SET contact_name = coalesce(v_contact_name, contact_name),
           contact_phone = coalesce(
             nullif(public.stage5_conversation_phone_identity(contact_phone, v_remote_jid), ''),
             contact_phone
           ),
           conversations_updated_at = now()
     WHERE organizations_id = v_instance.organizations_id
       AND conversations_id = v_final_id;

    RETURN jsonb_build_object(
      'ignored', false,
      'merged', true,
      'conversationId', v_final_id,
      'messageId', v_message.conversation_messages_id
    );
  END IF;

  -- Resolve aliases/LID/JID antes de inserir. Esta era a lacuna que permitia a
  -- existencia de duas threads visiveis para o mesmo numero.
  v_resolved_id := public.stage5_resolve_conversation_id(
    v_instance.organizations_id,
    v_chip.chips_id,
    p_remote_jid,
    coalesce(p_raw_payload, '{}'::jsonb)
  );

  IF v_resolved_id IS NOT NULL THEN
    UPDATE public.conversations
       SET contact_name = coalesce(v_contact_name, contact_name),
           contact_phone = coalesce(
             nullif(public.stage5_conversation_phone_identity(contact_phone, v_remote_jid), ''),
             contact_phone
           ),
           conversation_status = CASE WHEN NOT p_from_me THEN 'open' ELSE conversation_status END,
           last_message_at = greatest(coalesce(last_message_at, 'epoch'), coalesce(p_provider_timestamp, now())),
           last_message_preview = CASE
             WHEN coalesce(p_provider_timestamp, now()) >= coalesce(last_message_at, 'epoch') THEN p_message_body
             ELSE last_message_preview END,
           last_message_direction = CASE
             WHEN coalesce(p_provider_timestamp, now()) >= coalesce(last_message_at, 'epoch') THEN v_direction
             ELSE last_message_direction END,
           conversation_version = CASE WHEN NOT p_from_me AND conversation_status = 'archived' THEN conversation_version + 1 ELSE conversation_version END,
           conversations_updated_at = now()
     WHERE conversations_id = v_resolved_id
       AND organizations_id = v_instance.organizations_id
     RETURNING * INTO v_conversation;
  ELSE
    INSERT INTO public.conversations(
      users_id, organizations_id, chips_id, instances_id, remote_jid, contact_phone, contact_name,
      conversation_status, last_message_at, last_message_preview, last_message_direction,
      conversations_created_at, conversations_updated_at
    )
    VALUES(
      v_scope, v_instance.organizations_id, v_chip.chips_id, p_instances_id, v_remote_jid,
      nullif(public.stage5_conversation_phone_identity(NULL, v_remote_jid), ''),
      v_contact_name, 'open', coalesce(p_provider_timestamp, now()), p_message_body, v_direction, now(), now()
    )
    ON CONFLICT(organizations_id, chips_id, remote_jid) DO UPDATE SET
      contact_name = coalesce(excluded.contact_name, conversations.contact_name),
      contact_phone = coalesce(excluded.contact_phone, conversations.contact_phone),
      last_message_at = greatest(coalesce(conversations.last_message_at, 'epoch'), excluded.last_message_at),
      last_message_preview = CASE WHEN excluded.last_message_at >= coalesce(conversations.last_message_at, 'epoch') THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
      last_message_direction = CASE WHEN excluded.last_message_at >= coalesce(conversations.last_message_at, 'epoch') THEN excluded.last_message_direction ELSE conversations.last_message_direction END,
      conversations_updated_at = now()
    RETURNING * INTO v_conversation;
  END IF;

  v_final_id := public.stage5_register_conversation_aliases(
    v_instance.organizations_id,
    v_chip.chips_id,
    v_conversation.conversations_id,
    v_aliases
  );
  PERFORM public.stage5_sync_conversation_lead_identity(v_final_id);
  SELECT * INTO v_conversation FROM public.conversations WHERE conversations_id = v_final_id;

  IF p_from_me AND to_regclass('public.queue_item_dispatch_parts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT queue_items_id FROM public.queue_item_dispatch_parts WHERE external_id=$1 ORDER BY queue_item_dispatch_parts_id DESC LIMIT 1'
        INTO v_queue USING p_external_message_id;
      SELECT qi.dispatched_by_member_id
        INTO v_member
        FROM public.queue_items qi
       WHERE qi.queue_items_id = v_queue
         AND qi.organizations_id = v_instance.organizations_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  INSERT INTO public.conversation_messages(
    users_id, organizations_id, conversations_id, chips_id, instances_id, leads_id, queue_items_id,
    external_message_id, remote_jid, direction, from_me, message_type, message_body,
    media_url, media_mime_type, media_file_name, quoted_external_message_id, message_status,
    sent_by_member_id, executed_by, provider_timestamp, raw_payload,
    conversation_messages_created_at, conversation_messages_updated_at
  )
  VALUES(
    v_scope, v_instance.organizations_id, v_conversation.conversations_id, v_chip.chips_id, p_instances_id,
    v_conversation.leads_id, v_queue, p_external_message_id, v_remote_jid, v_direction, p_from_me,
    'text', p_message_body, NULL, NULL, NULL, p_quoted_external_message_id, p_message_status,
    CASE WHEN p_from_me THEN v_member ELSE NULL END, 'system', p_provider_timestamp,
    coalesce(p_raw_payload, '{}'), now(), now()
  )
  RETURNING * INTO v_message;

  IF NOT p_from_me AND v_conversation.assigned_to_member_id IS NULL THEN
    SELECT cm.sent_by_member_id
      INTO v_member
      FROM public.conversation_messages cm
      JOIN public.organization_members m
        ON m.organization_members_id = cm.sent_by_member_id
       AND m.organizations_id = cm.organizations_id
       AND m.status_id = 1
     WHERE cm.organizations_id = v_instance.organizations_id
       AND cm.conversations_id = v_conversation.conversations_id
       AND cm.direction = 'outbound'
       AND cm.executed_by = 'system'
       AND cm.sent_by_member_id IS NOT NULL
     ORDER BY cm.conversation_messages_id DESC
     LIMIT 1;

    IF v_member IS NOT NULL THEN
      UPDATE public.conversations
         SET assigned_to_member_id = v_member,
             assignment_updated_at = now(),
             conversation_version = conversation_version + 1
       WHERE organizations_id = v_instance.organizations_id
         AND conversations_id = v_conversation.conversations_id
         AND assigned_to_member_id IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ignored', false,
    'merged', false,
    'conversationId', v_conversation.conversations_id,
    'messageId', v_message.conversation_messages_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.service_upsert_evolution_chat(
  p_instances_id bigint,
  p_remote_jid text,
  p_contact_name text,
  p_contact_avatar_url text,
  p_unread_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_instance record;
  v_chip bigint;
  v_scope bigint;
  v_c public.conversations%ROWTYPE;
  v_id bigint;
  v_final_id bigint;
  v_jid text := public.stage5_normalize_contact_jid(p_remote_jid);
  v_phone text;
  v_contact_name text := public.stage5_meaningful_contact_name(p_contact_name);
BEGIN
  IF v_jid ILIKE '%@g.us' OR v_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored', true); END IF;

  SELECT instances_id, organizations_id
    INTO v_instance
    FROM public.instances
   WHERE instances_id = p_instances_id;
  IF v_instance.instances_id IS NULL THEN RETURN jsonb_build_object('ignored', true); END IF;

  SELECT chips_id
    INTO v_chip
    FROM public.chips
   WHERE instances_id = p_instances_id
     AND organizations_id = v_instance.organizations_id
   ORDER BY status_id = 1 DESC, chips_id
   LIMIT 1;
  IF v_chip IS NULL THEN RETURN jsonb_build_object('ignored', true); END IF;

  SELECT legacy_scope_users_id INTO v_scope
    FROM public.organizations
   WHERE organizations_id = v_instance.organizations_id;

  v_id := public.stage5_resolve_conversation_id(v_instance.organizations_id, v_chip, v_jid, '{}'::jsonb);
  v_phone := nullif(public.stage5_conversation_phone_identity(NULL, v_jid), '');

  IF v_id IS NULL THEN
    INSERT INTO public.conversations(
      users_id, organizations_id, chips_id, instances_id, remote_jid, contact_phone, contact_name,
      contact_avatar_url, conversation_status, unread_count, conversations_created_at, conversations_updated_at
    )
    VALUES(
      v_scope, v_instance.organizations_id, v_chip, p_instances_id, v_jid, v_phone, v_contact_name,
      p_contact_avatar_url, 'open', coalesce(p_unread_count, 0), now(), now()
    )
    ON CONFLICT(organizations_id, chips_id, remote_jid) DO UPDATE SET
      contact_name = coalesce(nullif(excluded.contact_name, ''), conversations.contact_name),
      contact_avatar_url = coalesce(nullif(excluded.contact_avatar_url, ''), conversations.contact_avatar_url),
      contact_phone = coalesce(nullif(conversations.contact_phone, ''), excluded.contact_phone),
      unread_count = greatest(conversations.unread_count, excluded.unread_count),
      conversations_updated_at = now()
    RETURNING * INTO v_c;
  ELSE
    UPDATE public.conversations
       SET contact_name = coalesce(nullif(v_contact_name, ''), contact_name),
           contact_avatar_url = coalesce(nullif(p_contact_avatar_url, ''), contact_avatar_url),
           contact_phone = coalesce(nullif(contact_phone, ''), v_phone),
           unread_count = greatest(unread_count, coalesce(p_unread_count, 0)),
           conversations_updated_at = now()
     WHERE conversations_id = v_id
     RETURNING * INTO v_c;
  END IF;

  v_final_id := public.stage5_register_conversation_aliases(
    v_instance.organizations_id,
    v_chip,
    v_c.conversations_id,
    ARRAY[v_jid]
  );
  PERFORM public.stage5_sync_conversation_lead_identity(v_final_id);

  RETURN jsonb_build_object('ignored', false, 'conversationId', v_final_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.service_stage5_list_conversations(
  p_organizations_id bigint,
  p_organization_members_id bigint,
  p_chip_id bigint DEFAULT NULL::bigint,
  p_scope text DEFAULT 'all'::text,
  p_unread_only boolean DEFAULT false,
  p_archived boolean DEFAULT false,
  p_search text DEFAULT NULL::text,
  p_cursor_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id bigint DEFAULT NULL::bigint,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id, p_organization_members_id, 'whatsapp.view');

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.last_message_at DESC NULLS LAST, x.conversations_id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT
        c.conversations_id,
        c.chips_id,
        c.instances_id,
        c.leads_id,
        c.remote_jid,
        c.contact_phone,
        coalesce(
          nullif(trim(l.leads_alternative_name), ''),
          nullif(trim(l.leads_name), ''),
          public.stage5_meaningful_contact_name(c.contact_name)
        ) AS contact_name,
        nullif(trim(l.leads_name), '') AS lead_name,
        nullif(trim(l.leads_alternative_name), '') AS lead_alternative_name,
        coalesce(
          nullif(trim(l.leads_alternative_name), ''),
          nullif(trim(l.leads_name), ''),
          public.stage5_meaningful_contact_name(c.contact_name),
          nullif(trim(c.contact_phone), ''),
          nullif(trim(c.remote_jid), '')
        ) AS display_name,
        c.contact_avatar_url,
        c.conversation_status,
        c.assigned_to_member_id,
        c.last_replied_by_member_id,
        c.last_message_at,
        c.last_message_preview,
        c.last_message_direction,
        c.assignment_updated_at,
        c.conversation_version,
        ch.chips_name,
        ch.chips_phone,
        coalesce(nullif(u.users_name, ''), 'Membro #' || m.organization_members_id::text) AS assigned_to_member_name,
        (
          SELECT count(*)::integer
          FROM public.conversation_messages cm
          WHERE cm.organizations_id = p_organizations_id
            AND cm.conversations_id = c.conversations_id
            AND cm.direction = 'inbound'
            AND cm.conversation_messages_id > coalesce(ms.last_read_message_id, 0)
        ) AS unread_count
      FROM public.conversations c
      JOIN public.chips ch
        ON ch.chips_id = c.chips_id
       AND ch.organizations_id = c.organizations_id
      LEFT JOIN public.leads l
        ON l.leads_id = c.leads_id
       AND l.organizations_id = c.organizations_id
      LEFT JOIN public.organization_members m
        ON m.organization_members_id = c.assigned_to_member_id
       AND m.organizations_id = c.organizations_id
      LEFT JOIN public.users u ON u.users_id = m.users_id
      LEFT JOIN public.conversation_member_states ms
        ON ms.organizations_id = c.organizations_id
       AND ms.conversations_id = c.conversations_id
       AND ms.organization_members_id = p_organization_members_id
      WHERE c.organizations_id = p_organizations_id
        AND (p_chip_id IS NULL OR c.chips_id = p_chip_id)
        AND c.conversation_status = CASE WHEN p_archived THEN 'archived' ELSE 'open' END
        AND (
          p_scope = 'all'
          OR (p_scope = 'mine' AND c.assigned_to_member_id = p_organization_members_id)
          OR (p_scope = 'unassigned' AND c.assigned_to_member_id IS NULL)
        )
        AND (
          nullif(trim(coalesce(p_search, '')), '') IS NULL
          OR concat_ws(
            ' ',
            l.leads_alternative_name,
            l.leads_name,
            public.stage5_meaningful_contact_name(c.contact_name),
            c.contact_phone,
            c.remote_jid,
            ch.chips_name,
            ch.chips_phone
          ) ILIKE '%' || trim(p_search) || '%'
        )
        AND (
          p_cursor_at IS NULL
          OR (c.last_message_at, c.conversations_id) < (p_cursor_at, coalesce(p_cursor_id, 9223372036854775807))
        )
        AND (
          NOT p_unread_only
          OR EXISTS (
            SELECT 1
            FROM public.conversation_messages cm
            WHERE cm.organizations_id = p_organizations_id
              AND cm.conversations_id = c.conversations_id
              AND cm.direction = 'inbound'
              AND cm.conversation_messages_id > coalesce(ms.last_read_message_id, 0)
          )
        )
      ORDER BY c.last_message_at DESC NULLS LAST, c.conversations_id DESC
      LIMIT v_limit
    ) x;

  RETURN jsonb_build_object('items', v_rows, 'limit', v_limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_repair_conversation_identities_r59()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  r record;
  v_aliases text[];
  v_phone text;
  v_final bigint;
  v_seen integer := 0;
  v_merged integer := 0;
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*)::integer INTO v_before FROM public.conversations;

  FOR r IN
    SELECT conversations_id, organizations_id, chips_id, remote_jid, contact_phone
      FROM public.conversations
     ORDER BY organizations_id, chips_id, conversations_id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.conversations_id = r.conversations_id) THEN
      CONTINUE;
    END IF;

    v_seen := v_seen + 1;
    v_phone := public.stage5_conversation_phone_identity(r.contact_phone, r.remote_jid);

    SELECT array_agg(DISTINCT q.alias_jid ORDER BY q.alias_jid)
      INTO v_aliases
      FROM (
        SELECT public.stage5_normalize_contact_jid(r.remote_jid) AS alias_jid
        UNION ALL
        SELECT CASE WHEN coalesce(v_phone, '') <> '' THEN v_phone || '@s.whatsapp.net' END
        UNION ALL
        SELECT alias_value
          FROM public.conversation_messages cm
          CROSS JOIN LATERAL unnest(public.stage5_payload_contact_aliases(cm.remote_jid, cm.raw_payload)) AS alias_value
         WHERE cm.organizations_id = r.organizations_id
           AND cm.conversations_id = r.conversations_id
      ) q
     WHERE q.alias_jid IS NOT NULL;

    v_final := public.stage5_register_conversation_aliases(
      r.organizations_id,
      r.chips_id,
      r.conversations_id,
      coalesce(v_aliases, ARRAY[]::text[])
    );

    IF v_final IS NOT NULL THEN
      PERFORM public.stage5_sync_conversation_lead_identity(v_final);
      UPDATE public.conversation_messages cm
         SET leads_id = coalesce(cm.leads_id, c.leads_id),
             conversation_messages_updated_at = CASE WHEN cm.leads_id IS NULL AND c.leads_id IS NOT NULL THEN now() ELSE cm.conversation_messages_updated_at END
        FROM public.conversations c
       WHERE c.conversations_id = v_final
         AND cm.conversations_id = v_final
         AND cm.organizations_id = c.organizations_id;
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_after FROM public.conversations;
  v_merged := greatest(v_before - v_after, 0);

  RETURN jsonb_build_object(
    'scanned', v_seen,
    'before', v_before,
    'after', v_after,
    'merged', v_merged
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.stage5_repair_conversation_identities_r59() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage5_repair_conversation_identities_r59() TO service_role;

-- Saneia threads antigas agora. A funcao de merge ja preserva mensagens,
-- estados de leitura, aliases, atribuicao e o lead existente entre as duas threads.
SELECT public.stage5_repair_conversation_identities_r59();

COMMIT;
