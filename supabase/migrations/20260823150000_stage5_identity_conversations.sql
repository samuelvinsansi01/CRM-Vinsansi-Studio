BEGIN;

-- Etapa 5 v1.4.3
-- Corrige identidade WhatsApp LID x telefone sem misturar chips diferentes.
-- A identidade continua sendo organização + chip + JID canônico.

CREATE OR REPLACE FUNCTION public.stage5_canonical_remote_jid(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $$
  SELECT CASE
    WHEN nullif(trim(coalesce(p_value,'')),'') IS NULL THEN NULL
    WHEN lower(trim(p_value)) ~ '^[0-9]+@(s\.whatsapp\.net|c\.us)$'
      THEN regexp_replace(split_part(lower(trim(p_value)),'@',1),'\D','','g')||'@s.whatsapp.net'
    ELSE trim(p_value)
  END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_payload_phone_jid(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_candidate text;
BEGIN
  IF p_payload IS NULL THEN RETURN NULL; END IF;
  FOR v_candidate IN
    SELECT value FROM unnest(ARRAY[
      p_payload#>>'{Info,ChatAlt}',p_payload#>>'{Info,SenderAlt}',
      p_payload#>>'{info,ChatAlt}',p_payload#>>'{info,chatAlt}',p_payload#>>'{info,SenderAlt}',p_payload#>>'{info,senderAlt}',
      p_payload#>>'{key,remoteJidAlt}',p_payload#>>'{key,remote_jid_alt}',
      p_payload#>>'{chat,remoteJidAlt}',p_payload#>>'{chat,remote_jid_alt}',
      p_payload#>>'{data,Info,ChatAlt}',p_payload#>>'{data,Info,SenderAlt}',
      p_payload#>>'{remoteJidAlt}',p_payload#>>'{remote_jid_alt}',
      p_payload#>>'{Info,Chat}',p_payload#>>'{Info,Sender}',
      p_payload#>>'{key,remoteJid}',p_payload#>>'{remoteJid}'
    ]) AS candidate(value)
  LOOP
    v_candidate:=public.stage5_canonical_remote_jid(v_candidate);
    IF v_candidate ~ '^[0-9]+@s\.whatsapp\.net$' THEN RETURN v_candidate; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_meaningful_contact_name(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $$
  SELECT CASE
    WHEN nullif(trim(coalesce(p_value,'')),'') IS NULL THEN NULL
    WHEN trim(p_value) !~ '[[:alnum:]]' THEN NULL
    ELSE trim(p_value)
  END;
$$;

REVOKE ALL ON FUNCTION public.stage5_canonical_remote_jid(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_payload_phone_jid(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_meaningful_contact_name(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage5_canonical_remote_jid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_payload_phone_jid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_meaningful_contact_name(text) TO service_role;

-- Repara threads históricas criadas como @lid quando o payload preservou ChatAlt/SenderAlt.
-- A mesclagem acontece SOMENTE dentro da mesma organização e do mesmo chip.
DO $merge_lid_threads$
DECLARE r record;v_target_id bigint;v_phone text;
BEGIN
  FOR r IN
    SELECT c.conversations_id,c.organizations_id,c.chips_id,
           p.phone_jid
      FROM public.conversations c
      CROSS JOIN LATERAL (
        SELECT public.stage5_payload_phone_jid(cm.raw_payload) AS phone_jid
          FROM public.conversation_messages cm
         WHERE cm.organizations_id=c.organizations_id
           AND cm.conversations_id=c.conversations_id
           AND public.stage5_payload_phone_jid(cm.raw_payload) IS NOT NULL
         ORDER BY cm.conversation_messages_id DESC
         LIMIT 1
      ) p
     WHERE lower(c.remote_jid) LIKE '%@lid'
  LOOP
    v_phone:=public.stage5_canonical_remote_jid(r.phone_jid);
    IF v_phone IS NULL OR v_phone !~ '^[0-9]+@s\.whatsapp\.net$' THEN CONTINUE; END IF;

    SELECT c.conversations_id INTO v_target_id
      FROM public.conversations c
     WHERE c.organizations_id=r.organizations_id
       AND c.chips_id=r.chips_id
       AND c.remote_jid=v_phone
       AND c.conversations_id<>r.conversations_id
     ORDER BY c.conversations_id
     LIMIT 1;

    IF v_target_id IS NULL THEN
      UPDATE public.conversation_messages
         SET remote_jid=v_phone,conversation_messages_updated_at=now()
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
      UPDATE public.conversations
         SET remote_jid=v_phone,
             contact_phone=regexp_replace(split_part(v_phone,'@',1),'\D','','g'),
             contact_name=public.stage5_meaningful_contact_name(contact_name),
             conversations_updated_at=now(),conversation_version=conversation_version+1
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
    ELSE
      UPDATE public.conversation_messages
         SET conversations_id=v_target_id,remote_jid=v_phone,conversation_messages_updated_at=now()
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;

      INSERT INTO public.conversation_member_states(
        organizations_id,conversations_id,organization_members_id,last_read_message_id,last_viewed_at,
        conversation_member_states_created_at,conversation_member_states_updated_at
      )
      SELECT organizations_id,v_target_id,organization_members_id,last_read_message_id,last_viewed_at,
             conversation_member_states_created_at,now()
        FROM public.conversation_member_states
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id
      ON CONFLICT(organizations_id,conversations_id,organization_members_id) DO UPDATE SET
        last_read_message_id=CASE
          WHEN excluded.last_read_message_id IS NULL THEN conversation_member_states.last_read_message_id
          WHEN conversation_member_states.last_read_message_id IS NULL THEN excluded.last_read_message_id
          ELSE greatest(conversation_member_states.last_read_message_id,excluded.last_read_message_id)
        END,
        last_viewed_at=greatest(conversation_member_states.last_viewed_at,excluded.last_viewed_at),
        conversation_member_states_updated_at=now();

      DELETE FROM public.conversation_member_states
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
      DELETE FROM public.conversation_presence
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;

      UPDATE public.conversations target SET
        contact_phone=regexp_replace(split_part(v_phone,'@',1),'\D','','g'),
        contact_name=coalesce(public.stage5_meaningful_contact_name(target.contact_name),public.stage5_meaningful_contact_name(source.contact_name)),
        contact_avatar_url=coalesce(target.contact_avatar_url,source.contact_avatar_url),
        leads_id=coalesce(target.leads_id,source.leads_id),
        assigned_to_member_id=coalesce(target.assigned_to_member_id,source.assigned_to_member_id),
        last_replied_by_member_id=coalesce(
          CASE WHEN coalesce(source.last_message_at,'epoch'::timestamptz)>coalesce(target.last_message_at,'epoch'::timestamptz) THEN source.last_replied_by_member_id END,
          target.last_replied_by_member_id,source.last_replied_by_member_id
        ),
        conversation_status=CASE WHEN target.conversation_status='open' OR source.conversation_status='open' THEN 'open' ELSE 'archived' END,
        last_message_preview=CASE WHEN coalesce(source.last_message_at,'epoch'::timestamptz)>coalesce(target.last_message_at,'epoch'::timestamptz) THEN source.last_message_preview ELSE target.last_message_preview END,
        last_message_direction=CASE WHEN coalesce(source.last_message_at,'epoch'::timestamptz)>coalesce(target.last_message_at,'epoch'::timestamptz) THEN source.last_message_direction ELSE target.last_message_direction END,
        last_message_at=greatest(target.last_message_at,source.last_message_at),
        conversation_version=greatest(target.conversation_version,source.conversation_version)+1,
        conversations_updated_at=now()
      FROM public.conversations source
      WHERE source.conversations_id=r.conversations_id
        AND target.conversations_id=v_target_id
        AND target.organizations_id=r.organizations_id;

      DELETE FROM public.conversations
       WHERE organizations_id=r.organizations_id AND conversations_id=r.conversations_id;
    END IF;
    v_target_id:=NULL;
  END LOOP;
END
$merge_lid_threads$;

-- Nomes compostos só por pontuação não devem substituir o telefone como fallback.
UPDATE public.conversations
   SET contact_name=NULL,conversations_updated_at=now()
 WHERE contact_name IS NOT NULL
   AND public.stage5_meaningful_contact_name(contact_name) IS NULL;

-- Remove previews técnicos legados; usa o último texto humano existente na thread.
UPDATE public.conversations c
   SET last_message_preview=(
         SELECT cm.message_body
           FROM public.conversation_messages cm
          WHERE cm.organizations_id=c.organizations_id
            AND cm.conversations_id=c.conversations_id
            AND nullif(trim(coalesce(cm.message_body,'')),'') IS NOT NULL
            AND lower(trim(cm.message_body)) NOT IN ('[reactionmessage]','[base64]')
          ORDER BY coalesce(cm.provider_timestamp,cm.conversation_messages_created_at) DESC,cm.conversation_messages_id DESC
          LIMIT 1
       ),
       conversations_updated_at=now()
 WHERE lower(trim(coalesce(c.last_message_preview,''))) IN ('[reactionmessage]','[base64]','');

CREATE OR REPLACE FUNCTION public.service_stage5_list_conversations(
  p_organizations_id bigint,p_organization_members_id bigint,p_chip_id bigint DEFAULT NULL,
  p_scope text DEFAULT 'all',p_unread_only boolean DEFAULT false,p_archived boolean DEFAULT false,
  p_search text DEFAULT NULL,p_cursor_at timestamptz DEFAULT NULL,p_cursor_id bigint DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.last_message_at DESC NULLS LAST,x.conversations_id DESC),'[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT c.conversations_id,c.chips_id,c.instances_id,c.leads_id,c.remote_jid,c.contact_phone,
             public.stage5_meaningful_contact_name(c.contact_name) AS contact_name,
             c.contact_avatar_url,c.conversation_status,c.assigned_to_member_id,c.last_replied_by_member_id,
             c.last_message_at,c.last_message_preview,c.last_message_direction,c.assignment_updated_at,c.conversation_version,
             ch.chips_name,ch.chips_phone,
             coalesce(nullif(u.users_name,''),'Membro #'||m.organization_members_id::text) AS assigned_to_member_name,
             (SELECT count(*)::integer FROM public.conversation_messages cm
               WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=c.conversations_id
                 AND cm.direction='inbound'
                 AND cm.conversation_messages_id>coalesce(ms.last_read_message_id,0)) AS unread_count
        FROM public.conversations c
        JOIN public.chips ch ON ch.chips_id=c.chips_id AND ch.organizations_id=c.organizations_id
        LEFT JOIN public.organization_members m ON m.organization_members_id=c.assigned_to_member_id AND m.organizations_id=c.organizations_id
        LEFT JOIN public.users u ON u.users_id=m.users_id
        LEFT JOIN public.conversation_member_states ms ON ms.organizations_id=c.organizations_id
          AND ms.conversations_id=c.conversations_id AND ms.organization_members_id=p_organization_members_id
       WHERE c.organizations_id=p_organizations_id
         AND (p_chip_id IS NULL OR c.chips_id=p_chip_id)
         AND c.conversation_status=CASE WHEN p_archived THEN 'archived' ELSE 'open' END
         AND (p_scope='all' OR (p_scope='mine' AND c.assigned_to_member_id=p_organization_members_id)
              OR (p_scope='unassigned' AND c.assigned_to_member_id IS NULL))
         AND (nullif(trim(coalesce(p_search,'')),'') IS NULL OR concat_ws(' ',c.contact_name,c.contact_phone,c.remote_jid,ch.chips_name,ch.chips_phone) ILIKE '%'||trim(p_search)||'%')
         AND (p_cursor_at IS NULL OR (c.last_message_at,c.conversations_id)<(p_cursor_at,coalesce(p_cursor_id,9223372036854775807)))
         AND (NOT p_unread_only OR EXISTS(
           SELECT 1 FROM public.conversation_messages cm
            WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=c.conversations_id
              AND cm.direction='inbound' AND cm.conversation_messages_id>coalesce(ms.last_read_message_id,0)
         ))
       ORDER BY c.last_message_at DESC NULLS LAST,c.conversations_id DESC
       LIMIT v_limit
    ) x;
  RETURN jsonb_build_object('items',v_rows,'limit',v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_ingest_evolution_message(
  p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,
  p_message_type text,p_message_body text,p_message_status text,p_contact_name text,p_provider_timestamp timestamptz,
  p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip record;v_scope bigint;v_conversation public.conversations%ROWTYPE;v_message public.conversation_messages%ROWTYPE;
  v_direction text:=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END;v_member bigint;v_queue bigint;
  v_remote_jid text;v_contact_name text;v_chip_id bigint;v_any_chip_id bigint;v_active_count integer;v_total_count integer;
BEGIN
  v_remote_jid:=coalesce(public.stage5_payload_phone_jid(p_raw_payload),public.stage5_canonical_remote_jid(p_remote_jid));
  v_contact_name:=public.stage5_meaningful_contact_name(p_contact_name);
  IF v_remote_jid IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','remote_jid_missing'); END IF;
  IF v_remote_jid ILIKE '%@g.us' OR v_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true,'reason','unsupported_chat_kind'); END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','text_body_empty'); END IF;

  SELECT i.instances_id,i.organizations_id INTO v_instance FROM public.instances i WHERE i.instances_id=p_instances_id;
  IF v_instance.instances_id IS NULL THEN RAISE EXCEPTION 'webhook_instance_not_found'; END IF;

  SELECT count(*) FILTER(WHERE c.status_id=1)::integer,count(*)::integer,
         min(c.chips_id) FILTER(WHERE c.status_id=1),min(c.chips_id)
    INTO v_active_count,v_total_count,v_chip_id,v_any_chip_id
    FROM public.chips c
   WHERE c.instances_id=p_instances_id AND c.organizations_id=v_instance.organizations_id;
  IF v_active_count=1 THEN NULL;
  ELSIF v_active_count>1 THEN RAISE EXCEPTION 'webhook_chip_ambiguous_active';
  ELSIF v_total_count=1 THEN v_chip_id:=v_any_chip_id;
  ELSIF v_total_count=0 THEN RETURN jsonb_build_object('ignored',true,'reason','webhook_chip_not_found');
  ELSE RAISE EXCEPTION 'webhook_chip_ambiguous'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_chip_id AND c.organizations_id=v_instance.organizations_id;

  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;

  -- Idempotência vem ANTES do upsert da conversa. Um retry com LID/JID alternativo
  -- nunca pode criar uma thread vazia paralela.
  SELECT * INTO v_message FROM public.conversation_messages
   WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id AND external_message_id=p_external_message_id;
  IF v_message.conversation_messages_id IS NOT NULL THEN
    UPDATE public.conversation_messages SET
      message_status=CASE WHEN public.stage5_status_rank(p_message_status)>=public.stage5_status_rank(message_status) OR message_status IN('failed','reconciliation_required') THEN p_message_status ELSE message_status END,
      message_body=coalesce(nullif(p_message_body,''),message_body),remote_jid=v_remote_jid,
      raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),conversation_messages_updated_at=now()
     WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
    UPDATE public.conversations SET
      contact_name=coalesce(v_contact_name,contact_name),
      contact_phone=coalesce(CASE WHEN v_remote_jid LIKE '%@s.whatsapp.net' THEN regexp_replace(split_part(v_remote_jid,'@',1),'\D','','g') END,contact_phone),
      conversations_updated_at=now()
     WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_message.conversations_id;
    RETURN jsonb_build_object('ignored',false,'merged',true,'conversationId',v_message.conversations_id,'messageId',v_message.conversation_messages_id);
  END IF;

  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip.chips_id,p_instances_id,v_remote_jid,
    CASE WHEN v_remote_jid LIKE '%@s.whatsapp.net' THEN regexp_replace(split_part(v_remote_jid,'@',1),'\D','','g') ELSE NULL END,
    v_contact_name,'open',coalesce(p_provider_timestamp,now()),p_message_body,v_direction,now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET
    contact_name=coalesce(excluded.contact_name,conversations.contact_name),contact_phone=coalesce(excluded.contact_phone,conversations.contact_phone),
    last_message_at=greatest(coalesce(conversations.last_message_at,'epoch'),excluded.last_message_at),
    last_message_preview=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
    last_message_direction=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_direction ELSE conversations.last_message_direction END,
    conversations_updated_at=now()
  RETURNING * INTO v_conversation;

  IF NOT p_from_me AND v_conversation.conversation_status='archived' THEN
    UPDATE public.conversations SET conversation_status='open',conversation_version=conversation_version+1,conversations_updated_at=now()
     WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_conversation.conversations_id
     RETURNING * INTO v_conversation;
  END IF;

  IF p_from_me AND to_regclass('public.queue_item_dispatch_parts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT queue_items_id FROM public.queue_item_dispatch_parts WHERE external_id=$1 ORDER BY queue_item_dispatch_parts_id DESC LIMIT 1' INTO v_queue USING p_external_message_id;
      SELECT qi.dispatched_by_member_id INTO v_member FROM public.queue_items qi WHERE qi.queue_items_id=v_queue AND qi.organizations_id=v_instance.organizations_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,queue_items_id,external_message_id,remote_jid,direction,from_me,
    message_type,message_body,media_url,media_mime_type,media_file_name,quoted_external_message_id,message_status,sent_by_member_id,executed_by,provider_timestamp,raw_payload,
    conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_conversation.conversations_id,v_chip.chips_id,p_instances_id,v_queue,p_external_message_id,v_remote_jid,v_direction,p_from_me,
    'text',p_message_body,NULL,NULL,NULL,p_quoted_external_message_id,p_message_status,
    CASE WHEN p_from_me THEN v_member ELSE NULL END,'system',p_provider_timestamp,coalesce(p_raw_payload,'{}'),now(),now()) RETURNING * INTO v_message;

  IF NOT p_from_me AND v_conversation.assigned_to_member_id IS NULL THEN
    SELECT cm.sent_by_member_id INTO v_member FROM public.conversation_messages cm
     JOIN public.organization_members m ON m.organization_members_id=cm.sent_by_member_id AND m.organizations_id=cm.organizations_id AND m.status_id=1
     WHERE cm.organizations_id=v_instance.organizations_id AND cm.conversations_id=v_conversation.conversations_id
       AND cm.direction='outbound' AND cm.executed_by='system' AND cm.sent_by_member_id IS NOT NULL
     ORDER BY cm.conversation_messages_id DESC LIMIT 1;
    IF v_member IS NOT NULL THEN
      UPDATE public.conversations SET assigned_to_member_id=v_member,assignment_updated_at=now(),conversation_version=conversation_version+1
       WHERE organizations_id=v_instance.organizations_id AND conversations_id=v_conversation.conversations_id AND assigned_to_member_id IS NULL;
    END IF;
  END IF;
  RETURN jsonb_build_object('ignored',false,'merged',false,'conversationId',v_conversation.conversations_id,'messageId',v_message.conversation_messages_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_converge_automatic_message(
  p_organizations_id bigint,p_queue_items_id bigint,p_external_message_id text,p_remote_jid text,p_message_body text,p_message_type text DEFAULT 'text'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;v_chip record;v_scope bigint;v_c public.conversations%ROWTYPE;v_m public.conversation_messages%ROWTYPE;v_remote_jid text;
BEGIN
  IF lower(coalesce(nullif(trim(p_message_type),''),'text'))<>'text' THEN RAISE EXCEPTION 'media_disabled_text_only'; END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'automatic_message_body_required'; END IF;
  v_remote_jid:=public.stage5_canonical_remote_jid(p_remote_jid);
  IF v_remote_jid IS NULL OR v_remote_jid LIKE '%@lid' THEN RAISE EXCEPTION 'automatic_message_phone_jid_required'; END IF;
  SELECT qi.queue_items_id,qi.organizations_id,qi.chips_id,qi.leads_id,qi.dispatched_by_member_id INTO v_q
   FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_items_id AND qi.organizations_id=p_organizations_id;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'automatic_message_queue_item_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_q.chips_id AND c.organizations_id=p_organizations_id;
  IF v_chip.chips_id IS NULL THEN RAISE EXCEPTION 'automatic_message_chip_not_found'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,p_organizations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,v_remote_jid,regexp_replace(split_part(v_remote_jid,'@',1),'\D','','g'),'open',now(),p_message_body,'outbound',now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET leads_id=coalesce(conversations.leads_id,excluded.leads_id),contact_phone=excluded.contact_phone,last_message_at=excluded.last_message_at,
    last_message_preview=excluded.last_message_preview,last_message_direction='outbound',conversations_updated_at=now()
  RETURNING * INTO v_c;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,queue_items_id,external_message_id,remote_jid,
    direction,from_me,message_type,message_body,message_status,sent_by_member_id,executed_by,provider_timestamp,conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,p_organizations_id,v_c.conversations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_queue_items_id,p_external_message_id,v_remote_jid,
    'outbound',true,'text',p_message_body,'sent',v_q.dispatched_by_member_id,'system',now(),now(),now())
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO UPDATE SET
    queue_items_id=coalesce(conversation_messages.queue_items_id,excluded.queue_items_id),sent_by_member_id=coalesce(conversation_messages.sent_by_member_id,excluded.sent_by_member_id),
    executed_by='system',message_body=coalesce(conversation_messages.message_body,excluded.message_body),remote_jid=excluded.remote_jid,conversation_messages_updated_at=now()
  RETURNING * INTO v_m;
  RETURN jsonb_build_object('conversationId',v_c.conversations_id,'messageId',v_m.conversation_messages_id,'merged',true);
END;
$$;

COMMIT;
