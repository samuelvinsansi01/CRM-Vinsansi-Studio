\set ON_ERROR_STOP on

INSERT INTO public.organizations VALUES (1,101,1),(2,202,1);
INSERT INTO public.organization_tools(organizations_id,tool_id,enabled) VALUES
  (1,'vinsansi_whatsapp_manager',true),(2,'vinsansi_whatsapp_manager',true);
INSERT INTO public.platform_tools(tool_id) VALUES
  ('vinsansi_capture'),('vinsansi_instagram'),('vinsansi_whatsapp_manager');
INSERT INTO public.organization_tool_installations(organization_tool_installations_id,organizations_id,tool_id,external_installation_id,registration_status,last_seen_at) VALUES
  ('00000000-0000-0000-0000-000000000011',1,'vinsansi_instagram','instagram-org1','registered',now()),
  ('00000000-0000-0000-0000-000000000012',1,'vinsansi_capture','capture-org1','registered',now()),
  ('00000000-0000-0000-0000-000000000021',2,'vinsansi_instagram','instagram-org2','registered',now());
INSERT INTO public.organization_members VALUES (11,1,1),(21,2,1);
INSERT INTO public.socials VALUES (11,1,'org1',1),(21,2,'org2',1);

SELECT set_config('app.organization_id','1',false);
SELECT set_config('app.auth_role','authenticated',false);
INSERT INTO public.platform_runtime_heartbeats(organizations_id,component_type,component_key,component_version,runtime_status)
VALUES(1,'worker','worker-1','3.13.2','online'),(2,'worker','worker-2','3.13.2','online');

