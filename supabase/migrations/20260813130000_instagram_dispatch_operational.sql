BEGIN;

-- Fechamento operacional do Instagram:
-- 1) persiste o resultado final em public.sents de forma idempotente;
-- 2) permite reprocessar apenas erro seguro (nunca reconciliation_required);
-- 3) invalida item Instagram de forma atômica, sincronizando progress/queue/lead.
-- 4) a extensão só pode fazer claim de item realmente pendente; erro exige reprocesso explícito no CRM.

CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item(
  p_users_id bigint,
  p_queue_item_id bigint,
  p_socials_id bigint,
  p_consumer_id text
) RETURNS TABLE(queue_items_id bigint, claim_token uuid, step text, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_item public.queue_items%ROWTYPE;
  v_existing public.instagram_queue_progress%ROWTYPE;
  v_token uuid:=gen_random_uuid();
  v_attempts integer;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF nullif(trim(coalesce(p_consumer_id,'')),'') IS NULL THEN RAISE EXCEPTION 'consumer_id_required'; END IF;

  SELECT * INTO v_item FROM public.queue_items qi
  WHERE qi.queue_items_id=p_queue_item_id AND qi.users_id=p_users_id AND qi.socials_id=p_socials_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;

  SELECT * INTO v_existing FROM public.instagram_queue_progress p
  WHERE p.queue_items_id=p_queue_item_id FOR UPDATE;

  IF FOUND AND v_existing.step IN ('sent','invalid','error','reconciliation_required') THEN
    RAISE EXCEPTION 'instagram_item_not_claimable:%',v_existing.step;
  END IF;
  IF v_item.status_id<>3 THEN
    RAISE EXCEPTION 'instagram_item_not_pending:%',v_item.status_id;
  END IF;

  v_attempts:=coalesce(v_existing.attempts,0)+1;
  INSERT INTO public.instagram_queue_progress(
    users_id,queue_items_id,socials_id,step,claim_token,claimed_by,attempts,last_heartbeat_at,started_at,finished_at,error_message,metadata
  ) VALUES(
    p_users_id,p_queue_item_id,p_socials_id,'claimed',v_token,trim(p_consumer_id),v_attempts,now(),coalesce(v_existing.started_at,now()),NULL,NULL,'{}'::jsonb
  ) ON CONFLICT(queue_items_id) DO UPDATE SET
    step='claimed',claim_token=excluded.claim_token,claimed_by=excluded.claimed_by,
    attempts=excluded.attempts,last_heartbeat_at=now(),started_at=coalesce(public.instagram_queue_progress.started_at,now()),
    finished_at=NULL,error_message=NULL,instagram_queue_progress_updated_at=now()
  RETURNING public.instagram_queue_progress.claim_token,public.instagram_queue_progress.attempts
  INTO v_token,v_attempts;

  UPDATE public.queue_items SET status_id=4,queue_items_started_at=coalesce(queue_items_started_at,now()),
    queue_items_finished_at=NULL,queue_items_error_message=NULL,queue_items_updated_at=now()
  WHERE queue_items_id=p_queue_item_id;

  PERFORM public.instagram_log_progress_event(p_users_id,p_queue_item_id,p_socials_id,coalesce(v_existing.step,'queued'),'claimed',v_token,p_consumer_id,NULL,'{}'::jsonb);
  PERFORM public.append_audit_event('instagram-extension','instagram_claimed','queue_item',p_queue_item_id::text,v_item.leads_id,p_queue_item_id,2,v_item.status_id,4,NULL,jsonb_build_object('consumer_id',p_consumer_id,'attempt',v_attempts),p_users_id);

  RETURN QUERY SELECT p_queue_item_id,v_token,'claimed'::text,v_attempts;
END; $$;

GRANT EXECUTE ON FUNCTION public.instagram_claim_queue_item(bigint,bigint,bigint,text) TO service_role;
REVOKE ALL ON FUNCTION public.instagram_claim_queue_item(bigint,bigint,bigint,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress(
  p_users_id bigint,
  p_queue_item_id bigint,
  p_claim_token uuid,
  p_step text,
  p_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(queue_items_id bigint, step text, queue_status_id bigint, lead_status_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_item public.queue_items%ROWTYPE;
  v_target_queue bigint:=4;
  v_target_lead bigint;
  v_final boolean:=false;
  v_allowed text[]:=ARRAY['claimed','profile_opened','following','followed','dm_opened','messages_sending','media_sending','sent','invalid','error','reconciliation_required'];
  v_channel_id bigint;
  v_recipient text;
  v_idempotency_key text;
  v_body text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT (p_step=ANY(v_allowed)) THEN RAISE EXCEPTION 'instagram_step_invalid:%',p_step; END IF;

  SELECT * INTO v_progress FROM public.instagram_queue_progress p
  WHERE p.queue_items_id=p_queue_item_id AND p.users_id=p_users_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found'; END IF;
  IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid'; END IF;
  IF p_step='error' AND v_progress.step IN ('messages_sending','media_sending') THEN
    RAISE EXCEPTION 'instagram_error_after_dispatch_requires_reconciliation';
  END IF;
  IF v_progress.step IN ('sent','invalid','reconciliation_required') AND v_progress.step<>p_step THEN
    RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step;
  END IF;
  SELECT * INTO v_item FROM public.queue_items qi
  WHERE qi.queue_items_id=p_queue_item_id AND qi.users_id=p_users_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;

  IF p_step='sent' THEN v_target_queue:=5; v_target_lead:=5; v_final:=true;
  ELSIF p_step='invalid' THEN v_target_queue:=6; v_target_lead:=6; v_final:=true;
  ELSIF p_step IN ('error','reconciliation_required') THEN v_target_queue:=6; v_final:=true;
  END IF;

  UPDATE public.instagram_queue_progress SET
    step=p_step,last_heartbeat_at=now(),finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
    error_message=CASE WHEN p_step IN ('error','invalid','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,
    metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),instagram_queue_progress_updated_at=now()
  WHERE instagram_queue_progress_id=v_progress.instagram_queue_progress_id;

  UPDATE public.queue_items SET status_id=v_target_queue,queue_items_updated_at=now(),
    queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
    queue_items_error_message=CASE WHEN p_step IN ('error','invalid','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END
  WHERE queue_items_id=p_queue_item_id;

  IF v_target_lead IS NOT NULL THEN
    UPDATE public.leads SET lead_status_id=v_target_lead,leads_updated_at=now()
    WHERE leads_id=v_item.leads_id AND users_id=p_users_id AND lead_status_id=4;
  END IF;

  -- Registra um único resultado operacional por queue_item + payload congelado.
  -- Retry seguro atualiza esse registro em vez de criar um segundo envio lógico.
  IF p_step IN ('sent','error','reconciliation_required') THEN
    SELECT q.channels_id INTO v_channel_id
    FROM public.queues q
    WHERE q.queues_id=v_item.queues_id AND q.users_id=p_users_id;

    v_recipient:=lower(trim(coalesce(
      v_item.queue_items_payload_snapshot #>> '{recipient,instagram}',
      v_item.queue_items_payload_snapshot #>> '{lead,instagram}',
      ''
    )));
    v_recipient:=regexp_replace(v_recipient,'^@','','g');
    v_idempotency_key:=format(
      'instagram-queue-item:%s:final:%s',
      p_queue_item_id,
      coalesce(nullif(v_item.queue_items_payload_hash,''),'nohash')
    );
    v_body:=jsonb_build_object(
      'channel','Instagram',
      'final_step',p_step,
      'messages',coalesce(v_item.queue_items_payload_snapshot->'messages','{}'::jsonb),
      'media',coalesce(v_item.queue_items_payload_snapshot->'media','{}'::jsonb),
      'payload_frozen_at',v_item.queue_items_payload_created_at,
      'metadata',coalesce(p_metadata,'{}'::jsonb)
    )::text;

    INSERT INTO public.sents(
      users_id,queue_items_id,leads_id,channels_id,chips_id,socials_id,templates_id,status_id,
      sents_recipient,sents_body,sents_external_id,sents_attempt,sents_error_message,sents_sent_at,
      sents_created_at,sents_updated_at,sents_part_key,sents_idempotency_key,sents_payload_hash
    ) VALUES(
      p_users_id,p_queue_item_id,v_item.leads_id,v_channel_id,NULL,v_item.socials_id,v_item.templates_id,
      CASE WHEN p_step='sent' THEN 5 ELSE 6 END,
      nullif(v_recipient,''),v_body,NULL,greatest(coalesce(v_progress.attempts,1),1),
      CASE WHEN p_step IN ('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,
      CASE WHEN p_step='sent' THEN now() ELSE NULL END,
      now(),now(),'instagram_final',v_idempotency_key,v_item.queue_items_payload_hash
    )
    ON CONFLICT(sents_idempotency_key) WHERE sents_idempotency_key IS NOT NULL
    DO UPDATE SET
      status_id=EXCLUDED.status_id,
      socials_id=EXCLUDED.socials_id,
      templates_id=EXCLUDED.templates_id,
      sents_recipient=EXCLUDED.sents_recipient,
      sents_body=EXCLUDED.sents_body,
      sents_attempt=greatest(public.sents.sents_attempt,EXCLUDED.sents_attempt),
      sents_error_message=EXCLUDED.sents_error_message,
      sents_sent_at=CASE WHEN EXCLUDED.status_id=5 THEN coalesce(public.sents.sents_sent_at,EXCLUDED.sents_sent_at) ELSE public.sents.sents_sent_at END,
      sents_updated_at=now();
  END IF;

  PERFORM public.instagram_log_progress_event(p_users_id,p_queue_item_id,v_progress.socials_id,v_progress.step,p_step,p_claim_token,v_progress.claimed_by,p_message,p_metadata);
  PERFORM public.append_audit_event('instagram-extension','instagram_step_'||p_step,'queue_item',p_queue_item_id::text,v_item.leads_id,p_queue_item_id,2,v_item.status_id,v_target_queue,p_message,jsonb_build_object('from_step',v_progress.step,'to_step',p_step),p_users_id);

  RETURN QUERY SELECT p_queue_item_id,p_step,v_target_queue,coalesce(v_target_lead,4::bigint);
END; $$;

GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress(bigint,bigint,uuid,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.instagram_update_queue_progress(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.instagram_reprocess_queue_items(
  p_queue_item_ids bigint[]
) RETURNS TABLE(queue_items_id bigint, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_users_id bigint:=public.ensure_current_user();
  v_id bigint;
  v_item public.queue_items%ROWTYPE;
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_channel_id bigint;
BEGIN
  SELECT channels_id INTO v_channel_id FROM public.channels
  WHERE lower(regexp_replace(public.unaccent(trim(channels_name)),'[^a-z0-9]+','','g'))='instagram'
  ORDER BY channels_id LIMIT 1;
  IF v_channel_id IS NULL THEN RAISE EXCEPTION 'instagram_channel_not_found'; END IF;

  FOREACH v_id IN ARRAY coalesce(p_queue_item_ids,ARRAY[]::bigint[]) LOOP
    SELECT qi.* INTO v_item
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id
    WHERE qi.queue_items_id=v_id AND qi.users_id=v_users_id AND q.users_id=v_users_id
      AND q.channels_id=v_channel_id AND qi.socials_id IS NOT NULL
    FOR UPDATE OF qi;
    IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found:%',v_id; END IF;

    SELECT * INTO v_progress FROM public.instagram_queue_progress p
    WHERE p.queue_items_id=v_id AND p.users_id=v_users_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found:%',v_id; END IF;
    IF v_item.status_id<>6 OR v_progress.step<>'error' THEN
      RAISE EXCEPTION 'instagram_item_not_safe_to_reprocess:%:%',v_id,v_progress.step;
    END IF;

    UPDATE public.instagram_queue_progress SET
      step='queued',claim_token=NULL,claimed_by=NULL,last_heartbeat_at=now(),finished_at=NULL,
      error_message=NULL,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('operator_reprocessed_at',now()),
      instagram_queue_progress_updated_at=now()
    WHERE instagram_queue_progress_id=v_progress.instagram_queue_progress_id;

    UPDATE public.queue_items SET
      status_id=3,queue_items_started_at=NULL,queue_items_finished_at=NULL,queue_items_error_message=NULL,
      queue_items_updated_at=now()
    WHERE queue_items_id=v_id;

    PERFORM public.instagram_log_progress_event(v_users_id,v_id,v_progress.socials_id,'error','queued',NULL,'crm-operator','operator_reprocess','{}'::jsonb);
    PERFORM public.append_audit_event('instagram-queue','instagram_reprocessed','queue_item',v_id::text,v_item.leads_id,v_id,2,6,3,NULL,'{}'::jsonb,v_users_id);
    queue_items_id:=v_id; outcome:='queued'; RETURN NEXT;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.instagram_invalidate_queue_item(
  p_queue_item_id bigint,
  p_reason text DEFAULT 'invalidado pelo operador'
) RETURNS TABLE(queue_items_id bigint, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_users_id bigint:=public.ensure_current_user();
  v_item public.queue_items%ROWTYPE;
  v_progress public.instagram_queue_progress%ROWTYPE;
  v_channel_id bigint;
  v_reason text:=coalesce(nullif(trim(coalesce(p_reason,'')),''),'invalidado pelo operador');
BEGIN
  SELECT channels_id INTO v_channel_id FROM public.channels
  WHERE lower(regexp_replace(public.unaccent(trim(channels_name)),'[^a-z0-9]+','','g'))='instagram'
  ORDER BY channels_id LIMIT 1;
  IF v_channel_id IS NULL THEN RAISE EXCEPTION 'instagram_channel_not_found'; END IF;

  SELECT qi.* INTO v_item
  FROM public.queue_items qi
  JOIN public.queues q ON q.queues_id=qi.queues_id
  WHERE qi.queue_items_id=p_queue_item_id AND qi.users_id=v_users_id AND q.users_id=v_users_id
    AND q.channels_id=v_channel_id AND qi.socials_id IS NOT NULL
  FOR UPDATE OF qi;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
  IF v_item.status_id NOT IN (3,6,8) THEN RAISE EXCEPTION 'instagram_item_not_operator_invalidatable:%',v_item.status_id; END IF;

  SELECT * INTO v_progress FROM public.instagram_queue_progress p
  WHERE p.queue_items_id=p_queue_item_id AND p.users_id=v_users_id FOR UPDATE;
  IF FOUND AND v_progress.step IN ('sent','reconciliation_required','claimed','profile_opened','following','followed','dm_opened','messages_sending','media_sending') THEN
    RAISE EXCEPTION 'instagram_progress_not_operator_invalidatable:%',v_progress.step;
  END IF;

  INSERT INTO public.instagram_queue_progress(
    users_id,queue_items_id,socials_id,step,claim_token,claimed_by,attempts,last_heartbeat_at,started_at,finished_at,error_message,metadata
  ) VALUES(
    v_users_id,p_queue_item_id,v_item.socials_id,'invalid',NULL,NULL,coalesce(v_progress.attempts,0),now(),v_progress.started_at,now(),v_reason,
    jsonb_build_object('operator_invalidated_at',now())
  )
  ON CONFLICT(queue_items_id) DO UPDATE SET
    step='invalid',claim_token=NULL,claimed_by=NULL,last_heartbeat_at=now(),finished_at=now(),error_message=v_reason,
    metadata=coalesce(public.instagram_queue_progress.metadata,'{}'::jsonb)||jsonb_build_object('operator_invalidated_at',now()),
    instagram_queue_progress_updated_at=now();

  UPDATE public.queue_items SET status_id=6,queue_items_finished_at=now(),queue_items_error_message=v_reason,queue_items_updated_at=now()
  WHERE queue_items_id=p_queue_item_id;
  UPDATE public.leads SET lead_status_id=6,leads_updated_at=now()
  WHERE leads_id=v_item.leads_id AND users_id=v_users_id AND lead_status_id=4;

  PERFORM public.instagram_log_progress_event(v_users_id,p_queue_item_id,v_item.socials_id,coalesce(v_progress.step,'queued'),'invalid',NULL,'crm-operator',v_reason,'{}'::jsonb);
  PERFORM public.append_audit_event('instagram-queue','instagram_invalidated','queue_item',p_queue_item_id::text,v_item.leads_id,p_queue_item_id,2,v_item.status_id,6,v_reason,'{}'::jsonb,v_users_id);

  RETURN QUERY SELECT p_queue_item_id,'invalid'::text;
END; $$;

GRANT EXECUTE ON FUNCTION public.instagram_reprocess_queue_items(bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_invalidate_queue_item(bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.instagram_reprocess_queue_items(bigint[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.instagram_invalidate_queue_item(bigint,text) FROM PUBLIC,anon;

COMMIT;
