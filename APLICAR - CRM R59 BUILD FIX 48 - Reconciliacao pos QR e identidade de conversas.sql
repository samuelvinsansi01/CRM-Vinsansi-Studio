-- CRM R59 BUILD FIX 48
-- Reconciliação pós-QR / sessão restaurada:
-- 1) usa aliases de mensagens inbound para convergir telefone, JID e LID;
-- 2) saneia contact_name contaminado pelo pushName do próprio chip;
-- 3) executa reconciliação automaticamente após um novo ciclo conectado;
-- 4) limpa apenas o erro obsoleto chip_disconnected do último lote quando o runtime confirma conexão.

BEGIN;

CREATE OR REPLACE FUNCTION public.stage5_payload_contact_name_r59(p_raw_payload jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v text;
BEGIN
  v := public.stage5_meaningful_contact_name(coalesce(
    p_raw_payload->>'pushName',
    p_raw_payload->>'push_name',
    p_raw_payload->>'notifyName',
    p_raw_payload->>'contactName',
    p_raw_payload#>>'{Info,PushName}',
    p_raw_payload#>>'{info,pushName}',
    p_raw_payload#>>'{data,pushName}',
    p_raw_payload#>>'{data,Info,PushName}',
    p_raw_payload#>>'{data,info,pushName}'
  ));
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_contact_name_is_own_sender_r59(
  p_organizations_id bigint,
  p_chips_id bigint,
  p_value text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_name text := public.stage5_meaningful_contact_name(p_value);
BEGIN
  IF v_name IS NULL OR p_organizations_id IS NULL OR p_chips_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM (
        SELECT cm.raw_payload
          FROM public.conversation_messages cm
         WHERE cm.organizations_id = p_organizations_id
           AND cm.chips_id = p_chips_id
           AND cm.from_me = true
         ORDER BY cm.conversation_messages_id DESC
         LIMIT 50
      ) recent
     WHERE lower(public.stage5_payload_contact_name_r59(recent.raw_payload)) = lower(v_name)
     LIMIT 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_sanitize_contact_name_r59(
  p_organizations_id bigint,
  p_chips_id bigint,
  p_value text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_name text := public.stage5_meaningful_contact_name(p_value);
BEGIN
  IF v_name IS NULL THEN RETURN NULL; END IF;
  IF public.stage5_contact_name_is_own_sender_r59(p_organizations_id, p_chips_id, v_name) THEN
    RETURN NULL;
  END IF;
  RETURN v_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_conversations_contact_name_guard_r59()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_clean text;
  v_old_clean text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_name IS NOT DISTINCT FROM OLD.contact_name THEN
    RETURN NEW;
  END IF;

  v_clean := public.stage5_sanitize_contact_name_r59(NEW.organizations_id, NEW.chips_id, NEW.contact_name);

  IF v_clean IS NULL AND NEW.contact_name IS NOT NULL AND TG_OP = 'UPDATE' THEN
    v_old_clean := public.stage5_sanitize_contact_name_r59(OLD.organizations_id, OLD.chips_id, OLD.contact_name);
    NEW.contact_name := v_old_clean;
  ELSE
    NEW.contact_name := v_clean;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS conversations_contact_name_guard_r59 ON public.conversations;
CREATE TRIGGER conversations_contact_name_guard_r59
BEFORE INSERT OR UPDATE OF contact_name ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.stage5_conversations_contact_name_guard_r59();

CREATE OR REPLACE FUNCTION public.stage5_inbound_payload_contact_aliases_r59(p_raw_payload jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_values text[] := ARRAY[]::text[];
  v text;
  v_candidate text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    p_raw_payload#>>'{key,remoteJid}',
    p_raw_payload#>>'{key,remote_jid}',
    p_raw_payload#>>'{key,remoteJidAlt}',
    p_raw_payload#>>'{key,remote_jid_alt}',
    p_raw_payload->>'remoteJid',
    p_raw_payload->>'remote_jid',
    p_raw_payload->>'remoteJidAlt',
    p_raw_payload->>'remote_jid_alt',
    p_raw_payload#>>'{Info,Chat}',
    p_raw_payload#>>'{Info,ChatAlt}',
    p_raw_payload#>>'{Info,SenderAlt}',
    p_raw_payload#>>'{info,chat}',
    p_raw_payload#>>'{info,chatAlt}',
    p_raw_payload#>>'{info,senderAlt}',
    p_raw_payload#>>'{data,Info,Chat}',
    p_raw_payload#>>'{data,Info,ChatAlt}',
    p_raw_payload#>>'{data,Info,SenderAlt}',
    p_raw_payload#>>'{data,info,chat}',
    p_raw_payload#>>'{data,info,chatAlt}',
    p_raw_payload#>>'{data,info,senderAlt}'
  ] LOOP
    v_candidate := public.stage5_normalize_contact_jid(v);
    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(v_values)) THEN
      v_values := array_append(v_values, v_candidate);
    END IF;
  END LOOP;
  RETURN v_values;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_repair_conversation_contact_name_r59(p_conversations_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_c public.conversations%ROWTYPE;
  v_current text;
  v_inbound text;
  v_final text;
BEGIN
  SELECT * INTO v_c
    FROM public.conversations
   WHERE conversations_id = p_conversations_id
   FOR UPDATE;

  IF v_c.conversations_id IS NULL THEN RETURN NULL; END IF;

  v_current := public.stage5_sanitize_contact_name_r59(v_c.organizations_id, v_c.chips_id, v_c.contact_name);

  SELECT public.stage5_sanitize_contact_name_r59(
           v_c.organizations_id,
           v_c.chips_id,
           public.stage5_payload_contact_name_r59(cm.raw_payload)
         )
    INTO v_inbound
    FROM public.conversation_messages cm
   WHERE cm.organizations_id = v_c.organizations_id
     AND cm.conversations_id = v_c.conversations_id
     AND cm.from_me = false
     AND public.stage5_sanitize_contact_name_r59(
           v_c.organizations_id,
           v_c.chips_id,
           public.stage5_payload_contact_name_r59(cm.raw_payload)
         ) IS NOT NULL
   ORDER BY coalesce(cm.provider_timestamp, cm.conversation_messages_created_at) DESC,
            cm.conversation_messages_id DESC
   LIMIT 1;

  v_final := coalesce(v_current, v_inbound);

  IF v_c.contact_name IS DISTINCT FROM v_final THEN
    UPDATE public.conversations
       SET contact_name = v_final,
           conversations_updated_at = now()
     WHERE conversations_id = v_c.conversations_id;
  END IF;

  RETURN v_final;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_reconcile_instance_after_reconnect_r59(p_instances_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_instance public.instances%ROWTYPE;
  v_chip_id bigint;
  v_runtime_connected boolean := false;
  v_before integer := 0;
  v_after integer := 0;
  v_scanned integer := 0;
  v_names_repaired integer := 0;
  v_final bigint;
  v_aliases text[];
  v_previous_name text;
  v_new_name text;
  v_latest_batch bigint;
  r record;
BEGIN
  SELECT * INTO v_instance
    FROM public.instances
   WHERE instances_id = p_instances_id;
  IF v_instance.instances_id IS NULL THEN
    RETURN jsonb_build_object('ignored', true, 'reason', 'instance_not_found');
  END IF;

  SELECT c.chips_id
    INTO v_chip_id
    FROM public.chips c
   WHERE c.instances_id = p_instances_id
     AND c.organizations_id = v_instance.organizations_id
   ORDER BY CASE WHEN c.status_id = 1 THEN 0 ELSE 1 END, c.chips_id
   LIMIT 1;

  IF v_chip_id IS NULL THEN
    RETURN jsonb_build_object('ignored', true, 'reason', 'chip_not_found');
  END IF;

  SELECT coalesce(irs.socket_connected, false) AND coalesce(irs.connected, false) AND coalesce(irs.logged_in, false)
    INTO v_runtime_connected
    FROM public.instance_runtime_states irs
   WHERE irs.instances_id = p_instances_id
     AND irs.organizations_id = v_instance.organizations_id;
  v_runtime_connected := coalesce(v_runtime_connected, false);

  SELECT count(*)::integer INTO v_before
    FROM public.conversations c
   WHERE c.organizations_id = v_instance.organizations_id
     AND c.chips_id = v_chip_id;

  FOR r IN
    SELECT c.conversations_id, c.remote_jid, c.contact_phone
      FROM public.conversations c
     WHERE c.organizations_id = v_instance.organizations_id
       AND c.chips_id = v_chip_id
     ORDER BY c.conversations_id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.conversations_id = r.conversations_id) THEN
      CONTINUE;
    END IF;

    v_scanned := v_scanned + 1;

    SELECT array_agg(DISTINCT q.alias_jid ORDER BY q.alias_jid)
      INTO v_aliases
      FROM (
        SELECT public.stage5_normalize_contact_jid(r.remote_jid) AS alias_jid
        UNION ALL
        SELECT CASE
          WHEN public.normalize_identity_phone(r.contact_phone) <> ''
            THEN public.normalize_identity_phone(r.contact_phone) || '@s.whatsapp.net'
        END
        UNION ALL
        SELECT a.alias_jid
          FROM public.conversation_contact_aliases a
         WHERE a.organizations_id = v_instance.organizations_id
           AND a.chips_id = v_chip_id
           AND a.conversations_id = r.conversations_id
        UNION ALL
        SELECT alias_value
          FROM public.conversation_messages cm
          CROSS JOIN LATERAL unnest(public.stage5_inbound_payload_contact_aliases_r59(cm.raw_payload)) AS alias_value
         WHERE cm.organizations_id = v_instance.organizations_id
           AND cm.chips_id = v_chip_id
           AND cm.conversations_id = r.conversations_id
           AND cm.from_me = false
      ) q
     WHERE q.alias_jid IS NOT NULL;

    v_final := public.stage5_register_conversation_aliases(
      v_instance.organizations_id,
      v_chip_id,
      r.conversations_id,
      coalesce(v_aliases, ARRAY[]::text[])
    );

    IF v_final IS NOT NULL THEN
      PERFORM public.stage5_sync_conversation_lead_identity(v_final);
      SELECT contact_name INTO v_previous_name FROM public.conversations WHERE conversations_id = v_final;
      v_new_name := public.stage5_repair_conversation_contact_name_r59(v_final);
      IF v_previous_name IS DISTINCT FROM v_new_name THEN
        v_names_repaired := v_names_repaired + 1;
      END IF;

      UPDATE public.conversation_messages cm
         SET leads_id = coalesce(cm.leads_id, c.leads_id),
             conversation_messages_updated_at = CASE
               WHEN cm.leads_id IS NULL AND c.leads_id IS NOT NULL THEN now()
               ELSE cm.conversation_messages_updated_at
             END
        FROM public.conversations c
       WHERE c.conversations_id = v_final
         AND cm.organizations_id = c.organizations_id
         AND cm.conversations_id = v_final;
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_after
    FROM public.conversations c
   WHERE c.organizations_id = v_instance.organizations_id
     AND c.chips_id = v_chip_id;

  IF v_runtime_connected THEN
    SELECT wb.worker_batches_id
      INTO v_latest_batch
      FROM public.worker_batches wb
     WHERE wb.organizations_id = v_instance.organizations_id
       AND wb.chips_id = v_chip_id
     ORDER BY wb.worker_batches_id DESC
     LIMIT 1;

    IF v_latest_batch IS NOT NULL THEN
      UPDATE public.worker_batches
         SET worker_batches_last_error = NULL,
             worker_batches_updated_at = now()
       WHERE worker_batches_id = v_latest_batch
         AND worker_batches_last_error ~* '^chip_disconnected:';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ignored', false,
    'instanceId', p_instances_id,
    'chipId', v_chip_id,
    'runtimeConnected', v_runtime_connected,
    'scanned', v_scanned,
    'before', v_before,
    'after', v_after,
    'merged', greatest(v_before - v_after, 0),
    'namesRepaired', v_names_repaired
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.stage5_payload_contact_name_r59(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_conversations_contact_name_guard_r59() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_contact_name_is_own_sender_r59(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_sanitize_contact_name_r59(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_inbound_payload_contact_aliases_r59(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_repair_conversation_contact_name_r59(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage5_reconcile_instance_after_reconnect_r59(bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.stage5_payload_contact_name_r59(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_contact_name_is_own_sender_r59(bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_sanitize_contact_name_r59(bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_inbound_payload_contact_aliases_r59(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_repair_conversation_contact_name_r59(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage5_reconcile_instance_after_reconnect_r59(bigint) TO service_role;

-- Saneamento imediato das identidades já existentes. A função é idempotente e
-- limpa erro chip_disconnected apenas para runtime que já está conectado.
DO $block$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT instances_id FROM public.instances ORDER BY instances_id LOOP
    PERFORM public.stage5_reconcile_instance_after_reconnect_r59(r.instances_id);
  END LOOP;
END;
$block$;

COMMIT;

-- Resultado visível no SQL Editor para homologação imediata.
SELECT
  i.instances_id,
  i.instances_name,
  public.stage5_reconcile_instance_after_reconnect_r59(i.instances_id) AS reconciliation
FROM public.instances i
ORDER BY i.instances_id;