DO $$
DECLARE h jsonb;
BEGIN
  h:=public.get_operational_health();
  IF NOT (h ?& ARRAY['checkedAt','organizationId','workers','components','queues','reconciliation','batches','tools','alerts','latestRecovery']) THEN
    RAISE EXCEPTION 'health_shape_unstable:%',h;
  END IF;
  IF (h#>>'{workers,online}')::integer<>1 OR (h#>>'{workers,stale}')::integer<>0 THEN RAISE EXCEPTION 'healthy_worker_counts:%',h; END IF;
  IF (h#>>'{queues,staleProcessing}')::integer<>0 OR (h#>>'{batches,stale}')::integer<>0 THEN RAISE EXCEPTION 'healthy_entity_marked_stale:%',h; END IF;
  IF jsonb_array_length(h->'components')<>1 THEN RAISE EXCEPTION 'tenant_component_leak:%',h; END IF;
END $$;

-- Heartbeat expirado: health materializa um único alerta e o resolve após retorno.
UPDATE public.platform_runtime_heartbeats SET last_seen_at=now()-interval '4 minutes' WHERE organizations_id=1;
SELECT public.get_operational_health();
SELECT public.get_operational_health();
DO $$
DECLARE h jsonb; a public.operational_alerts%ROWTYPE;
BEGIN
  h:=public.get_operational_health();
  IF (h#>>'{workers,stale}')::integer<>1 OR h#>>'{components,0,status}'<>'offline' THEN RAISE EXCEPTION 'offline_not_detected:%',h; END IF;
  SELECT * INTO a FROM public.operational_alerts WHERE organizations_id=1 AND alert_key='worker_heartbeat_missing';
  IF a.operational_alerts_id IS NULL OR a.status<>'open' OR a.severity<>'critical' OR a.resolved_at IS NOT NULL THEN RAISE EXCEPTION 'worker_alert_invalid:%',to_jsonb(a); END IF;
  IF (SELECT count(*) FROM public.operational_alerts WHERE organizations_id=1 AND alert_key='worker_heartbeat_missing')<>1 THEN RAISE EXCEPTION 'worker_alert_duplicated'; END IF;
  IF a.metadata->>'category'<>'infrastructure' OR a.last_detected_at<a.first_detected_at THEN RAISE EXCEPTION 'worker_alert_timestamps_invalid:%',to_jsonb(a); END IF;
END $$;
UPDATE public.platform_runtime_heartbeats SET last_seen_at=now(),runtime_status='online' WHERE organizations_id=1;
SELECT set_config('app.auth_role','service_role',false);
SELECT public.service_worker_heartbeat(1,'worker-1','3.13.2','online','{}','{}');
SELECT set_config('app.auth_role','authenticated',false);
SELECT public.get_operational_health();
DO $$ BEGIN
  IF (SELECT status FROM public.operational_alerts WHERE organizations_id=1 AND alert_key='worker_heartbeat_missing')<>'resolved' THEN RAISE EXCEPTION 'worker_alert_not_resolved'; END IF;
  IF (SELECT resolved_at FROM public.operational_alerts WHERE organizations_id=1 AND alert_key='worker_heartbeat_missing') IS NULL THEN RAISE EXCEPTION 'worker_alert_resolution_timestamp_missing'; END IF;
END $$;
UPDATE public.organization_tools SET enabled=false WHERE organizations_id=1 AND tool_id='vinsansi_whatsapp_manager';
UPDATE public.platform_runtime_heartbeats SET last_seen_at=now()-interval '4 minutes' WHERE organizations_id=1;
SELECT public.get_operational_health();
DO $$ BEGIN
  IF (SELECT status FROM public.operational_alerts WHERE organizations_id=1 AND alert_key='worker_heartbeat_missing')<>'resolved' THEN RAISE EXCEPTION 'disabled_worker_alert_reopened'; END IF;
END $$;
UPDATE public.organization_tools SET enabled=true WHERE organizations_id=1 AND tool_id='vinsansi_whatsapp_manager';
UPDATE public.platform_runtime_heartbeats SET last_seen_at=now() WHERE organizations_id=1;

-- Pedidos são deduplicados por tenant e o Worker não reclama pedido de outro tenant.
DO $$
DECLARE first_id bigint; retry_id bigint;
BEGIN
  first_id:=public.request_operational_recovery('all');
  retry_id:=public.request_operational_recovery('whatsapp');
  IF first_id<>retry_id THEN RAISE EXCEPTION 'recovery_request_not_deduplicated'; END IF;
  BEGIN
    PERFORM public.request_operational_recovery('capture');
    RAISE EXCEPTION 'unsupported_recovery_scope_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'recovery_scope_invalid' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('app.organization_id','2',false);
SELECT public.request_operational_recovery('instagram');
SELECT set_config('app.auth_role','service_role',false);
DO $$ DECLARE r record; org1_id bigint; BEGIN
  SELECT * INTO r FROM public.service_claim_recovery_request(1,'worker-1');
  IF r.organizations_id<>1 THEN RAISE EXCEPTION 'recovery_claim_tenant_leak:%',to_jsonb(r); END IF;
  org1_id:=r.recovery_requests_id;
  PERFORM public.service_complete_recovery_request(2,org1_id,'{}',NULL);
  IF (SELECT status FROM public.recovery_requests WHERE recovery_requests_id=org1_id)<>'running' THEN RAISE EXCEPTION 'recovery_cross_tenant_completion'; END IF;
  PERFORM public.service_complete_recovery_request(1,org1_id,jsonb_build_object('ok',true),NULL);
  IF (SELECT status FROM public.recovery_requests WHERE recovery_requests_id=org1_id)<>'completed' THEN RAISE EXCEPTION 'recovery_not_completed'; END IF;
END $$;
SELECT set_config('app.organization_id','1',false);
SELECT set_config('app.auth_role','authenticated',false);

-- Batch sem heartbeat deve ser stale; o tenant 2 não entra na contagem.
INSERT INTO public.worker_batches VALUES
  (1,1,4,NULL,now()-interval '20 minutes',NULL,now()-interval '20 minutes',now()-interval '20 minutes'),
  (2,2,4,NULL,now()-interval '20 minutes',NULL,now()-interval '20 minutes',now()-interval '20 minutes');
DO $$ DECLARE h jsonb; BEGIN
  h:=public.get_operational_health();
  IF (h#>>'{batches,active}')::integer<>1 OR (h#>>'{batches,stale}')::integer<>1 THEN RAISE EXCEPTION 'batch_health_wrong:%',h; END IF;
END $$;

-- WhatsApp: preserva parte/sent concluído, reconcilia claim incerto e é idempotente.
INSERT INTO public.leads VALUES (100,1,4,NULL),(101,1,4,NULL),(200,2,4,NULL);
INSERT INTO public.queue_items(queue_items_id,users_id,organizations_id,leads_id,status_id,queue_items_started_at,queue_items_updated_at)
VALUES
  (100,101,1,100,4,now()-interval '20 minutes',now()-interval '20 minutes'),
  (101,101,1,101,4,now()-interval '20 minutes',now()-interval '20 minutes'),
  (200,202,2,200,4,now()-interval '20 minutes',now()-interval '20 minutes');
INSERT INTO public.worker_batch_items VALUES
  (100,1,100,4,now()-interval '20 minutes',NULL,NULL,now()-interval '20 minutes'),
  (101,1,101,4,now()-interval '20 minutes',NULL,NULL,now()-interval '20 minutes'),
  (200,2,200,4,now()-interval '20 minutes',NULL,NULL,now()-interval '20 minutes');
INSERT INTO public.queue_item_dispatch_parts(users_id,organizations_id,queue_items_id,queue_item_dispatch_parts_key,queue_item_dispatch_parts_state,queue_item_dispatch_parts_claim_token)
VALUES
  (101,1,100,'message_1','sent',NULL),
  (101,1,101,'message_1','processing',gen_random_uuid()),
  (202,2,200,'message_1','processing',gen_random_uuid());
INSERT INTO public.sents(users_id,organizations_id,queue_items_id,leads_id,channels_id,status_id,sents_body,sents_sent_at,sents_idempotency_key)
VALUES(101,1,100,100,1,5,'message_1',now(),'queue-item:100:message_1:hash');
SELECT set_config('app.auth_role','service_role',false);
DO $$ DECLARE r1 jsonb; r2 jsonb; BEGIN
  r1:=public.worker_recover_stale_whatsapp_v2(1,now()-interval '15 minutes');
  r2:=public.worker_recover_stale_whatsapp_v2(1,now()-interval '15 minutes');
  IF r1<>jsonb_build_object('recovered_items',1,'reconciliation_items',1) THEN RAISE EXCEPTION 'whatsapp_recovery_result:%',r1; END IF;
  IF r2<>jsonb_build_object('recovered_items',0,'reconciliation_items',0) THEN RAISE EXCEPTION 'whatsapp_recovery_not_idempotent:%',r2; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT status_id FROM public.queue_items WHERE queue_items_id=100)<>3 THEN RAISE EXCEPTION 'whatsapp_safe_item_not_requeued'; END IF;
  IF (SELECT status_id FROM public.queue_items WHERE queue_items_id=101)<>6 THEN RAISE EXCEPTION 'whatsapp_uncertain_item_not_reconciled'; END IF;
  IF (SELECT status_id FROM public.queue_items WHERE queue_items_id=200)<>4 THEN RAISE EXCEPTION 'whatsapp_cross_tenant_mutation'; END IF;
  IF (SELECT count(*) FROM public.queue_item_dispatch_parts WHERE queue_items_id=100)<>1 OR (SELECT count(*) FROM public.sents WHERE queue_items_id=100)<>1 THEN RAISE EXCEPTION 'whatsapp_checkpoint_or_sent_duplicated'; END IF;
END $$;

-- Instagram: todos os checkpoints seguros são preservados; sending vai para reconciliação.
INSERT INTO public.leads VALUES
  (301,1,4,'lead301'),(302,1,4,'lead302'),(303,1,4,'lead303'),(304,1,4,'lead304'),(305,1,4,'lead305'),(306,1,4,'lead306'),(399,2,4,'lead399');
INSERT INTO public.queue_items(queue_items_id,users_id,organizations_id,leads_id,socials_id,templates_id,status_id,queue_items_started_at,queue_items_updated_at,queue_items_payload_snapshot,queue_items_payload_hash)
SELECT id,CASE WHEN id=399 THEN 202 ELSE 101 END,CASE WHEN id=399 THEN 2 ELSE 1 END,id,CASE WHEN id=399 THEN 21 ELSE 11 END,1,4,
       now()-interval '20 minutes',now()-interval '20 minutes',jsonb_build_object('recipient',jsonb_build_object('instagram','lead'||id),'messages',jsonb_build_object('message_1','oi')),'hash-'||id
FROM unnest(ARRAY[301,302,303,304,305,306,399]) id;
INSERT INTO public.instagram_queue_progress(users_id,organizations_id,queue_items_id,socials_id,step,canonical_step,claim_token,claimed_by,attempts,last_heartbeat_at,started_at,profile_username)
VALUES
  (101,1,301,11,'claimed','claimed',gen_random_uuid(),'old',1,now()-interval '20 minutes',now()-interval '20 minutes','org1'),
  (101,1,302,11,'profile_opened','opening_profile',gen_random_uuid(),'old',1,now()-interval '20 minutes',now()-interval '20 minutes','org1'),
  (101,1,303,11,'following','following',gen_random_uuid(),'old',1,now()-interval '20 minutes',now()-interval '20 minutes','org1'),
  (101,1,304,11,'followed','followed',gen_random_uuid(),'old',1,now()-interval '20 minutes',now()-interval '20 minutes','org1'),
  (101,1,305,11,'dm_opened','opening_dm',gen_random_uuid(),'old',1,now()-interval '20 minutes',now()-interval '20 minutes','org1'),
  (101,1,306,11,'messages_sending','sending',gen_random_uuid(),'old',1,now()-interval '20 minutes',now()-interval '20 minutes','org1'),
  (202,2,399,21,'followed','followed',gen_random_uuid(),'other',1,now()-interval '20 minutes',now()-interval '20 minutes','org2');
DO $$ DECLARE r1 jsonb; r2 jsonb; BEGIN
  r1:=public.instagram_recover_stale_items_v2(1,now()-interval '15 minutes');
  r2:=public.instagram_recover_stale_items_v2(1,now()-interval '15 minutes');
  IF r1<>jsonb_build_object('requeued',5,'reconciliation',1) THEN RAISE EXCEPTION 'instagram_recovery_result:%',r1; END IF;
  IF r2<>jsonb_build_object('requeued',0,'reconciliation',0) THEN RAISE EXCEPTION 'instagram_recovery_not_idempotent:%',r2; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.instagram_queue_progress WHERE queue_items_id BETWEEN 301 AND 305 AND step='queued') THEN RAISE EXCEPTION 'instagram_checkpoint_erased'; END IF;
  IF (SELECT step FROM public.instagram_queue_progress WHERE queue_items_id=304)<>'followed' THEN RAISE EXCEPTION 'instagram_followed_checkpoint_lost'; END IF;
  IF (SELECT status_id FROM public.queue_items WHERE queue_items_id=304)<>3 THEN RAISE EXCEPTION 'instagram_safe_item_not_requeued'; END IF;
  IF (SELECT canonical_step FROM public.instagram_queue_progress WHERE queue_items_id=306)<>'reconciliation_required' THEN RAISE EXCEPTION 'instagram_sending_not_reconciled'; END IF;
  IF (SELECT status_id FROM public.queue_items WHERE queue_items_id=399)<>4 THEN RAISE EXCEPTION 'instagram_cross_tenant_mutation'; END IF;
  IF (SELECT count(*) FROM public.instagram_dispatch_events WHERE organizations_id=1 AND actor='recovery')<>6 THEN RAISE EXCEPTION 'instagram_recovery_events_duplicated'; END IF;
END $$;

-- Reclaim de "followed" não retrocede, não duplica claimed_count e bloqueia regressão.
INSERT INTO public.instagram_profile_runtime(organizations_id,socials_id,profile_username,operational_date,claimed_count)
VALUES(1,11,'org1',(now() AT TIME ZONE 'America/Sao_Paulo')::date,5);
DO $$
DECLARE c record; token uuid; before_events integer; after_first integer; after_retry integer;
BEGIN
  SELECT * INTO c FROM public.instagram_claim_queue_item_v2(1,304,11,'new-consumer','00000000-0000-0000-0000-000000000011',11);
  token:=c.claim_token;
  IF c.step<>'followed' THEN RAISE EXCEPTION 'instagram_claim_regressed:%',to_jsonb(c); END IF;
  IF (SELECT claimed_count FROM public.instagram_profile_runtime WHERE organizations_id=1 AND socials_id=11)<>5 THEN RAISE EXCEPTION 'instagram_claim_counter_duplicated'; END IF;
  BEGIN
    PERFORM public.instagram_update_queue_progress_v2(1,304,token,'following',NULL,'{}');
    RAISE EXCEPTION 'instagram_regression_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'instagram_step_regression:%' THEN RAISE; END IF;
  END;
  PERFORM public.instagram_update_queue_progress_v2(1,304,token,'dm_opened',NULL,'{}');
  PERFORM public.instagram_update_queue_progress_v2(1,304,token,'messages_sending',NULL,jsonb_build_object('confirmed_message_numbers',ARRAY[1]));
  SELECT count(*) INTO before_events FROM public.instagram_dispatch_events WHERE queue_items_id=304;
  PERFORM public.instagram_update_queue_progress_v2(1,304,token,'messages_sending',NULL,jsonb_build_object('confirmed_message_numbers',ARRAY[1]));
  SELECT count(*) INTO after_first FROM public.instagram_dispatch_events WHERE queue_items_id=304;
  IF after_first<>before_events THEN RAISE EXCEPTION 'instagram_same_step_event_duplicated'; END IF;
  PERFORM public.instagram_update_queue_progress_v2(1,304,token,'sent',NULL,'{}');
  SELECT count(*) INTO after_first FROM public.sents WHERE organizations_id=1 AND queue_items_id=304 AND channels_id=2;
  PERFORM public.instagram_update_queue_progress_v2(1,304,token,'sent',NULL,'{}');
  SELECT count(*) INTO after_retry FROM public.sents WHERE organizations_id=1 AND queue_items_id=304 AND channels_id=2;
  IF after_first<>1 OR after_retry<>1 THEN RAISE EXCEPTION 'instagram_sent_not_idempotent:%:%',after_first,after_retry; END IF;
  IF (SELECT sent_count FROM public.instagram_profile_runtime WHERE organizations_id=1 AND socials_id=11)<>1 THEN RAISE EXCEPTION 'instagram_sent_counter_duplicated'; END IF;
  IF (SELECT lead_status_id FROM public.leads WHERE leads_id=304)<>5 THEN RAISE EXCEPTION 'instagram_lead_not_finalized'; END IF;
END $$;

-- Health e alertas do tenant 1 não incluem dados privados do tenant 2.
SELECT set_config('app.organization_id','1',false);
SELECT set_config('app.auth_role','authenticated',false);
DO $$ DECLARE h jsonb; BEGIN
  h:=public.get_operational_health();
  IF (h->>'organizationId')::bigint<>1 THEN RAISE EXCEPTION 'health_wrong_tenant:%',h; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(h->'components') c WHERE c->>'key'='worker-2') THEN RAISE EXCEPTION 'health_component_tenant_leak:%',h; END IF;
  IF EXISTS(SELECT 1 FROM public.operational_alerts WHERE organizations_id=2) THEN RAISE EXCEPTION 'alert_cross_tenant_creation'; END IF;
END $$;

SELECT 'stage11_r21_integration_pass' AS result;
