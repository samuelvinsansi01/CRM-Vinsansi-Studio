BEGIN;

-- CRM Vinsansi Studio v1.4.0
-- Etapa 5 / Fase A: cockpit WhatsApp no Gerenciador.
-- organizations_id e a fronteira de tenant; users_id permanece somente como
-- bridge do ConversationsPage do CRM ate a Fase B explicitamente homologada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $preflight$
DECLARE v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN v_missing:=array_append(v_missing,'table:organizations'); END IF;
  IF to_regclass('public.organization_members') IS NULL THEN v_missing:=array_append(v_missing,'table:organization_members'); END IF;
  IF to_regclass('public.conversations') IS NULL THEN v_missing:=array_append(v_missing,'table:conversations'); END IF;
  IF to_regclass('public.conversation_messages') IS NULL THEN v_missing:=array_append(v_missing,'table:conversation_messages'); END IF;
  IF to_regclass('public.instances') IS NULL THEN v_missing:=array_append(v_missing,'table:instances'); END IF;
  IF to_regclass('public.chips') IS NULL THEN v_missing:=array_append(v_missing,'table:chips'); END IF;
  IF to_regclass('public.queue_items') IS NULL THEN v_missing:=array_append(v_missing,'table:queue_items'); END IF;
  IF to_regprocedure('public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)') IS NULL THEN
    v_missing:=array_append(v_missing,'function:append_audit_event');
  END IF;
  IF cardinality(v_missing)>0 THEN
    RAISE EXCEPTION 'v1.4.0_requires_v1.3.0:%',array_to_string(v_missing,',');
  END IF;
END
$preflight$;

INSERT INTO public.permissions(permissions_key,permissions_name,permissions_category,permissions_description,permissions_sensitivity)
VALUES('whatsapp.assign','Atribuir conversas','WhatsApp','Transferir ou reatribuir a responsabilidade de conversas WhatsApp.','delegable')
ON CONFLICT(permissions_key) DO UPDATE SET
  permissions_name=excluded.permissions_name,
  permissions_category=excluded.permissions_category,
  permissions_description=excluded.permissions_description,
  permissions_sensitivity=excluded.permissions_sensitivity;

-- Dono recebe todas as permissoes nao-platform pela regra central. Gestor recebe
-- whatsapp.assign como poder gerencial padrao; funcoes delegaveis podem recebe-la.
INSERT INTO public.organization_role_permissions(organization_roles_id,permissions_id)
SELECT r.organization_roles_id,p.permissions_id
  FROM public.organization_roles r
  JOIN public.permissions p ON p.permissions_key='whatsapp.assign'
 WHERE r.organization_roles_key='gestor' AND r.status_id=1
