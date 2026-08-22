-- CRM Vinsansi Studio v1.4.1 — fechamento Etapa 5
-- Text-only operacional + reabertura automática de conversa arquivada.
-- A reabertura ocorre somente para mensagem inbound nova; retries/duplicatas não reabrem.
-- Pode ser aplicado sobre a v1.4.0 já instalada.

CREATE OR REPLACE FUNCTION public.service_stage5_prepare_manual_message(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_expected_version integer,
  p_client_idempotency_key uuid,p_message_body text,p_message_type text DEFAULT 'text',
  p_media_storage_path text DEFAULT NULL,p_media_mime_type text DEFAULT NULL,p_media_file_name text DEFAULT NULL,p_media_size_bytes bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;v_existing public.conversation_messages%ROWTYPE;v_message public.conversation_messages%ROWTYPE;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  IF p_client_idempotency_key IS NULL THEN RAISE EXCEPTION 'manual_message_idempotency_key_required'; END IF;
  IF lower(coalesce(nullif(trim(p_message_type),''),'text'))<>'text' OR p_media_storage_path IS NOT NULL OR p_media_mime_type IS NOT NULL OR p_media_file_name IS NOT NULL OR p_media_size_bytes IS NOT NULL THEN RAISE EXCEPTION 'media_disabled_text_only'; END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'manual_message_body_required'; END IF;
  SELECT * INTO v_existing FROM public.conversation_messages WHERE organizations_id=p_organizations_id AND client_idempotency_key=p_client_idempotency_key;
  IF v_existing.conversation_messages_id IS NOT NULL THEN
    IF v_existing.conversations_id<>p_conversations_id OR v_existing.sent_by_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'manual_message_idempotency_conflict'; END IF;
    SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
    RETURN jsonb_build_object('idempotent',true,'messageId',v_existing.conversation_messages_id,'status',v_existing.message_status,
      'conversationVersion',v_c.conversation_version,'instancesId',v_existing.instances_id,'recipient',coalesce(v_c.contact_phone,v_existing.remote_jid));
  END IF;
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_c.conversation_status='archived' THEN RAISE EXCEPTION 'conversation_archived'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  IF v_c.assigned_to_member_id IS NULL THEN
    UPDATE public.conversations SET assigned_to_member_id=p_organization_members_id,assignment_updated_at=now(),conversation_version=conversation_version+1
     WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
    v_c.assigned_to_member_id:=p_organization_members_id;v_c.conversation_version:=v_c.conversation_version+1;
  ELSIF v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assigned_to_other_member'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversation_messages(
    users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,remote_jid,direction,from_me,
    message_type,message_body,media_storage_path,media_mime_type,media_file_name,media_size_bytes,
    message_status,client_idempotency_key,sent_by_member_id,executed_by,conversation_messages_created_at,conversation_messages_updated_at
  ) VALUES(
    v_scope,p_organizations_id,p_conversations_id,v_c.chips_id,v_c.instances_id,v_c.leads_id,v_c.remote_jid,'outbound',true,
    coalesce(nullif(p_message_type,''),'text'),nullif(p_message_body,''),p_media_storage_path,p_media_mime_type,p_media_file_name,p_media_size_bytes,
    'pending',p_client_idempotency_key,p_organization_members_id,'member',now(),now()
  ) RETURNING * INTO v_message;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,'conversation.manual_message_prepared',p_conversations_id::text,
    jsonb_build_object('conversation_message_id',v_message.conversation_messages_id,'client_idempotency_key',p_client_idempotency_key));
  RETURN jsonb_build_object('idempotent',false,'messageId',v_message.conversation_messages_id,'status',v_message.message_status,
    'conversationVersion',v_c.conversation_version,'instancesId',v_c.instances_id,'recipient',coalesce(v_c.contact_phone,v_c.remote_jid));
END;
$$;

