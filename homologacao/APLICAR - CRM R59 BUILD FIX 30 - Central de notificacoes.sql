-- CRM R59 BUILD FIX 30
-- Central de notificações persistentes do CRM.
-- Escopo inicial:
--   1) nova mensagem WhatsApp recebida (com identificação do chip);
--   2) chip WhatsApp desconectado;
--   3) falhas relevantes de envio agrupadas por canal/recurso/data.
-- Instagram recebido/DM NÃO é medido nem notificado.

BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_notifications (
  crm_notifications_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  recipient_member_id bigint NOT NULL REFERENCES public.organization_members(organization_members_id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  channel text,
  title text NOT NULL,
  message text NOT NULL,
  entity_type text,
  entity_id text,
  target_page text,
  target_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  group_key text NOT NULL,
  event_count integer NOT NULL DEFAULT 1 CHECK (event_count > 0),
  first_event_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  crm_notifications_created_at timestamptz NOT NULL DEFAULT now(),
  crm_notifications_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_notifications_type_check CHECK (
    notification_type = ANY (ARRAY[
      'whatsapp_message'::text,
      'whatsapp_disconnected'::text,
      'dispatch_error'::text
    ])
  ),
  CONSTRAINT crm_notifications_channel_check CHECK (
    channel IS NULL OR channel = ANY (ARRAY['whatsapp'::text, 'instagram'::text])
  )
);

CREATE INDEX IF NOT EXISTS crm_notifications_recipient_activity_idx
  ON public.crm_notifications (organizations_id, recipient_member_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS crm_notifications_recipient_unread_idx
  ON public.crm_notifications (organizations_id, recipient_member_id, last_event_at DESC)
  WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_notifications_unread_group_uidx
  ON public.crm_notifications (organizations_id, recipient_member_id, group_key)
  WHERE read_at IS NULL;

ALTER TABLE public.crm_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_notifications_own_select ON public.crm_notifications;
CREATE POLICY crm_notifications_own_select
  ON public.crm_notifications
  FOR SELECT
  TO authenticated
  USING (
    organizations_id = public.current_organization_id()
    AND recipient_member_id = public.current_organization_member_id()
  );

REVOKE ALL ON TABLE public.crm_notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.crm_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_notification_emit(
  p_organizations_id bigint,
  p_recipient_member_id bigint,
  p_notification_type text,
  p_channel text,
  p_group_key text,
  p_title text,
  p_plural_title text,
  p_message text,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_target_page text DEFAULT NULL,
  p_target_payload jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  IF p_organizations_id IS NULL OR p_recipient_member_id IS NULL THEN RETURN NULL; END IF;
  IF nullif(trim(coalesce(p_group_key,'')),'') IS NULL THEN RAISE EXCEPTION 'notification_group_key_required'; END IF;

  INSERT INTO public.crm_notifications (
    organizations_id,
    recipient_member_id,
    notification_type,
    channel,
    title,
    message,
    entity_type,
    entity_id,
    target_page,
    target_payload,
    metadata,
    group_key,
    event_count,
    first_event_at,
    last_event_at,
    crm_notifications_created_at,
    crm_notifications_updated_at
  )
  VALUES (
    p_organizations_id,
    p_recipient_member_id,
    p_notification_type,
    nullif(trim(coalesce(p_channel,'')),''),
    trim(p_title),
    trim(p_message),
    nullif(trim(coalesce(p_entity_type,'')),''),
    nullif(trim(coalesce(p_entity_id,'')),''),
    nullif(trim(coalesce(p_target_page,'')),''),
    coalesce(p_target_payload,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb),
    trim(p_group_key),
    1,
    now(),
    now(),
    now(),
    now()
  )
  ON CONFLICT (organizations_id, recipient_member_id, group_key)
    WHERE read_at IS NULL
  DO UPDATE SET
    event_count = public.crm_notifications.event_count + 1,
    title = CASE
      WHEN nullif(trim(coalesce(p_plural_title,'')),'') IS NOT NULL
        THEN replace(p_plural_title, '{count}', (public.crm_notifications.event_count + 1)::text)
      ELSE excluded.title
    END,
    message = excluded.message,
    channel = excluded.channel,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    target_page = excluded.target_page,
    target_payload = excluded.target_payload,
    metadata = coalesce(public.crm_notifications.metadata,'{}'::jsonb) || excluded.metadata,
    last_event_at = now(),
    crm_notifications_updated_at = now()
  RETURNING crm_notifications_id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_notification_emit(bigint,bigint,text,text,text,text,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_crm_notification_read(p_crm_notifications_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_member bigint := public.current_organization_member_id();
BEGIN
  IF v_org IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_member_required'; END IF;

  UPDATE public.crm_notifications
     SET read_at = coalesce(read_at, now()),
         crm_notifications_updated_at = now()
   WHERE crm_notifications_id = p_crm_notifications_id
     AND organizations_id = v_org
     AND recipient_member_id = v_member;

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_crm_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_member bigint := public.current_organization_member_id();
  v_count integer;
BEGIN
  IF v_org IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_member_required'; END IF;

  UPDATE public.crm_notifications
     SET read_at = now(),
         crm_notifications_updated_at = now()
   WHERE organizations_id = v_org
     AND recipient_member_id = v_member
     AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_crm_notification_read(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_crm_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_crm_notification_read(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_crm_notifications_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_notify_inbound_whatsapp_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_conversation record;
  v_chip record;
  v_member record;
  v_subject text;
  v_chip_label text;
BEGIN
  IF NEW.direction <> 'inbound' OR NEW.from_me IS TRUE THEN RETURN NEW; END IF;

  SELECT c.conversations_id,c.assigned_to_member_id,c.contact_name,c.contact_phone,c.remote_jid,c.leads_id,l.leads_name
    INTO v_conversation
    FROM public.conversations c
    LEFT JOIN public.leads l
      ON l.leads_id=c.leads_id
     AND l.organizations_id=c.organizations_id
   WHERE c.conversations_id=NEW.conversations_id
     AND c.organizations_id=NEW.organizations_id;

  SELECT ch.chips_id,ch.chips_name,ch.chips_phone,i.instances_name
    INTO v_chip
    FROM public.chips ch
    LEFT JOIN public.instances i ON i.instances_id=ch.instances_id
   WHERE ch.chips_id=NEW.chips_id
     AND ch.organizations_id=NEW.organizations_id;

  v_subject := coalesce(
    nullif(trim(coalesce(v_conversation.leads_name,'')),''),
    nullif(trim(coalesce(v_conversation.contact_name,'')),''),
    nullif(trim(coalesce(v_conversation.contact_phone,'')),''),
    nullif(trim(coalesce(v_conversation.remote_jid,'')),''),
    'Contato'
  );

  v_chip_label := concat_ws(' · ',
    coalesce(nullif(trim(coalesce(v_chip.chips_name,'')),''), nullif(trim(coalesce(v_chip.instances_name,'')),''), 'WhatsApp'),
    nullif(trim(coalesce(v_chip.chips_phone,'')),'')
  );

  FOR v_member IN
    SELECT m.organization_members_id
      FROM public.organization_members m
     WHERE m.organizations_id=NEW.organizations_id
       AND m.status_id=1
       AND (
         v_conversation.assigned_to_member_id IS NULL
         OR m.organization_members_id=v_conversation.assigned_to_member_id
       )
       AND public.stage5_member_has_permission(NEW.organizations_id,m.organization_members_id,'whatsapp.view')
  LOOP
    PERFORM public.crm_notification_emit(
      NEW.organizations_id,
      v_member.organization_members_id,
      'whatsapp_message',
      'whatsapp',
      format('whatsapp_message:conversation:%s',NEW.conversations_id),
      format('Nova mensagem · %s',v_subject),
      format('{count} novas mensagens · %s',v_subject),
      format('Recebida em %s',v_chip_label),
      'conversation',
      NEW.conversations_id::text,
      'conversations',
      jsonb_build_object(
        'conversationId',NEW.conversations_id,
        'chipId',NEW.chips_id
      ),
      jsonb_build_object(
        'subject',v_subject,
        'chipId',NEW.chips_id,
        'chipName',coalesce(v_chip.chips_name,''),
        'chipPhone',coalesce(v_chip.chips_phone,'')
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_notify_inbound_whatsapp_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_notify_inbound_whatsapp_message_trigger ON public.conversation_messages;
CREATE TRIGGER crm_notify_inbound_whatsapp_message_trigger
AFTER INSERT ON public.conversation_messages
FOR EACH ROW
WHEN (NEW.direction='inbound' AND NEW.from_me=false)
EXECUTE FUNCTION public.crm_notify_inbound_whatsapp_message();

CREATE OR REPLACE FUNCTION public.crm_notify_whatsapp_runtime_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_instance record;
  v_chip record;
  v_member record;
  v_chip_label text;
  v_was_online boolean := coalesce(OLD.socket_connected,false);
  v_is_online boolean := coalesce(NEW.socket_connected,false);
  v_old_proven_disconnect boolean := lower(trim(coalesce(OLD.operational_state,''))) IN ('session_saved','reconnecting','disconnected');
  v_is_proven_disconnect boolean := lower(trim(coalesce(NEW.operational_state,''))) IN ('session_saved','reconnecting','disconnected');
BEGIN
  -- instance_runtime_states e a fonte canonica de conectividade. Nao usamos
  -- instances.status_id, que representa o cadastro ativo/inativo da instancia.
  -- Tambem nao tratamos "unavailable" como queda: indisponibilidade do Gateway
  -- ou da leitura nao prova que o chip perdeu a sessao.
  IF NOT (
    (NOT v_is_online AND v_is_proven_disconnect AND (v_was_online OR NOT v_old_proven_disconnect))
    OR (v_is_online AND NOT v_was_online)
  ) THEN RETURN NEW; END IF;

  SELECT i.instances_id,i.instances_name
    INTO v_instance
    FROM public.instances i
   WHERE i.instances_id=NEW.instances_id
     AND i.organizations_id=NEW.organizations_id;

  SELECT ch.chips_id,ch.chips_name,ch.chips_phone
    INTO v_chip
    FROM public.chips ch
   WHERE ch.instances_id=NEW.instances_id
     AND ch.organizations_id=NEW.organizations_id
   ORDER BY CASE WHEN ch.status_id=1 THEN 0 ELSE 1 END,ch.chips_id
   LIMIT 1;

  IF NOT v_is_online AND v_is_proven_disconnect AND (v_was_online OR NOT v_old_proven_disconnect) THEN
    v_chip_label := concat_ws(' · ',
      coalesce(nullif(trim(coalesce(v_chip.chips_name,'')),''),nullif(trim(coalesce(v_instance.instances_name,'')),''),'WhatsApp'),
      nullif(trim(coalesce(v_chip.chips_phone,'')),'')
    );

    FOR v_member IN
      SELECT m.organization_members_id
        FROM public.organization_members m
       WHERE m.organizations_id=NEW.organizations_id
         AND m.status_id=1
         AND public.stage5_member_has_permission(NEW.organizations_id,m.organization_members_id,'whatsapp.view')
    LOOP
      PERFORM public.crm_notification_emit(
        NEW.organizations_id,
        v_member.organization_members_id,
        'whatsapp_disconnected',
        'whatsapp',
        format('whatsapp_disconnected:instance:%s',NEW.instances_id),
        'Chip WhatsApp desconectado',
        NULL,
        v_chip_label,
        'instance',
        NEW.instances_id::text,
        'sender-chips',
        jsonb_build_object('instanceId',NEW.instances_id,'chipId',v_chip.chips_id),
        jsonb_build_object(
          'chipName',coalesce(v_chip.chips_name,''),
          'chipPhone',coalesce(v_chip.chips_phone,''),
          'instanceName',coalesce(v_instance.instances_name,''),
          'operationalState',coalesce(NEW.operational_state,'')
        )
      );
    END LOOP;
  ELSIF v_is_online AND NOT v_was_online THEN
    -- A reconexao nao gera uma nova notificacao, mas resolve o alerta pendente
    -- para que a bolinha do sino nao permaneca acesa com um problema ja sanado.
    UPDATE public.crm_notifications
       SET read_at=coalesce(read_at,now()),
           crm_notifications_updated_at=now(),
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('resolvedAt',now())
     WHERE organizations_id=NEW.organizations_id
       AND notification_type='whatsapp_disconnected'
       AND entity_type='instance'
       AND entity_id=NEW.instances_id::text
       AND read_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_notify_whatsapp_runtime_status() FROM PUBLIC, anon, authenticated;

-- Remove a versao intermediaria do FIX 30, caso o SQL tenha sido testado antes
-- da entrega final. Ela observava o status administrativo de instances, nao o
-- runtime canonico do socket.
DROP TRIGGER IF EXISTS crm_notify_whatsapp_instance_status_trigger ON public.instances;
DROP FUNCTION IF EXISTS public.crm_notify_whatsapp_instance_status();

DROP TRIGGER IF EXISTS crm_notify_whatsapp_runtime_status_trigger ON public.instance_runtime_states;
CREATE TRIGGER crm_notify_whatsapp_runtime_status_trigger
AFTER UPDATE OF socket_connected,operational_state ON public.instance_runtime_states
FOR EACH ROW
EXECUTE FUNCTION public.crm_notify_whatsapp_runtime_status();

CREATE OR REPLACE FUNCTION public.crm_notify_dispatch_error()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_queue record;
  v_chip record;
  v_social record;
  v_progress_step text;
  v_member record;
  v_channel text;
  v_resource text;
  v_target_page text;
  v_group_key text;
  v_operational_date date;
BEGIN
  IF NEW.status_id<>6 OR coalesce(OLD.status_id,-1)=6 THEN RETURN NEW; END IF;

  SELECT q.channels_id
    INTO v_queue
    FROM public.queues q
   WHERE q.queues_id=NEW.queues_id
     AND q.organizations_id=NEW.organizations_id;

  IF v_queue.channels_id=2 THEN
    SELECT p.step INTO v_progress_step
      FROM public.instagram_queue_progress p
     WHERE p.queue_items_id=NEW.queue_items_id
       AND p.organizations_id=NEW.organizations_id;
    IF coalesce(v_progress_step,'')='invalid' THEN RETURN NEW; END IF;
  END IF;

  v_operational_date := coalesce((NEW.queue_items_scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date,(now() AT TIME ZONE 'America/Sao_Paulo')::date);

  IF v_queue.channels_id=1 THEN
    v_channel:='whatsapp';
    v_target_page:='whatsapp';
    SELECT ch.chips_name,ch.chips_phone,i.instances_name INTO v_chip
      FROM public.chips ch
      LEFT JOIN public.instances i
        ON i.instances_id=ch.instances_id
       AND i.organizations_id=ch.organizations_id
     WHERE ch.chips_id=NEW.chips_id
       AND ch.organizations_id=NEW.organizations_id;
    v_resource:=concat_ws(' · ',coalesce(nullif(trim(coalesce(v_chip.chips_name,'')),''),'WhatsApp'),nullif(trim(coalesce(v_chip.chips_phone,'')),''));
    v_group_key:=format('dispatch_error:whatsapp:chip:%s:%s',coalesce(NEW.chips_id,0),v_operational_date);
  ELSIF v_queue.channels_id=2 THEN
    v_channel:='instagram';
    v_target_page:='instagram';
    SELECT s.socials_name,s.socials_username INTO v_social
      FROM public.socials s
     WHERE s.socials_id=NEW.socials_id
       AND s.organizations_id=NEW.organizations_id;
    v_resource:=coalesce(
      CASE WHEN nullif(trim(coalesce(v_social.socials_username,'')),'') IS NOT NULL THEN '@'||trim(v_social.socials_username) END,
      nullif(trim(coalesce(v_social.socials_name,'')),''),
      'Instagram'
    );
    v_group_key:=format('dispatch_error:instagram:social:%s:%s',coalesce(NEW.socials_id,0),v_operational_date);
  ELSE
    RETURN NEW;
  END IF;

  FOR v_member IN
    SELECT m.organization_members_id
      FROM public.organization_members m
     WHERE m.organizations_id=NEW.organizations_id
       AND m.status_id=1
       AND public.stage5_member_has_permission(NEW.organizations_id,m.organization_members_id,'queues.view')
  LOOP
    PERFORM public.crm_notification_emit(
      NEW.organizations_id,
      v_member.organization_members_id,
      'dispatch_error',
      v_channel,
      v_group_key,
      format('Envio com erro · %s',CASE WHEN v_channel='whatsapp' THEN 'WhatsApp' ELSE 'Instagram' END),
      format('{count} envios com erro · %s',CASE WHEN v_channel='whatsapp' THEN 'WhatsApp' ELSE 'Instagram' END),
      concat_ws(' · ',v_resource,to_char(v_operational_date,'DD/MM/YYYY')),
      'queue_item',
      NEW.queue_items_id::text,
      v_target_page,
      jsonb_build_object(
        'queueItemId',NEW.queue_items_id,
        'scheduledDate',v_operational_date,
        'resourceKey',CASE
          WHEN v_channel='whatsapp' THEN coalesce(v_chip.instances_name,'')
          ELSE lower(regexp_replace(trim(coalesce(v_social.socials_username,'')),'^@+',''))
        END,
        'tab','Fila final'
      ),
      jsonb_build_object(
        'error',coalesce(NEW.queue_items_error_message,''),
        'resource',v_resource,
        'chipName',CASE WHEN v_channel='whatsapp' THEN coalesce(v_chip.chips_name,'') ELSE '' END,
        'chipPhone',CASE WHEN v_channel='whatsapp' THEN coalesce(v_chip.chips_phone,'') ELSE '' END,
        'instanceName',CASE WHEN v_channel='whatsapp' THEN coalesce(v_chip.instances_name,'') ELSE '' END,
        'profileUsername',CASE WHEN v_channel='instagram' THEN coalesce(v_social.socials_username,'') ELSE '' END
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_notify_dispatch_error() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_notify_dispatch_error_trigger ON public.queue_items;
CREATE TRIGGER crm_notify_dispatch_error_trigger
AFTER UPDATE OF status_id ON public.queue_items
FOR EACH ROW
WHEN (NEW.status_id=6)
EXECUTE FUNCTION public.crm_notify_dispatch_error();

COMMIT;

-- Validação rápida pós-aplicação (somente leitura):
-- SELECT notification_type,channel,count(*) FROM public.crm_notifications GROUP BY 1,2 ORDER BY 1,2;
