BEGIN;

-- R21 / Etapa 11 — endurece saúde, alertas e recovery contra o schema
-- canônico registrado em Banco - Atual.txt (gerado em 2026-08-25T14:53:03Z).

DO $preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_table text;
  v_column text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'platform_runtime_heartbeats','operational_alerts','recovery_requests',
    'queue_items','queue_item_dispatch_parts','worker_batches','worker_batch_items',
    'instagram_queue_progress','instagram_dispatch_events','instagram_profile_runtime','sents'
  ] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN
      v_missing := array_append(v_missing,'table:'||v_table);
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY ARRAY[
    'worker_batches.status_id','worker_batches.worker_batches_heartbeat_at',
    'queue_items.status_id','queue_items.queue_items_updated_at',
    'instagram_queue_progress.canonical_step','instagram_queue_progress.metadata',
    'sents.sents_idempotency_key'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema='public'
        AND c.table_name=split_part(v_column,'.',1)
        AND c.column_name=split_part(v_column,'.',2)
    ) THEN
      v_missing := array_append(v_missing,'column:'||v_column);
    END IF;
  END LOOP;

  IF cardinality(v_missing)>0 THEN
    RAISE EXCEPTION 'r21_preflight_failed:%',array_to_string(v_missing,',');
  END IF;
END
$preflight$;

-- A RPC expunha scopes que a constraint atual não aceita e que nenhum executor
-- implementa. Mantém o contrato real: all, whatsapp e instagram.
CREATE OR REPLACE FUNCTION public.request_operational_recovery(p_scope text DEFAULT 'all')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_id bigint;
  v_scope text:=lower(trim(coalesce(p_scope,'all')));