ON CONFLICT DO NOTHING;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS conversation_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assignment_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_direction text,
  ADD COLUMN IF NOT EXISTS conversations_created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS queue_items_id bigint REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sents_id bigint REFERENCES public.sents(sents_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS media_storage_path text,
  ADD COLUMN IF NOT EXISTS media_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS media_archive_status text,
  ADD COLUMN IF NOT EXISTS media_archive_error text,
  ADD COLUMN IF NOT EXISTS reconciliation_state text,
  ADD COLUMN IF NOT EXISTS reconciliation_checked_at timestamptz;

UPDATE public.conversations SET conversation_version=1 WHERE conversation_version IS NULL OR conversation_version<1;

CREATE INDEX IF NOT EXISTS conversations_org_last_message_idx
  ON public.conversations(organizations_id,last_message_at DESC,conversations_id DESC);
CREATE INDEX IF NOT EXISTS conversations_org_assignee_idx
  ON public.conversations(organizations_id,assigned_to_member_id,last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_thread_cursor_idx
  ON public.conversation_messages(organizations_id,conversations_id,conversation_messages_id DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_queue_item_idx
  ON public.conversation_messages(organizations_id,queue_items_id) WHERE queue_items_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_sent_idx
  ON public.conversation_messages(organizations_id,sents_id) WHERE sents_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_identity_org_chip_jid_unique
  ON public.conversations(organizations_id,chips_id,remote_jid);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_manual_idempotency_unique
  ON public.conversation_messages(organizations_id,client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_provider_unique
  ON public.conversation_messages(organizations_id,instances_id,external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conversation_member_states(
  conversation_member_states_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  conversations_id bigint NOT NULL REFERENCES public.conversations(conversations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  last_read_message_id bigint REFERENCES public.conversation_messages(conversation_messages_id) ON DELETE SET NULL,
  last_viewed_at timestamptz,
  conversation_member_states_created_at timestamptz NOT NULL DEFAULT now(),
  conversation_member_states_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizations_id,conversations_id,organization_members_id)
);
CREATE INDEX IF NOT EXISTS conversation_member_states_member_idx
  ON public.conversation_member_states(organizations_id,organization_members_id,last_viewed_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_presence(
  conversation_presence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  conversations_id bigint NOT NULL REFERENCES public.conversations(conversations_id) ON DELETE CASCADE,
  organization_members_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  session_key text NOT NULL,
  viewing boolean NOT NULL DEFAULT true,
  typing boolean NOT NULL DEFAULT false,
  viewing_seen_at timestamptz NOT NULL DEFAULT now(),
  typing_seen_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '45 seconds'),
  conversation_presence_created_at timestamptz NOT NULL DEFAULT now(),
  conversation_presence_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_presence_session_key_valid CHECK(length(session_key) BETWEEN 8 AND 160),
  UNIQUE(organizations_id,conversations_id,organization_members_id,session_key)
);
CREATE INDEX IF NOT EXISTS conversation_presence_active_idx
  ON public.conversation_presence(organizations_id,conversations_id,expires_at DESC);

ALTER TABLE public.conversation_member_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_member_states_org_select ON public.conversation_member_states;
CREATE POLICY conversation_member_states_org_select ON public.conversation_member_states FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('whatsapp.view'));
DROP POLICY IF EXISTS conversation_presence_org_select ON public.conversation_presence;
CREATE POLICY conversation_presence_org_select ON public.conversation_presence FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('whatsapp.view'));
REVOKE INSERT,UPDATE,DELETE ON public.conversation_member_states,public.conversation_presence FROM anon,authenticated;
GRANT SELECT ON public.conversation_member_states,public.conversation_presence TO authenticated;

-- Bucket privado. Upload/leitura sao emitidos pelo backend depois de validar
-- sessao humana, membership e organization path.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'conversation-media','conversation-media',false,26214400,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','audio/ogg','audio/mpeg','audio/mp4','application/pdf','application/octet-stream']
)
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.stage5_member_has_permission(
  p_organizations_id bigint,p_organization_members_id bigint,p_permission text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1
      FROM public.organization_members m
     WHERE m.organization_members_id=p_organization_members_id
       AND m.organizations_id=p_organizations_id
       AND m.status_id=1
       AND (
         m.access_level='owner'
         OR (m.access_level='manager' AND p_permission=ANY(ARRAY[
           'organization.view','members.view','members.invite','members.edit','members.deactivate','roles.view','audit.view','whatsapp.assign'
         ]))
         OR EXISTS(
           SELECT 1 FROM public.organization_role_permissions rp
           JOIN public.permissions p ON p.permissions_id=rp.permissions_id
           WHERE rp.organization_roles_id=m.organization_roles_id
             AND p.permissions_key=p_permission
             AND p.permissions_sensitivity='delegable'
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.stage5_require_member(
  p_organizations_id bigint,p_organization_members_id bigint,p_permission text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NOT public.stage5_member_has_permission(p_organizations_id,p_organization_members_id,p_permission) THEN
    RAISE EXCEPTION 'conversation_permission_denied:%',p_permission;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_audit_entity(
  p_organizations_id bigint,p_organization_members_id bigint,p_action text,p_entity_type text,p_entity_id text,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint;v_actor bigint;v_auth uuid;v_id bigint;
BEGIN
  SELECT o.legacy_scope_users_id INTO v_scope FROM public.organizations o WHERE o.organizations_id=p_organizations_id;
  SELECT m.users_id,u.auth_user_id INTO v_actor,v_auth
    FROM public.organization_members m JOIN public.users u ON u.users_id=m.users_id
   WHERE m.organization_members_id=p_organization_members_id AND m.organizations_id=p_organizations_id;
  INSERT INTO public.audit_events(
    users_id,organizations_id,actor_auth_user_id,actor_users_id,actor_member_id,actor_type,
    source,action,entity_type,entity_id,message,metadata
  ) VALUES(
    v_scope,p_organizations_id,v_auth,v_actor,p_organization_members_id,'member',
    'whatsapp-manager',p_action,p_entity_type,p_entity_id,p_action,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('actor_member_id',p_organization_members_id)
  ) RETURNING audit_events_id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage5_audit(
  p_organizations_id bigint,p_organization_members_id bigint,p_action text,p_entity_id text,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
  SELECT public.stage5_audit_entity(p_organizations_id,p_organization_members_id,p_action,'conversation',p_entity_id,p_metadata);
$$;

CREATE OR REPLACE FUNCTION public.stage5_status_rank(p_status text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status WHEN 'pending' THEN 10 WHEN 'sending' THEN 20 WHEN 'sent' THEN 30
    WHEN 'delivered' THEN 40 WHEN 'read' THEN 50 WHEN 'failed' THEN 15
    WHEN 'reconciliation_required' THEN 16 WHEN 'deleted' THEN 60 ELSE 0 END;
$$;

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
      SELECT c.conversations_id,c.chips_id,c.instances_id,c.leads_id,c.remote_jid,c.contact_phone,c.contact_name,
             c.contact_avatar_url,c.conversation_status,c.assigned_to_member_id,c.last_replied_by_member_id,
             c.last_message_at,c.last_message_preview,c.last_message_direction,c.assignment_updated_at,c.conversation_version,
             ch.chips_name,coalesce(nullif(u.users_name,''),'Membro #'||m.organization_members_id::text) AS assigned_to_member_name,
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
         AND (nullif(trim(coalesce(p_search,'')),'') IS NULL OR concat_ws(' ',c.contact_name,c.contact_phone,c.remote_jid) ILIKE '%'||trim(p_search)||'%')
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

CREATE OR REPLACE FUNCTION public.service_stage5_list_messages(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,
  p_before_id bigint DEFAULT NULL,p_after_id bigint DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  IF NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.conversations_id=p_conversations_id AND c.organizations_id=p_organizations_id) THEN
    RAISE EXCEPTION 'conversation_not_found';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.conversation_messages_id),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT cm.conversation_messages_id,cm.conversations_id,cm.queue_items_id,cm.sents_id,cm.external_message_id,
             cm.client_idempotency_key,cm.direction,cm.from_me,cm.message_type,cm.message_body,cm.media_url,
             cm.media_storage_path,cm.media_mime_type,cm.media_file_name,cm.media_size_bytes,cm.quoted_external_message_id,
             cm.message_status,cm.sent_by_member_id,cm.executed_by,cm.provider_timestamp,cm.error_message,
             cm.reconciliation_state,cm.conversation_messages_created_at,cm.conversation_messages_updated_at,
             coalesce(nullif(u.users_name,''),CASE WHEN cm.sent_by_member_id IS NULL THEN NULL ELSE 'Membro #'||cm.sent_by_member_id::text END) AS sent_by_member_name
        FROM public.conversation_messages cm
        LEFT JOIN public.organization_members m ON m.organization_members_id=cm.sent_by_member_id AND m.organizations_id=cm.organizations_id
        LEFT JOIN public.users u ON u.users_id=m.users_id
       WHERE cm.organizations_id=p_organizations_id AND cm.conversations_id=p_conversations_id
         AND (p_before_id IS NULL OR cm.conversation_messages_id<p_before_id)
         AND (p_after_id IS NULL OR cm.conversation_messages_id>p_after_id)
       ORDER BY CASE WHEN p_after_id IS NULL THEN cm.conversation_messages_id END DESC,
                CASE WHEN p_after_id IS NOT NULL THEN cm.conversation_messages_id END ASC
       LIMIT v_limit
    ) x;
  RETURN jsonb_build_object('items',v_rows,'limit',v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_mark_read(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_last_read_message_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_last bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  SELECT max(conversation_messages_id) INTO v_last FROM public.conversation_messages
   WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id
     AND (p_last_read_message_id IS NULL OR conversation_messages_id<=p_last_read_message_id);
  INSERT INTO public.conversation_member_states(organizations_id,conversations_id,organization_members_id,last_read_message_id,last_viewed_at)
  VALUES(p_organizations_id,p_conversations_id,p_organization_members_id,v_last,now())
  ON CONFLICT(organizations_id,conversations_id,organization_members_id) DO UPDATE SET
    last_read_message_id=greatest(coalesce(conversation_member_states.last_read_message_id,0),coalesce(excluded.last_read_message_id,0)),
    last_viewed_at=now(),conversation_member_states_updated_at=now();
  RETURN jsonb_build_object('conversationId',p_conversations_id,'lastReadMessageId',v_last);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_assign_conversation(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,
  p_action text,p_target_member_id bigint DEFAULT NULL,p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;v_target bigint;v_action text:=lower(trim(coalesce(p_action,'')));
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  IF v_action='assume' THEN
    IF v_c.assigned_to_member_id IS NOT NULL AND v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assignment_conflict'; END IF;
    v_target:=p_organization_members_id;
  ELSIF v_action='release' THEN
    IF v_c.assigned_to_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'conversation_assigned_to_other_member'; END IF;
    v_target:=NULL;
  ELSIF v_action='transfer' THEN
    PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.assign');
    IF NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_members_id=p_target_member_id AND m.organizations_id=p_organizations_id AND m.status_id=1) THEN
      RAISE EXCEPTION 'conversation_transfer_target_invalid';
    END IF;
    v_target:=p_target_member_id;
  ELSE RAISE EXCEPTION 'conversation_assignment_action_invalid'; END IF;
  UPDATE public.conversations SET assigned_to_member_id=v_target,assignment_updated_at=now(),conversation_version=conversation_version+1,conversations_updated_at=now()
   WHERE conversations_id=p_conversations_id AND organizations_id=p_organizations_id
   RETURNING * INTO v_c;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,
    CASE v_action WHEN 'assume' THEN 'conversation.assigned' WHEN 'release' THEN 'conversation.released' ELSE 'conversation.transferred' END,
    p_conversations_id::text,jsonb_build_object('assigned_to_member_id',v_target,'conversation_version',v_c.conversation_version));
  RETURN jsonb_build_object('conversationId',p_conversations_id,'assignedToMemberId',v_target,'conversationVersion',v_c.conversation_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_set_archived(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_archived boolean,p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_c public.conversations%ROWTYPE;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  SELECT * INTO v_c FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id FOR UPDATE;
  IF v_c.conversations_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF p_expected_version IS NOT NULL AND v_c.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'conversation_version_conflict'; END IF;
  UPDATE public.conversations SET conversation_status=CASE WHEN p_archived THEN 'archived' ELSE 'open' END,
    conversation_version=conversation_version+1,conversations_updated_at=now()
   WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id RETURNING * INTO v_c;
  PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,CASE WHEN p_archived THEN 'conversation.archived' ELSE 'conversation.unarchived' END,p_conversations_id::text,'{}');
  RETURN jsonb_build_object('conversationId',p_conversations_id,'status',v_c.conversation_status,'conversationVersion',v_c.conversation_version);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.service_stage5_report_manual_message(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversation_messages_id bigint,
  p_status text,p_external_message_id text DEFAULT NULL,p_error_message text DEFAULT NULL,p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_m public.conversation_messages%ROWTYPE;v_provider public.conversation_messages%ROWTYPE;v_status text:=lower(trim(coalesce(p_status,'')));
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply');
  IF v_status NOT IN('sending','sent','failed','reconciliation_required') THEN RAISE EXCEPTION 'manual_message_report_status_invalid'; END IF;
  SELECT * INTO v_m FROM public.conversation_messages
   WHERE organizations_id=p_organizations_id AND conversation_messages_id=p_conversation_messages_id FOR UPDATE;
  IF v_m.conversation_messages_id IS NULL OR v_m.executed_by<>'member' OR v_m.sent_by_member_id<>p_organization_members_id THEN RAISE EXCEPTION 'manual_message_not_found'; END IF;
  IF nullif(p_external_message_id,'') IS NOT NULL THEN
    SELECT * INTO v_provider FROM public.conversation_messages
     WHERE organizations_id=p_organizations_id AND instances_id=v_m.instances_id AND external_message_id=p_external_message_id
       AND conversation_messages_id<>v_m.conversation_messages_id FOR UPDATE;
    IF v_provider.conversation_messages_id IS NOT NULL THEN
      IF v_provider.remote_jid IS DISTINCT FROM v_m.remote_jid OR v_provider.direction<>'outbound' OR v_provider.queue_items_id IS NOT NULL THEN
        RAISE EXCEPTION 'manual_message_provider_identity_conflict';
      END IF;
      UPDATE public.conversation_messages SET
        message_body=coalesce(message_body,v_provider.message_body),media_url=coalesce(media_url,v_provider.media_url),
        media_storage_path=coalesce(media_storage_path,v_provider.media_storage_path),media_mime_type=coalesce(media_mime_type,v_provider.media_mime_type),
        media_file_name=coalesce(media_file_name,v_provider.media_file_name),provider_timestamp=coalesce(v_provider.provider_timestamp,provider_timestamp),
        raw_payload=coalesce(raw_payload,'{}'::jsonb)||coalesce(v_provider.raw_payload,'{}'::jsonb)
       WHERE conversation_messages_id=v_m.conversation_messages_id;
      DELETE FROM public.conversation_messages WHERE conversation_messages_id=v_provider.conversation_messages_id;
      SELECT * INTO v_m FROM public.conversation_messages WHERE conversation_messages_id=p_conversation_messages_id FOR UPDATE;
    END IF;
  END IF;
  IF public.stage5_status_rank(v_status)<public.stage5_status_rank(v_m.message_status)
     AND NOT (v_m.message_status IN('pending','sending') AND v_status IN('failed','reconciliation_required'))
     AND NOT (v_m.message_status IN('failed','reconciliation_required') AND v_status='sent') THEN
    RETURN jsonb_build_object('messageId',v_m.conversation_messages_id,'status',v_m.message_status,'ignoredRegression',true);
  END IF;
  UPDATE public.conversation_messages SET message_status=v_status,external_message_id=coalesce(nullif(p_external_message_id,''),external_message_id),
    error_message=nullif(p_error_message,''),raw_payload=coalesce(raw_payload,'{}'::jsonb)||coalesce(p_provider_payload,'{}'::jsonb),
    reconciliation_state=CASE WHEN v_status='reconciliation_required' THEN 'pending' WHEN v_status='sent' THEN 'resolved_sent' ELSE reconciliation_state END,
    conversation_messages_updated_at=now()
   WHERE conversation_messages_id=p_conversation_messages_id RETURNING * INTO v_m;
  IF v_status='sent' THEN
    UPDATE public.conversations SET last_replied_by_member_id=p_organization_members_id,last_message_at=now(),
      last_message_preview=coalesce(v_m.message_body,'['||v_m.message_type||']'),last_message_direction='outbound',conversations_updated_at=now()
     WHERE organizations_id=p_organizations_id AND conversations_id=v_m.conversations_id;
  ELSIF v_status IN('failed','reconciliation_required') THEN
    PERFORM public.stage5_audit(p_organizations_id,p_organization_members_id,'conversation.manual_message_failed',v_m.conversations_id::text,
      jsonb_build_object('conversation_message_id',v_m.conversation_messages_id,'status',v_status,'error',p_error_message));
  END IF;
  RETURN jsonb_build_object('messageId',v_m.conversation_messages_id,'status',v_m.message_status,'externalMessageId',v_m.external_message_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_presence(
  p_organizations_id bigint,p_organization_members_id bigint,p_conversations_id bigint,p_session_key text,
  p_viewing boolean DEFAULT true,p_typing boolean DEFAULT false,p_stop boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  IF p_typing THEN PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.reply'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  UPDATE public.conversation_presence SET typing=false,conversation_presence_updated_at=now()
   WHERE organizations_id=p_organizations_id AND typing AND typing_seen_at<=now()-interval '8 seconds';
  DELETE FROM public.conversation_presence WHERE organizations_id=p_organizations_id AND expires_at<=now();
  IF p_stop THEN
    DELETE FROM public.conversation_presence WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id
      AND organization_members_id=p_organization_members_id AND session_key=p_session_key;
  ELSE
    INSERT INTO public.conversation_presence(organizations_id,conversations_id,organization_members_id,session_key,viewing,typing,viewing_seen_at,typing_seen_at,expires_at)
    VALUES(p_organizations_id,p_conversations_id,p_organization_members_id,p_session_key,p_viewing,p_typing,now(),CASE WHEN p_typing THEN now() END,now()+interval '45 seconds')
    ON CONFLICT(organizations_id,conversations_id,organization_members_id,session_key) DO UPDATE SET
      viewing=excluded.viewing,typing=excluded.typing,viewing_seen_at=now(),
      typing_seen_at=CASE WHEN excluded.typing THEN now() ELSE conversation_presence.typing_seen_at END,
      expires_at=now()+interval '45 seconds',conversation_presence_updated_at=now();
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'memberId',p.organization_members_id,'memberName',coalesce(nullif(u.users_name,''),'Membro #'||p.organization_members_id::text),
    'viewing',p.viewing AND p.expires_at>now(),'typing',p.typing AND p.typing_seen_at>now()-interval '8 seconds'
  ) ORDER BY u.users_name),'[]'::jsonb) INTO v_rows
  FROM public.conversation_presence p JOIN public.organization_members m ON m.organization_members_id=p.organization_members_id AND m.status_id=1
  JOIN public.users u ON u.users_id=m.users_id
  WHERE p.organizations_id=p_organizations_id AND p.conversations_id=p_conversations_id
    AND p.organization_members_id<>p_organization_members_id AND p.expires_at>now();
  RETURN jsonb_build_object('items',v_rows,'viewerTtlSeconds',45,'typingTtlSeconds',8);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_transfer_members(
  p_organizations_id bigint,p_organization_members_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'whatsapp.view');
  SELECT coalesce(jsonb_agg(jsonb_build_object('memberId',m.organization_members_id,'name',coalesce(nullif(u.users_name,''),'Membro #'||m.organization_members_id::text),'accessLevel',m.access_level) ORDER BY u.users_name),'[]'::jsonb)
    INTO v_rows FROM public.organization_members m JOIN public.users u ON u.users_id=m.users_id
   WHERE m.organizations_id=p_organizations_id AND m.status_id=1;
  RETURN v_rows;
END;
$$;

-- Webhook canônico: o tenant e derivado da instancia, nunca do payload.
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

DROP FUNCTION IF EXISTS public.service_update_evolution_message_status(bigint,text,text,text,jsonb,timestamptz);
CREATE FUNCTION public.service_update_evolution_message_status(
  p_instances_id bigint,p_external_message_id text,p_message_status text,p_event_type text,p_raw_payload jsonb,p_provider_timestamp timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_message public.conversation_messages%ROWTYPE;v_org bigint;
BEGIN
  SELECT organizations_id INTO v_org FROM public.instances WHERE instances_id=p_instances_id;
  SELECT * INTO v_message FROM public.conversation_messages WHERE organizations_id=v_org AND instances_id=p_instances_id AND external_message_id=p_external_message_id FOR UPDATE;
  IF v_message.conversation_messages_id IS NULL THEN RETURN jsonb_build_object('updated',false,'reason','message_not_found'); END IF;
  IF public.stage5_status_rank(p_message_status)<public.stage5_status_rank(v_message.message_status)
    AND NOT (v_message.message_status IN('pending','sending') AND p_message_status IN('failed','reconciliation_required'))
    AND NOT (v_message.message_status IN('failed','reconciliation_required') AND p_message_status IN('sent','delivered','read')) THEN
    RETURN jsonb_build_object('updated',false,'reason','status_regression');
  END IF;
  UPDATE public.conversation_messages SET message_status=p_message_status,provider_timestamp=coalesce(p_provider_timestamp,provider_timestamp),
    raw_payload=coalesce(raw_payload,'{}')||coalesce(p_raw_payload,'{}'),reconciliation_state=CASE WHEN message_status='reconciliation_required' THEN 'resolved_provider' ELSE reconciliation_state END,
    reconciliation_checked_at=CASE WHEN message_status='reconciliation_required' THEN now() ELSE reconciliation_checked_at END,conversation_messages_updated_at=now()
   WHERE conversation_messages_id=v_message.conversation_messages_id RETURNING * INTO v_message;
  RETURN jsonb_build_object('updated',true,'messageId',v_message.conversation_messages_id,'status',v_message.message_status);
END;
$$;

DROP FUNCTION IF EXISTS public.service_upsert_evolution_chat(bigint,text,text,text,integer);
CREATE FUNCTION public.service_upsert_evolution_chat(
  p_instances_id bigint,p_remote_jid text,p_contact_name text,p_contact_avatar_url text,p_unread_count integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_instance record;v_chip bigint;v_scope bigint;v_id bigint;
BEGIN
  IF p_remote_jid ILIKE '%@g.us' OR p_remote_jid ILIKE '%@broadcast' THEN RETURN jsonb_build_object('ignored',true); END IF;
  SELECT instances_id,organizations_id INTO v_instance FROM public.instances WHERE instances_id=p_instances_id;
  SELECT chips_id INTO v_chip FROM public.chips WHERE organizations_id=v_instance.organizations_id AND instances_id=p_instances_id ORDER BY chips_id LIMIT 1;
  IF v_chip IS NULL THEN RETURN jsonb_build_object('ignored',true); END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=v_instance.organizations_id;
  INSERT INTO public.conversations(users_id,organizations_id,chips_id,instances_id,remote_jid,contact_phone,contact_name,contact_avatar_url,conversation_status,unread_count,conversations_created_at,conversations_updated_at)
  VALUES(v_scope,v_instance.organizations_id,v_chip,p_instances_id,p_remote_jid,regexp_replace(split_part(p_remote_jid,'@',1),'\D','','g'),p_contact_name,p_contact_avatar_url,'open',coalesce(p_unread_count,0),now(),now())
  ON CONFLICT(organizations_id,chips_id,remote_jid) DO UPDATE SET contact_name=coalesce(nullif(excluded.contact_name,''),conversations.contact_name),
    contact_avatar_url=coalesce(nullif(excluded.contact_avatar_url,''),conversations.contact_avatar_url),
    unread_count=coalesce(excluded.unread_count,conversations.unread_count),conversations_updated_at=now()
  RETURNING conversations_id INTO v_id;
  RETURN jsonb_build_object('ignored',false,'conversationId',v_id);
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

CREATE OR REPLACE FUNCTION public.service_stage5_queue_control(
  p_organizations_id bigint,p_organization_members_id bigint,p_worker_batches_id bigint,p_action text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_batch record;v_action text:=lower(trim(coalesce(p_action,'')));v_next bigint;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'queues.control');
  SELECT * INTO v_batch FROM public.worker_batches WHERE organizations_id=p_organizations_id AND worker_batches_id=p_worker_batches_id FOR UPDATE;
  IF v_batch.worker_batches_id IS NULL THEN RAISE EXCEPTION 'queue_batch_not_found'; END IF;
  IF v_action='pause' THEN v_next:=8;
  ELSIF v_action='resume' THEN v_next:=4;
  ELSIF v_action='stop' THEN v_next:=7;
  ELSE RAISE EXCEPTION 'queue_control_action_invalid'; END IF;
  UPDATE public.worker_batches SET status_id=v_next,worker_batches_updated_at=now() WHERE worker_batches_id=p_worker_batches_id AND organizations_id=p_organizations_id;
  PERFORM public.stage5_audit_entity(p_organizations_id,p_organization_members_id,
    'queue.'||CASE v_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'resumed' ELSE 'stopped' END,
    'worker_batch',p_worker_batches_id::text,jsonb_build_object('previous_status_id',v_batch.status_id,'status_id',v_next));
  RETURN jsonb_build_object('batchId',p_worker_batches_id,'statusId',v_next,'action',v_action);
END;
$$;

-- A tabela operacional sents continua sendo a prova final do lote. Este trigger
-- completa a linhagem quando o registro de envio for persistido depois do
-- evento/convergência da conversa.
CREATE OR REPLACE FUNCTION public.stage5_link_sent_to_conversation_messages()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NEW.queue_items_id IS NOT NULL THEN
    UPDATE public.conversation_messages
       SET sents_id=NEW.sents_id,conversation_messages_updated_at=now()
     WHERE organizations_id=NEW.organizations_id
       AND queue_items_id=NEW.queue_items_id
       AND sents_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stage5_sents_conversation_lineage ON public.sents;
CREATE TRIGGER stage5_sents_conversation_lineage
AFTER INSERT OR UPDATE OF queue_items_id,status_id ON public.sents
FOR EACH ROW EXECUTE FUNCTION public.stage5_link_sent_to_conversation_messages();

CREATE OR REPLACE FUNCTION public.service_stage5_reprocess_queue_item(
  p_organizations_id bigint,p_organization_members_id bigint,p_queue_items_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'queues.control');
  SELECT * INTO v_q FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id FOR UPDATE;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
  IF v_q.status_id<>6 THEN RAISE EXCEPTION 'queue_item_not_safely_reprocessable'; END IF;
  IF EXISTS(SELECT 1 FROM public.sents s WHERE s.organizations_id=p_organizations_id AND s.queue_items_id=p_queue_items_id AND s.status_id=5) THEN
    RAISE EXCEPTION 'queue_item_already_sent';
  END IF;
  IF EXISTS(SELECT 1 FROM public.conversation_messages cm WHERE cm.organizations_id=p_organizations_id AND cm.queue_items_id=p_queue_items_id
    AND (cm.external_message_id IS NOT NULL OR cm.message_status IN('sent','delivered','read','reconciliation_required'))) THEN
    RAISE EXCEPTION 'queue_item_requires_reconciliation';
  END IF;
  IF to_regclass('public.queue_item_dispatch_parts') IS NOT NULL THEN
    BEGIN
      IF EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_items_id=p_queue_items_id AND p.dispatch_state IN('sent','reconciliation_required')) THEN
        RAISE EXCEPTION 'queue_item_requires_reconciliation';
      END IF;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;
  UPDATE public.queue_items SET status_id=3,queue_items_error_message=NULL,queue_items_started_at=NULL,queue_items_finished_at=NULL,queue_items_updated_at=now()
   WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id;
  PERFORM public.stage5_audit_entity(p_organizations_id,p_organization_members_id,'queue.reprocessed','queue_item',p_queue_items_id::text,
    jsonb_build_object('previous_status_id',v_q.status_id,'status_id',3,'blind_resend',false));
  RETURN jsonb_build_object('queueItemId',p_queue_items_id,'status','queued');
END;
$$;

CREATE OR REPLACE FUNCTION public.service_stage5_reconcile_queue_item(
  p_organizations_id bigint,p_organization_members_id bigint,p_queue_items_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_q record;v_message bigint;v_scope bigint;
BEGIN
  PERFORM public.stage5_require_member(p_organizations_id,p_organization_members_id,'queues.control');
  SELECT * INTO v_q FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id FOR UPDATE;
  IF v_q.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
  SELECT cm.conversation_messages_id INTO v_message FROM public.conversation_messages cm
   WHERE cm.organizations_id=p_organizations_id AND cm.queue_items_id=p_queue_items_id
     AND cm.external_message_id IS NOT NULL AND cm.message_status IN('sent','delivered','read')
   ORDER BY cm.conversation_messages_id DESC LIMIT 1;
  IF v_message IS NOT NULL THEN
    UPDATE public.queue_items SET status_id=5,queue_items_error_message=NULL,queue_items_finished_at=coalesce(queue_items_finished_at,now()),queue_items_updated_at=now()
     WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id;
  END IF;
  PERFORM public.stage5_audit_entity(p_organizations_id,p_organization_members_id,'queue.reconciled','queue_item',p_queue_items_id::text,
    jsonb_build_object('previous_status_id',v_q.status_id,'status_id',CASE WHEN v_message IS NULL THEN v_q.status_id ELSE 5 END,
      'matched_message_id',v_message,'blind_resend',false));
  RETURN jsonb_build_object('queueItemId',p_queue_items_id,'matchedMessageId',v_message,
    'outcome',CASE WHEN v_message IS NULL THEN 'provider_confirmation_required' ELSE 'confirmed_sent' END,'blindResend',false);
END;
$$;

-- RLS org-scoped para o dominio completo; mutacoes humanas passam pelas funcoes
-- transacionais acima. Platform Owner sem membership nao satisfaz stage5_require_member.
DO $conversation_rls$
DECLARE v_table text;v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['conversations','conversation_messages','conversation_member_states','conversation_presence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    FOR v_policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=v_table AND cmd='SELECT' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',v_policy.policyname,v_table);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(organizations_id=public.current_organization_id() AND public.has_organization_permission(''whatsapp.view''))',v_table||'_stage5_org_select',v_table);
  END LOOP;
END
$conversation_rls$;

REVOKE ALL ON FUNCTION public.stage5_member_has_permission(bigint,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_require_member(bigint,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_audit(bigint,bigint,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_audit_entity(bigint,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_list_conversations(bigint,bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_list_messages(bigint,bigint,bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_mark_read(bigint,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_assign_conversation(bigint,bigint,bigint,text,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_set_archived(bigint,bigint,bigint,boolean,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_prepare_manual_message(bigint,bigint,bigint,integer,uuid,text,text,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_report_manual_message(bigint,bigint,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_presence(bigint,bigint,bigint,text,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_transfer_members(bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_converge_automatic_message(bigint,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_queue_control(bigint,bigint,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage5_link_sent_to_conversation_messages() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_reprocess_queue_item(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_reconcile_queue_item(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.stage5_member_has_permission(bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_list_conversations(bigint,bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_list_messages(bigint,bigint,bigint,bigint,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_mark_read(bigint,bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_assign_conversation(bigint,bigint,bigint,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_set_archived(bigint,bigint,bigint,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_prepare_manual_message(bigint,bigint,bigint,integer,uuid,text,text,text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_report_manual_message(bigint,bigint,bigint,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_presence(bigint,bigint,bigint,text,boolean,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_transfer_members(bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_ingest_evolution_message(bigint,text,text,text,boolean,text,text,text,text,timestamptz,jsonb,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_update_evolution_message_status(bigint,text,text,text,jsonb,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_upsert_evolution_chat(bigint,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_converge_automatic_message(bigint,bigint,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_queue_control(bigint,bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_reprocess_queue_item(bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_stage5_reconcile_queue_item(bigint,bigint,bigint) TO service_role;

COMMIT;
