-- STAGING-ONLY. NUNCA execute este arquivo em producao.
--
-- 1. Substitua REPLACE_WITH_STAGING_AUTH_USER_ID pelo auth.users.id do usuario
--    controlado que ja existe no staging.
-- 2. Substitua REPLACE_WITH_COMPLETE_STAGING_SEED_EXPORT_JSON pelo objeto JSON
--    completo retornado por scripts/export-staging-seed-data.sql.
-- 3. Substitua REPLACE_WITH_STAGING_ONLY_CONFIRMATION por STAGING_ONLY.
--
-- O seed nao pertence a supabase/migrations. Ele nao copia users_id da origem,
-- nao apaga dados e aborta diante de qualquer divergencia.

BEGIN;

CREATE TEMP TABLE staging_seed_status (
  status_id bigint PRIMARY KEY,
  status_name text NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_channels (
  channels_id bigint PRIMARY KEY,
  channels_name text NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_lead_status (
  lead_status_id bigint PRIMARY KEY,
  lead_status_name text NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_countries (
  countries_id bigint PRIMARY KEY,
  countries_name text NOT NULL,
  countries_code text NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_states (
  states_id bigint PRIMARY KEY,
  countries_id bigint NOT NULL,
  states_name text NOT NULL,
  states_code text,
  UNIQUE (countries_id, states_name),
  UNIQUE (countries_id, states_code)
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_cities (
  cities_id bigint PRIMARY KEY,
  states_id bigint NOT NULL,
  cities_name text NOT NULL,
  UNIQUE (states_id, cities_name)
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_validation_results (
  lead_validation_results_id bigint PRIMARY KEY,
  lead_validation_results_key text NOT NULL UNIQUE,
  lead_validation_results_name text NOT NULL,
  status_id bigint NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_audit_rules (
  audit_transition_rules_id bigint PRIMARY KEY,
  entity_type text NOT NULL,
  from_status_id bigint NOT NULL,
  to_status_id bigint NOT NULL,
  action_key text NOT NULL,
  is_active boolean NOT NULL,
  UNIQUE (entity_type, from_status_id, to_status_id)
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_branches (
  source_branches_id bigint PRIMARY KEY,
  status_id bigint NOT NULL,
  branches_name text NOT NULL UNIQUE,
  branches_categories jsonb
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_contact_sources (
  source_contact_sources_id bigint PRIMARY KEY,
  status_id bigint NOT NULL,
  contact_sources_name text NOT NULL UNIQUE,
  contact_sources_key text NOT NULL UNIQUE,
  contact_sources_requires_review boolean NOT NULL,
  contact_sources_default_channel_id bigint
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_levels (
  source_levels_id bigint PRIMARY KEY,
  channels_id bigint NOT NULL,
  status_id bigint NOT NULL,
  levels_name text NOT NULL,
  levels_daily_limit integer NOT NULL,
  levels_queues integer,
  UNIQUE (channels_id, levels_name)
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_template_channels (
  source_template_channels_id bigint PRIMARY KEY,
  status_id bigint NOT NULL,
  template_channels_name text NOT NULL UNIQUE,
  template_channels_blocked_channels bigint[] NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_template_types (
  source_template_types_id bigint PRIMARY KEY,
  status_id bigint NOT NULL,
  template_types_name text NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_template_variables (
  source_template_variables_id bigint PRIMARY KEY,
  status_id bigint NOT NULL,
  template_variables_name text NOT NULL,
  template_variables_key text NOT NULL UNIQUE,
  template_variables_source text NOT NULL,
  template_variables_default_value text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_templates (
  source_templates_id bigint PRIMARY KEY,
  source_branches_id bigint NOT NULL,
  status_id bigint NOT NULL,
  source_template_channels_id bigint NOT NULL,
  source_template_types_id bigint NOT NULL,
  templates_name text NOT NULL UNIQUE,
  templates_message_1 text NOT NULL,
  templates_message_2 text NOT NULL,
  templates_message_3 text NOT NULL,
  templates_message_4 text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_branch_map (
  source_id bigint PRIMARY KEY,
  target_id bigint NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_template_channel_map (
  source_id bigint PRIMARY KEY,
  target_id bigint NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE staging_seed_template_type_map (
  source_id bigint PRIMARY KEY,
  target_id bigint NOT NULL UNIQUE
) ON COMMIT DROP;

DO $staging_seed$
DECLARE
  v_snapshot jsonb := $snapshot$
REPLACE_WITH_COMPLETE_STAGING_SEED_EXPORT_JSON
$snapshot$::jsonb;
  v_target_auth_user_id uuid := 'REPLACE_WITH_STAGING_AUTH_USER_ID'::uuid;
  v_confirmation text := 'REPLACE_WITH_STAGING_ONLY_CONFIRMATION';
  v_target_users_id bigint;
  v_sequence text;
  v_key text;
BEGIN
  IF v_confirmation <> 'STAGING_ONLY' THEN
    RAISE EXCEPTION 'staging_confirmation_required';
  END IF;

  IF jsonb_typeof(v_snapshot) <> 'object'
     OR jsonb_typeof(v_snapshot -> 'canonical') <> 'object'
     OR jsonb_typeof(v_snapshot -> 'tenant') <> 'object' THEN
    RAISE EXCEPTION 'invalid_staging_seed_export_shape';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_snapshot)
  LOOP
    IF v_key NOT IN ('canonical', 'tenant') THEN
      RAISE EXCEPTION 'unexpected_top_level_key: %', v_key;
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_snapshot -> 'canonical')
  LOOP
    IF v_key NOT IN (
      'audit_transition_rules', 'channels', 'cities', 'countries',
      'lead_status', 'lead_validation_results', 'states', 'status'
    ) THEN
      RAISE EXCEPTION 'unexpected_canonical_key: %', v_key;
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_snapshot -> 'tenant')
  LOOP
    IF v_key NOT IN (
      'branches', 'contact_sources', 'levels', 'template_channels',
      'template_types', 'template_variables', 'templates'
    ) THEN
      RAISE EXCEPTION 'unexpected_tenant_key: %', v_key;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY[
    'audit_transition_rules', 'channels', 'cities', 'countries',
    'lead_status', 'lead_validation_results', 'states', 'status'
  ]
  LOOP
    IF jsonb_typeof(v_snapshot -> 'canonical' -> v_key) <> 'array' THEN
      RAISE EXCEPTION 'missing_or_invalid_canonical_array: %', v_key;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY[
    'branches', 'contact_sources', 'levels', 'template_channels',
    'template_types', 'template_variables', 'templates'
  ]
  LOOP
    IF jsonb_typeof(v_snapshot -> 'tenant' -> v_key) <> 'array' THEN
      RAISE EXCEPTION 'missing_or_invalid_tenant_array: %', v_key;
    END IF;
  END LOOP;

  SELECT u.users_id
  INTO STRICT v_target_users_id
  FROM public.users AS u
  WHERE u.auth_user_id = v_target_auth_user_id;

  INSERT INTO staging_seed_status
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,status}') AS x(
    status_id bigint, status_name text
  );
  INSERT INTO staging_seed_channels
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,channels}') AS x(
    channels_id bigint, channels_name text
  );
  INSERT INTO staging_seed_lead_status
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,lead_status}') AS x(
    lead_status_id bigint, lead_status_name text
  );
  INSERT INTO staging_seed_countries
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,countries}') AS x(
    countries_id bigint, countries_name text, countries_code text
  );
  INSERT INTO staging_seed_states
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,states}') AS x(
    states_id bigint, countries_id bigint, states_name text, states_code text
  );
  INSERT INTO staging_seed_cities
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,cities}') AS x(
    cities_id bigint, states_id bigint, cities_name text
  );
  INSERT INTO staging_seed_validation_results
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,lead_validation_results}') AS x(
    lead_validation_results_id bigint,
    lead_validation_results_key text,
    lead_validation_results_name text,
    status_id bigint
  );
  INSERT INTO staging_seed_audit_rules
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{canonical,audit_transition_rules}') AS x(
    audit_transition_rules_id bigint,
    entity_type text,
    from_status_id bigint,
    to_status_id bigint,
    action_key text,
    is_active boolean
  );

  INSERT INTO staging_seed_branches
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,branches}') AS x(
    source_branches_id bigint,
    status_id bigint,
    branches_name text,
    branches_categories jsonb
  );
  INSERT INTO staging_seed_contact_sources
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,contact_sources}') AS x(
    source_contact_sources_id bigint,
    status_id bigint,
    contact_sources_name text,
    contact_sources_key text,
    contact_sources_requires_review boolean,
    contact_sources_default_channel_id bigint
  );
  INSERT INTO staging_seed_levels
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,levels}') AS x(
    source_levels_id bigint,
    channels_id bigint,
    status_id bigint,
    levels_name text,
    levels_daily_limit integer,
    levels_queues integer
  );
  INSERT INTO staging_seed_template_channels
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,template_channels}') AS x(
    source_template_channels_id bigint,
    status_id bigint,
    template_channels_name text,
    template_channels_blocked_channels bigint[]
  );
  INSERT INTO staging_seed_template_types
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,template_types}') AS x(
    source_template_types_id bigint,
    status_id bigint,
    template_types_name text
  );
  INSERT INTO staging_seed_template_variables
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,template_variables}') AS x(
    source_template_variables_id bigint,
    status_id bigint,
    template_variables_name text,
    template_variables_key text,
    template_variables_source text,
    template_variables_default_value text
  );
  INSERT INTO staging_seed_templates
  SELECT * FROM jsonb_to_recordset(v_snapshot #> '{tenant,templates}') AS x(
    source_templates_id bigint,
    source_branches_id bigint,
    status_id bigint,
    source_template_channels_id bigint,
    source_template_types_id bigint,
    templates_name text,
    templates_message_1 text,
    templates_message_2 text,
    templates_message_3 text,
    templates_message_4 text
  );

  IF NOT EXISTS (SELECT 1 FROM staging_seed_status)
     OR NOT EXISTS (SELECT 1 FROM staging_seed_channels)
     OR NOT EXISTS (SELECT 1 FROM staging_seed_countries)
     OR NOT EXISTS (SELECT 1 FROM staging_seed_states)
     OR NOT EXISTS (SELECT 1 FROM staging_seed_cities) THEN
    RAISE EXCEPTION 'required_canonical_catalog_is_empty';
  END IF;

  IF (SELECT count(*) FROM staging_seed_contact_sources) <> 4
     OR EXISTS (
       SELECT 1 FROM staging_seed_contact_sources
       WHERE contact_sources_key NOT IN ('sem_site', 'dominio_proprio', 'agregador', 'instagram')
     )
     OR EXISTS (
       SELECT expected.key
       FROM (VALUES ('sem_site'), ('dominio_proprio'), ('agregador'), ('instagram')) AS expected(key)
       WHERE NOT EXISTS (
         SELECT 1 FROM staging_seed_contact_sources AS source
         WHERE source.contact_sources_key = expected.key
       )
     ) THEN
    RAISE EXCEPTION 'contact_sources_do_not_match_canonical_snapshot_contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM staging_seed_template_variables
    WHERE template_variables_default_value IS DISTINCT FROM '[STAGING]'
  ) THEN
    RAISE EXCEPTION 'template_variables_are_not_sanitized';
  END IF;

  IF EXISTS (
    SELECT 1 FROM staging_seed_templates
    WHERE templates_message_1 IS DISTINCT FROM '[STAGING] Mensagem 1 para {EMPRESA}'
       OR templates_message_2 IS DISTINCT FROM '[STAGING] Mensagem 2 para {EMPRESA}'
       OR templates_message_3 IS DISTINCT FROM '[STAGING] Mensagem 3 para {EMPRESA}'
       OR templates_message_4 IS DISTINCT FROM '[STAGING] Mensagem 4 para {EMPRESA}'
  ) THEN
    RAISE EXCEPTION 'templates_are_not_sanitized';
  END IF;

  IF EXISTS (
    SELECT 1 FROM staging_seed_states AS child
    LEFT JOIN staging_seed_countries AS parent ON parent.countries_id = child.countries_id
    WHERE parent.countries_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM staging_seed_cities AS child
    LEFT JOIN staging_seed_states AS parent ON parent.states_id = child.states_id
    WHERE parent.states_id IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_location_relationship_in_snapshot';
  END IF;

  IF EXISTS (
    SELECT 1 FROM staging_seed_templates AS child
    LEFT JOIN staging_seed_branches AS branch ON branch.source_branches_id = child.source_branches_id
    LEFT JOIN staging_seed_template_channels AS channel ON channel.source_template_channels_id = child.source_template_channels_id
    LEFT JOIN staging_seed_template_types AS type ON type.source_template_types_id = child.source_template_types_id
    WHERE branch.source_branches_id IS NULL
       OR channel.source_template_channels_id IS NULL
       OR type.source_template_types_id IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_template_relationship_in_snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM staging_seed_contact_sources AS source
    LEFT JOIN staging_seed_channels AS channel ON channel.channels_id = source.contact_sources_default_channel_id
    WHERE source.contact_sources_default_channel_id IS NOT NULL
      AND channel.channels_id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM staging_seed_levels AS source
    LEFT JOIN staging_seed_channels AS channel ON channel.channels_id = source.channels_id
    WHERE channel.channels_id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM staging_seed_template_channels AS source
    CROSS JOIN LATERAL unnest(source.template_channels_blocked_channels) AS blocked(channels_id)
    LEFT JOIN staging_seed_channels AS channel ON channel.channels_id = blocked.channels_id
    WHERE channel.channels_id IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_channel_relationship_in_snapshot';
  END IF;

  -- Catálogos globais: mesmo ID/natural key divergente aborta; IDs ausentes
  -- sao inseridos exatamente como vieram no snapshot.
  IF EXISTS (
    SELECT 1 FROM public.status AS target
    JOIN staging_seed_status AS source USING (status_id)
    WHERE target.status_name IS DISTINCT FROM source.status_name
  ) OR EXISTS (
    SELECT 1 FROM public.status AS target
    JOIN staging_seed_status AS source ON source.status_name = target.status_name
    WHERE target.status_id <> source.status_id
  ) THEN RAISE EXCEPTION 'status_catalog_divergence'; END IF;
  INSERT INTO public.status (status_id, status_name)
  SELECT source.status_id, source.status_name
  FROM staging_seed_status AS source
  WHERE NOT EXISTS (SELECT 1 FROM public.status AS target WHERE target.status_id = source.status_id);

  IF EXISTS (
    SELECT 1 FROM public.channels AS target
    JOIN staging_seed_channels AS source USING (channels_id)
    WHERE target.channels_name IS DISTINCT FROM source.channels_name
  ) OR EXISTS (
    SELECT 1 FROM public.channels AS target
    JOIN staging_seed_channels AS source ON source.channels_name = target.channels_name
    WHERE target.channels_id <> source.channels_id
  ) THEN RAISE EXCEPTION 'channels_catalog_divergence'; END IF;
  INSERT INTO public.channels (channels_id, channels_name)
  SELECT source.channels_id, source.channels_name
  FROM staging_seed_channels AS source
  WHERE NOT EXISTS (SELECT 1 FROM public.channels AS target WHERE target.channels_id = source.channels_id);

  IF EXISTS (
    SELECT 1 FROM public.lead_status AS target
    JOIN staging_seed_lead_status AS source USING (lead_status_id)
    WHERE target.lead_status_name IS DISTINCT FROM source.lead_status_name
  ) OR EXISTS (
    SELECT 1 FROM public.lead_status AS target
    JOIN staging_seed_lead_status AS source ON source.lead_status_name = target.lead_status_name
    WHERE target.lead_status_id <> source.lead_status_id
  ) THEN RAISE EXCEPTION 'lead_status_catalog_divergence'; END IF;
  INSERT INTO public.lead_status (lead_status_id, lead_status_name)
  SELECT source.lead_status_id, source.lead_status_name
  FROM staging_seed_lead_status AS source
  WHERE NOT EXISTS (SELECT 1 FROM public.lead_status AS target WHERE target.lead_status_id = source.lead_status_id);

  IF EXISTS (
    SELECT 1 FROM public.countries AS target
    JOIN staging_seed_countries AS source USING (countries_id)
    WHERE target.countries_name IS DISTINCT FROM source.countries_name
       OR target.countries_code IS DISTINCT FROM source.countries_code
  ) OR EXISTS (
    SELECT 1 FROM public.countries AS target
    JOIN staging_seed_countries AS source ON source.countries_code = target.countries_code
    WHERE target.countries_id <> source.countries_id
       OR target.countries_name IS DISTINCT FROM source.countries_name
  ) THEN RAISE EXCEPTION 'countries_catalog_divergence'; END IF;
  INSERT INTO public.countries (countries_id, countries_name, countries_code)
  SELECT source.countries_id, source.countries_name, source.countries_code
  FROM staging_seed_countries AS source
  WHERE NOT EXISTS (SELECT 1 FROM public.countries AS target WHERE target.countries_id = source.countries_id);

  IF EXISTS (
    SELECT 1 FROM public.states AS target
    JOIN staging_seed_states AS source USING (states_id)
    WHERE target.countries_id IS DISTINCT FROM source.countries_id
       OR target.states_name IS DISTINCT FROM source.states_name
       OR target.states_code IS DISTINCT FROM source.states_code
  ) OR EXISTS (
    SELECT 1 FROM public.states AS target
    JOIN staging_seed_states AS source
      ON source.countries_id = target.countries_id
     AND source.states_name = target.states_name
    WHERE target.states_id <> source.states_id
       OR target.states_code IS DISTINCT FROM source.states_code
  ) THEN RAISE EXCEPTION 'states_catalog_divergence'; END IF;
  INSERT INTO public.states (states_id, countries_id, states_name, states_code)
  SELECT source.states_id, source.countries_id, source.states_name, source.states_code
  FROM staging_seed_states AS source
  WHERE NOT EXISTS (SELECT 1 FROM public.states AS target WHERE target.states_id = source.states_id);

  IF EXISTS (
    SELECT 1 FROM public.cities AS target
    JOIN staging_seed_cities AS source USING (cities_id)
    WHERE target.states_id IS DISTINCT FROM source.states_id
       OR target.cities_name IS DISTINCT FROM source.cities_name
  ) OR EXISTS (
    SELECT 1 FROM public.cities AS target
    JOIN staging_seed_cities AS source
      ON source.states_id = target.states_id
     AND source.cities_name = target.cities_name
    WHERE target.cities_id <> source.cities_id
  ) THEN RAISE EXCEPTION 'cities_catalog_divergence'; END IF;
  INSERT INTO public.cities (cities_id, states_id, cities_name)
  SELECT source.cities_id, source.states_id, source.cities_name
  FROM staging_seed_cities AS source
  WHERE NOT EXISTS (SELECT 1 FROM public.cities AS target WHERE target.cities_id = source.cities_id);

  IF EXISTS (
    SELECT 1 FROM public.lead_validation_results AS target
    JOIN staging_seed_validation_results AS source USING (lead_validation_results_id)
    WHERE target.lead_validation_results_key IS DISTINCT FROM source.lead_validation_results_key
       OR target.lead_validation_results_name IS DISTINCT FROM source.lead_validation_results_name
       OR target.status_id IS DISTINCT FROM source.status_id
  ) OR EXISTS (
    SELECT 1 FROM public.lead_validation_results AS target
    JOIN staging_seed_validation_results AS source
      ON source.lead_validation_results_key = target.lead_validation_results_key
    WHERE target.lead_validation_results_id <> source.lead_validation_results_id
       OR target.lead_validation_results_name IS DISTINCT FROM source.lead_validation_results_name
       OR target.status_id IS DISTINCT FROM source.status_id
  ) THEN RAISE EXCEPTION 'lead_validation_results_catalog_divergence'; END IF;
  INSERT INTO public.lead_validation_results (
    lead_validation_results_id, lead_validation_results_key,
    lead_validation_results_name, status_id
  )
  SELECT source.lead_validation_results_id, source.lead_validation_results_key,
         source.lead_validation_results_name, source.status_id
  FROM staging_seed_validation_results AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lead_validation_results AS target
    WHERE target.lead_validation_results_id = source.lead_validation_results_id
  );

  IF EXISTS (
    SELECT 1 FROM public.audit_transition_rules AS target
    JOIN staging_seed_audit_rules AS source USING (audit_transition_rules_id)
    WHERE target.entity_type IS DISTINCT FROM source.entity_type
       OR target.from_status_id IS DISTINCT FROM source.from_status_id
       OR target.to_status_id IS DISTINCT FROM source.to_status_id
       OR target.action_key IS DISTINCT FROM source.action_key
       OR target.is_active IS DISTINCT FROM source.is_active
  ) OR EXISTS (
    SELECT 1 FROM public.audit_transition_rules AS target
    JOIN staging_seed_audit_rules AS source
      ON source.entity_type = target.entity_type
     AND source.from_status_id = target.from_status_id
     AND source.to_status_id = target.to_status_id
    WHERE target.audit_transition_rules_id <> source.audit_transition_rules_id
       OR target.action_key IS DISTINCT FROM source.action_key
       OR target.is_active IS DISTINCT FROM source.is_active
  ) THEN RAISE EXCEPTION 'audit_transition_rules_catalog_divergence'; END IF;
  INSERT INTO public.audit_transition_rules (
    audit_transition_rules_id, entity_type, from_status_id,
    to_status_id, action_key, is_active
  )
  SELECT source.audit_transition_rules_id, source.entity_type, source.from_status_id,
         source.to_status_id, source.action_key, source.is_active
  FROM staging_seed_audit_rules AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_transition_rules AS target
    WHERE target.audit_transition_rules_id = source.audit_transition_rules_id
  );

  IF (SELECT count(*) FROM public.status) <> (SELECT count(*) FROM staging_seed_status)
     OR (SELECT count(*) FROM public.channels) <> (SELECT count(*) FROM staging_seed_channels)
     OR (SELECT count(*) FROM public.lead_status) <> (SELECT count(*) FROM staging_seed_lead_status)
     OR (SELECT count(*) FROM public.countries) <> (SELECT count(*) FROM staging_seed_countries)
     OR (SELECT count(*) FROM public.states) <> (SELECT count(*) FROM staging_seed_states)
     OR (SELECT count(*) FROM public.cities) <> (SELECT count(*) FROM staging_seed_cities)
     OR (SELECT count(*) FROM public.lead_validation_results) <> (SELECT count(*) FROM staging_seed_validation_results)
     OR (SELECT count(*) FROM public.audit_transition_rules) <> (SELECT count(*) FROM staging_seed_audit_rules) THEN
    RAISE EXCEPTION 'global_catalog_contains_rows_outside_snapshot';
  END IF;

  -- Tenant: o conjunto existente deve ser vazio ou identico ao snapshot. IDs
  -- locais sao gerados no staging e registrados em mapas temporarios.
  IF EXISTS (
    SELECT 1 FROM public.branches AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (SELECT 1 FROM staging_seed_branches AS source WHERE source.branches_name = target.branches_name)
  ) OR EXISTS (
    SELECT 1 FROM public.branches AS target
    JOIN staging_seed_branches AS source ON source.branches_name = target.branches_name
    WHERE target.users_id = v_target_users_id
      AND (target.status_id IS DISTINCT FROM source.status_id
        OR target.branches_categories IS DISTINCT FROM source.branches_categories)
  ) THEN RAISE EXCEPTION 'branches_tenant_divergence'; END IF;
  INSERT INTO public.branches (users_id, status_id, branches_name, branches_categories)
  SELECT v_target_users_id, source.status_id, source.branches_name, source.branches_categories
  FROM staging_seed_branches AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.branches AS target
    WHERE target.users_id = v_target_users_id AND target.branches_name = source.branches_name
  );
  INSERT INTO staging_seed_branch_map (source_id, target_id)
  SELECT source.source_branches_id, target.branches_id
  FROM staging_seed_branches AS source
  JOIN public.branches AS target
    ON target.users_id = v_target_users_id AND target.branches_name = source.branches_name;

  IF EXISTS (
    SELECT 1 FROM public.contact_sources AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (SELECT 1 FROM staging_seed_contact_sources AS source WHERE source.contact_sources_key = target.contact_sources_key)
  ) OR EXISTS (
    SELECT 1 FROM public.contact_sources AS target
    JOIN staging_seed_contact_sources AS source ON source.contact_sources_key = target.contact_sources_key
    WHERE target.users_id = v_target_users_id
      AND (target.status_id IS DISTINCT FROM source.status_id
        OR target.contact_sources_name IS DISTINCT FROM source.contact_sources_name
        OR target.contact_sources_requires_review IS DISTINCT FROM source.contact_sources_requires_review
        OR target.contact_sources_default_channel_id IS DISTINCT FROM source.contact_sources_default_channel_id)
  ) THEN RAISE EXCEPTION 'contact_sources_tenant_divergence'; END IF;
  INSERT INTO public.contact_sources (
    users_id, status_id, contact_sources_name, contact_sources_key,
    contact_sources_requires_review, contact_sources_default_channel_id
  )
  SELECT v_target_users_id, source.status_id, source.contact_sources_name,
         source.contact_sources_key, source.contact_sources_requires_review,
         source.contact_sources_default_channel_id
  FROM staging_seed_contact_sources AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_sources AS target
    WHERE target.users_id = v_target_users_id
      AND target.contact_sources_key = source.contact_sources_key
  );

  IF EXISTS (
    SELECT 1 FROM public.levels AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (
        SELECT 1 FROM staging_seed_levels AS source
        WHERE source.channels_id = target.channels_id AND source.levels_name = target.levels_name
      )
  ) OR EXISTS (
    SELECT 1 FROM public.levels AS target
    JOIN staging_seed_levels AS source
      ON source.channels_id = target.channels_id AND source.levels_name = target.levels_name
    WHERE target.users_id = v_target_users_id
      AND (target.status_id IS DISTINCT FROM source.status_id
        OR target.levels_daily_limit IS DISTINCT FROM source.levels_daily_limit
        OR target.levels_queues IS DISTINCT FROM source.levels_queues)
  ) THEN RAISE EXCEPTION 'levels_tenant_divergence'; END IF;
  INSERT INTO public.levels (
    users_id, channels_id, status_id, levels_name, levels_daily_limit, levels_queues
  )
  SELECT v_target_users_id, source.channels_id, source.status_id,
         source.levels_name, source.levels_daily_limit, source.levels_queues
  FROM staging_seed_levels AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.levels AS target
    WHERE target.users_id = v_target_users_id
      AND target.channels_id = source.channels_id
      AND target.levels_name = source.levels_name
  );

  IF EXISTS (
    SELECT 1 FROM public.template_channels AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (
        SELECT 1 FROM staging_seed_template_channels AS source
        WHERE source.template_channels_name = target.template_channels_name
      )
  ) OR EXISTS (
    SELECT 1 FROM public.template_channels AS target
    JOIN staging_seed_template_channels AS source
      ON source.template_channels_name = target.template_channels_name
    WHERE target.users_id = v_target_users_id
      AND (target.status_id IS DISTINCT FROM source.status_id
        OR target.template_channels_blocked_channels IS DISTINCT FROM source.template_channels_blocked_channels)
  ) THEN RAISE EXCEPTION 'template_channels_tenant_divergence'; END IF;
  INSERT INTO public.template_channels (
    users_id, status_id, template_channels_name, template_channels_blocked_channels
  )
  SELECT v_target_users_id, source.status_id, source.template_channels_name,
         source.template_channels_blocked_channels
  FROM staging_seed_template_channels AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.template_channels AS target
    WHERE target.users_id = v_target_users_id
      AND target.template_channels_name = source.template_channels_name
  );
  INSERT INTO staging_seed_template_channel_map (source_id, target_id)
  SELECT source.source_template_channels_id, target.template_channels_id
  FROM staging_seed_template_channels AS source
  JOIN public.template_channels AS target
    ON target.users_id = v_target_users_id
   AND target.template_channels_name = source.template_channels_name;

  IF EXISTS (
    SELECT 1 FROM public.template_types AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (
        SELECT 1 FROM staging_seed_template_types AS source
        WHERE source.template_types_name = target.template_types_name
      )
  ) OR EXISTS (
    SELECT 1 FROM public.template_types AS target
    JOIN staging_seed_template_types AS source ON source.template_types_name = target.template_types_name
    WHERE target.users_id = v_target_users_id
      AND target.status_id IS DISTINCT FROM source.status_id
  ) THEN RAISE EXCEPTION 'template_types_tenant_divergence'; END IF;
  INSERT INTO public.template_types (users_id, status_id, template_types_name)
  SELECT v_target_users_id, source.status_id, source.template_types_name
  FROM staging_seed_template_types AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.template_types AS target
    WHERE target.users_id = v_target_users_id
      AND target.template_types_name = source.template_types_name
  );
  INSERT INTO staging_seed_template_type_map (source_id, target_id)
  SELECT source.source_template_types_id, target.template_types_id
  FROM staging_seed_template_types AS source
  JOIN public.template_types AS target
    ON target.users_id = v_target_users_id
   AND target.template_types_name = source.template_types_name;

  IF EXISTS (
    SELECT 1 FROM public.template_variables AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (
        SELECT 1 FROM staging_seed_template_variables AS source
        WHERE source.template_variables_key = target.template_variables_key
      )
  ) OR EXISTS (
    SELECT 1 FROM public.template_variables AS target
    JOIN staging_seed_template_variables AS source
      ON source.template_variables_key = target.template_variables_key
    WHERE target.users_id = v_target_users_id
      AND (target.status_id IS DISTINCT FROM source.status_id
        OR target.template_variables_name IS DISTINCT FROM source.template_variables_name
        OR target.template_variables_source IS DISTINCT FROM source.template_variables_source
        OR target.template_variables_default_value IS DISTINCT FROM source.template_variables_default_value)
  ) THEN RAISE EXCEPTION 'template_variables_tenant_divergence'; END IF;
  INSERT INTO public.template_variables (
    users_id, status_id, template_variables_name, template_variables_key,
    template_variables_source, template_variables_default_value
  )
  SELECT v_target_users_id, source.status_id, source.template_variables_name,
         source.template_variables_key, source.template_variables_source,
         source.template_variables_default_value
  FROM staging_seed_template_variables AS source
  WHERE NOT EXISTS (
    SELECT 1 FROM public.template_variables AS target
    WHERE target.users_id = v_target_users_id
      AND target.template_variables_key = source.template_variables_key
  );

  IF EXISTS (
    SELECT 1 FROM public.templates AS target
    WHERE target.users_id = v_target_users_id
      AND NOT EXISTS (SELECT 1 FROM staging_seed_templates AS source WHERE source.templates_name = target.templates_name)
  ) OR EXISTS (
    SELECT 1
    FROM public.templates AS target
    JOIN staging_seed_templates AS source ON source.templates_name = target.templates_name
    JOIN staging_seed_branch_map AS branch ON branch.source_id = source.source_branches_id
    JOIN staging_seed_template_channel_map AS channel ON channel.source_id = source.source_template_channels_id
    JOIN staging_seed_template_type_map AS type ON type.source_id = source.source_template_types_id
    WHERE target.users_id = v_target_users_id
      AND (target.branches_id IS DISTINCT FROM branch.target_id
        OR target.status_id IS DISTINCT FROM source.status_id
        OR target.template_channels_id IS DISTINCT FROM channel.target_id
        OR target.template_types_id IS DISTINCT FROM type.target_id
        OR target.templates_message_1 IS DISTINCT FROM source.templates_message_1
        OR target.templates_message_2 IS DISTINCT FROM source.templates_message_2
        OR target.templates_message_3 IS DISTINCT FROM source.templates_message_3
        OR target.templates_message_4 IS DISTINCT FROM source.templates_message_4)
  ) THEN RAISE EXCEPTION 'templates_tenant_divergence'; END IF;
  INSERT INTO public.templates (
    users_id, branches_id, status_id, template_channels_id, template_types_id,
    templates_name, templates_message_1, templates_message_2,
    templates_message_3, templates_message_4
  )
  SELECT v_target_users_id, branch.target_id, source.status_id,
         channel.target_id, type.target_id, source.templates_name,
         source.templates_message_1, source.templates_message_2,
         source.templates_message_3, source.templates_message_4
  FROM staging_seed_templates AS source
  JOIN staging_seed_branch_map AS branch ON branch.source_id = source.source_branches_id
  JOIN staging_seed_template_channel_map AS channel ON channel.source_id = source.source_template_channels_id
  JOIN staging_seed_template_type_map AS type ON type.source_id = source.source_template_types_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.templates AS target
    WHERE target.users_id = v_target_users_id AND target.templates_name = source.templates_name
  );

  IF (SELECT count(*) FROM public.contact_sources WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_contact_sources)
     OR (SELECT count(*) FROM public.branches WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_branches)
     OR (SELECT count(*) FROM public.levels WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_levels)
     OR (SELECT count(*) FROM public.template_channels WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_template_channels)
     OR (SELECT count(*) FROM public.template_types WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_template_types)
     OR (SELECT count(*) FROM public.template_variables WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_template_variables)
     OR (SELECT count(*) FROM public.templates WHERE users_id = v_target_users_id)
       <> (SELECT count(*) FROM staging_seed_templates) THEN
    RAISE EXCEPTION 'staging_tenant_seed_count_mismatch';
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'status', 'channels', 'lead_status', 'countries', 'states', 'cities',
    'lead_validation_results', 'audit_transition_rules'
  ]
  LOOP
    v_sequence := pg_get_serial_sequence(
      'public.' || v_key,
      CASE v_key
        WHEN 'status' THEN 'status_id'
        WHEN 'channels' THEN 'channels_id'
        WHEN 'lead_status' THEN 'lead_status_id'
        WHEN 'countries' THEN 'countries_id'
        WHEN 'states' THEN 'states_id'
        WHEN 'cities' THEN 'cities_id'
        WHEN 'lead_validation_results' THEN 'lead_validation_results_id'
        ELSE 'audit_transition_rules_id'
      END
    );
    IF v_sequence IS NOT NULL THEN
      EXECUTE format(
        'SELECT pg_catalog.setval(%L::regclass, greatest((SELECT max(%I) FROM public.%I), 1), true)',
        v_sequence,
        CASE v_key
          WHEN 'status' THEN 'status_id'
          WHEN 'channels' THEN 'channels_id'
          WHEN 'lead_status' THEN 'lead_status_id'
          WHEN 'countries' THEN 'countries_id'
          WHEN 'states' THEN 'states_id'
          WHEN 'cities' THEN 'cities_id'
          WHEN 'lead_validation_results' THEN 'lead_validation_results_id'
          ELSE 'audit_transition_rules_id'
        END,
        v_key
      );
    END IF;
  END LOOP;
END;
$staging_seed$;

COMMIT;
