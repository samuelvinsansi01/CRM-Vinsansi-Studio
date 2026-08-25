-- R22 / Etapa 11: separa inventário histórico de instalação operacional corrente.
-- Fonte de verdade auditada: Banco - Atual.txt (2026-08-25T14:53:03.038263+00:00).
BEGIN;

ALTER TABLE public.organization_tool_installations
  ADD COLUMN IF NOT EXISTS operational_slot text,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_installation_id uuid;

UPDATE public.organization_tool_installations i
SET operational_slot=CASE
  WHEN i.tool_id='vinsansi_instagram'
       AND nullif(trim(coalesce(i.metadata->>'instagramProfile','')),'') IS NOT NULL
    THEN left('profile:'||lower(regexp_replace(trim(i.metadata->>'instagramProfile'),'^@','','g')),160)
  ELSE 'primary'
END
WHERE i.operational_slot IS NULL OR trim(i.operational_slot)='';

ALTER TABLE public.organization_tool_installations
  ALTER COLUMN operational_slot SET DEFAULT 'primary',
  ALTER COLUMN operational_slot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.organization_tool_installations'::regclass
      AND conname='organization_tool_installations_operational_slot_check'
  ) THEN
    ALTER TABLE public.organization_tool_installations
      ADD CONSTRAINT organization_tool_installations_operational_slot_check
      CHECK(length(trim(operational_slot)) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.organization_tool_installations'::regclass
      AND conname='organization_tool_installations_superseded_by_fkey'
  ) THEN
    ALTER TABLE public.organization_tool_installations
      ADD CONSTRAINT organization_tool_installations_superseded_by_fkey
      FOREIGN KEY(superseded_by_installation_id)
      REFERENCES public.organization_tool_installations(organization_tool_installations_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill conservador: por organização/ferramenta/slot, o heartbeat mais recente
-- vence; sem heartbeat, vence o registro mais recente. Nada é apagado.
WITH ranked AS (
  SELECT i.organization_tool_installations_id,
         first_value(i.organization_tool_installations_id) OVER(
           PARTITION BY i.organizations_id,i.tool_id,i.operational_slot
           ORDER BY
             greatest(
               coalesce(i.last_seen_at,'-infinity'::timestamptz),
               coalesce(i.last_activity_at,'-infinity'::timestamptz),
               coalesce(i.registered_at,'-infinity'::timestamptz),
               coalesce(i.updated_at,'-infinity'::timestamptz),
               coalesce(i.created_at,'-infinity'::timestamptz)
             ) DESC,
             i.organization_tool_installations_id DESC
         ) AS current_id,
         row_number() OVER(
           PARTITION BY i.organizations_id,i.tool_id,i.operational_slot
           ORDER BY
             greatest(
               coalesce(i.last_seen_at,'-infinity'::timestamptz),
               coalesce(i.last_activity_at,'-infinity'::timestamptz),
               coalesce(i.registered_at,'-infinity'::timestamptz),
               coalesce(i.updated_at,'-infinity'::timestamptz),
               coalesce(i.created_at,'-infinity'::timestamptz)
             ) DESC,
             i.organization_tool_installations_id DESC
         ) AS position
  FROM public.organization_tool_installations i
  WHERE i.registration_status='registered'
)
UPDATE public.organization_tool_installations i
SET is_current=(r.position=1),
    superseded_at=CASE WHEN r.position=1 THEN NULL ELSE coalesce(i.superseded_at,now()) END,
    superseded_by_installation_id=CASE WHEN r.position=1 THEN NULL ELSE r.current_id END
FROM ranked r
WHERE r.organization_tool_installations_id=i.organization_tool_installations_id;

UPDATE public.organization_tool_installations
SET is_current=false,
    superseded_at=coalesce(superseded_at,disabled_at,revoked_at,now())
WHERE registration_status<>'registered';

CREATE UNIQUE INDEX IF NOT EXISTS organization_tool_installations_one_current_slot_idx
ON public.organization_tool_installations(organizations_id,tool_id,operational_slot)
WHERE is_current AND registration_status='registered';

-- Credenciais e sessões antigas deixam de poder reanimar um registro histórico.
UPDATE public.tool_installation_credentials c
SET revoked_at=coalesce(c.revoked_at,now())
FROM public.organization_tool_installations i
WHERE i.organization_tool_installations_id=c.organization_tool_installations_id
  AND NOT i.is_current AND c.revoked_at IS NULL;

UPDATE public.tool_user_sessions s
SET revoked_at=coalesce(s.revoked_at,now()),
    logout_reason=coalesce(s.logout_reason,'installation_superseded')
FROM public.organization_tool_installations i
WHERE i.organization_tool_installations_id=s.organization_tool_installations_id
  AND NOT i.is_current AND s.revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.tool_operational_slot(p_tool_id text,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog,public AS $$
  SELECT CASE
    WHEN p_tool_id='vinsansi_instagram'
         AND nullif(trim(coalesce(p_metadata->>'instagramProfile','')),'') IS NOT NULL
      THEN left('profile:'||lower(regexp_replace(trim(p_metadata->>'instagramProfile'),'^@','','g')),160)
    ELSE 'primary'
  END
$$;
REVOKE ALL ON FUNCTION public.tool_operational_slot(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tool_operational_slot(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.service_register_tool_installation(
  p_organizations_id bigint,p_tool_id text,p_external_installation_id text,
  p_installed_version text DEFAULT NULL,p_reported_capabilities text[] DEFAULT '{}',
  p_registered_by_member_id bigint DEFAULT NULL,p_metadata jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE
  v_id uuid;
  v_new boolean:=false;
  v_scope bigint;
  v_slot text;
  v_metadata jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT public.tool_semver_is_valid(p_installed_version) OR public.tool_json_contains_secret(p_metadata) THEN
    RAISE EXCEPTION 'tool_installation_contract_invalid';
  END IF;

  SELECT i.organization_tool_installations_id,coalesce(i.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)
  INTO v_id,v_metadata
  FROM public.organization_tool_installations i
  WHERE i.organizations_id=p_organizations_id AND i.tool_id=p_tool_id
    AND i.external_installation_id=p_external_installation_id;
  v_new:=v_id IS NULL;
  v_metadata:=coalesce(v_metadata,p_metadata,'{}'::jsonb);
  v_slot:=public.tool_operational_slot(p_tool_id,v_metadata);
  PERFORM pg_advisory_xact_lock(hashtextextended('tool-installation:'||p_organizations_id||':'||p_tool_id||':'||v_slot,0));

  INSERT INTO public.organization_tools(organizations_id,tool_id,enabled,registered_by_member_id)
  VALUES(p_organizations_id,p_tool_id,true,p_registered_by_member_id)
  ON CONFLICT(organizations_id,tool_id) DO NOTHING;
  INSERT INTO public.organization_tool_settings(organizations_id,tool_id,settings,settings_schema_version)
  SELECT p_organizations_id,pt.tool_id,pt.default_settings,pt.settings_schema_version
  FROM public.platform_tools pt WHERE pt.tool_id=p_tool_id
  ON CONFLICT(organizations_id,tool_id) DO NOTHING;

  UPDATE public.organization_tool_installations i
  SET is_current=false,superseded_at=coalesce(i.superseded_at,now())
  WHERE i.organizations_id=p_organizations_id AND i.tool_id=p_tool_id
    AND i.operational_slot=v_slot AND i.is_current
    AND i.external_installation_id<>p_external_installation_id;

  INSERT INTO public.organization_tool_installations(
    organizations_id,tool_id,external_installation_id,registration_status,installed_version,
    reported_capabilities,registered_by_member_id,metadata,operational_slot,is_current,
    superseded_at,superseded_by_installation_id
  ) VALUES(
    p_organizations_id,p_tool_id,p_external_installation_id,'registered',p_installed_version,
    coalesce(p_reported_capabilities,'{}'),p_registered_by_member_id,v_metadata,v_slot,true,NULL,NULL
  )
  ON CONFLICT(organizations_id,tool_id,external_installation_id) DO UPDATE SET
    registration_status='registered',
    installed_version=coalesce(excluded.installed_version,organization_tool_installations.installed_version),
    reported_capabilities=excluded.reported_capabilities,
    registered_by_member_id=coalesce(organization_tool_installations.registered_by_member_id,excluded.registered_by_member_id),
    metadata=organization_tool_installations.metadata||excluded.metadata,
    operational_slot=excluded.operational_slot,is_current=true,
    superseded_at=NULL,superseded_by_installation_id=NULL,disabled_at=NULL,revoked_at=NULL
  RETURNING organization_tool_installations_id INTO v_id;

  UPDATE public.organization_tool_installations i
  SET superseded_by_installation_id=v_id
  WHERE i.organizations_id=p_organizations_id AND i.tool_id=p_tool_id
    AND i.operational_slot=v_slot AND NOT i.is_current
    AND i.organization_tool_installations_id<>v_id;
  UPDATE public.tool_installation_credentials c SET revoked_at=coalesce(c.revoked_at,now())
  FROM public.organization_tool_installations i
  WHERE i.organization_tool_installations_id=c.organization_tool_installations_id
    AND i.organizations_id=p_organizations_id AND i.tool_id=p_tool_id
    AND i.operational_slot=v_slot AND NOT i.is_current AND c.revoked_at IS NULL;
  UPDATE public.tool_user_sessions s
  SET revoked_at=coalesce(s.revoked_at,now()),logout_reason=coalesce(s.logout_reason,'installation_superseded')
  FROM public.organization_tool_installations i
  WHERE i.organization_tool_installations_id=s.organization_tool_installations_id
    AND i.organizations_id=p_organizations_id AND i.tool_id=p_tool_id
    AND i.operational_slot=v_slot AND NOT i.is_current AND s.revoked_at IS NULL;

  IF v_new THEN
    SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=p_organizations_id;
    PERFORM public.append_audit_event('tools','tool.installation.registered','organization_tool_installations',v_id::text,NULL,NULL,NULL,NULL,NULL,'Instalacao registrada',
      jsonb_build_object('tool_id',p_tool_id,'organization_tool_installation_id',v_id,'registered_by_member_id',p_registered_by_member_id,'operational_slot',v_slot),v_scope);
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.service_register_tool_installation(bigint,text,text,text,text[],bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_register_tool_installation(bigint,text,text,text,text[],bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.service_touch_tool_installation(
  p_organizations_id bigint,p_tool_id text,p_external_installation_id text,p_seen boolean DEFAULT true,
  p_meaningful_activity boolean DEFAULT false,p_installed_version text DEFAULT NULL,
  p_reported_capabilities text[] DEFAULT NULL,p_last_seen_member_id bigint DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT public.tool_semver_is_valid(p_installed_version) THEN RAISE EXCEPTION 'tool_semver_invalid'; END IF;
  UPDATE public.organization_tool_installations SET
    last_seen_at=CASE WHEN p_seen THEN now() ELSE last_seen_at END,
    last_activity_at=CASE WHEN p_meaningful_activity THEN now() ELSE last_activity_at END,
    installed_version=coalesce(p_installed_version,installed_version),
    reported_capabilities=coalesce(p_reported_capabilities,reported_capabilities),
    last_seen_member_id=coalesce(p_last_seen_member_id,last_seen_member_id)
  WHERE organizations_id=p_organizations_id AND tool_id=p_tool_id
    AND external_installation_id=p_external_installation_id AND is_current
    AND (registration_status='registered' OR (registration_status='disabled' AND NOT p_meaningful_activity))
  RETURNING organization_tool_installations_id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tool_installation_not_current'; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.service_touch_tool_installation(bigint,text,text,boolean,boolean,text,text[],bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_touch_tool_installation(bigint,text,text,boolean,boolean,text,text[],bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.service_runtime_heartbeat(
  p_organizations_id bigint,p_component_type text,p_component_key text,p_component_version text DEFAULT NULL,
  p_status text DEFAULT 'online',p_installation_id uuid DEFAULT NULL,p_metrics jsonb DEFAULT '{}',
  p_metadata jsonb DEFAULT '{}',p_meaningful_activity boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_id bigint;v_type text:=lower(trim(coalesce(p_component_type,'')));v_status text:=lower(trim(coalesce(p_status,'online')));
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'organization_not_active'; END IF;
  IF v_type NOT IN('worker','manager','gateway','evolution','capture','instagram','realtime') THEN RAISE EXCEPTION 'runtime_component_invalid'; END IF;
  IF v_status NOT IN('online','degraded','stopping','offline','error','incompatible') THEN RAISE EXCEPTION 'runtime_status_invalid'; END IF;
  IF nullif(trim(coalesce(p_component_key,'')),'') IS NULL THEN RAISE EXCEPTION 'runtime_component_key_required'; END IF;
  IF p_installation_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.organization_tool_installations i
    WHERE i.organization_tool_installations_id=p_installation_id
      AND i.organizations_id=p_organizations_id AND i.registration_status='registered' AND i.is_current
  ) THEN RAISE EXCEPTION 'runtime_installation_not_current'; END IF;
  INSERT INTO public.platform_runtime_heartbeats(
    organizations_id,organization_tool_installations_id,component_type,component_key,component_version,
    runtime_status,last_meaningful_activity_at,metrics,metadata
  ) VALUES(
    p_organizations_id,p_installation_id,v_type,trim(p_component_key),nullif(trim(coalesce(p_component_version,'')),''),
    v_status,CASE WHEN p_meaningful_activity THEN now() ELSE NULL END,coalesce(p_metrics,'{}'),coalesce(p_metadata,'{}')
  ) ON CONFLICT(organizations_id,component_type,component_key) DO UPDATE SET
    organization_tool_installations_id=coalesce(excluded.organization_tool_installations_id,public.platform_runtime_heartbeats.organization_tool_installations_id),
    component_version=coalesce(excluded.component_version,public.platform_runtime_heartbeats.component_version),
    runtime_status=excluded.runtime_status,last_seen_at=now(),
    last_meaningful_activity_at=CASE WHEN p_meaningful_activity THEN now() ELSE public.platform_runtime_heartbeats.last_meaningful_activity_at END,
    metrics=excluded.metrics,metadata=public.platform_runtime_heartbeats.metadata||excluded.metadata
  RETURNING platform_runtime_heartbeats_id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.service_runtime_heartbeat(bigint,text,text,text,text,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_runtime_heartbeat(bigint,text,text,text,text,uuid,jsonb,jsonb,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_operational_alerts_for_org(p_organizations_id bigint)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_user bigint;v_count integer:=0;v_value bigint;v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT o.legacy_scope_users_id INTO v_user FROM public.organizations o WHERE o.organizations_id=p_organizations_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT count(*) INTO v_value FROM public.queue_items qi
  WHERE qi.organizations_id=p_organizations_id AND qi.status_id=4
    AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<v_now-interval '15 minutes';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'stale_queue_items','queues','critical','Itens travados em processamento',v_value||' item(ns) estão processando há mais de 15 minutos.',jsonb_build_object('count',v_value,'category','queue_item'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='stale_queue_items' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=p_organizations_id AND p.queue_item_dispatch_parts_state='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'whatsapp_reconciliation','worker','warning','WhatsApp requer reconciliação',v_value||' parte(s) possuem resultado incerto.',jsonb_build_object('count',v_value,'category','executor'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='whatsapp_reconciliation' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value FROM public.instagram_queue_progress p WHERE p.organizations_id=p_organizations_id AND p.canonical_step='reconciliation_required';
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'instagram_reconciliation','instagram','warning','Instagram requer reconciliação',v_value||' item(ns) possuem resultado incerto.',jsonb_build_object('count',v_value,'category','executor'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='instagram_reconciliation' AND status<>'resolved'; END IF;

  IF EXISTS(SELECT 1 FROM public.organization_tools t WHERE t.organizations_id=p_organizations_id AND t.tool_id='vinsansi_whatsapp_manager' AND t.enabled) THEN
    SELECT count(*) INTO v_value FROM public.platform_runtime_heartbeats h
    WHERE h.organizations_id=p_organizations_id AND h.component_type='worker'
      AND h.last_seen_at>v_now-interval '2 minutes' AND h.runtime_status IN('online','degraded');
    IF v_value=0 THEN
      INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
      VALUES(v_user,p_organizations_id,'worker_heartbeat_missing','worker','critical','Worker sem heartbeat','Nenhum Worker da organização comunicou nos últimos 2 minutos.',jsonb_build_object('category','infrastructure'))
      ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
      v_count:=v_count+1;
    ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='worker_heartbeat_missing' AND status<>'resolved'; END IF;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='worker_heartbeat_missing' AND status<>'resolved'; END IF;

  SELECT count(*) INTO v_value
  FROM public.organization_tool_installations i
  JOIN public.organization_tools t ON t.organizations_id=i.organizations_id AND t.tool_id=i.tool_id AND t.enabled
  WHERE i.organizations_id=p_organizations_id AND i.registration_status='registered' AND i.is_current
    AND i.tool_id IN('vinsansi_capture','vinsansi_instagram','vinsansi_whatsapp_manager')
    AND (i.last_seen_at IS NULL OR i.last_seen_at<v_now-interval '3 minutes');
  IF v_value>0 THEN
    INSERT INTO public.operational_alerts(users_id,organizations_id,alert_key,source,severity,title,message,metadata)
    VALUES(v_user,p_organizations_id,'tool_installation_stale','tools','warning','Ferramenta local sem comunicação',v_value||' instalação(ões) corrente(s) não comunicaram nos últimos 3 minutos.',jsonb_build_object('count',v_value,'category','infrastructure'))
    ON CONFLICT(organizations_id,alert_key) DO UPDATE SET status='open',first_detected_at=CASE WHEN public.operational_alerts.status='resolved' THEN v_now ELSE public.operational_alerts.first_detected_at END,last_detected_at=v_now,acknowledged_at=NULL,resolved_at=NULL,message=excluded.message,metadata=excluded.metadata;
    v_count:=v_count+1;
  ELSE UPDATE public.operational_alerts SET status='resolved',resolved_at=v_now WHERE organizations_id=p_organizations_id AND alert_key='tool_installation_stale' AND status<>'resolved'; END IF;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.refresh_operational_alerts_for_org(bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint:=public.current_organization_id();v_result jsonb;
BEGIN
  PERFORM public.require_organization_permission('monitoring.view');
  PERFORM public.refresh_operational_alerts_for_org(v_org);
  SELECT jsonb_build_object(
    'checkedAt',clock_timestamp(),'organizationId',v_org,
    'workers',jsonb_build_object(
      'online',(SELECT count(*) FROM public.platform_runtime_heartbeats h WHERE h.organizations_id=v_org AND h.component_type='worker' AND h.last_seen_at>now()-interval '2 minutes' AND h.runtime_status='online'),
      'stale',(SELECT count(*) FROM public.platform_runtime_heartbeats h WHERE h.organizations_id=v_org AND h.component_type='worker' AND (h.last_seen_at<=now()-interval '2 minutes' OR h.runtime_status IN('offline','error','incompatible')))
    ),
    'components',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'type',h.component_type,'key',h.component_key,'version',h.component_version,
      'status',CASE WHEN h.last_seen_at<=now()-interval '2 minutes' THEN 'offline' ELSE h.runtime_status END,
      'lastSeenAt',h.last_seen_at,'lastActivityAt',h.last_meaningful_activity_at,'metrics',h.metrics,'metadata',h.metadata
    ) ORDER BY h.component_type,h.component_key)
    FROM public.platform_runtime_heartbeats h
    WHERE h.organizations_id=v_org AND (
      h.organization_tool_installations_id IS NULL OR EXISTS(
        SELECT 1 FROM public.organization_tool_installations i
        WHERE i.organization_tool_installations_id=h.organization_tool_installations_id
          AND i.organizations_id=v_org AND i.registration_status='registered' AND i.is_current
      )
    )),'[]'::jsonb),
    'queues',jsonb_build_object(
      'pending',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=3),
      'processing',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=4),
      'staleProcessing',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=4 AND coalesce(qi.queue_items_started_at,qi.queue_items_updated_at)<now()-interval '15 minutes'),
      'errors',(SELECT count(*) FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.status_id=6)),
    'reconciliation',jsonb_build_object(
      'whatsapp',(SELECT count(*) FROM public.queue_item_dispatch_parts p WHERE p.organizations_id=v_org AND p.queue_item_dispatch_parts_state='reconciliation_required'),
      'instagram',(SELECT count(*) FROM public.instagram_queue_progress p WHERE p.organizations_id=v_org AND p.canonical_step='reconciliation_required')),
    'batches',jsonb_build_object(
      'active',(SELECT count(*) FROM public.worker_batches b WHERE b.organizations_id=v_org AND b.status_id IN(3,4,8)),
      'stale',(SELECT count(*) FROM public.worker_batches b WHERE b.organizations_id=v_org AND b.status_id=4 AND coalesce(b.worker_batches_heartbeat_at,b.worker_batches_started_at,b.worker_batches_updated_at,b.worker_batches_created_at)<now()-interval '15 minutes')),
    'tools',jsonb_build_object(
      'registered',(SELECT count(*) FROM public.organization_tool_installations i WHERE i.organizations_id=v_org AND i.registration_status='registered' AND i.is_current),
      'stale',(SELECT count(*) FROM public.organization_tool_installations i JOIN public.organization_tools t ON t.organizations_id=i.organizations_id AND t.tool_id=i.tool_id AND t.enabled WHERE i.organizations_id=v_org AND i.registration_status='registered' AND i.is_current AND (i.last_seen_at IS NULL OR i.last_seen_at<now()-interval '3 minutes')),
      'historical',(SELECT count(*) FROM public.organization_tool_installations i WHERE i.organizations_id=v_org AND NOT i.is_current)),
    'alerts',jsonb_build_object(
      'open',(SELECT count(*) FROM public.operational_alerts a WHERE a.organizations_id=v_org AND a.status<>'resolved'),
      'critical',(SELECT count(*) FROM public.operational_alerts a WHERE a.organizations_id=v_org AND a.status<>'resolved' AND a.severity='critical')),
    'latestRecovery',(SELECT to_jsonb(r) FROM public.recovery_requests r WHERE r.organizations_id=v_org ORDER BY r.requested_at DESC LIMIT 1)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_operational_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operational_health() TO authenticated;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_tools' AND column_name='latest_version') THEN
    EXECUTE $sql$UPDATE public.platform_tools SET latest_version='1.3.3' WHERE tool_id='vinsansi_whatsapp_manager'$sql$;
  END IF;
  IF to_regclass('public.platform_release_channels') IS NOT NULL THEN
    EXECUTE $sql$UPDATE public.platform_release_channels SET latest_version='1.3.3',updated_at=now() WHERE component_key='manager'$sql$;
  END IF;
END $$;

COMMIT;
