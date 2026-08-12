-- Execute esta consulta separadamente no SQL Editor da PRODUCAO.
-- Antes de executar, substitua somente REPLACE_WITH_SOURCE_USERS_ID pelo ID
-- numerico confirmado em find-production-source-user.sql.
-- O resultado possui uma unica linha JSONB; as agregacoes evitam o limite de
-- 1000 linhas do cliente sem criar objetos ou escrever no banco.
WITH params AS (
  SELECT CAST('REPLACE_WITH_SOURCE_USERS_ID' AS bigint) AS source_users_id
)
SELECT jsonb_build_object(
  'canonical', jsonb_build_object(
    'status', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.status_id)
      FROM (
        SELECT status_id, status_name
        FROM public.status
      ) AS row_data
    ), '[]'::jsonb),
    'channels', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.channels_id)
      FROM (
        SELECT channels_id, channels_name
        FROM public.channels
      ) AS row_data
    ), '[]'::jsonb),
    'lead_status', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.lead_status_id)
      FROM (
        SELECT lead_status_id, lead_status_name
        FROM public.lead_status
      ) AS row_data
    ), '[]'::jsonb),
    'countries', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.countries_id)
      FROM (
        SELECT countries_id, countries_name, countries_code
        FROM public.countries
      ) AS row_data
    ), '[]'::jsonb),
    'states', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.states_id)
      FROM (
        SELECT states_id, countries_id, states_name, states_code
        FROM public.states
      ) AS row_data
    ), '[]'::jsonb),
    'cities', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.cities_id)
      FROM (
        SELECT cities_id, states_id, cities_name
        FROM public.cities
      ) AS row_data
    ), '[]'::jsonb),
    'lead_validation_results', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.lead_validation_results_id)
      FROM (
        SELECT
          lead_validation_results_id,
          lead_validation_results_key,
          lead_validation_results_name,
          status_id
        FROM public.lead_validation_results
      ) AS row_data
    ), '[]'::jsonb),
    'audit_transition_rules', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.audit_transition_rules_id)
      FROM (
        SELECT
          audit_transition_rules_id,
          entity_type,
          from_status_id,
          to_status_id,
          action_key,
          is_active
        FROM public.audit_transition_rules
      ) AS row_data
    ), '[]'::jsonb)
  ),
  'tenant', jsonb_build_object(
    'branches', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_branches_id)
      FROM (
        SELECT
          b.branches_id AS source_branches_id,
          b.status_id,
          b.branches_name,
          b.branches_categories
        FROM public.branches AS b
        WHERE b.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb),
    'contact_sources', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_contact_sources_id)
      FROM (
        SELECT
          cs.contact_sources_id AS source_contact_sources_id,
          cs.status_id,
          cs.contact_sources_name,
          cs.contact_sources_key,
          cs.contact_sources_requires_review,
          cs.contact_sources_default_channel_id
        FROM public.contact_sources AS cs
        WHERE cs.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb),
    'levels', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_levels_id)
      FROM (
        SELECT
          l.levels_id AS source_levels_id,
          l.channels_id,
          l.status_id,
          l.levels_name,
          l.levels_daily_limit,
          l.levels_queues
        FROM public.levels AS l
        WHERE l.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb),
    'template_channels', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_template_channels_id)
      FROM (
        SELECT
          tc.template_channels_id AS source_template_channels_id,
          tc.status_id,
          tc.template_channels_name,
          tc.template_channels_blocked_channels
        FROM public.template_channels AS tc
        WHERE tc.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb),
    'template_types', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_template_types_id)
      FROM (
        SELECT
          tt.template_types_id AS source_template_types_id,
          tt.status_id,
          tt.template_types_name
        FROM public.template_types AS tt
        WHERE tt.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb),
    'template_variables', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_template_variables_id)
      FROM (
        SELECT
          tv.template_variables_id AS source_template_variables_id,
          tv.status_id,
          tv.template_variables_name,
          tv.template_variables_key,
          tv.template_variables_source,
          CASE
            WHEN tv.template_variables_default_value IS NULL THEN NULL
            ELSE '[STAGING]'
          END AS template_variables_default_value
        FROM public.template_variables AS tv
        WHERE tv.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb),
    'templates', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.source_templates_id)
      FROM (
        SELECT
          t.templates_id AS source_templates_id,
          t.branches_id AS source_branches_id,
          t.status_id,
          t.template_channels_id AS source_template_channels_id,
          t.template_types_id AS source_template_types_id,
          t.templates_name,
          CASE WHEN t.templates_message_1 IS NULL THEN NULL
               ELSE '[STAGING] Mensagem 1 para {EMPRESA}' END AS templates_message_1,
          CASE WHEN t.templates_message_2 IS NULL THEN NULL
               ELSE '[STAGING] Mensagem 2 para {EMPRESA}' END AS templates_message_2,
          CASE WHEN t.templates_message_3 IS NULL THEN NULL
               ELSE '[STAGING] Mensagem 3 para {EMPRESA}' END AS templates_message_3,
          CASE WHEN t.templates_message_4 IS NULL THEN NULL
               ELSE '[STAGING] Mensagem 4 para {EMPRESA}' END AS templates_message_4
        FROM public.templates AS t
        WHERE t.users_id = p.source_users_id
      ) AS row_data
    ), '[]'::jsonb)
  )
) AS staging_seed_export
FROM params AS p;
