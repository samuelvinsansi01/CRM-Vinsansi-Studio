-- CRM - Vinsansi Studio R59
-- Homologacao final do contrato congelado.
-- SOMENTE LEITURA: este arquivo nao altera o banco.
-- Resultado esperado: todos os itens obrigatorios = OK.
-- O item enviado_sem_canal_legacy e apenas informativo e preserva o historico conhecido.

WITH
channels_ids AS (
  SELECT
    max(channels_id) FILTER (WHERE regexp_replace(lower(public.unaccent(trim(channels_name))), '[^a-z0-9]+','','g')='whatsapp') AS whatsapp_id,
    max(channels_id) FILTER (WHERE regexp_replace(lower(public.unaccent(trim(channels_name))), '[^a-z0-9]+','','g')='instagram') AS instagram_id,
    max(channels_id) FILTER (WHERE regexp_replace(lower(public.unaccent(trim(channels_name))), '[^a-z0-9]+','','g')='semdestino') AS sem_destino_id
  FROM public.channels
),
lead_status_diff AS (
  WITH esperado(id,nome) AS (VALUES
    (1::bigint,'importado'::text),(2::bigint,'revisao'::text),(3::bigint,'sem_contato'::text),
    (4::bigint,'na_fila'::text),(5::bigint,'enviado'::text),(6::bigint,'invalido'::text),(7::bigint,'duplicado'::text)
  ), atual AS (
    SELECT lead_status_id AS id,lead_status_name AS nome FROM public.lead_status
  ), diff AS (
    (SELECT * FROM esperado EXCEPT SELECT * FROM atual)
    UNION ALL
    (SELECT * FROM atual EXCEPT SELECT * FROM esperado)
  )
  SELECT count(*)::bigint total FROM diff
),
status_diff AS (
  WITH esperado(id,nome) AS (VALUES
    (1::bigint,'ativo'::text),(2::bigint,'inativo'::text),(3::bigint,'pendente'::text),(4::bigint,'processando'::text),
    (5::bigint,'concluido'::text),(6::bigint,'erro'::text),(7::bigint,'cancelado'::text),(8::bigint,'pausado'::text)
  ), atual AS (
    SELECT status_id AS id,regexp_replace(lower(public.unaccent(trim(status_name))), '[^a-z0-9]+','','g') AS nome FROM public.status
  ), diff AS (
    (SELECT * FROM esperado EXCEPT SELECT * FROM atual)
    UNION ALL
    (SELECT * FROM atual EXCEPT SELECT * FROM esperado)
  )
  SELECT count(*)::bigint total FROM diff
),
invalidation_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='invalidate_final_queue_item' AND pg_get_function_identity_arguments(p.oid)='p_queue_item_id bigint, p_reason text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='invalidate_queue_review_item' AND pg_get_function_identity_arguments(p.oid)='p_review_item_id bigint') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='invalidate_final_queue_item' AND (
        lower(p.prosrc) LIKE '%invalid_status_catalog_missing%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%setstatus_id=7%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%setlead_status_id=6%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_items_error_message=null%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''queuestatus'',''cancelado''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='invalidate_queue_review_item' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) LIKE '%''contractversion'',''r58''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%setlead_status_id=6%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
