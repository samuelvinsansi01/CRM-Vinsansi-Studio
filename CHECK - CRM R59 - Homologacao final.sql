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
  SELECT '01_total_tabelas' verificacao, (SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public') total, 60::bigint esperado, false informativo
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
)
SELECT verificacao,total,esperado,
  CASE WHEN informativo THEN 'INFORMATIVO' WHEN total=esperado THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM checks
ORDER BY verificacao;
