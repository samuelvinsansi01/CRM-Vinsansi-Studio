BEGIN;

CREATE OR REPLACE FUNCTION public.r60_assert_service_role()
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.r60_assert_worker_gate(p_organizations_id bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.organization_messaging_state%ROWTYPE;
BEGIN
  PERFORM public.r60_assert_service_role();
  SELECT * INTO s FROM public.organization_messaging_state WHERE organizations_id=p_organizations_id;
  IF s.organizations_id IS NULL OR s.maintenance OR NOT s.resume_allowed OR s.release_sequence<>60 OR s.schema_target<>'r60' OR s.security_baseline<>'r60-security-baseline-v1' THEN
    RAISE EXCEPTION 'messaging_paused';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.worker_claim_dispatch_job(p_organizations_id bigint,p_queue_items_id bigint,p_worker_id text,p_lease_seconds integer DEFAULT 90)
RETURNS TABLE(context jsonb,claimed boolean,claim_token uuid,attempt integer,max_attempts integer,lease_expires_at timestamptz,already_sent boolean,dlq_required boolean,state text,error_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,vault AS $$
DECLARE q public.queue_items%ROWTYPE; token uuid; secret text; lease_seconds integer:=least(greatest(coalesce(p_lease_seconds,90),15),600); payload jsonb; t jsonb;b jsonb;c jsonb;i jsonb;
BEGIN
  PERFORM public.r60_assert_worker_gate(p_organizations_id);
  SELECT * INTO q FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id FOR UPDATE;
  IF q.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
  IF q.status_id=5 THEN
    SELECT decrypted_secret INTO secret FROM public.instance_credentials ic JOIN vault.decrypted_secrets ds ON ds.id=ic.vault_secret_id JOIN public.chips ch ON ch.instances_id=ic.instances_id WHERE ch.chips_id=q.chips_id LIMIT 1;
    payload:=coalesce(q.queue_items_payload_snapshot,'{}'::jsonb);
    SELECT to_jsonb(x) INTO t FROM (SELECT templates_id,templates_message_1,templates_message_2,templates_message_3,templates_message_4 FROM public.templates WHERE templates_id=q.templates_id) x;
    SELECT to_jsonb(x) INTO b FROM (SELECT branches_id,branches_name FROM public.branches WHERE branches_id=(SELECT branches_id FROM public.leads WHERE leads_id=q.leads_id)) x;
    SELECT jsonb_build_object('chips_id',ch.chips_id,'chips_name',ch.chips_name,'chips_phone',ch.chips_phone) INTO c FROM public.chips ch WHERE ch.chips_id=q.chips_id;
    SELECT jsonb_build_object('instances_id',ins.instances_id,'instances_name',ins.instances_name,'instances_url',ins.instances_url,'api_key',secret) INTO i FROM public.instances ins JOIN public.chips ch ON ch.instances_id=ins.instances_id WHERE ch.chips_id=q.chips_id;
    context:=jsonb_build_object('queue_item',to_jsonb(q),'payload',payload,'template',coalesce(t,'{}'::jsonb),'branch',coalesce(b,'{}'::jsonb),'chip',coalesce(c,'{}'::jsonb),'instance',coalesce(i,'{}'::jsonb));
    claimed:=false;claim_token:=NULL;attempt:=q.queue_items_attempts;max_attempts:=q.worker_max_attempts;lease_expires_at:=NULL;already_sent:=true;dlq_required:=false;state:='sent';error_reason:=NULL;RETURN NEXT;RETURN;
  END IF;
  IF q.worker_dlq_at IS NOT NULL OR q.queue_items_attempts>=q.worker_max_attempts THEN
    context:=jsonb_build_object('queue_item',to_jsonb(q));claimed:=false;claim_token:=NULL;attempt:=q.queue_items_attempts;max_attempts:=q.worker_max_attempts;lease_expires_at:=q.worker_lease_expires_at;already_sent:=false;dlq_required:=true;state:='dlq';error_reason:=coalesce(q.worker_dlq_reason,'max_attempts_exceeded');RETURN NEXT;RETURN;
  END IF;
  IF q.worker_claim_token IS NOT NULL AND q.worker_lease_expires_at>now() AND q.worker_claimed_by IS DISTINCT FROM p_worker_id THEN
    context:=jsonb_build_object('queue_item',to_jsonb(q));claimed:=false;claim_token:=q.worker_claim_token;attempt:=q.queue_items_attempts;max_attempts:=q.worker_max_attempts;lease_expires_at:=q.worker_lease_expires_at;already_sent:=false;dlq_required:=false;state:='leased';error_reason:=NULL;RETURN NEXT;RETURN;
  END IF;
  token:=gen_random_uuid();
  UPDATE public.queue_items SET status_id=4,queue_items_attempts=queue_items_attempts+1,queue_items_started_at=coalesce(queue_items_started_at,now()),queue_items_finished_at=NULL,queue_items_error_message=NULL,
    worker_claim_token=token,worker_claimed_by=p_worker_id,worker_lease_expires_at=now()+make_interval(secs=>lease_seconds),queue_items_updated_at=now()
  WHERE queue_items_id=q.queue_items_id RETURNING * INTO q;
  SELECT ds.decrypted_secret INTO secret FROM public.chips ch JOIN public.instance_credentials ic ON ic.instances_id=ch.instances_id AND ic.organizations_id=p_organizations_id JOIN vault.decrypted_secrets ds ON ds.id=ic.vault_secret_id WHERE ch.chips_id=q.chips_id LIMIT 1;
  IF secret IS NULL THEN RAISE EXCEPTION 'worker_claim_context_chip_invalid:%',p_queue_items_id; END IF;
  payload:=coalesce(q.queue_items_payload_snapshot,'{}'::jsonb);
  SELECT to_jsonb(x) INTO t FROM (SELECT templates_id,templates_message_1,templates_message_2,templates_message_3,templates_message_4 FROM public.templates WHERE templates_id=q.templates_id AND organizations_id=p_organizations_id) x;
  SELECT to_jsonb(x) INTO b FROM (SELECT br.branches_id,br.branches_name FROM public.leads l JOIN public.branches br ON br.branches_id=l.branches_id WHERE l.leads_id=q.leads_id AND l.organizations_id=p_organizations_id) x;
  SELECT jsonb_build_object('chips_id',ch.chips_id,'chips_name',ch.chips_name,'chips_phone',ch.chips_phone) INTO c FROM public.chips ch WHERE ch.chips_id=q.chips_id AND ch.organizations_id=p_organizations_id;
  SELECT jsonb_build_object('instances_id',ins.instances_id,'instances_name',ins.instances_name,'instances_url',ins.instances_url,'api_key',secret) INTO i FROM public.instances ins JOIN public.chips ch ON ch.instances_id=ins.instances_id WHERE ch.chips_id=q.chips_id AND ch.organizations_id=p_organizations_id;
  context:=jsonb_build_object('queue_item',to_jsonb(q),'payload',payload,'template',coalesce(t,'{}'::jsonb),'branch',coalesce(b,'{}'::jsonb),'chip',coalesce(c,'{}'::jsonb),'instance',coalesce(i,'{}'::jsonb));
  claimed:=true;claim_token:=token;attempt:=q.queue_items_attempts;max_attempts:=q.worker_max_attempts;lease_expires_at:=q.worker_lease_expires_at;already_sent:=false;dlq_required:=false;state:='processing';error_reason:=NULL;RETURN NEXT;
END $$;

DROP FUNCTION IF EXISTS public.worker_claim_dispatch_part(bigint,bigint,text,text,text);
CREATE OR REPLACE FUNCTION public.worker_claim_dispatch_part(p_organizations_id bigint,p_queue_items_id bigint,p_part_key text,p_content_hash text,p_body text,p_reserved_external_id text,p_worker_id text,p_lease_seconds integer DEFAULT 90)
RETURNS TABLE(part_id bigint,part_state text,should_send boolean,claim_token uuid,external_id text,reserved_external_id text,operation_id text,attempt integer,max_attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.queue_item_dispatch_parts%ROWTYPE;token uuid;ord integer;lease_seconds integer:=least(greatest(coalesce(p_lease_seconds,90),15),600);
BEGIN
 PERFORM public.r60_assert_worker_gate(p_organizations_id);
 IF p_part_key NOT IN ('message_1','message_2','message_3','message_4') THEN RAISE EXCEPTION 'dispatch_part_invalid'; END IF;
 IF nullif(btrim(coalesce(p_reserved_external_id,'')),'') IS NULL THEN RAISE EXCEPTION 'reserved_external_id_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id AND worker_claimed_by=p_worker_id AND worker_lease_expires_at>now()) THEN RAISE EXCEPTION 'queue_item_lease_invalid'; END IF;
 ord:=substring(p_part_key from '[0-9]+')::integer;
 SELECT * INTO p FROM public.queue_item_dispatch_parts WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id AND queue_item_dispatch_parts_key=p_part_key FOR UPDATE;
 IF p.queue_item_dispatch_parts_id IS NOT NULL THEN
   IF p.queue_item_dispatch_parts_content_hash<>p_content_hash THEN RAISE EXCEPTION 'dispatch_part_content_changed'; END IF;
   IF p.queue_item_dispatch_parts_state IN ('sent','reconciliation_required','dlq') THEN
     RETURN QUERY SELECT p.queue_item_dispatch_parts_id,p.queue_item_dispatch_parts_state,false,NULL::uuid,p.queue_item_dispatch_parts_external_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_attempts,p.queue_item_dispatch_parts_max_attempts;RETURN;
   END IF;
   IF p.queue_item_dispatch_parts_state='processing' AND p.queue_item_dispatch_parts_lease_expires_at>now() THEN
     RETURN QUERY SELECT p.queue_item_dispatch_parts_id,'processing'::text,false,NULL::uuid,p.queue_item_dispatch_parts_external_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_attempts,p.queue_item_dispatch_parts_max_attempts;RETURN;
   END IF;
 END IF;
 token:=gen_random_uuid();
 INSERT INTO public.queue_item_dispatch_parts(users_id,organizations_id,queue_items_id,queue_item_dispatch_parts_key,queue_item_dispatch_parts_order,queue_item_dispatch_parts_state,queue_item_dispatch_parts_content_hash,queue_item_dispatch_parts_body,queue_item_dispatch_parts_attempts,queue_item_dispatch_parts_claim_token,queue_item_dispatch_parts_claimed_at,queue_item_dispatch_parts_operation_id,queue_item_dispatch_parts_lease_expires_at)
 SELECT qi.users_id,p_organizations_id,p_queue_items_id,p_part_key,ord,'processing',p_content_hash,coalesce(p_body,''),1,token,now(),p_reserved_external_id,now()+make_interval(secs=>lease_seconds) FROM public.queue_items qi WHERE qi.queue_items_id=p_queue_items_id AND qi.organizations_id=p_organizations_id
 ON CONFLICT(queue_items_id,queue_item_dispatch_parts_key) DO UPDATE SET queue_item_dispatch_parts_state='processing',queue_item_dispatch_parts_attempts=public.queue_item_dispatch_parts.queue_item_dispatch_parts_attempts+1,queue_item_dispatch_parts_claim_token=token,queue_item_dispatch_parts_claimed_at=now(),queue_item_dispatch_parts_lease_expires_at=now()+make_interval(secs=>lease_seconds),queue_item_dispatch_parts_operation_id=coalesce(public.queue_item_dispatch_parts.queue_item_dispatch_parts_operation_id,p_reserved_external_id),queue_item_dispatch_parts_error_message=NULL,queue_item_dispatch_parts_updated_at=now()
 WHERE public.queue_item_dispatch_parts.queue_item_dispatch_parts_state IN ('pending','failed') OR public.queue_item_dispatch_parts.queue_item_dispatch_parts_lease_expires_at<=now()
 RETURNING * INTO p;
 IF p.queue_item_dispatch_parts_id IS NULL THEN RAISE EXCEPTION 'dispatch_part_claim_conflict'; END IF;
 IF p.queue_item_dispatch_parts_attempts>p.queue_item_dispatch_parts_max_attempts THEN
   UPDATE public.queue_item_dispatch_parts SET queue_item_dispatch_parts_state='dlq',queue_item_dispatch_parts_claim_token=NULL,queue_item_dispatch_parts_error_message='max_attempts_exceeded',queue_item_dispatch_parts_updated_at=now() WHERE queue_item_dispatch_parts_id=p.queue_item_dispatch_parts_id;
   RETURN QUERY SELECT p.queue_item_dispatch_parts_id,'dlq'::text,false,NULL::uuid,p.queue_item_dispatch_parts_external_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_attempts,p.queue_item_dispatch_parts_max_attempts;RETURN;
 END IF;
 RETURN QUERY SELECT p.queue_item_dispatch_parts_id,'processing'::text,true,p.queue_item_dispatch_parts_claim_token,p.queue_item_dispatch_parts_external_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_operation_id,p.queue_item_dispatch_parts_attempts,p.queue_item_dispatch_parts_max_attempts;
END $$;

DROP FUNCTION IF EXISTS public.worker_complete_dispatch_part(bigint,bigint,text,uuid,text,text,text);
CREATE OR REPLACE FUNCTION public.worker_complete_dispatch_part(p_organizations_id bigint,p_queue_items_id bigint,p_part_key text,p_claim_token uuid,p_outcome text,p_external_id text,p_operation_id text,p_error_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.queue_item_dispatch_parts%ROWTYPE;outcome text:=lower(btrim(coalesce(p_outcome,'')));
BEGIN
 PERFORM public.r60_assert_service_role();
 IF outcome NOT IN ('sent','failed','reconciliation_required') THEN RAISE EXCEPTION 'dispatch_part_outcome_invalid'; END IF;
 SELECT * INTO p FROM public.queue_item_dispatch_parts WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id AND queue_item_dispatch_parts_key=p_part_key FOR UPDATE;
 IF p.queue_item_dispatch_parts_id IS NULL THEN RAISE EXCEPTION 'dispatch_part_not_found'; END IF;
 IF p.queue_item_dispatch_parts_state='sent' AND outcome='sent' THEN RETURN; END IF;
 IF p.queue_item_dispatch_parts_state<>'processing' OR p.queue_item_dispatch_parts_claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'dispatch_part_claim_lost'; END IF;
 IF p.queue_item_dispatch_parts_operation_id IS DISTINCT FROM p_operation_id THEN RAISE EXCEPTION 'dispatch_operation_id_mismatch'; END IF;
 UPDATE public.queue_item_dispatch_parts SET queue_item_dispatch_parts_state=outcome,queue_item_dispatch_parts_external_id=coalesce(nullif(btrim(coalesce(p_external_id,'')),''),queue_item_dispatch_parts_external_id),queue_item_dispatch_parts_sent_at=CASE WHEN outcome='sent' THEN now() ELSE queue_item_dispatch_parts_sent_at END,queue_item_dispatch_parts_error_message=nullif(btrim(coalesce(p_error_message,'')),''),queue_item_dispatch_parts_claim_token=NULL,queue_item_dispatch_parts_lease_expires_at=NULL,queue_item_dispatch_parts_updated_at=now() WHERE queue_item_dispatch_parts_id=p.queue_item_dispatch_parts_id;
END $$;

DROP FUNCTION IF EXISTS public.worker_finalize_whatsapp_queue_item(bigint,bigint);
CREATE OR REPLACE FUNCTION public.worker_finalize_whatsapp_queue_item(p_organizations_id bigint,p_queue_items_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.queue_items%ROWTYPE; missing integer;
BEGIN
 PERFORM public.r60_assert_service_role();
 SELECT * INTO q FROM public.queue_items WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id FOR UPDATE;
 IF q.queue_items_id IS NULL THEN RAISE EXCEPTION 'queue_item_not_found'; END IF;
 IF q.status_id=5 THEN RETURN; END IF;
 SELECT count(*) INTO missing FROM jsonb_each_text(coalesce(q.queue_items_payload_snapshot->'messages','{}'::jsonb)) m
 WHERE m.key ~ '^message_[1-4]$' AND nullif(btrim(m.value),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_items_id=p_queue_items_id AND p.queue_item_dispatch_parts_key=m.key AND p.queue_item_dispatch_parts_state='sent');
 IF missing>0 THEN RAISE EXCEPTION 'required_message_parts_not_sent'; END IF;
 IF EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_items_id=p_queue_items_id AND p.queue_item_dispatch_parts_state IN ('processing','reconciliation_required')) THEN RAISE EXCEPTION 'dispatch_part_reconciliation_required'; END IF;
 UPDATE public.queue_items SET status_id=5,queue_items_finished_at=now(),queue_items_error_message=NULL,worker_claim_token=NULL,worker_claimed_by=NULL,worker_lease_expires_at=NULL,queue_items_updated_at=now() WHERE queue_items_id=p_queue_items_id;
END $$;

DROP FUNCTION IF EXISTS public.worker_fail_whatsapp_queue_item(bigint,bigint,text);
CREATE OR REPLACE FUNCTION public.worker_fail_whatsapp_queue_item(p_organizations_id bigint,p_queue_items_id bigint,p_error_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.r60_assert_service_role();
 UPDATE public.queue_items SET status_id=6,queue_items_error_message=nullif(left(coalesce(p_error_message,''),1000),''),queue_items_finished_at=now(),worker_claim_token=NULL,worker_claimed_by=NULL,worker_lease_expires_at=NULL,queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id AND status_id<>5;
END $$;

CREATE OR REPLACE FUNCTION public.worker_move_dispatch_to_dlq(p_organizations_id bigint,p_queue_items_id bigint,p_worker_id text,p_reason text,p_attempts integer,p_max_attempts integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.r60_assert_service_role();
 UPDATE public.queue_items SET status_id=6,worker_dlq_at=now(),worker_dlq_reason=left(coalesce(p_reason,'terminal_error'),1000),queue_items_error_message=left(coalesce(p_reason,'terminal_error'),1000),queue_items_finished_at=now(),worker_claim_token=NULL,worker_claimed_by=NULL,worker_lease_expires_at=NULL,queue_items_attempts=greatest(queue_items_attempts,coalesce(p_attempts,0)),worker_max_attempts=greatest(worker_max_attempts,coalesce(p_max_attempts,1)),queue_items_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id;
 UPDATE public.queue_item_dispatch_parts SET queue_item_dispatch_parts_state='dlq',queue_item_dispatch_parts_claim_token=NULL,queue_item_dispatch_parts_lease_expires_at=NULL,queue_item_dispatch_parts_error_message=coalesce(queue_item_dispatch_parts_error_message,'queue_item_dlq'),queue_item_dispatch_parts_updated_at=now() WHERE organizations_id=p_organizations_id AND queue_items_id=p_queue_items_id AND queue_item_dispatch_parts_state<>'sent';
END $$;

-- Organization-native batch contracts. Runtime route injects p_organizations_id from installation scope.
DROP FUNCTION IF EXISTS public.worker_start_whatsapp_batch(bigint,text,bigint[],text);
CREATE OR REPLACE FUNCTION public.worker_start_whatsapp_batch(p_organizations_id bigint,p_chip_instance text,p_queue_item_ids bigint[],p_worker_id text DEFAULT NULL)
RETURNS TABLE(batch_id bigint,batch_status text,enabled boolean,chip text,total integer,remaining integer,processed integer,sent integer,failed integer,next_run_at timestamptz,started_at timestamptz,last_error text,already_running boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_user bigint;v_channel bigint;v_chip bigint;v_batch bigint;v_existing public.worker_batches%ROWTYPE;v_count integer;
BEGIN
 PERFORM public.r60_assert_worker_gate(p_organizations_id);
 SELECT legacy_scope_users_id INTO v_user FROM public.organizations WHERE organizations_id=p_organizations_id;
 SELECT channels_id INTO v_channel FROM public.channels WHERE lower(btrim(channels_name))='whatsapp' LIMIT 1;
 SELECT ch.chips_id INTO v_chip FROM public.chips ch JOIN public.instances i ON i.instances_id=ch.instances_id WHERE ch.organizations_id=p_organizations_id AND i.instances_name=btrim(p_chip_instance) LIMIT 1;
 IF v_chip IS NULL OR v_channel IS NULL THEN RAISE EXCEPTION 'batch_chip_not_found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(format('r60-batch:%s:%s',p_organizations_id,v_chip),0));
 SELECT * INTO v_existing FROM public.worker_batches WHERE organizations_id=p_organizations_id AND channels_id=v_channel AND chips_id=v_chip AND status_id IN(3,4,8) ORDER BY worker_batches_id DESC LIMIT 1 FOR UPDATE;
 IF v_existing.worker_batches_id IS NOT NULL THEN RETURN QUERY SELECT v_existing.worker_batches_id,CASE v_existing.status_id WHEN 8 THEN 'paused' ELSE 'running' END,true,p_chip_instance,v_existing.worker_batches_total_items,greatest(v_existing.worker_batches_total_items-v_existing.worker_batches_processed_items,0),v_existing.worker_batches_processed_items,v_existing.worker_batches_sent_items,v_existing.worker_batches_failed_items,v_existing.worker_batches_next_run_at,v_existing.worker_batches_started_at,coalesce(v_existing.worker_batches_last_error,''),true;RETURN; END IF;
 SELECT count(DISTINCT x) INTO v_count FROM unnest(coalesce(p_queue_item_ids,ARRAY[]::bigint[])) x;
 IF v_count=0 OR v_count<>(SELECT count(*) FROM public.queue_items WHERE organizations_id=p_organizations_id AND chips_id=v_chip AND queue_items_id=ANY(p_queue_item_ids) AND status_id IN(3,8)) THEN RAISE EXCEPTION 'batch_items_not_dispatchable'; END IF;
 INSERT INTO public.worker_batches(users_id,organizations_id,channels_id,chips_id,status_id,worker_batches_total_items,worker_batches_next_run_at,worker_batches_started_at,worker_batches_heartbeat_at,worker_batches_worker_id) VALUES(v_user,p_organizations_id,v_channel,v_chip,4,v_count,now(),now(),now(),p_worker_id) RETURNING worker_batches_id INTO v_batch;
 INSERT INTO public.worker_batch_items(users_id,organizations_id,worker_batches_id,queue_items_id,status_id,worker_batch_items_position)
 SELECT v_user,p_organizations_id,v_batch,x,id_status,ord::integer FROM unnest(p_queue_item_ids) WITH ORDINALITY u(x,ord) CROSS JOIN LATERAL (SELECT 3::bigint id_status) s JOIN public.queue_items q ON q.queue_items_id=x AND q.organizations_id=p_organizations_id GROUP BY x,ord,id_status;
 RETURN QUERY SELECT v_batch,'running',true,p_chip_instance,v_count,v_count,0,0,0,now(),now(),'',false;
END $$;

DROP FUNCTION IF EXISTS public.worker_set_whatsapp_batch_state(bigint,text,text,text);
CREATE OR REPLACE FUNCTION public.worker_set_whatsapp_batch_state(p_organizations_id bigint,p_chip_instance text,p_action text,p_worker_id text DEFAULT NULL)
RETURNS TABLE(batch_id bigint,batch_status text,enabled boolean,chip text,total integer,remaining integer,processed integer,sent integer,failed integer,next_run_at timestamptz,started_at timestamptz,last_error text,already_running boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.worker_batches%ROWTYPE;v_chip bigint;act text:=lower(btrim(coalesce(p_action,'')));
BEGIN
 PERFORM public.r60_assert_service_role(); IF act='resume' THEN PERFORM public.r60_assert_worker_gate(p_organizations_id); END IF;
 SELECT ch.chips_id INTO v_chip FROM public.chips ch JOIN public.instances i ON i.instances_id=ch.instances_id WHERE ch.organizations_id=p_organizations_id AND i.instances_name=btrim(p_chip_instance) LIMIT 1;
 SELECT * INTO b FROM public.worker_batches WHERE organizations_id=p_organizations_id AND chips_id=v_chip ORDER BY worker_batches_id DESC LIMIT 1 FOR UPDATE;
 IF b.worker_batches_id IS NULL THEN RAISE EXCEPTION 'batch_not_found'; END IF;
 IF act='pause' AND b.status_id IN(3,4) THEN UPDATE public.worker_batches SET status_id=8,worker_batches_paused_at=now(),worker_batches_updated_at=now() WHERE worker_batches_id=b.worker_batches_id;
 ELSIF act='resume' AND b.status_id=8 THEN UPDATE public.worker_batches SET status_id=4,worker_batches_paused_at=NULL,worker_batches_next_run_at=now(),worker_batches_worker_id=coalesce(nullif(btrim(p_worker_id),''),worker_batches_worker_id),worker_batches_updated_at=now() WHERE worker_batches_id=b.worker_batches_id;
 ELSIF act='stop' AND b.status_id IN(3,4,8) THEN UPDATE public.worker_batches SET status_id=7,worker_batches_finished_at=now(),worker_batches_next_run_at=NULL,worker_batches_updated_at=now() WHERE worker_batches_id=b.worker_batches_id;
 ELSIF act NOT IN('state','status','pause','resume','stop') THEN RAISE EXCEPTION 'batch_action_invalid'; END IF;
 SELECT * INTO b FROM public.worker_batches WHERE worker_batches_id=b.worker_batches_id;
 RETURN QUERY SELECT b.worker_batches_id,CASE b.status_id WHEN 3 THEN 'pending' WHEN 4 THEN 'running' WHEN 5 THEN 'completed' WHEN 6 THEN 'error' WHEN 7 THEN 'stopped' WHEN 8 THEN 'paused' ELSE 'idle' END,b.status_id IN(3,4,8),p_chip_instance,b.worker_batches_total_items,greatest(b.worker_batches_total_items-b.worker_batches_processed_items,0),b.worker_batches_processed_items,b.worker_batches_sent_items,b.worker_batches_failed_items,b.worker_batches_next_run_at,b.worker_batches_started_at,coalesce(b.worker_batches_last_error,''),false;
END $$;

DROP FUNCTION IF EXISTS public.worker_claim_next_batch_item(bigint,text);
DROP FUNCTION IF EXISTS public.worker_claim_next_batch_item(bigint,bigint,text);
CREATE OR REPLACE FUNCTION public.worker_claim_next_batch_item(p_worker_batches_id bigint,p_worker_id text)
RETURNS TABLE(batch_item_id bigint,queue_item_id bigint,item_position integer,total integer,processed integer,policy jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.worker_batches%ROWTYPE;bi public.worker_batch_items%ROWTYPE;
BEGIN
 PERFORM public.r60_assert_service_role();
 SELECT * INTO b FROM public.worker_batches WHERE worker_batches_id=p_worker_batches_id FOR UPDATE;
 IF b.worker_batches_id IS NULL THEN RETURN; END IF;
 PERFORM public.r60_assert_worker_gate(b.organizations_id);
 IF b.status_id<>4 OR (b.worker_batches_next_run_at IS NOT NULL AND b.worker_batches_next_run_at>now()) THEN RETURN; END IF;
 SELECT * INTO bi FROM public.worker_batch_items WHERE organizations_id=b.organizations_id AND worker_batches_id=p_worker_batches_id AND status_id=3 ORDER BY worker_batch_items_position FOR UPDATE SKIP LOCKED LIMIT 1;
 IF bi.worker_batch_items_id IS NULL THEN RETURN; END IF;
 UPDATE public.worker_batch_items SET status_id=4,worker_batch_items_attempts=worker_batch_items_attempts+1,worker_batch_items_started_at=now(),worker_batch_items_updated_at=now() WHERE worker_batch_items_id=bi.worker_batch_items_id;
 UPDATE public.worker_batches SET worker_batches_worker_id=p_worker_id,worker_batches_heartbeat_at=now(),worker_batches_updated_at=now() WHERE worker_batches_id=p_worker_batches_id;
 RETURN QUERY SELECT bi.worker_batch_items_id,bi.queue_items_id,bi.worker_batch_items_position,b.worker_batches_total_items,b.worker_batches_processed_items,jsonb_build_object('batchCount',1,'batchSize',b.worker_batches_total_items);
END $$;

DROP FUNCTION IF EXISTS public.worker_complete_batch_item(bigint,text,text,timestamptz);
DROP FUNCTION IF EXISTS public.worker_complete_batch_item(bigint,bigint,text,text,timestamptz);
CREATE OR REPLACE FUNCTION public.worker_complete_batch_item(p_worker_batch_items_id bigint,p_result text,p_error_message text,p_next_run_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE bi public.worker_batch_items%ROWTYPE;sid bigint;
BEGIN
 PERFORM public.r60_assert_service_role();
 SELECT * INTO bi FROM public.worker_batch_items WHERE worker_batch_items_id=p_worker_batch_items_id FOR UPDATE;
 IF bi.worker_batch_items_id IS NULL THEN RAISE EXCEPTION 'batch_item_not_found'; END IF;
 PERFORM public.r60_assert_worker_gate(bi.organizations_id);
 sid:=CASE lower(btrim(coalesce(p_result,''))) WHEN 'sent' THEN 5 WHEN 'paused' THEN 8 WHEN 'stopped' THEN 7 ELSE 6 END;
 UPDATE public.worker_batch_items SET status_id=sid,worker_batch_items_finished_at=now(),worker_batch_items_error_message=nullif(left(coalesce(p_error_message,''),1000),''),worker_batch_items_updated_at=now() WHERE worker_batch_items_id=bi.worker_batch_items_id;
 UPDATE public.worker_batches SET worker_batches_processed_items=worker_batches_processed_items+1,worker_batches_sent_items=worker_batches_sent_items+CASE WHEN sid=5 THEN 1 ELSE 0 END,worker_batches_failed_items=worker_batches_failed_items+CASE WHEN sid=6 THEN 1 ELSE 0 END,worker_batches_next_run_at=p_next_run_at,worker_batches_heartbeat_at=now(),worker_batches_updated_at=now() WHERE organizations_id=bi.organizations_id AND worker_batches_id=bi.worker_batches_id;
 UPDATE public.worker_batches SET status_id=5,worker_batches_finished_at=now(),worker_batches_next_run_at=NULL,worker_batches_updated_at=now() WHERE worker_batches_id=bi.worker_batches_id AND NOT EXISTS(SELECT 1 FROM public.worker_batch_items x WHERE x.worker_batches_id=bi.worker_batches_id AND x.status_id IN(3,4));
END $$;

CREATE OR REPLACE FUNCTION public.worker_recover_stale_whatsapp_v2(p_organizations_id bigint,p_stale_before timestamptz DEFAULT now()-interval '15 minutes')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rec integer:=0;recon integer:=0;
BEGIN
 PERFORM public.r60_assert_service_role();
 UPDATE public.queue_item_dispatch_parts SET queue_item_dispatch_parts_state='reconciliation_required',queue_item_dispatch_parts_claim_token=NULL,queue_item_dispatch_parts_lease_expires_at=NULL,queue_item_dispatch_parts_error_message='stale_processing_requires_reconciliation',queue_item_dispatch_parts_updated_at=now()
 WHERE organizations_id=p_organizations_id AND queue_item_dispatch_parts_state='processing' AND coalesce(queue_item_dispatch_parts_lease_expires_at,queue_item_dispatch_parts_claimed_at)<p_stale_before;
 GET DIAGNOSTICS recon=ROW_COUNT;
 UPDATE public.queue_items q SET status_id=3,worker_claim_token=NULL,worker_claimed_by=NULL,worker_lease_expires_at=NULL,queue_items_started_at=NULL,queue_items_error_message=NULL,queue_items_updated_at=now()
 WHERE q.organizations_id=p_organizations_id AND q.status_id=4 AND coalesce(q.worker_lease_expires_at,q.queue_items_updated_at)<p_stale_before AND NOT EXISTS(SELECT 1 FROM public.queue_item_dispatch_parts p WHERE p.queue_items_id=q.queue_items_id AND p.queue_item_dispatch_parts_state='reconciliation_required');
 GET DIAGNOSTICS rec=ROW_COUNT;
 RETURN jsonb_build_object('recovered_items',rec,'reconciliation_items',recon);
END $$;

COMMIT;
