-- CRM - Vinsansi Studio v2.4.0-R17
-- Etapa 10: integra o fechamento Instagram ao log canônico `sents`
-- e garante refresh idempotente da Base Permanente.

BEGIN;

-- Toda gravação canônica de envio concluído atualiza a memória comercial.
CREATE OR REPLACE FUNCTION public.refresh_permanent_record_from_sent_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.leads_id IS NOT NULL
     AND NEW.sents_sent_at IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.sents_sent_at IS DISTINCT FROM NEW.sents_sent_at
       OR OLD.status_id IS DISTINCT FROM NEW.status_id
     ) THEN
    PERFORM public.refresh_permanent_record(NEW.leads_id, 'dispatch_changed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_permanent_record_sent_trigger ON public.sents;
CREATE TRIGGER refresh_permanent_record_sent_trigger
AFTER INSERT OR UPDATE OF status_id, sents_sent_at ON public.sents
FOR EACH ROW
EXECUTE FUNCTION public.refresh_permanent_record_from_sent_trigger();

-- O fechamento Instagram agora grava um único `sents` por queue_item.
-- Repetir a mesma confirmação final é no-op para evitar contadores/eventos duplicados.
CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
 p_organizations_id bigint,
 p_queue_item_id bigint,
 p_claim_token uuid,
 p_step text,
 p_message text DEFAULT NULL,
 p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_item public.queue_items%ROWTYPE;
  v_canonical text:=public.instagram_canonical_step(p_step);
  v_queue bigint:=4;
  v_lead bigint;
  v_final boolean:=false;
  v_previous text;
  v_current_lead_status bigint;
  v_recipient text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF NOT v_canonical=ANY(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending','completed','error','reconciliation_required']) THEN
   RAISE EXCEPTION 'instagram_step_invalid:%',p_step;
 END IF;

 SELECT p.* INTO v_progress
 FROM public.instagram_queue_progress p
 WHERE p.queue_items_id=p_queue_item_id AND p.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found'; END IF;
 IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid'; END IF;

 SELECT qi.* INTO v_item
 FROM public.queue_items qi
 WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;

 SELECT l.lead_status_id INTO v_current_lead_status
 FROM public.leads l
 WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id;

 v_previous:=v_progress.step;

 -- Finalizações são idempotentes: retry da mesma transição não gera novo sent/evento/contador.
 IF public.instagram_canonical_step(v_progress.step) IN('completed','error','reconciliation_required') THEN
   IF public.instagram_canonical_step(v_progress.step)<>v_canonical THEN
     RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step;
   END IF;
   RETURN QUERY SELECT p_queue_item_id,p_step,v_item.status_id,coalesce(v_current_lead_status,4::bigint);
   RETURN;
 END IF;

 IF v_canonical='completed' THEN
   v_queue:=5;v_lead:=5;v_final:=true;
 ELSIF v_canonical='error' THEN
   v_queue:=6;v_lead:=CASE WHEN p_step='invalid' THEN 6 ELSE NULL END;v_final:=true;
 ELSIF v_canonical='reconciliation_required' THEN
   v_queue:=6;v_final:=true;
 END IF;

 UPDATE public.instagram_queue_progress p
 SET step=p_step,canonical_step=v_canonical,last_heartbeat_at=now(),
     finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
     error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,
     metadata=coalesce(p.metadata,'{}')||coalesce(p_metadata,'{}'),instagram_queue_progress_updated_at=now()
 WHERE p.instagram_queue_progress_id=v_progress.instagram_queue_progress_id;

 UPDATE public.queue_items qi
 SET status_id=v_queue,queue_items_updated_at=now(),
     queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
     queue_items_error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END
 WHERE qi.queue_items_id=p_queue_item_id;

 IF v_lead IS NOT NULL THEN
   UPDATE public.leads l SET lead_status_id=v_lead,leads_updated_at=now()
   WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id AND l.lead_status_id=4;
 END IF;

 IF v_canonical='completed' THEN
   v_recipient:=nullif(trim(coalesce(
     v_item.queue_items_payload_snapshot #>> '{recipient,instagram}',
     v_item.queue_items_payload_snapshot #>> '{lead,instagram}',
     (SELECT l.leads_instagram FROM public.leads l WHERE l.leads_id=v_item.leads_id),
     ''
   )), '');

   INSERT INTO public.sents(
     users_id,organizations_id,queue_items_id,leads_id,channels_id,socials_id,templates_id,status_id,
     sents_recipient,sents_body,sents_attempt,sents_sent_at,sent_by_member_id,executed_by
   )
   SELECT
     v_item.users_id,p_organizations_id,p_queue_item_id,v_item.leads_id,2,v_progress.socials_id,v_item.templates_id,5,
     v_recipient,
     jsonb_build_object(
       'channel','instagram',
       'queueItemId',p_queue_item_id,
       'messages',coalesce(v_item.queue_items_payload_snapshot->'messages','{}'::jsonb),
       'metadata',coalesce(p_metadata,'{}'::jsonb)
     )::text,
     greatest(coalesce(v_progress.attempts,0),1),now(),v_progress.dispatched_by_member_id,'system'
   WHERE NOT EXISTS(
     SELECT 1 FROM public.sents s
     WHERE s.organizations_id=p_organizations_id
       AND s.queue_items_id=p_queue_item_id
       AND s.channels_id=2
       AND s.sents_sent_at IS NOT NULL
   );
 END IF;

 INSERT INTO public.instagram_dispatch_events(
   users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata,
   organization_tool_installations_id,organization_members_id
 ) VALUES(
   v_item.users_id,p_organizations_id,p_queue_item_id,v_progress.socials_id,v_previous,p_step,p_claim_token,
   v_progress.claimed_by,p_message,coalesce(p_metadata,'{}'),v_progress.organization_tool_installations_id,v_progress.dispatched_by_member_id
 );

 IF v_final THEN
   INSERT INTO public.instagram_profile_runtime(
     organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,
     sent_count,invalid_count,error_count,last_send_at,last_heartbeat_at
   ) VALUES(
     p_organizations_id,v_progress.socials_id,v_progress.organization_tool_installations_id,coalesce(v_progress.profile_username,''),
     (now() AT TIME ZONE 'America/Sao_Paulo')::date,
     CASE WHEN v_canonical='completed' THEN 1 ELSE 0 END,
     CASE WHEN p_step='invalid' THEN 1 ELSE 0 END,
     CASE WHEN v_canonical IN('error','reconciliation_required') AND p_step<>'invalid' THEN 1 ELSE 0 END,
     CASE WHEN v_canonical='completed' THEN now() ELSE NULL END,now()
   ) ON CONFLICT(organizations_id,socials_id,operational_date)
   DO UPDATE SET sent_count=public.instagram_profile_runtime.sent_count+excluded.sent_count,
     invalid_count=public.instagram_profile_runtime.invalid_count+excluded.invalid_count,
     error_count=public.instagram_profile_runtime.error_count+excluded.error_count,
     last_send_at=coalesce(excluded.last_send_at,public.instagram_profile_runtime.last_send_at),last_heartbeat_at=now(),updated_at=now();
 END IF;

 RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,v_current_lead_status,4::bigint);
END;
$$;

REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

-- Backfill dos envios Instagram já concluídos antes do R17.
-- Não reenvia nada; apenas cria o registro canônico faltante em `sents`.
INSERT INTO public.sents(
  users_id,organizations_id,queue_items_id,leads_id,channels_id,socials_id,templates_id,status_id,
  sents_recipient,sents_body,sents_attempt,sents_sent_at,sent_by_member_id,executed_by
)
SELECT
  qi.users_id,qi.organizations_id,qi.queue_items_id,qi.leads_id,2,p.socials_id,qi.templates_id,5,
  nullif(trim(coalesce(
    qi.queue_items_payload_snapshot #>> '{recipient,instagram}',
    qi.queue_items_payload_snapshot #>> '{lead,instagram}',
    l.leads_instagram,
    ''
  )),''),
  jsonb_build_object(
    'channel','instagram',
    'queueItemId',qi.queue_items_id,
    'messages',coalesce(qi.queue_items_payload_snapshot->'messages','{}'::jsonb),
    'metadata',coalesce(p.metadata,'{}'::jsonb),
    'backfill','R17'
  )::text,
  greatest(coalesce(p.attempts,0),1),
  coalesce(p.finished_at,qi.queue_items_finished_at,now()),
  p.dispatched_by_member_id,
  'system'
FROM public.instagram_queue_progress p
JOIN public.queue_items qi
  ON qi.queue_items_id=p.queue_items_id
 AND qi.organizations_id=p.organizations_id
LEFT JOIN public.leads l
  ON l.leads_id=qi.leads_id
WHERE public.instagram_canonical_step(p.step)='completed'
  AND NOT EXISTS(
    SELECT 1 FROM public.sents s
    WHERE s.organizations_id=qi.organizations_id
      AND s.queue_items_id=qi.queue_items_id
      AND s.channels_id=2
      AND s.sents_sent_at IS NOT NULL
  );

COMMIT;