DROP FUNCTION IF EXISTS public.service_ingest_evolution_message(bigint,text,text,text,boolean,text,text,text,text,timestamptz,jsonb,text,text,text,text);
CREATE FUNCTION public.service_ingest_evolution_message(
  p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,
  p_message_type text,p_message_body text,p_message_status text,p_contact_name text,p_provider_timestamp timestamptz,
  p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip record;v_scope bigint;v_conversation public.conversations%ROWTYPE;v_message public.conversation_messages%ROWTYPE;
  v_direction text:=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END;v_member bigint;v_queue bigint;v_sent bigint;
BEGIN
  IF p_remote_jid ILIKE '%@g.us' OR p_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true,'reason','unsupported_chat_kind'); END IF;
  SELECT i.instances_id,i.organizations_id INTO v_instance FROM public.instances i WHERE i.instances_id=p_instances_id;
  IF v_instance.instances_id IS NULL THEN RAISE EXCEPTION 'webhook_instance_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.instances_id=p_instances_id AND c.organizations_id=v_instance.organizations_id ORDER BY c.chips_id LIMIT 1;
  IF v_chip.chips_id IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','webhook_chip_not_found'); END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip.chips_id,p_instances_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),nullif(p_contact_name,''),'open',coalesce(p_provider_timestamp,now()),coalesce(p_message_body,'['||p_message_type||']'),v_direction,now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET contact_name=coalesce(nullif(excluded.contact_name,''),conversations.contact_name),
    last_message_at=greatest(coalesce(conversations.last_message_at,'epoch'),excluded.last_message_at),
    last_message_preview=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_preview ELSE conversations.last_message_preview END,
    last_message_direction=CASE WHEN excluded.last_message_at>=coalesce(conversations.last_message_at,'epoch') THEN excluded.last_message_direction ELSE conversations.last_message_direction END,
    conversations_updated_at=now()
  RETURNING * INTO v_conversation;
  SELECT * INTO v_message FROM public.conversation_messages WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id AND external_message_id=p_external_message_id;
  IF v_message.conversation_messages_id IS NOT NULL THEN
    UPDATE public.conversation_messages SET
      message_status=CASE WHEN public.stage5_status_rank(p_message_status)>=public.stage5_status_rank(message_status) OR message_status IN('failed','reconciliation_required') THEN p_message_status ELSE message_status END,
      message_body=coalesce(nullif(p_message_body,''),message_body),media_url=coalesce(nullif(p_media_url,''),media_url),
      media_mime_type=coalesce(nullif(p_media_mime_type,''),media_mime_type),media_file_name=coalesce(nullif(p_media_file_name,''),media_file_name),
      raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),conversation_messages_updated_at=now()
     WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
    RETURN jsonb_build_object('ignored',false,'merged',true,'conversationId',v_message.conversations_id,'messageId',v_message.conversation_messages_id);
  END IF;
  -- Somente uma mensagem inbound nova reabre uma conversa arquivada. Retries/duplicatas
  -- já mesclados acima não alteram o estado da conversa.
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
  VALUES(v_scope,v_instance.organizations_id,v_conversation.conversations_id,v_chip.chips_id,p_instances_id,v_queue,p_external_message_id,p_remote_jid,v_direction,p_from_me,
    coalesce(nullif(p_message_type,''),'unsupported'),p_message_body,p_media_url,p_media_mime_type,p_media_file_name,p_quoted_external_message_id,p_message_status,
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
DECLARE v_q record;v_chip record;v_scope bigint;v_c public.conversations%ROWTYPE;v_m public.conversation_messages%ROWTYPE;
BEGIN
  IF lower(coalesce(nullif(trim(p_message_type),''),'text'))<>'text' THEN RAISE EXCEPTION 'media_disabled_text_only'; END IF;
  IF nullif(trim(coalesce(p_message_body,'')),'') IS NULL THEN RAISE EXCEPTION 'automatic_message_body_required'; END IF;
  SELECT qi.queue_items_id,qi.organizations_id,qi.chips_id,qi.leads_id,qi.dispatched_by_member_id INTO v_q
   FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_items_id AND qi.organizations_id=p_organizations_id;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'automatic_message_queue_item_not_found'; END IF;
  SELECT c.chips_id,c.instances_id INTO v_chip FROM public.chips c WHERE c.chips_id=v_q.chips_id AND c.organizations_id=p_organizations_id;
  IF v_chip.chips_id IS NULL THEN RAISE EXCEPTION 'automatic_message_chip_not_found'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,remote_jid,contact_phone,conversation_status,last_message_at,last_message_preview,last_message_direction,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,p_organizations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),'open',now(),p_message_body,'outbound',now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET leads_id=coalesce(conversations.leads_id,excluded.leads_id),last_message_at=excluded.last_message_at,
    last_message_preview=excluded.last_message_preview,last_message_direction='outbound',conversations_updated_at=now()
  RETURNING * INTO v_c;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,queue_items_id,external_message_id,remote_jid,
    direction,from_me,message_type,message_body,message_status,sent_by_member_id,executed_by,provider_timestamp,conversation_messages_created_at,conversation_messages_updated_at)
  VALUES(v_scope,p_organizations_id,v_c.conversations_id,v_chip.chips_id,v_chip.instances_id,v_q.leads_id,p_queue_items_id,p_external_message_id,p_remote_jid,
    'outbound',true,coalesce(nullif(p_message_type,''),'text'),p_message_body,'sent',v_q.dispatched_by_member_id,'system',now(),now(),now())
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO UPDATE SET
    queue_items_id=coalesce(conversation_messages.queue_items_id,excluded.queue_items_id),sent_by_member_id=coalesce(conversation_messages.sent_by_member_id,excluded.sent_by_member_id),
    executed_by='system',message_body=coalesce(conversation_messages.message_body,excluded.message_body),conversation_messages_updated_at=now()
  RETURNING * INTO v_m;
  RETURN jsonb_build_object('conversationId',v_c.conversations_id,'messageId',v_m.conversation_messages_id,'merged',true);
END;
$$;
