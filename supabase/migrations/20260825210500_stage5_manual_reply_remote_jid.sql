-- CRM Vinsansi Studio v2.4.0-R28
-- Resposta manual deve preservar o JID canônico da conversa.
-- Telefone é apenas fallback quando a conversa não possui remote_jid.

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
      'conversationVersion',v_c.conversation_version,'instancesId',v_existing.instances_id,'recipient',coalesce(nullif(trim(v_c.remote_jid),''),nullif(trim(v_c.contact_phone),''),nullif(trim(v_existing.remote_jid),'')));
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
    'conversationVersion',v_c.conversation_version,'instancesId',v_c.instances_id,'recipient',coalesce(nullif(trim(v_c.remote_jid),''),nullif(trim(v_c.contact_phone),'')));
END;
$$;