alternative_name_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='update_lead_alternative_name' AND pg_get_function_identity_arguments(p.oid)='p_lead_id bigint, p_alternative_name text, p_queue_item_id bigint') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='update_lead_alternative_name' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%build_queue_item_payload_snapshot%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%vinsansi.allow_queue_snapshot_refresh%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''originalcompanyname''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''sendcompanyname''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%v_snapshot->''messages''%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='build_queue_item_payload_snapshot' AND pg_get_function_identity_arguments(p.oid)='p_users_id bigint, p_queues_id bigint, p_leads_id bigint, p_templates_id bigint, p_frozen_at timestamp with time zone') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='build_queue_item_payload_snapshot' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads_alternative_name%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''company_name''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''original_company_name''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%render_queue_snapshot_message%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
approval_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='approve_queue_review_item' AND pg_get_function_identity_arguments(p.oid)='p_review_item_id bigint, p_template_id bigint') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='approve_queue_review_item' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) LIKE '%''contractversion'',''r58''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_snapshot_message_1_missing%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_lead_not_queued%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_template_unavailable%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''templatefallbackused''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) LIKE '%queue_review_resource_capacity_reached%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
pull_filter_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pull_queue_review_to_capacity' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_resource_key text, p_scheduled_date date, p_site_filter text, p_instagram_filter text, p_branch_ids bigint[], p_name_keyword text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='preview_queue_review_pull' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_resource_key text, p_scheduled_date date, p_site_filter text, p_instagram_filter text, p_branch_ids bigint[], p_name_keyword text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='pull_queue_review_to_capacity' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) LIKE '%''contractversion'',''r58''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_site_filter%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_instagram_filter%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_branch_ids%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_name_keyword%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_name_keyword_min_3%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%strpos(%leads_name%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%branches_id=any(v_branch_ids)%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads_website%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads_instagram%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='preview_queue_review_pull' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%list_queue_review_resources%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''willpull''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''eligible''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_branch_ids%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_name_keyword%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_name_keyword_min_3%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%strpos(%leads_name%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
rollover_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rollover_queue_items_to_capacity' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_target_date date') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='rollover_queue_items_to_capacity' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%list_queue_review_resources%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''unresolvedoverflow''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%review%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_items_scheduled_at%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
pagination_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='list_imported_leads_page_r59' AND pg_get_function_identity_arguments(p.oid)='p_page integer, p_page_size integer, p_search text, p_branch_id bigint, p_state text, p_site_filter text, p_instagram_filter text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='list_base_permanent_page_r59' AND pg_get_function_identity_arguments(p.oid)='p_page integer, p_page_size integer, p_search text, p_origin text, p_status text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='list_queue_review_page_r59' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_resource_key text, p_scheduled_date date, p_page integer, p_page_size integer') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='queue_review_count_r59' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_resource_key text, p_scheduled_date date') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='list_queue_final_page_r59' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_resource_key text, p_scheduled_date date, p_page integer, p_page_size integer, p_search text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='queue_final_retryable_ids_r59' AND pg_get_function_identity_arguments(p.oid)='p_channel text, p_resource_key text, p_scheduled_date date') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('list_imported_leads_page_r59','list_base_permanent_page_r59','list_queue_review_page_r59','list_queue_final_page_r59')
        AND (lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%limitv_page_sizeoffsetv_offset%'
             OR lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%10,20,50,100%'
             OR lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%''contractversion'',''r59''%')
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
finish_queue_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='list_queue_review_branches_r59' AND pg_get_function_identity_arguments(p.oid)='') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='list_queue_final_page_r59' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%dispatch_batch_number%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%levels_queues%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%dispatch_batch_position%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
level_capacity_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='validate_resource_level_change_r59' AND pg_get_function_identity_arguments(p.oid)='p_resource_type text, p_resource_id bigint, p_new_level_id bigint') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='validate_level_daily_limit_change_r59' AND pg_get_function_identity_arguments(p.oid)='p_level_id bigint, p_new_daily_limit integer') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_resource_capacity_conflict_r59' AND pg_get_function_identity_arguments(p.oid)='p_users_id bigint, p_channel text, p_resource_id bigint, p_new_limit integer, p_from_date date') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname='chips' AND t.tgname='trg_chips_level_capacity_r59') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname='socials' AND t.tgname='trg_socials_level_capacity_r59') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname='levels' AND t.tgname='trg_levels_daily_limit_capacity_r59') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='_resource_capacity_conflict_r59' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_items%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_items%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%concluido%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%p_from_date%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
keyword_pull_contract_diff AS (
  SELECT (
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('pull_queue_review_to_capacity','preview_queue_review_pull') AND (
        pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_name_keyword text' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_review_name_keyword_min_3%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%public.unaccent%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads_name%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%strpos(%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pull_queue_review_to_capacity','preview_queue_review_pull') AND pg_get_function_identity_arguments(p.oid) LIKE '%p_name_keyword text') <> 2 THEN 1 ELSE 0 END
  )::bigint AS total
),
notification_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='crm_notifications') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='crm_notifications' AND c.relrowsecurity
    ) THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='crm_notifications' AND policyname='crm_notifications_own_select') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
      'crm_notification_emit','mark_crm_notification_read','mark_all_crm_notifications_read',
      'crm_notify_inbound_whatsapp_message','crm_notify_whatsapp_runtime_status','crm_notify_dispatch_error'
    )) <> 6 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public' AND (
        (c.relname='conversation_messages' AND t.tgname='crm_notify_inbound_whatsapp_message_trigger') OR
        (c.relname='instance_runtime_states' AND t.tgname='crm_notify_whatsapp_runtime_status_trigger') OR
        (c.relname='queue_items' AND t.tgname='crm_notify_dispatch_error_trigger')
      )) <> 3 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname='instances' AND t.tgname='crm_notify_whatsapp_instance_status_trigger'
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='crm_notify_whatsapp_runtime_status'
        AND lower(regexp_replace(p.prosrc, '\\s+', '', 'g')) NOT LIKE '%instance_runtime_states%'
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
commercial_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='lead_commercial') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='lead_commercial' AND c.relrowsecurity
    ) THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='lead_commercial' AND policyname='lead_commercial_org_select') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_commercial' AND column_name='preview_due_date' AND data_type='date') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_commercial' AND column_name='design_due_date') THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('list_leads_page_r59','set_lead_commercial_stage_r59','set_lead_preview_due_date_r59','set_lead_design_due_date_r59')) <> 4 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='set_lead_commercial_stage_r59' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%commercial_stage_transition_invalid%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%commercial_stage_terminal%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%aguardando_previa%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%previa_enviada%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='set_lead_preview_due_date_r59' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%preview_due_date_requires_awaiting_preview%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%preview_due_date_past_invalid%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%america/sao_paulo%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM public.lead_commercial lc
      JOIN public.leads l ON l.leads_id=lc.leads_id AND l.organizations_id=lc.organizations_id
      WHERE l.lead_status_id<>5 OR lc.commercial_stage IN ('aguardando_design','design_enviado')
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
dashboard_period_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='dashboard_summary_r59' AND pg_get_function_identity_arguments(p.oid)='p_from timestamp with time zone, p_to_exclusive timestamp with time zone') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='dashboard_summary_r59' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queue_items%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%sents_sent_at%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%lead_commercial%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%preview_due_date%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%lead_projects%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%scheduledreceipts%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
projects_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('lead_projects','lead_project_stage_history')) <> 2 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('lead_projects','lead_project_stage_history') AND c.relrowsecurity) <> 2 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND ((tablename='lead_projects' AND policyname='lead_projects_org_select') OR (tablename='lead_project_stage_history' AND policyname='lead_project_stage_history_org_select'))) <> 2 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('list_projects_r59','update_project_financials_r59','set_project_stage_r59','update_project_stage_dates_r59','set_project_payment_received_r59')) <> 5 THEN 1 ELSE 0 END +
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='lead_project_stage_history_one_active_idx') THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='set_lead_commercial_stage_r59' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%lead_projects%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%aguardando_inicio%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM public.lead_projects pr
      JOIN public.leads l ON l.leads_id=pr.leads_id AND l.organizations_id=pr.organizations_id
      LEFT JOIN public.lead_commercial lc ON lc.leads_id=pr.leads_id AND lc.organizations_id=pr.organizations_id
      WHERE lc.commercial_stage IS DISTINCT FROM 'fechado'
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM public.lead_projects pr
      WHERE NOT EXISTS (
        SELECT 1 FROM public.lead_project_stage_history h
        WHERE h.organizations_id=pr.organizations_id AND h.lead_projects_id=pr.lead_projects_id AND h.completed_on IS NULL
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
mobile_push_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='mobile_push_devices') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='mobile_push_devices' AND c.relrowsecurity
    ) THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('register_mobile_push_device_v1','disable_mobile_push_device_v1')) <> 2 THEN 1 ELSE 0 END +
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='lead_commercial'
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
conversation_identity_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='stage5_conversation_phone_identity' AND pg_get_function_identity_arguments(p.oid)='p_contact_phone text, p_remote_jid text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='stage5_sync_conversation_lead_identity' AND pg_get_function_identity_arguments(p.oid)='p_conversations_id bigint') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='stage5_repair_conversation_identities_r59' AND pg_get_function_identity_arguments(p.oid)='') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='service_ingest_evolution_message' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%stage5_resolve_conversation_id%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%stage5_register_conversation_aliases%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%stage5_sync_conversation_lead_identity%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='service_stage5_list_conversations' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads_alternative_name%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%display_name%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='stage5_sync_conversation_lead_identity' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%effective_whatsapp_phone%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads_normalized_phone%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
permission_matrix_contract_diff AS (
  SELECT (
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='has_organization_permission' AND pg_get_function_identity_arguments(p.oid)='p_permission_key text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='stage5_member_has_permission' AND pg_get_function_identity_arguments(p.oid)='p_organizations_id bigint, p_organization_members_id bigint, p_permission text') <> 1 THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='has_organization_permission' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%access_level=''manager''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%whatsapp.instances.manage%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%instagram.settings%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%templates.manage%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%settings.manage%'
      )
    ) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='stage5_member_has_permission' AND (
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%access_level=''manager''%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%whatsapp.assign%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%queues.control%' OR
        lower(regexp_replace(p.prosrc, '\s+', '', 'g')) NOT LIKE '%leads.edit%'
      )
    ) THEN 1 ELSE 0 END
  )::bigint AS total
),
channel_diff AS (
  WITH esperado(nome) AS (VALUES ('whatsapp'::text),('instagram'::text),('sem_destino'::text)), atual AS (
    SELECT regexp_replace(lower(public.unaccent(trim(channels_name))), '[^a-z0-9]+','_','g') nome FROM public.channels
  ), diff AS (
    (SELECT * FROM esperado EXCEPT SELECT * FROM atual)
    UNION ALL
    (SELECT * FROM atual EXCEPT SELECT * FROM esperado)
  )
  SELECT count(*)::bigint total FROM diff
),
function_residue AS (
  SELECT count(*)::bigint total
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p') AND (
    pg_get_functiondef(p.oid) ILIKE '%whatsapp_validation_requests%' OR
    pg_get_functiondef(p.oid) ILIKE '%whatsapp_validation_proofs%' OR
    pg_get_functiondef(p.oid) ILIKE '%lead_identity_registry%' OR
    pg_get_functiondef(p.oid) ILIKE '%contact_suppressions%' OR
    pg_get_functiondef(p.oid) ILIKE '%audit_events%' OR
    pg_get_functiondef(p.oid) ILIKE '%audit_transition_rules%' OR
    pg_get_functiondef(p.oid) ILIKE '%permanent_records%' OR
    pg_get_functiondef(p.oid) ILIKE '%lead_orchestration_state%' OR
    pg_get_functiondef(p.oid) ILIKE '%lead_lifecycle_events%' OR
    pg_get_functiondef(p.oid) ILIKE '%instagram_dispatch_events%' OR
    pg_get_functiondef(p.oid) ILIKE '%capture_execution_events%' OR
    pg_get_functiondef(p.oid) ILIKE '%maps_search_snapshots%' OR
    pg_get_functiondef(p.oid) ILIKE '%production_homologation_%' OR
    pg_get_functiondef(p.oid) ILIKE '%platform_schema_contracts%' OR
    pg_get_functiondef(p.oid) ILIKE '%platform_schema_releases%' OR
    pg_get_functiondef(p.oid) ILIKE '%platform_release_channels%' OR
    pg_get_functiondef(p.oid) ILIKE '%template_variables%' OR
    pg_get_functiondef(p.oid) ILIKE '%instances_apikey%' OR
    pg_get_functiondef(p.oid) ILIKE '%apify%'
  )
),
old_status_residue AS (
  SELECT count(*)::bigint total
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p') AND (
    pg_get_functiondef(p.oid) ILIKE '%''validado''%' OR
    pg_get_functiondef(p.oid) ILIKE '%''pre_envio''%' OR
    pg_get_functiondef(p.oid) ILIKE '%''arquivado''%'
  )
),
trigger_residue AS (
  SELECT count(*)::bigint total
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND n.nspname='public' AND (
    pg_get_functiondef(p.oid) ILIKE '%whatsapp_validation_%' OR
    pg_get_functiondef(p.oid) ILIKE '%lead_identity_registry%' OR
    pg_get_functiondef(p.oid) ILIKE '%contact_suppressions%' OR
    pg_get_functiondef(p.oid) ILIKE '%audit_events%' OR
    pg_get_functiondef(p.oid) ILIKE '%permanent_records%' OR
    pg_get_functiondef(p.oid) ILIKE '%instagram_dispatch_events%' OR
    pg_get_functiondef(p.oid) ILIKE '%maps_search_snapshots%' OR
    pg_get_functiondef(p.oid) ILIKE '%template_variables%' OR
    pg_get_functiondef(p.oid) ILIKE '%instances_apikey%' OR
    pg_get_functiondef(p.oid) ILIKE '%apify%'
  )
),
checks AS (
  SELECT '01_total_tabelas' verificacao, (SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public') total, 65::bigint esperado, false informativo
  UNION ALL SELECT '02_lead_status_divergencias',(SELECT total FROM lead_status_diff),0,false
  UNION ALL SELECT '03_channels_divergencias',(SELECT total FROM channel_diff),0,false
  UNION ALL SELECT '04_constraints_nao_validadas',(SELECT count(*)::bigint FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace WHERE n.nspname='public' AND con.convalidated IS FALSE),0,false
  UNION ALL SELECT '05_residuos_funcoes',(SELECT total FROM function_residue),0,false
  UNION ALL SELECT '06_status_antigos_funcoes',(SELECT total FROM old_status_residue),0,false
  UNION ALL SELECT '07_residuos_triggers',(SELECT total FROM trigger_residue),0,false
  UNION ALL SELECT '08_importado_whatsapp_sem_telefone',count(*)::bigint,0,false FROM public.leads l CROSS JOIN channels_ids c WHERE l.lead_status_id=1 AND l.channels_id=c.whatsapp_id AND length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))<10
  UNION ALL SELECT '09_importado_instagram_sem_instagram',count(*)::bigint,0,false FROM public.leads l CROSS JOIN channels_ids c WHERE l.lead_status_id=1 AND l.channels_id=c.instagram_id AND length(btrim(coalesce(l.leads_instagram,'')))=0
  UNION ALL SELECT '10_importado_sem_destino_incoerente',count(*)::bigint,0,false FROM public.leads l CROSS JOIN channels_ids c WHERE l.lead_status_id=1 AND l.channels_id=c.sem_destino_id AND (length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))<10 OR length(btrim(coalesce(l.leads_instagram,'')))=0)
  UNION ALL SELECT '11_revisao_com_canal_invalido',count(*)::bigint,0,false FROM public.leads l CROSS JOIN channels_ids c WHERE l.lead_status_id=2 AND l.channels_id NOT IN (c.whatsapp_id,c.instagram_id)
  UNION ALL SELECT '12_revisao_sem_review_item_aberto',count(*)::bigint,0,false FROM public.leads l WHERE l.lead_status_id=2 AND NOT EXISTS (SELECT 1 FROM public.queue_review_items i WHERE i.organizations_id=l.organizations_id AND i.leads_id=l.leads_id AND i.review_status='open')
  UNION ALL SELECT '13_review_item_aberto_lead_fora_revisao',count(*)::bigint,0,false FROM public.queue_review_items i JOIN public.leads l ON l.organizations_id=i.organizations_id AND l.leads_id=i.leads_id WHERE i.review_status='open' AND l.lead_status_id<>2
  UNION ALL SELECT '14_multiplas_revisoes_abertas',count(*)::bigint,0,false FROM (SELECT organizations_id,leads_id FROM public.queue_review_items WHERE review_status='open' GROUP BY organizations_id,leads_id HAVING count(*)>1) x
  UNION ALL SELECT '15_revisao_canal_divergente_batch',count(*)::bigint,0,false FROM public.queue_review_items i JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id JOIN public.leads l ON l.organizations_id=i.organizations_id AND l.leads_id=i.leads_id WHERE i.review_status='open' AND l.channels_id IS DISTINCT FROM b.channels_id
  UNION ALL SELECT '16_na_fila_sem_queue_item',count(*)::bigint,0,false FROM public.leads l WHERE l.lead_status_id=4 AND NOT EXISTS (SELECT 1 FROM public.queue_items qi WHERE qi.organizations_id=l.organizations_id AND qi.leads_id=l.leads_id)
  UNION ALL SELECT '17_review_locked_sem_queue_item',count(*)::bigint,0,false FROM public.queue_review_items WHERE review_status='locked' AND queue_items_id IS NULL
  UNION ALL SELECT '18_sem_contato_com_instagram',count(*)::bigint,0,false FROM public.leads WHERE lead_status_id=3 AND length(btrim(coalesce(leads_instagram,'')))>0
  UNION ALL SELECT '19_enviado_sem_canal_legacy',count(*)::bigint,0,true FROM public.leads WHERE lead_status_id=5 AND channels_id IS NULL
  UNION ALL SELECT '20_status_operacional_divergencias',(SELECT total FROM status_diff),0,false
  UNION ALL SELECT '21_contrato_invalidacao_r59',(SELECT total FROM invalidation_contract_diff),0,false
  UNION ALL SELECT '22_invalidacao_manual_marcada_como_erro',count(*)::bigint,0,false
  FROM public.queue_items qi
  JOIN public.leads l ON l.leads_id=qi.leads_id AND l.users_id=qi.users_id
  WHERE qi.status_id=6
    AND l.lead_status_id=6
    AND regexp_replace(lower(public.unaccent(trim(coalesce(qi.queue_items_error_message,'')))), '[^a-z0-9]+','','g')='invalidadopelooperador'
  UNION ALL SELECT '23_contrato_nome_alternativo_r59',(SELECT total FROM alternative_name_contract_diff),0,false
  UNION ALL SELECT '24_contrato_aprovacao_r59',(SELECT total FROM approval_contract_diff),0,false
  UNION ALL SELECT '25_contrato_puxada_filtrada_r59',(SELECT total FROM pull_filter_contract_diff),0,false
  UNION ALL SELECT '26_contrato_rollover_capacidade_r59',(SELECT total FROM rollover_contract_diff),0,false
  UNION ALL SELECT '27_contrato_paginacao_server_side_r59',(SELECT total FROM pagination_contract_diff),0,false
  UNION ALL SELECT '28_contrato_lotes_e_ramos_r59',(SELECT total FROM finish_queue_contract_diff),0,false
  UNION ALL SELECT '29_contrato_protecao_downgrade_nivel_r59',(SELECT total FROM level_capacity_contract_diff),0,false
  UNION ALL SELECT '30_contrato_palavra_chave_nome_r59',(SELECT total FROM keyword_pull_contract_diff),0,false
  UNION ALL SELECT '31_contrato_notificacoes_r59',(SELECT total FROM notification_contract_diff),0,false
  UNION ALL SELECT '32_contrato_comercial_r59',(SELECT total FROM commercial_contract_diff),0,false
  UNION ALL SELECT '33_contrato_dashboard_periodo_r59',(SELECT total FROM dashboard_period_contract_diff),0,false
  UNION ALL SELECT '34_contrato_mobile_push_v1',(SELECT total FROM mobile_push_contract_diff),0,false
  UNION ALL SELECT '35_contrato_identidade_conversas_r59',(SELECT total FROM conversation_identity_contract_diff),0,false
  UNION ALL SELECT '36_contrato_projetos_r59',(SELECT total FROM projects_contract_diff),0,false
  UNION ALL SELECT '37_matriz_permissoes_r59',(SELECT total FROM permission_matrix_contract_diff),0,false
)
SELECT verificacao,total,esperado,
  CASE WHEN informativo THEN 'INFORMATIVO' WHEN total=esperado THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM checks
ORDER BY verificacao;