BEGIN
  PERFORM public.require_organization_permission('monitoring.manage');
  IF v_scope NOT IN('all','whatsapp','instagram') THEN
    RAISE EXCEPTION 'recovery_scope_invalid';
  END IF;
  SELECT r.recovery_requests_id
    INTO v_id
    FROM public.recovery_requests r
   WHERE r.organizations_id=v_org
     AND r.status IN('pending','running')
   ORDER BY r.requested_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.recovery_requests(users_id,organizations_id,requested_by,scope)
  VALUES(v_user,v_org,auth.uid(),v_scope)
  RETURNING recovery_requests_id INTO v_id;
  PERFORM public.append_audit_event(
    'monitoring','recovery_requested','recovery_request',v_id::text,
    NULL,NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('scope',v_scope,'organization_id',v_org),v_user
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_operational_recovery(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_operational_recovery(text) TO authenticated;

-- Núcleo tenant-aware de alertas. Não é exposto a clientes: get_operational_health
-- deriva o tenant da sessão e refresh_operational_alerts permanece service-only.
CREATE OR REPLACE FUNCTION public.refresh_operational_alerts_for_org(p_organizations_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  v_user bigint;
  v_count integer:=0;
  v_value bigint;
  v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT o.legacy_scope_users_id INTO v_user
  FROM public.organizations o
  WHERE o.organizations_id=p_organizations_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT count(*) INTO v_value
  FROM public.queue_items qi
  WHERE qi.organizations_id=p_organizations_id
    AND qi.status_id=4
    AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<v_now-interval '15 minutes';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'stale_queue_items','queues','critical','Itens travados em processamento',v_value||' item(ns) estão processando há mais de 15 minutos.',jsonb_build_object('count',v_value,'category','queue_item'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET
      status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,
      last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE
    UPDATE public.operational_alerts a SET status='resolved',resolved_at=v_now
    WHERE a.organizations_id=p_organizations_id AND a.alert_key='stale_queue_items' AND a.status<>'resolved';
  END IF;

  SELECT count(*) INTO v_value
  FROM public.queue_item_dispatch_parts p
  WHERE p.organizations_id=p_organizations_id
    AND p.queue_item_dispatch_parts_state='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'whatsapp_reconciliation','worker','warning','WhatsApp requer reconciliação',v_value||' parte(s) possuem resultado incerto.',jsonb_build_object('count',v_value,'category','executor'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET
      status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,
      last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE
    UPDATE public.operational_alerts a SET status='resolved',resolved_at=v_now
    WHERE a.organizations_id=p_organizations_id AND a.alert_key='whatsapp_reconciliation' AND a.status<>'resolved';
  END IF;

  SELECT count(*) INTO v_value
  FROM public.instagram_queue_progress p
  WHERE p.organizations_id=p_organizations_id
    AND p.canonical_step='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'instagram_reconciliation','instagram','warning','Instagram requer reconciliação',v_value||' item(ns) possuem resultado incerto.',jsonb_build_object('count',v_value,'category','executor'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET
      status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,
      last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE
    UPDATE public.operational_alerts a SET status='resolved',resolved_at=v_now
    WHERE a.organizations_id=p_organizations_id AND a.alert_key='instagram_reconciliation' AND a.status<>'resolved';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.organization_tools t
    WHERE t.organizations_id=p_organizations_id
      AND t.tool_id='vinsansi_whatsapp_manager'
      AND t.enabled
  ) THEN
    SELECT count(*) INTO v_value
    FROM public.platform_runtime_heartbeats h
    WHERE h.organizations_id=p_organizations_id
      AND h.component_type='worker'
      AND h.last_seen_at>v_now-interval '2 minutes'
      AND h.runtime_status IN('online','degraded');
    IF v_value=0 THEN
      INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
      VALUES(v_user,p_organizations_id,'worker_heartbeat_missing','worker','critical','Worker sem heartbeat','Nenhum Worker da organização comunicou nos últimos 2 minutos.',jsonb_build_object('category','infrastructure'))
      ON CONFLICT(organizations_id,alert_key) DO UPDATE SET
        status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,
        last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
      v_count:=v_count+1;
    ELSE
      UPDATE public.operational_alerts a SET status='resolved',resolved_at=v_now
      WHERE a.organizations_id=p_organizations_id AND a.alert_key='worker_heartbeat_missing' AND a.status<>'resolved';
    END IF;
  ELSE
    UPDATE public.operational_alerts a SET status='resolved',resolved_at=v_now
    WHERE a.organizations_id=p_organizations_id AND a.alert_key='worker_heartbeat_missing' AND a.status<>'resolved';
  END IF;

  SELECT count(*) INTO v_value
  FROM public.organization_tool_installations i
  WHERE i.organizations_id=p_organizations_id
    AND i.registration_status='registered'
    AND i.tool_id IN('vinsansi_capture','vinsansi_instagram')
    AND (i.last_seen_at IS NULL OR i.last_seen_at<v_now-interval '3 minutes');
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'tool_installation_stale','tools','warning','Ferramenta local sem comunicação',v_value||' instalação(ões) não comunicaram nos últimos 3 minutos.',jsonb_build_object('count',v_value,'category','infrastructure'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET
      status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,
      last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE
    UPDATE public.operational_alerts a SET status='resolved',resolved_at=v_now
    WHERE a.organizations_id=p_organizations_id AND a.alert_key='tool_installation_stale' AND a.status<>'resolved';
  END IF;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_operational_alerts_for_org(bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.refresh_operational_alerts(p_organizations_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  RETURN public.refresh_operational_alerts_for_org(p_organizations_id);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_operational_alerts(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_operational_alerts(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_result jsonb;
BEGIN
  PERFORM public.require_organization_permission('monitoring.view');
  PERFORM public.refresh_operational_alerts_for_org(v_org);

  SELECT jsonb_build_object(
    'checkedAt',clock_timestamp(),
    'organizationId',v_org,
    'workers',jsonb_build_object(
      'online',(SELECT count(*) FROM public.platform_runtime_heartbeats h WHERE h.organizations_id=v_org AND h.component_type='worker' AND h.last_seen_at>now()-interval '2 minutes' AND h.runtime_status='online'),
      'stale',(SELECT count(*) FROM public.platform_runtime_heartbeats h WHERE h.organizations_id=v_org AND h.component_type='worker' AND (h.last_seen_at<=now()-interval '2 minutes' OR h.runtime_status IN('offline','error','incompatible')))
    ),
    'components',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type',h.component_type,'key',h.component_key,'version',h.component_version,
        'status',CASE WHEN h.last_seen_at<=now()-interval '2 minutes' THEN 'offline' ELSE h.runtime_status END,
        'lastSeenAt',h.last_seen_at,'lastActivityAt',h.last_meaningful_activity_at,
        'metrics',h.metrics,'metadata',h.metadata
      ) ORDER BY h.component_type,h.component_key)
      FROM public.platform_runtime_heartbeats h WHERE h.organizations_id=v_org
    ),'[]'::jsonb),
    'queues',jsonb_build_object(
      'pending',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=3),
      'processing',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=4),
      'staleProcessing',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=4 AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<now()-interval '15 minutes'),
      'errors',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=6)
    ),
    'reconciliation',jsonb_build_object(
      'whatsapp',(SELECT count(*) FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=v_org AND p.queue_item_dispatch_parts_state='reconciliation_required'),
      'instagram',(SELECT count(*) FROM public.instagram_queue_progress p WHERE p.organizations_id=v_org AND p.canonical_step='reconciliation_required')
    ),
    'batches',jsonb_build_object(
      'active',(SELECT count(*) FROM public.worker_batches b WHERE b.organizations_id=v_org AND b.status_id IN(3,4,8)),
      'stale',(SELECT count(*) FROM public.worker_batches b WHERE b.organizations_id=v_org AND b.status_id=4 AND coalesce(b.worker_batches_heartbeat_at,b.worker_batches_started_at,b.worker_batches_updated_at,b.worker_batches_created_at)<now()-interval '15 minutes')
    ),
    'tools',jsonb_build_object(
      'registered',(SELECT count(*) FROM public.organization_tool_installations i WHERE i.organizations_id=v_org AND i.registration_status='registered'),
      'stale',(SELECT count(*) FROM public.organization_tool_installations i WHERE i.organizations_id=v_org AND i.registration_status='registered' AND (i.last_seen_at IS NULL OR i.last_seen_at<now()-interval '3 minutes'))
    ),
    'alerts',jsonb_build_object(
      'open',(SELECT count(*) FROM public.operational_alerts a WHERE a.organizations_id=v_org AND a.status<>'resolved'),
      'critical',(SELECT count(*) FROM public.operational_alerts a WHERE a.organizations_id=v_org AND a.status<>'resolved' AND a.severity='critical')
    ),
    'latestRecovery',(
      SELECT to_jsonb(r) FROM public.recovery_requests r
      WHERE r.organizations_id=v_org ORDER BY r.requested_at DESC LIMIT 1
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_operational_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operational_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.worker_recover_stale_whatsapp_v2(
  p_organizations_id bigint,
  p_stale_before timestamptz DEFAULT now()-interval '15 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  r record;
  v_recovered integer:=0;
  v_reconciliation integer:=0;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  FOR r IN
    SELECT qi.queue_items_id
    FROM public.queue_items qi
    WHERE qi.organizations_id=p_organizations_id
      AND qi.status_id=4
      AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<p_stale_before
    FOR UPDATE OF qi SKIP LOCKED
  LOOP
    IF EXISTS(
      SELECT 1 FROM public.queue_item_dispatch_parts p
      WHERE p.organizations_id=p_organizations_id
        AND p.queue_items_id=r.queue_items_id
        AND p.queue_item_dispatch_parts_state='processing'
    ) THEN
      UPDATE public.queue_item_dispatch_parts p
      SET queue_item_dispatch_parts_state='reconciliation_required',
          queue_item_dispatch_parts_claim_token=NULL,
          queue_item_dispatch_parts_error_message='worker_restart_after_provider_claim',
          queue_item_dispatch_parts_updated_at=now()
      WHERE p.organizations_id=p_organizations_id
        AND p.queue_items_id=r.queue_items_id
        AND p.queue_item_dispatch_parts_state='processing';
      UPDATE public.queue_items qi
      SET status_id=6,queue_items_error_message='reconciliation_required_after_worker_restart',
          queue_items_finished_at=now(),queue_items_updated_at=now()
      WHERE qi.organizations_id=p_organizations_id AND qi.queue_items_id=r.queue_items_id;
      UPDATE public.worker_batch_items bi
      SET status_id=6,worker_batch_items_error_message='reconciliation_required_after_worker_restart',
          worker_batch_items_finished_at=now(),worker_batch_items_updated_at=now()
      WHERE bi.organizations_id=p_organizations_id AND bi.queue_items_id=r.queue_items_id AND bi.status_id=4;
      v_reconciliation:=v_reconciliation+1;
    ELSE
      UPDATE public.queue_items qi
      SET status_id=3,queue_items_error_message=NULL,queue_items_started_at=NULL,
          queue_items_finished_at=NULL,queue_items_updated_at=now()
      WHERE qi.organizations_id=p_organizations_id AND qi.queue_items_id=r.queue_items_id;
      UPDATE public.worker_batch_items bi
      SET status_id=3,worker_batch_items_started_at=NULL,worker_batch_items_finished_at=NULL,
          worker_batch_items_error_message=NULL,worker_batch_items_updated_at=now()
      WHERE bi.organizations_id=p_organizations_id AND bi.queue_items_id=r.queue_items_id AND bi.status_id=4;
      v_recovered:=v_recovered+1;
    END IF;
  END LOOP;
  UPDATE public.worker_batches b
  SET worker_batches_next_run_at=now(),worker_batches_updated_at=now()
  WHERE b.organizations_id=p_organizations_id
    AND b.status_id=4
    AND coalesce(b.worker_batches_heartbeat_at,b.worker_batches_started_at,b.worker_batches_updated_at,b.worker_batches_created_at)<p_stale_before;
  RETURN jsonb_build_object('recovered_items',v_recovered,'reconciliation_items',v_reconciliation);
END;
$$;
REVOKE ALL ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_recover_stale_whatsapp_v2(bigint,timestamptz) TO service_role;

-- Recovery preserva o último checkpoint seguro. Somente o passo "sending"
-- vira reconciliação, pois já pode ter produzido efeito externo.
CREATE OR REPLACE FUNCTION public.instagram_recover_stale_items_v2(
  p_organizations_id bigint,
  p_stale_before timestamptz DEFAULT now()-interval '15 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  r record;
  v_requeued integer:=0;
  v_reconciliation integer:=0;
  v_next text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  FOR r IN
    SELECT p.instagram_queue_progress_id,p.queue_items_id,p.socials_id,p.step,p.canonical_step,p.claim_token
    FROM public.instagram_queue_progress p
    WHERE p.organizations_id=p_organizations_id
      AND p.claim_token IS NOT NULL
      AND p.canonical_step IN('claimed','opening_profile','following','followed','opening_dm','sending')
      AND coalesce(p.last_heartbeat_at,p.instagram_queue_progress_updated_at)<p_stale_before
    FOR UPDATE OF p SKIP LOCKED
  LOOP
    IF r.canonical_step='sending' THEN
      v_next:='reconciliation_required';
      UPDATE public.instagram_queue_progress p
      SET canonical_step=v_next,step=v_next,claim_token=NULL,claimed_by=NULL,
          error_message='stale_after_possible_dispatch',finished_at=now(),
          metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('recovered_from_step',r.step),
          instagram_queue_progress_updated_at=now()
      WHERE p.instagram_queue_progress_id=r.instagram_queue_progress_id;
      UPDATE public.queue_items qi
      SET status_id=6,queue_items_error_message='instagram_reconciliation_required',
          queue_items_finished_at=now(),queue_items_updated_at=now()
      WHERE qi.organizations_id=p_organizations_id AND qi.queue_items_id=r.queue_items_id;
      v_reconciliation:=v_reconciliation+1;
    ELSE
      v_next:=r.step;
      UPDATE public.instagram_queue_progress p
      SET claim_token=NULL,claimed_by=NULL,error_message='recovered_stale_claim',finished_at=NULL,
          metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('resume_from_step',r.step),
          instagram_queue_progress_updated_at=now()
      WHERE p.instagram_queue_progress_id=r.instagram_queue_progress_id;
      UPDATE public.queue_items qi
      SET status_id=3,queue_items_started_at=NULL,queue_items_error_message=NULL,
          queue_items_finished_at=NULL,queue_items_updated_at=now()
      WHERE qi.organizations_id=p_organizations_id AND qi.queue_items_id=r.queue_items_id;
      v_requeued:=v_requeued+1;
    END IF;
    INSERT INTO public.instagram_dispatch_events(
      users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata
    )
    SELECT qi.users_id,p_organizations_id,r.queue_items_id,r.socials_id,r.step,v_next,r.claim_token,
           'recovery','stale_execution_recovered',jsonb_build_object('checkpoint_preserved',r.canonical_step<>'sending')
    FROM public.queue_items qi
    WHERE qi.organizations_id=p_organizations_id AND qi.queue_items_id=r.queue_items_id;
  END LOOP;
  RETURN jsonb_build_object('requeued',v_requeued,'reconciliation',v_reconciliation);
END;
$$;
REVOKE ALL ON FUNCTION public.instagram_recover_stale_items_v2(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_recover_stale_items_v2(bigint,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item_v2(
  p_organizations_id bigint,p_queue_item_id bigint,p_socials_id bigint,p_consumer_id text,
  p_installation_id uuid,p_member_id bigint
)
RETURNS TABLE(queue_items_id bigint,claim_token uuid,step text,attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
DECLARE
  v_item public.queue_items%ROWTYPE;
  v_existing public.instagram_queue_progress%ROWTYPE;
  v_token uuid:=gen_random_uuid();
  v_attempts integer;
  v_users bigint;
  v_profile text;
  v_capacity jsonb;
  v_resume_step text:='claimed';
  v_resume_canonical text:='claimed';
  v_first_claim boolean:=false;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF nullif(trim(coalesce(p_consumer_id,'')),'') IS NULL THEN RAISE EXCEPTION 'consumer_id_required'; END IF;
  SELECT qi.* INTO v_item FROM public.queue_items qi
  WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id AND qi.socials_id=p_socials_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
  v_users:=v_item.users_id;
  IF NOT EXISTS(
    SELECT 1 FROM public.organization_tool_installations i
    WHERE i.organization_tool_installations_id=p_installation_id
      AND i.organizations_id=p_organizations_id AND i.tool_id='vinsansi_instagram'
      AND i.registration_status='registered'
  ) THEN RAISE EXCEPTION 'instagram_installation_invalid'; END IF;
  IF p_member_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_members_id=p_member_id AND m.organizations_id=p_organizations_id AND m.status_id=1
  ) THEN RAISE EXCEPTION 'instagram_member_invalid'; END IF;
  SELECT s.socials_username INTO v_profile FROM public.socials s
  WHERE s.socials_id=p_socials_id AND s.organizations_id=p_organizations_id AND s.status_id=1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'instagram_profile_not_available'; END IF;
  v_capacity:=public.instagram_profile_capacity(p_organizations_id,p_socials_id,now());
  IF coalesce((v_capacity->>'remaining')::integer,0)<=0 THEN RAISE EXCEPTION 'instagram_daily_limit_reached'; END IF;
  SELECT p.* INTO v_existing FROM public.instagram_queue_progress p
  WHERE p.queue_items_id=p_queue_item_id AND p.organizations_id=p_organizations_id
  FOR UPDATE;
  IF FOUND THEN
    IF public.instagram_canonical_step(v_existing.step) IN('completed','reconciliation_required','error') THEN
      RAISE EXCEPTION 'instagram_item_not_claimable:%',v_existing.step;
    END IF;
    IF v_existing.claim_token IS NOT NULL THEN RAISE EXCEPTION 'instagram_item_already_claimed'; END IF;
    v_resume_step:=v_existing.step;
    v_resume_canonical:=public.instagram_canonical_step(v_existing.step);
  ELSE
    v_first_claim:=true;
  END IF;
  IF v_item.status_id NOT IN(3,6) THEN RAISE EXCEPTION 'instagram_item_not_pending:%',v_item.status_id; END IF;
  v_attempts:=coalesce(v_existing.attempts,0)+1;
  INSERT INTO public.instagram_queue_progress(
    users_id,organizations_id,queue_items_id,socials_id,step,canonical_step,claim_token,claimed_by,attempts,
    last_heartbeat_at,started_at,finished_at,error_message,metadata,organization_tool_installations_id,
    dispatched_by_member_id,profile_username,frozen_payload_hash
  ) VALUES(
    v_users,p_organizations_id,p_queue_item_id,p_socials_id,v_resume_step,v_resume_canonical,v_token,trim(p_consumer_id),v_attempts,
    now(),coalesce(v_existing.started_at,now()),NULL,NULL,coalesce(v_existing.metadata,'{}'::jsonb),p_installation_id,
    p_member_id,v_profile,v_item.queue_items_payload_hash
  )
  ON CONFLICT ON CONSTRAINT instagram_queue_progress_queue_items_id_key DO UPDATE SET
    organizations_id=excluded.organizations_id,socials_id=excluded.socials_id,
    step=excluded.step,canonical_step=excluded.canonical_step,claim_token=excluded.claim_token,claimed_by=excluded.claimed_by,
    attempts=excluded.attempts,last_heartbeat_at=now(),started_at=coalesce(public.instagram_queue_progress.started_at,now()),
    finished_at=NULL,error_message=NULL,metadata=excluded.metadata,
    organization_tool_installations_id=excluded.organization_tool_installations_id,
    dispatched_by_member_id=excluded.dispatched_by_member_id,profile_username=excluded.profile_username,
    frozen_payload_hash=excluded.frozen_payload_hash,instagram_queue_progress_updated_at=now()
  RETURNING public.instagram_queue_progress.claim_token,public.instagram_queue_progress.attempts,
            public.instagram_queue_progress.step
  INTO v_token,v_attempts,v_resume_step;
  UPDATE public.queue_items qi
  SET status_id=4,dispatched_by_member_id=coalesce(qi.dispatched_by_member_id,p_member_id),
      queue_items_started_at=coalesce(qi.queue_items_started_at,now()),queue_items_finished_at=NULL,
      queue_items_error_message=NULL,queue_items_updated_at=now()
  WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id;
  INSERT INTO public.instagram_profile_runtime(
    organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,
    claimed_count,last_claim_at,last_heartbeat_at
  ) VALUES(
    p_organizations_id,p_socials_id,p_installation_id,v_profile,(now() AT TIME ZONE 'America/Sao_Paulo')::date,
    CASE WHEN v_first_claim THEN 1 ELSE 0 END,now(),now()
  ) ON CONFLICT(organizations_id,socials_id,operational_date) DO UPDATE SET
    claimed_count=public.instagram_profile_runtime.claimed_count+excluded.claimed_count,
    last_claim_at=now(),last_heartbeat_at=now(),organization_tool_installations_id=excluded.organization_tool_installations_id,
    updated_at=now();
  INSERT INTO public.instagram_dispatch_events(
    users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,metadata,
    organization_tool_installations_id,organization_members_id
  ) VALUES(
    v_users,p_organizations_id,p_queue_item_id,p_socials_id,
    CASE WHEN v_first_claim THEN 'queued' ELSE v_resume_step END,v_resume_step,v_token,p_consumer_id,
    jsonb_build_object('attempt',v_attempts,'profile',v_profile,'resumed',NOT v_first_claim),
    p_installation_id,p_member_id
  );
  RETURN QUERY SELECT p_queue_item_id,v_token,v_resume_step,v_attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_claim_queue_item_v2(bigint,bigint,bigint,text,uuid,bigint) TO service_role;

-- Impede regressão de checkpoint e torna retries do mesmo passo apenas heartbeat.
CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress_v2(
  p_organizations_id bigint,p_queue_item_id bigint,p_claim_token uuid,p_step text,
  p_message text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(queue_items_id bigint,step text,queue_status_id bigint,lead_status_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public AS $$
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
  v_current_rank integer;
  v_target_rank integer;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT v_canonical=ANY(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending','completed','error','reconciliation_required']) THEN
    RAISE EXCEPTION 'instagram_step_invalid:%',p_step;
  END IF;
  SELECT p.* INTO v_progress FROM public.instagram_queue_progress p
  WHERE p.queue_items_id=p_queue_item_id AND p.organizations_id=p_organizations_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_progress_not_found'; END IF;
  IF v_progress.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'instagram_claim_token_invalid'; END IF;
  SELECT qi.* INTO v_item FROM public.queue_items qi
  WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instagram_queue_item_not_found'; END IF;
  SELECT l.lead_status_id INTO v_current_lead_status FROM public.leads l
  WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id;
  v_previous:=v_progress.step;

  IF public.instagram_canonical_step(v_progress.step) IN('completed','error','reconciliation_required') THEN
    IF public.instagram_canonical_step(v_progress.step)<>v_canonical THEN RAISE EXCEPTION 'instagram_progress_final:%',v_progress.step; END IF;
    RETURN QUERY SELECT p_queue_item_id,v_progress.step,v_item.status_id,coalesce(v_current_lead_status,4::bigint);
    RETURN;
  END IF;

  v_current_rank:=array_position(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending'],public.instagram_canonical_step(v_progress.step));
  v_target_rank:=array_position(ARRAY['claimed','opening_profile','following','followed','opening_dm','sending'],v_canonical);
  IF v_target_rank IS NOT NULL AND v_current_rank IS NOT NULL AND v_target_rank<v_current_rank THEN
    RAISE EXCEPTION 'instagram_step_regression:%->%',v_progress.step,p_step;
  END IF;

  -- Retry/heartbeat do mesmo passo: atualiza checkpoint sem duplicar evento ou contador.
  IF v_progress.step=p_step THEN
    UPDATE public.instagram_queue_progress p
    SET last_heartbeat_at=now(),metadata=coalesce(p.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),
        instagram_queue_progress_updated_at=now()
    WHERE p.instagram_queue_progress_id=v_progress.instagram_queue_progress_id;
    RETURN QUERY SELECT p_queue_item_id,p_step,v_item.status_id,coalesce(v_current_lead_status,4::bigint);
    RETURN;
  END IF;

  IF v_canonical='completed' THEN v_queue:=5;v_lead:=5;v_final:=true;
  ELSIF v_canonical='error' THEN v_queue:=6;v_lead:=CASE WHEN p_step='invalid' THEN 6 ELSE NULL END;v_final:=true;
  ELSIF v_canonical='reconciliation_required' THEN v_queue:=6;v_final:=true;
  END IF;
  UPDATE public.instagram_queue_progress p
  SET step=p_step,canonical_step=v_canonical,last_heartbeat_at=now(),
      finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
      error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END,
      metadata=coalesce(p.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),instagram_queue_progress_updated_at=now()
  WHERE p.instagram_queue_progress_id=v_progress.instagram_queue_progress_id;
  UPDATE public.queue_items qi
  SET status_id=v_queue,queue_items_updated_at=now(),queue_items_finished_at=CASE WHEN v_final THEN now() ELSE NULL END,
      queue_items_error_message=CASE WHEN v_canonical IN('error','reconciliation_required') THEN nullif(trim(coalesce(p_message,'')),'') ELSE NULL END
  WHERE qi.queue_items_id=p_queue_item_id AND qi.organizations_id=p_organizations_id;
  IF v_lead IS NOT NULL THEN
    UPDATE public.leads l SET lead_status_id=v_lead,leads_updated_at=now()
    WHERE l.leads_id=v_item.leads_id AND l.organizations_id=p_organizations_id AND l.lead_status_id=4;
  END IF;
  IF v_canonical='completed' THEN
    v_recipient:=nullif(trim(coalesce(
      v_item.queue_items_payload_snapshot #>> '{recipient,instagram}',
      v_item.queue_items_payload_snapshot #>> '{lead,instagram}',
      (SELECT l.leads_instagram FROM public.leads l WHERE l.leads_id=v_item.leads_id),''
    )), '');
    INSERT INTO public.sents(
      users_id,organizations_id,queue_items_id,leads_id,channels_id,socials_id,templates_id,status_id,
      sents_recipient,sents_body,sents_attempt,sents_sent_at,sents_idempotency_key,sents_payload_hash,
      sent_by_member_id,executed_by
    )
    SELECT v_item.users_id,p_organizations_id,p_queue_item_id,v_item.leads_id,2,v_progress.socials_id,
           v_item.templates_id,5,v_recipient,
           jsonb_build_object('channel','instagram','queueItemId',p_queue_item_id,
             'messages',coalesce(v_item.queue_items_payload_snapshot->'messages','{}'::jsonb),
             'metadata',coalesce(p_metadata,'{}'::jsonb))::text,
           greatest(coalesce(v_progress.attempts,0),1),now(),
           format('instagram:queue-item:%s',p_queue_item_id),v_item.queue_items_payload_hash,
           v_progress.dispatched_by_member_id,'system'
    WHERE NOT EXISTS(
      SELECT 1 FROM public.sents s
      WHERE s.organizations_id=p_organizations_id AND s.queue_items_id=p_queue_item_id
        AND s.channels_id=2 AND s.sents_sent_at IS NOT NULL
    )
    ON CONFLICT(sents_idempotency_key) WHERE sents_idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  INSERT INTO public.instagram_dispatch_events(
    users_id,organizations_id,queue_items_id,socials_id,from_step,to_step,claim_token,actor,message,metadata,
    organization_tool_installations_id,organization_members_id
  ) VALUES(
    v_item.users_id,p_organizations_id,p_queue_item_id,v_progress.socials_id,v_previous,p_step,p_claim_token,
    v_progress.claimed_by,p_message,coalesce(p_metadata,'{}'::jsonb),
    v_progress.organization_tool_installations_id,v_progress.dispatched_by_member_id
  );
  IF v_final THEN
    INSERT INTO public.instagram_profile_runtime(
      organizations_id,socials_id,organization_tool_installations_id,profile_username,operational_date,
      sent_count,invalid_count,error_count,last_send_at,last_heartbeat_at
    ) VALUES(
      p_organizations_id,v_progress.socials_id,v_progress.organization_tool_installations_id,
      coalesce(v_progress.profile_username,''),(now() AT TIME ZONE 'America/Sao_Paulo')::date,
      CASE WHEN v_canonical='completed' THEN 1 ELSE 0 END,
      CASE WHEN p_step='invalid' THEN 1 ELSE 0 END,
      CASE WHEN v_canonical IN('error','reconciliation_required') AND p_step<>'invalid' THEN 1 ELSE 0 END,
      CASE WHEN v_canonical='completed' THEN now() ELSE NULL END,now()
    ) ON CONFLICT(organizations_id,socials_id,operational_date) DO UPDATE SET
      sent_count=public.instagram_profile_runtime.sent_count+excluded.sent_count,
      invalid_count=public.instagram_profile_runtime.invalid_count+excluded.invalid_count,
      error_count=public.instagram_profile_runtime.error_count+excluded.error_count,
      last_send_at=coalesce(excluded.last_send_at,public.instagram_profile_runtime.last_send_at),
      last_heartbeat_at=now(),updated_at=now();
  END IF;
  RETURN QUERY SELECT p_queue_item_id,p_step,v_queue,coalesce(v_lead,v_current_lead_status,4::bigint);
END;
$$;
REVOKE ALL ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_update_queue_progress_v2(bigint,bigint,uuid,text,text,jsonb) TO service_role;

COMMIT;
