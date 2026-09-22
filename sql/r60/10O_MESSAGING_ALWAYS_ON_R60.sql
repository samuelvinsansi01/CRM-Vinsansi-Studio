-- VINSANSI R60.33 — ingestão 1:1 sempre ativa + convergência SEND_MESSAGE
-- Idempotente: não altera tabelas; substitui apenas o contrato service_role de ingestão.
BEGIN;

CREATE OR REPLACE FUNCTION public.service_ingest_evolution_message(
 p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,p_message_type text,p_message_body text,p_message_status text,
 p_contact_name text,p_provider_timestamp timestamptz,p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_org bigint;v_user bigint;v_chip bigint;v_contact bigint;v_state text;v_conv bigint;v_msg bigint;v_existing_status text;v_phone text;v_aliases text[];v_alt text;v_body text;v_type text;v_status text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF lower(coalesce(p_event_type,'')) NOT IN ('messages.upsert','send.message','send_message','sendmessage','message','messages_upsert') THEN RETURN jsonb_build_object('ignored',true,'reason','not_direct_message'); END IF;
  IF NOT public.r60_is_direct_whatsapp_alias(p_remote_jid) THEN RETURN jsonb_build_object('ignored',true,'reason','non_direct'); END IF;
  SELECT i.organizations_id,i.users_id,c.chips_id INTO v_org,v_user,v_chip FROM public.instances i JOIN public.chips c ON c.instances_id=i.instances_id AND c.organizations_id=i.organizations_id AND c.status_id=1
   WHERE i.instances_id=p_instances_id ORDER BY c.chips_id LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'instance_scope_not_found'; END IF;
  v_aliases:=public.r60_contact_aliases_from_payload(p_remote_jid,coalesce(p_raw_payload,'{}'::jsonb));
  SELECT x INTO v_alt FROM unnest(v_aliases) x WHERE x<>public.r60_normalize_provider_alias(p_remote_jid) ORDER BY x LIKE '%@lid',x LIMIT 1;
  v_contact:=public.r60_resolve_whatsapp_contact(v_org,p_instances_id,v_chip,p_remote_jid,v_alt,CASE WHEN p_from_me THEN NULL ELSE p_contact_name END);
  IF NOT p_from_me AND nullif(btrim(coalesce(p_contact_name,'')),'') IS NOT NULL THEN
    UPDATE public.whatsapp_contacts SET display_name=left(btrim(p_contact_name),160),whatsapp_contacts_updated_at=now() WHERE whatsapp_contacts_id=v_contact;
  END IF;
  SELECT contact_state,normalized_phone INTO v_state,v_phone FROM public.whatsapp_contacts WHERE whatsapp_contacts_id=v_contact;
  IF v_state='ignored' THEN RETURN jsonb_build_object('ignored',true,'reason','contact_ignored','contactId',v_contact); END IF;
  IF nullif(btrim(coalesce(p_external_message_id,'')),'') IS NULL THEN RAISE EXCEPTION 'external_message_id_required'; END IF;
  SELECT conversation_messages_id,message_status INTO v_msg,v_existing_status FROM public.conversation_messages WHERE organizations_id=v_org AND instances_id=p_instances_id AND external_message_id=p_external_message_id FOR UPDATE;
  IF v_msg IS NOT NULL THEN
    v_status:=CASE WHEN lower(coalesce(p_message_status,'')) IN ('pending','sending','sent','delivered','read','failed','deleted','reconciliation_required') THEN lower(p_message_status) ELSE CASE WHEN p_from_me THEN 'sent' ELSE 'delivered' END END;
    UPDATE public.conversation_messages
    SET message_status=CASE WHEN public.chat_message_status_rank(v_status)>public.chat_message_status_rank(message_status) THEN v_status ELSE message_status END,
        provider_timestamp=coalesce(p_provider_timestamp,provider_timestamp),
        media_url=coalesce(media_url,nullif(btrim(coalesce(p_media_url,'')),'')),
        media_mime_type=coalesce(media_mime_type,nullif(btrim(coalesce(p_media_mime_type,'')),'')),
        media_file_name=coalesce(media_file_name,nullif(btrim(coalesce(p_media_file_name,'')),'')),
        conversation_messages_updated_at=now()
    WHERE conversation_messages_id=v_msg;
    RETURN jsonb_build_object('duplicate',true,'converged',true,'messageId',v_msg,'status',CASE WHEN public.chat_message_status_rank(v_status)>public.chat_message_status_rank(v_existing_status) THEN v_status ELSE v_existing_status END);
  END IF;
  SELECT conversations_id INTO v_conv FROM public.conversations WHERE organizations_id=v_org AND chips_id=v_chip AND whatsapp_contacts_id=v_contact FOR UPDATE;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,whatsapp_contacts_id,remote_jid,contact_phone,contact_name,conversation_status,unread_count)
    SELECT v_user,v_org,v_chip,p_instances_id,wc.leads_id,v_contact,public.r60_normalize_provider_alias(p_remote_jid),v_phone,CASE WHEN p_from_me THEN NULL ELSE nullif(btrim(coalesce(p_contact_name,'')),'') END,'open',0
    FROM public.whatsapp_contacts wc WHERE wc.whatsapp_contacts_id=v_contact RETURNING conversations_id INTO v_conv;
  END IF;
  v_type:=lower(coalesce(nullif(btrim(p_message_type),''),'text'));
  v_body:=CASE v_type WHEN 'image' THEN '[Imagem]' WHEN 'audio' THEN '[Áudio]' WHEN 'sticker' THEN '[Figurinha]' WHEN 'document' THEN '[Documento]' ELSE left(coalesce(p_message_body,''),8000) END;
  IF v_type NOT IN ('text','image','audio','sticker','document') THEN v_type:='text'; v_body:=left(coalesce(p_message_body,''),8000); END IF;
  v_status:=CASE WHEN lower(coalesce(p_message_status,'')) IN ('pending','sending','sent','delivered','read','failed','deleted','reconciliation_required') THEN lower(p_message_status) ELSE CASE WHEN p_from_me THEN 'sent' ELSE 'delivered' END END;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,external_message_id,remote_jid,direction,from_me,message_type,message_body,message_status,provider_timestamp,raw_payload,media_url,media_mime_type,media_file_name,quoted_external_message_id)
  SELECT v_user,v_org,v_conv,v_chip,p_instances_id,wc.leads_id,p_external_message_id,public.r60_normalize_provider_alias(p_remote_jid),CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END,p_from_me,v_type,v_body,v_status,p_provider_timestamp,'{}'::jsonb,nullif(btrim(coalesce(p_media_url,'')),''),nullif(btrim(coalesce(p_media_mime_type,'')),''),nullif(btrim(coalesce(p_media_file_name,'')),''),p_quoted_external_message_id
  FROM public.whatsapp_contacts wc WHERE wc.whatsapp_contacts_id=v_contact
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING RETURNING conversation_messages_id INTO v_msg;
  IF v_msg IS NULL THEN SELECT conversation_messages_id INTO v_msg FROM public.conversation_messages WHERE organizations_id=v_org AND instances_id=p_instances_id AND external_message_id=p_external_message_id; RETURN jsonb_build_object('duplicate',true,'messageId',v_msg); END IF;
  UPDATE public.conversations SET remote_jid=public.r60_normalize_provider_alias(p_remote_jid),contact_phone=v_phone,
    contact_name=CASE WHEN NOT p_from_me AND nullif(btrim(coalesce(p_contact_name,'')),'') IS NOT NULL THEN left(btrim(p_contact_name),160) ELSE contact_name END,last_message_at=coalesce(p_provider_timestamp,now()),last_message_preview=left(v_body,300),
    last_message_direction=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END,
    unread_count=CASE WHEN p_from_me THEN unread_count ELSE unread_count+1 END,conversation_status='open',conversation_version=conversation_version+1,conversations_updated_at=now()
  WHERE conversations_id=v_conv;
  RETURN jsonb_build_object('ignored',false,'duplicate',false,'conversationId',v_conv,'messageId',v_msg,'contactId',v_contact,'contactState',v_state);
END $$;

COMMIT;
