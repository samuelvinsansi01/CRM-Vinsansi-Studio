BEGIN;

CREATE OR REPLACE FUNCTION public.r60_require_actor(p_organizations_id bigint,p_permission text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_member bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT m.organization_members_id INTO v_member
  FROM public.users u
  JOIN public.organization_members m ON m.users_id=u.users_id
  WHERE u.auth_user_id=auth.uid() AND u.status_id=1
    AND m.organizations_id=p_organizations_id AND m.status_id=1
  ORDER BY m.organization_members_id LIMIT 1;
  IF v_member IS NULL THEN RAISE EXCEPTION 'conversation_active_membership_required'; END IF;
  IF NOT public.auth_user_has_organization_permission(auth.uid(),p_organizations_id,p_permission) THEN
    RAISE EXCEPTION 'conversation_permission_denied:%',p_permission;
  END IF;
  RETURN v_member;
END;
$$;

-- Remove assinaturas R59 que aceitavam member id como autoridade externa.
DROP FUNCTION IF EXISTS public.service_stage5_list_conversations(bigint,bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer);
DROP FUNCTION IF EXISTS public.service_stage5_list_messages(bigint,bigint,bigint,bigint,bigint,integer);
DROP FUNCTION IF EXISTS public.service_stage5_mark_read(bigint,bigint,bigint,bigint);
DROP FUNCTION IF EXISTS public.service_stage5_set_archived(bigint,bigint,bigint,boolean,integer);
DROP FUNCTION IF EXISTS public.service_stage5_assign_conversation(bigint,bigint,bigint,text,bigint,integer);
DROP FUNCTION IF EXISTS public.service_stage5_presence(bigint,bigint,bigint,text,boolean,boolean,boolean);

CREATE OR REPLACE FUNCTION public.service_stage5_list_conversations(
  p_organizations_id bigint,
  p_chip_id bigint DEFAULT NULL,
  p_scope text DEFAULT 'all',
  p_unread_only boolean DEFAULT false,
  p_archived boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_contact_state text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_member bigint; v_rows jsonb; v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  v_member:=public.r60_require_actor(p_organizations_id,'whatsapp.view');
  IF p_scope NOT IN ('all','mine','unassigned') THEN RAISE EXCEPTION 'conversation_scope_invalid'; END IF;
  IF p_contact_state IS NOT NULL AND p_contact_state NOT IN ('lead','unknown','ignored') THEN RAISE EXCEPTION 'contact_state_invalid'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.last_message_at DESC NULLS LAST,x.conversations_id DESC),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT c.conversations_id,c.chips_id,c.instances_id,c.whatsapp_contacts_id,wc.leads_id,
      c.remote_jid,wc.normalized_phone AS contact_phone,coalesce(wc.display_name,c.contact_name) AS contact_name,
      c.contact_avatar_url,c.conversation_status,c.unread_count,c.last_message_at,c.last_message_preview,c.last_message_direction,
      c.assigned_to_member_id,c.last_replied_by_member_id,c.conversation_version,c.assignment_updated_at,c.conversations_updated_at,
      wc.contact_state,wc.ignored_at,
      coalesce(nullif(l.leads_alternative_name,''),nullif(l.leads_name,''),nullif(wc.display_name,''),wc.normalized_phone,'Não cadastrado') AS display_name,
      l.leads_name,l.leads_alternative_name,ch.chips_name,ch.chips_phone
    FROM public.conversations c
    JOIN public.whatsapp_contacts wc ON wc.whatsapp_contacts_id=c.whatsapp_contacts_id AND wc.organizations_id=c.organizations_id
    JOIN public.chips ch ON ch.chips_id=c.chips_id AND ch.organizations_id=c.organizations_id
    LEFT JOIN public.leads l ON l.leads_id=wc.leads_id AND l.organizations_id=c.organizations_id
    WHERE c.organizations_id=p_organizations_id
      AND (p_chip_id IS NULL OR c.chips_id=p_chip_id)
      AND c.conversation_status=CASE WHEN p_archived THEN 'archived' ELSE 'open' END
      AND (p_contact_state IS NULL OR wc.contact_state=p_contact_state)
      AND (p_contact_state='ignored' OR wc.contact_state<>'ignored')
      AND (p_scope='all' OR (p_scope='mine' AND c.assigned_to_member_id=v_member) OR (p_scope='unassigned' AND c.assigned_to_member_id IS NULL))
      AND (nullif(btrim(coalesce(p_search,'')),'') IS NULL OR concat_ws(' ',wc.display_name,wc.normalized_phone,l.leads_name,l.leads_alternative_name,ch.chips_name,ch.chips_phone) ILIKE '%'||btrim(p_search)||'%')
      AND (p_cursor_at IS NULL OR (c.last_message_at,c.conversations_id)<(p_cursor_at,coalesce(p_cursor_id,9223372036854775807)))
      AND (NOT p_unread_only OR c.unread_count>0)
    ORDER BY c.last_message_at DESC NULLS LAST,c.conversations_id DESC
    LIMIT v_limit
  ) x;
  RETURN jsonb_build_object('items',v_rows,'limit',v_limit,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=v_limit THEN jsonb_build_object('at',v_rows->(jsonb_array_length(v_rows)-1)->>'last_message_at','id',v_rows->(jsonb_array_length(v_rows)-1)->>'conversations_id') ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_list_messages(
  p_organizations_id bigint,p_conversations_id bigint,p_before_id bigint DEFAULT NULL,p_after_id bigint DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_rows jsonb; v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  PERFORM public.r60_require_actor(p_organizations_id,'whatsapp.view');
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE conversations_id=p_conversations_id AND organizations_id=p_organizations_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.conversation_messages_id),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT cm.conversation_messages_id,cm.conversations_id,cm.queue_items_id,cm.sents_id,cm.external_message_id,cm.client_idempotency_key,
      cm.direction,cm.from_me,cm.message_type,cm.message_body,cm.quoted_external_message_id,cm.message_status,
      cm.sent_by_member_id,cm.executed_by,cm.provider_timestamp,cm.error_message,cm.reconciliation_state,
      cm.conversation_messages_created_at,cm.conversation_messages_updated_at
    FROM public.conversation_messages cm
    WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=p_conversations_id
      AND (p_before_id IS NULL OR cm.conversation_messages_id<p_before_id)
      AND (p_after_id IS NULL OR cm.conversation_messages_id>p_after_id)
    ORDER BY CASE WHEN p_after_id IS NULL THEN cm.conversation_messages_id END DESC,
             CASE WHEN p_after_id IS NOT NULL THEN cm.conversation_messages_id END ASC
    LIMIT v_limit
  ) x;
  RETURN jsonb_build_object('items',v_rows,'limit',v_limit,
    'hasMoreBefore',CASE WHEN p_after_id IS NULL AND jsonb_array_length(v_rows)=v_limit THEN true ELSE false END);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_mark_read(p_organizations_id bigint,p_conversations_id bigint,p_last_read_message_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_member bigint; v_last bigint;
BEGIN
  v_member:=public.r60_require_actor(p_organizations_id,'whatsapp.view');
  SELECT coalesce(p_last_read_message_id,max(conversation_messages_id)) INTO v_last FROM public.conversation_messages
   WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id;
  INSERT INTO public.conversation_member_states(organizations_id,conversations_id,organization_members_id,last_read_message_id,last_viewed_at)
  VALUES(p_organizations_id,p_conversations_id,v_member,v_last,now())
  ON CONFLICT(organizations_id,conversations_id,organization_members_id) DO UPDATE SET
    last_read_message_id=greatest(coalesce(conversation_member_states.last_read_message_id,0),coalesce(excluded.last_read_message_id,0)),last_viewed_at=now(),conversation_member_states_updated_at=now();
  UPDATE public.conversations SET unread_count=0,last_read_at=now(),conversations_updated_at=now()
   WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id AND unread_count<>0;
  RETURN jsonb_build_object('conversationId',p_conversations_id,'lastReadMessageId',v_last);
END $$;

CREATE OR REPLACE FUNCTION public.service_stage5_set_archived(p_organizations_id bigint,p_conversations_id bigint,p_archived boolean,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_member bigint; v_row public.conversations%ROWTYPE;
BEGIN
  v_member:=public.r60_require_actor(p_organizations_id,'whatsapp.reply');
  SELECT * INTO v_row FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_row.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_row.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  UPDATE public.conversations SET conversation_status=CASE WHEN p_archived THEN 'archived' ELSE 'open' END,
    conversation_version=conversation_version+1,conversations_updated_at=now()
  WHERE conversations_id=p_conversations_id;
  RETURN jsonb_build_object('conversationId',p_conversations_id,'version',p_expected_version+1,'archived',p_archived);
END $$;

CREATE OR REPLACE FUNCTION public.service_stage5_assign_conversation(p_organizations_id bigint,p_conversations_id bigint,p_action text,p_target_member_id bigint,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor bigint; v_target bigint; v_version integer;
BEGIN
  v_actor:=public.r60_require_actor(p_organizations_id,'whatsapp.assign');
  IF p_action NOT IN ('assign','unassign','take') THEN RAISE EXCEPTION 'conversation_assignment_action_invalid'; END IF;
  IF p_action='take' THEN v_target:=v_actor;
  ELSIF p_action='unassign' THEN v_target:=NULL;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_members_id=p_target_member_id AND organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'transfer_target_invalid'; END IF;
    v_target:=p_target_member_id;
  END IF;
  UPDATE public.conversations SET assigned_to_member_id=v_target,assignment_updated_at=now(),conversation_version=conversation_version+1,conversations_updated_at=now()
  WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id AND conversation_version=p_expected_version
  RETURNING conversation_version INTO v_version;
  IF v_version IS NULL THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  RETURN jsonb_build_object('conversationId',p_conversations_id,'assignedToMemberId',v_target,'version',v_version);
END $$;

CREATE OR REPLACE FUNCTION public.service_stage5_ignore_contact(p_organizations_id bigint,p_conversations_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_member bigint; v_contact bigint;
BEGIN
  v_member:=public.r60_require_actor(p_organizations_id,'whatsapp.reply');
  SELECT whatsapp_contacts_id INTO v_contact FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_contact IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  UPDATE public.whatsapp_contacts SET contact_state='ignored',ignored_at=now(),ignored_by_member_id=v_member,whatsapp_contacts_updated_at=now()
  WHERE organizations_id=p_organizations_id AND whatsapp_contacts_id=v_contact AND contact_state<>'lead';
  UPDATE public.conversations SET unread_count=0,conversation_version=conversation_version+1,conversations_updated_at=now() WHERE organizations_id=p_organizations_id AND whatsapp_contacts_id=v_contact;
  RETURN jsonb_build_object('contactId',v_contact,'state','ignored');
END $$;

CREATE OR REPLACE FUNCTION public.service_stage5_restore_contact(p_organizations_id bigint,p_whatsapp_contacts_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.r60_require_actor(p_organizations_id,'whatsapp.reply');
  UPDATE public.whatsapp_contacts SET contact_state='unknown',ignored_at=NULL,ignored_by_member_id=NULL,whatsapp_contacts_updated_at=now()
  WHERE organizations_id=p_organizations_id AND whatsapp_contacts_id=p_whatsapp_contacts_id AND contact_state='ignored';
  IF NOT FOUND THEN RAISE EXCEPTION 'ignored_contact_not_found'; END IF;
  UPDATE public.conversations SET conversation_version=conversation_version+1,conversations_updated_at=now() WHERE organizations_id=p_organizations_id AND whatsapp_contacts_id=p_whatsapp_contacts_id;
  RETURN jsonb_build_object('contactId',p_whatsapp_contacts_id,'state','unknown');
END $$;

CREATE OR REPLACE FUNCTION public.service_stage5_promote_unknown_contact(
 p_organizations_id bigint,p_conversations_id bigint,p_name text,p_alternative_name text,p_branches_id bigint,p_countries_id bigint,
 p_states_id bigint,p_cities_id bigint,p_contact_sources_id bigint,p_channels_id bigint DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_member bigint; v_contact public.whatsapp_contacts%ROWTYPE; v_scope_user bigint; v_lead bigint;
BEGIN
  v_member:=public.r60_require_actor(p_organizations_id,'leads.create');
  SELECT wc.* INTO v_contact FROM public.conversations c JOIN public.whatsapp_contacts wc ON wc.whatsapp_contacts_id=c.whatsapp_contacts_id
  WHERE c.organizations_id=p_organizations_id AND c.conversations_id=p_conversations_id FOR UPDATE OF wc;
  IF v_contact.whatsapp_contacts_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_contact.contact_state='lead' THEN RETURN jsonb_build_object('leadId',v_contact.leads_id,'contactId',v_contact.whatsapp_contacts_id,'state','lead','idempotent',true); END IF;
  IF v_contact.contact_state='ignored' THEN RAISE EXCEPTION 'ignored_contact_must_be_restored_first'; END IF;
  SELECT legacy_scope_users_id INTO v_scope_user FROM public.organizations WHERE organizations_id=p_organizations_id;
  INSERT INTO public.leads(users_id,organizations_id,branches_id,countries_id,states_id,cities_id,channels_id,lead_status_id,leads_name,
    leads_alternative_name,leads_phone,leads_whatsapp,leads_origin,contact_sources_id,created_by_member_id)
  VALUES(v_scope_user,p_organizations_id,p_branches_id,p_countries_id,p_states_id,p_cities_id,p_channels_id,1,
    left(coalesce(nullif(btrim(p_name),''),nullif(btrim(v_contact.display_name),''),'Contato WhatsApp'),160),nullif(left(btrim(coalesce(p_alternative_name,'')),160),''),
    v_contact.normalized_phone,v_contact.normalized_phone,'manual',p_contact_sources_id,v_member)
  RETURNING leads_id INTO v_lead;
  UPDATE public.whatsapp_contacts SET leads_id=v_lead,contact_state='lead',ignored_at=NULL,ignored_by_member_id=NULL,whatsapp_contacts_updated_at=now()
  WHERE whatsapp_contacts_id=v_contact.whatsapp_contacts_id;
  UPDATE public.conversations SET leads_id=v_lead,conversation_version=conversation_version+1,conversations_updated_at=now() WHERE organizations_id=p_organizations_id AND whatsapp_contacts_id=v_contact.whatsapp_contacts_id;
  UPDATE public.conversation_messages SET leads_id=v_lead,conversation_messages_updated_at=now() WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id AND leads_id IS DISTINCT FROM v_lead;
  RETURN jsonb_build_object('leadId',v_lead,'contactId',v_contact.whatsapp_contacts_id,'state','lead','idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.service_stage5_presence(p_organizations_id bigint,p_conversations_id bigint,p_session_key text,p_viewing boolean DEFAULT true,p_typing boolean DEFAULT false,p_stop boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.r60_require_actor(p_organizations_id,CASE WHEN p_typing THEN 'whatsapp.reply' ELSE 'whatsapp.view' END);
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  -- R60: presença é efêmera e transportada por Supabase Realtime Presence no cliente.
  RETURN jsonb_build_object('transport','realtime_presence','persisted',false,'viewerTtlSeconds',45,'typingTtlSeconds',8);
END $$;

CREATE OR REPLACE FUNCTION public.service_ingest_evolution_message(
 p_instances_id bigint,p_event_type text,p_external_message_id text,p_remote_jid text,p_from_me boolean,p_message_type text,p_message_body text,p_message_status text,
 p_contact_name text,p_provider_timestamp timestamptz,p_raw_payload jsonb,p_media_url text,p_media_mime_type text,p_media_file_name text,p_quoted_external_message_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_org bigint;v_user bigint;v_chip bigint;v_contact bigint;v_state text;v_conv bigint;v_msg bigint;v_phone text;v_aliases text[];v_alt text;v_body text;v_type text;v_status text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF lower(coalesce(p_event_type,'')) NOT IN ('messages.upsert','send.message','message','messages_upsert') THEN RETURN jsonb_build_object('ignored',true,'reason','not_direct_message'); END IF;
  IF NOT public.r60_is_direct_whatsapp_alias(p_remote_jid) THEN RETURN jsonb_build_object('ignored',true,'reason','non_direct'); END IF;
  SELECT i.organizations_id,i.users_id,c.chips_id INTO v_org,v_user,v_chip FROM public.instances i JOIN public.chips c ON c.instances_id=i.instances_id AND c.organizations_id=i.organizations_id AND c.status_id=1
   WHERE i.instances_id=p_instances_id ORDER BY c.chips_id LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'instance_scope_not_found'; END IF;
  v_aliases:=public.r60_contact_aliases_from_payload(p_remote_jid,coalesce(p_raw_payload,'{}'::jsonb));
  SELECT x INTO v_alt FROM unnest(v_aliases) x WHERE x<>public.r60_normalize_provider_alias(p_remote_jid) ORDER BY x LIKE '%@lid',x LIMIT 1;
  v_contact:=public.r60_resolve_whatsapp_contact(v_org,p_instances_id,v_chip,p_remote_jid,v_alt,p_contact_name);
  SELECT contact_state,normalized_phone INTO v_state,v_phone FROM public.whatsapp_contacts WHERE whatsapp_contacts_id=v_contact;
  IF v_state='ignored' THEN RETURN jsonb_build_object('ignored',true,'reason','contact_ignored','contactId',v_contact); END IF;
  IF nullif(btrim(coalesce(p_external_message_id,'')),'') IS NULL THEN RAISE EXCEPTION 'external_message_id_required'; END IF;
  SELECT conversation_messages_id INTO v_msg FROM public.conversation_messages WHERE organizations_id=v_org AND instances_id=p_instances_id AND external_message_id=p_external_message_id;
  IF v_msg IS NOT NULL THEN RETURN jsonb_build_object('duplicate',true,'messageId',v_msg); END IF;
  SELECT conversations_id INTO v_conv FROM public.conversations WHERE organizations_id=v_org AND chips_id=v_chip AND whatsapp_contacts_id=v_contact FOR UPDATE;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,whatsapp_contacts_id,remote_jid,contact_phone,contact_name,conversation_status,unread_count)
    SELECT v_user,v_org,v_chip,p_instances_id,wc.leads_id,v_contact,public.r60_normalize_provider_alias(p_remote_jid),v_phone,nullif(btrim(coalesce(p_contact_name,'')),''),'open',0
    FROM public.whatsapp_contacts wc WHERE wc.whatsapp_contacts_id=v_contact RETURNING conversations_id INTO v_conv;
  END IF;
  v_type:=lower(coalesce(nullif(btrim(p_message_type),''),'text'));
  v_body:=CASE v_type WHEN 'image' THEN '[Imagem]' WHEN 'audio' THEN '[Áudio]' WHEN 'sticker' THEN '[Figurinha]' WHEN 'document' THEN '[Documento]' ELSE left(coalesce(p_message_body,''),8000) END;
  IF v_type NOT IN ('text','image','audio','sticker','document') THEN v_type:='text'; v_body:=left(coalesce(p_message_body,''),8000); END IF;
  v_status:=CASE WHEN lower(coalesce(p_message_status,'')) IN ('pending','sending','sent','delivered','read','failed','deleted','reconciliation_required') THEN lower(p_message_status) ELSE CASE WHEN p_from_me THEN 'sent' ELSE 'delivered' END END;
  INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,external_message_id,remote_jid,direction,from_me,message_type,message_body,message_status,provider_timestamp,raw_payload,quoted_external_message_id)
  SELECT v_user,v_org,v_conv,v_chip,p_instances_id,wc.leads_id,p_external_message_id,public.r60_normalize_provider_alias(p_remote_jid),CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END,p_from_me,v_type,v_body,v_status,p_provider_timestamp,'{}'::jsonb,p_quoted_external_message_id
  FROM public.whatsapp_contacts wc WHERE wc.whatsapp_contacts_id=v_contact
  ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING RETURNING conversation_messages_id INTO v_msg;
  IF v_msg IS NULL THEN SELECT conversation_messages_id INTO v_msg FROM public.conversation_messages WHERE organizations_id=v_org AND instances_id=p_instances_id AND external_message_id=p_external_message_id; RETURN jsonb_build_object('duplicate',true,'messageId',v_msg); END IF;
  UPDATE public.conversations SET remote_jid=public.r60_normalize_provider_alias(p_remote_jid),contact_phone=v_phone,
    contact_name=coalesce(nullif(btrim(coalesce(p_contact_name,'')),''),contact_name),last_message_at=coalesce(p_provider_timestamp,now()),last_message_preview=left(v_body,300),
    last_message_direction=CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END,
    unread_count=CASE WHEN p_from_me THEN unread_count ELSE unread_count+1 END,conversation_status='open',conversation_version=conversation_version+1,conversations_updated_at=now()
  WHERE conversations_id=v_conv;
  RETURN jsonb_build_object('ignored',false,'duplicate',false,'conversationId',v_conv,'messageId',v_msg,'contactId',v_contact,'contactState',v_state);
END $$;

CREATE OR REPLACE FUNCTION public.service_update_evolution_message_status(p_instances_id bigint,p_external_message_id text,p_message_status text,p_event_type text,p_raw_payload jsonb,p_provider_timestamp timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_old text;v_new text:=lower(btrim(coalesce(p_message_status,'')));v_id bigint;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF v_new NOT IN ('pending','sending','sent','delivered','read','failed','deleted','reconciliation_required') THEN RETURN jsonb_build_object('ignored',true,'reason','status_invalid'); END IF;
 SELECT conversation_messages_id,message_status INTO v_id,v_old FROM public.conversation_messages WHERE instances_id=p_instances_id AND external_message_id=p_external_message_id FOR UPDATE;
 IF v_id IS NULL THEN RETURN jsonb_build_object('ignored',true,'reason','message_not_found'); END IF;
 IF public.chat_message_status_rank(v_new)<=public.chat_message_status_rank(v_old) THEN RETURN jsonb_build_object('noop',true,'messageId',v_id,'status',v_old); END IF;
 UPDATE public.conversation_messages SET message_status=v_new,provider_timestamp=coalesce(p_provider_timestamp,provider_timestamp),conversation_messages_updated_at=now() WHERE conversation_messages_id=v_id;
 RETURN jsonb_build_object('noop',false,'messageId',v_id,'status',v_new);
END $$;

CREATE OR REPLACE FUNCTION public.service_update_evolution_connection_state_r60(p_instances_id bigint,p_provider_state text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_org bigint;v_user bigint;v_state text;v_connected boolean;v_logged boolean;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT organizations_id,users_id INTO v_org,v_user FROM public.instances WHERE instances_id=p_instances_id;
 IF v_org IS NULL THEN RAISE EXCEPTION 'instance_scope_not_found'; END IF;
 v_state:=lower(btrim(coalesce(p_provider_state,'')));
 v_connected:=v_state IN ('open','online','connected','pairsuccess','pair_success');
 v_logged:=v_connected;
 INSERT INTO public.instance_runtime_states(instances_id,users_id,organizations_id,provider,operational_state,session_saved,socket_connected,connected,logged_in,provider_state,source,checked_at)
 VALUES(p_instances_id,v_user,v_org,'evolution-go',CASE WHEN v_connected THEN 'online' WHEN v_state IN ('close','closed','disconnected','loggedout','logged_out') THEN 'disconnected' ELSE 'unknown' END,v_connected,v_connected,v_connected,v_logged,nullif(v_state,''),'webhook',now())
 ON CONFLICT(instances_id) DO UPDATE SET operational_state=excluded.operational_state,session_saved=CASE WHEN excluded.operational_state='disconnected' THEN instance_runtime_states.session_saved ELSE excluded.session_saved END,socket_connected=excluded.socket_connected,connected=excluded.connected,logged_in=excluded.logged_in,provider_state=excluded.provider_state,source='webhook',checked_at=now(),instance_runtime_states_updated_at=now()
 WHERE (instance_runtime_states.operational_state,instance_runtime_states.socket_connected,instance_runtime_states.connected,instance_runtime_states.logged_in,coalesce(instance_runtime_states.provider_state,'')) IS DISTINCT FROM (excluded.operational_state,excluded.socket_connected,excluded.connected,excluded.logged_in,coalesce(excluded.provider_state,''));
 RETURN jsonb_build_object('instanceId',p_instances_id,'state',CASE WHEN v_connected THEN 'online' ELSE 'disconnected' END);
END $$;

CREATE OR REPLACE FUNCTION public.service_upsert_evolution_chat(p_instances_id bigint,p_remote_jid text,p_contact_name text,p_contact_avatar_url text,p_unread_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 RETURN jsonb_build_object('ignored',true,'reason','r60_message_driven_inbox');
END $$;

-- Outbound automático do Worker converge no mesmo contato/conversa canônicos.
CREATE OR REPLACE FUNCTION public.service_stage5_converge_automatic_message(p_organizations_id bigint,p_queue_items_id bigint,p_external_message_id text,p_remote_jid text,p_message_body text,p_message_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_item record;v_instance bigint;v_contact bigint;v_conv bigint;v_msg bigint;v_remote text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT qi.*,c.instances_id,i.instances_name INTO v_item FROM public.queue_items qi JOIN public.chips c ON c.chips_id=qi.chips_id JOIN public.instances i ON i.instances_id=c.instances_id
 WHERE qi.organizations_id=p_organizations_id AND qi.queue_items_id=p_queue_items_id;
 IF v_item.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
 v_instance:=v_item.instances_id; v_remote:=public.r60_normalize_provider_alias(p_remote_jid);
 v_contact:=public.r60_resolve_whatsapp_contact(p_organizations_id,v_instance,v_item.chips_id,v_remote,NULL,NULL);
 UPDATE public.whatsapp_contacts SET leads_id=coalesce(leads_id,v_item.leads_id),contact_state=CASE WHEN coalesce(leads_id,v_item.leads_id) IS NOT NULL THEN 'lead' ELSE contact_state END,whatsapp_contacts_updated_at=now() WHERE whatsapp_contacts_id=v_contact;
 SELECT conversations_id INTO v_conv FROM public.conversations WHERE organizations_id=p_organizations_id AND chips_id=v_item.chips_id AND whatsapp_contacts_id=v_contact;
 IF v_conv IS NULL THEN INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,leads_id,whatsapp_contacts_id,remote_jid,contact_phone,conversation_status)
 VALUES(v_item.users_id,p_organizations_id,v_item.chips_id,v_instance,v_item.leads_id,v_contact,v_remote,public.r60_normalize_phone(v_remote),'open') RETURNING conversations_id INTO v_conv; END IF;
 INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,leads_id,external_message_id,remote_jid,direction,from_me,message_type,message_body,message_status,provider_timestamp,raw_payload,queue_items_id,executed_by)
 VALUES(v_item.users_id,p_organizations_id,v_conv,v_item.chips_id,v_instance,v_item.leads_id,p_external_message_id,v_remote,'outbound',true,'text',left(coalesce(p_message_body,''),8000),'sent',now(),'{}'::jsonb,p_queue_items_id,'system')
 ON CONFLICT(organizations_id,instances_id,external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING RETURNING conversation_messages_id INTO v_msg;
 UPDATE public.conversations SET leads_id=coalesce(leads_id,v_item.leads_id),last_message_at=now(),last_message_preview=left(coalesce(p_message_body,''),300),last_message_direction='outbound',conversation_version=conversation_version+1,conversations_updated_at=now() WHERE conversations_id=v_conv;
 RETURN jsonb_build_object('conversationId',v_conv,'messageId',v_msg,'contactId',v_contact);
END $$;

COMMIT;
