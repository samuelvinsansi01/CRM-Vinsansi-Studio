\set ON_ERROR_STOP on

SELECT set_config('app.organization_id','10',false);
SELECT set_config('app.auth_role','authenticated',false);

DO $$
DECLARE h jsonb;
BEGIN
  IF (SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=10 AND is_current)<>4 THEN
    RAISE EXCEPTION 'current_installation_backfill_wrong';
  END IF;
  IF (SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=10 AND NOT is_current)<>3 THEN
    RAISE EXCEPTION 'historical_installations_not_preserved';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations WHERE external_installation_id='instagram-beta-current' AND is_current AND operational_slot='profile:beta') THEN
    RAISE EXCEPTION 'parallel_instagram_profile_was_superseded';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tool_installation_credentials c JOIN public.organization_tool_installations i USING(organization_tool_installations_id) WHERE NOT i.is_current AND c.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'historical_credential_still_active';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tool_user_sessions s JOIN public.organization_tool_installations i USING(organization_tool_installations_id) WHERE NOT i.is_current AND s.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'historical_session_still_active';
  END IF;
  h:=public.get_operational_health();
  IF (h#>>'{tools,registered}')::integer<>4 OR (h#>>'{tools,historical}')::integer<>3 OR (h#>>'{tools,stale}')::integer<>0 THEN
    RAISE EXCEPTION 'historical_installation_polluted_health:%',h;
  END IF;
  IF jsonb_array_length(h->'components')<>5 THEN RAISE EXCEPTION 'historical_components_visible:%',h; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(h->'components') c WHERE c->>'key' IN('capture-old','instagram-alpha-old','manager-old')) THEN
    RAISE EXCEPTION 'historical_component_visible:%',h;
  END IF;
  IF EXISTS(SELECT 1 FROM public.operational_alerts WHERE organizations_id=10 AND alert_key='tool_installation_stale' AND status<>'resolved') THEN
    RAISE EXCEPTION 'historical_tool_alert_open';
  END IF;
END $$;

-- Só a instalação corrente ausente gera o alerta agregado; retries não duplicam.
UPDATE public.organization_tool_installations SET last_seen_at=now()-interval '4 minutes'
WHERE external_installation_id='capture-current';
SELECT public.get_operational_health();
SELECT public.get_operational_health();
DO $$
BEGIN
  IF (SELECT count(*) FROM public.operational_alerts WHERE organizations_id=10 AND alert_key='tool_installation_stale')<>1 THEN
    RAISE EXCEPTION 'r21_alert_dedup_regressed';
  END IF;
  IF (SELECT metadata->>'count' FROM public.operational_alerts WHERE organizations_id=10 AND alert_key='tool_installation_stale')<>'1' THEN
    RAISE EXCEPTION 'historical_rows_counted_in_alert';
  END IF;
END $$;
UPDATE public.organization_tool_installations SET last_seen_at=now() WHERE external_installation_id='capture-current';
SELECT public.get_operational_health();
DO $$ BEGIN
  IF (SELECT status FROM public.operational_alerts WHERE organizations_id=10 AND alert_key='tool_installation_stale')<>'resolved' THEN
    RAISE EXCEPTION 'tool_alert_not_resolved';
  END IF;
END $$;

-- Novo ID/versão substitui apenas o slot correspondente e preserva o inventário.
SELECT set_config('app.auth_role','service_role',false);
SELECT public.service_register_tool_installation(10,'vinsansi_capture','capture-r22','1.0.11',ARRAY['capture.maps'],NULL,'{"operationalSlot":"primary"}');
DO $$
DECLARE current_id uuid;
BEGIN
  SELECT organization_tool_installations_id INTO current_id FROM public.organization_tool_installations
  WHERE organizations_id=10 AND tool_id='vinsansi_capture' AND is_current;
  IF current_id<>(SELECT organization_tool_installations_id FROM public.organization_tool_installations WHERE external_installation_id='capture-r22') THEN
    RAISE EXCEPTION 'new_capture_not_promoted';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations WHERE external_installation_id='capture-current' AND NOT is_current AND superseded_by_installation_id=current_id) THEN
    RAISE EXCEPTION 'previous_capture_not_linked_as_history';
  END IF;
  IF (SELECT revoked_at FROM public.tool_installation_credentials WHERE credential_hash=repeat('2',64)) IS NULL THEN
    RAISE EXCEPTION 'replaced_current_credential_not_revoked';
  END IF;
  BEGIN
    PERFORM public.service_touch_tool_installation(10,'vinsansi_capture','capture-current',true,false,NULL,NULL,NULL);
    RAISE EXCEPTION 'historical_installation_touched';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'tool_installation_not_current' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.service_runtime_heartbeat(10,'capture','capture-old-retry','1.0.8','online','10000000-0000-0000-0000-000000000001','{}','{}',false);
    RAISE EXCEPTION 'historical_runtime_heartbeat_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'runtime_installation_not_current' THEN RAISE; END IF;
  END;
END $$;

-- Um perfil Instagram novo não substitui outro perfil legitimamente corrente.
SELECT public.service_register_tool_installation(10,'vinsansi_instagram','instagram-alpha-r22','2.0.6',ARRAY['instagram.dispatch'],NULL,'{"instagramProfile":"alpha","operationalSlot":"profile:alpha"}');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations WHERE external_installation_id='instagram-alpha-r22' AND is_current) THEN RAISE EXCEPTION 'instagram_alpha_not_promoted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_tool_installations WHERE external_installation_id='instagram-beta-current' AND is_current) THEN RAISE EXCEPTION 'instagram_beta_wrongly_superseded'; END IF;
  IF (SELECT count(*) FROM public.organization_tool_installations WHERE organizations_id=10 AND tool_id='vinsansi_instagram' AND is_current)<>2 THEN RAISE EXCEPTION 'instagram_current_slots_wrong'; END IF;
END $$;

SELECT set_config('app.auth_role','authenticated',false);
SELECT 'stage11_r22_integration_pass' AS result;

