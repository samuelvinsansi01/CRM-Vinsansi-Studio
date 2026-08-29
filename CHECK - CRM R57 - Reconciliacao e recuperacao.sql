-- CHECK SOMENTE LEITURA - CRM R57
-- Execute depois do SQL R57 e antes de voltar a usar Puxar.
-- A coluna r57_limpa_e_ativa deve retornar true.

WITH fn AS (
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='reconcile_queue_review_whatsapp_validation'
    AND pg_get_function_identity_arguments(p.oid)='p_batch_id bigint, p_approved_ids bigint[], p_release_ids bigint[]'
  LIMIT 1
), invisible_open AS (
  SELECT count(*)::bigint AS total
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b
    ON b.queue_review_batches_id=i.queue_review_batches_id
   AND b.organizations_id=i.organizations_id
  JOIN public.leads l
    ON l.leads_id=i.leads_id
   AND l.organizations_id=b.organizations_id
   AND l.users_id=b.users_id
  WHERE b.review_status='open'
    AND b.channel_key='whatsapp'
    AND b.scheduled_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND i.review_status='open'
    AND (
      l.lead_status_id<>3
      OR l.channels_id IS DISTINCT FROM b.channels_id
      OR NOT EXISTS(
        SELECT 1
        FROM public.whatsapp_validation_proofs p
        WHERE p.organizations_id=b.organizations_id
          AND p.users_id=b.users_id
          AND p.leads_id=l.leads_id
          AND p.is_valid=true
          AND p.validated_phone=public.normalize_whatsapp_validation_phone(
            public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)
          )
      )
    )
), released_validated AS (
  SELECT count(*)::bigint AS total
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b
    ON b.queue_review_batches_id=i.queue_review_batches_id
   AND b.organizations_id=i.organizations_id
  JOIN public.leads l
    ON l.leads_id=i.leads_id
   AND l.organizations_id=b.organizations_id
   AND l.users_id=b.users_id
  WHERE b.review_status='open'
    AND b.channel_key='whatsapp'
    AND b.scheduled_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND i.review_status='released'
    AND l.lead_status_id=2
    AND l.channels_id=b.channels_id
    AND EXISTS(
      SELECT 1
      FROM public.whatsapp_validation_proofs p
      WHERE p.organizations_id=b.organizations_id
        AND p.users_id=b.users_id
        AND p.leads_id=l.leads_id
        AND p.is_valid=true
        AND p.validated_phone=public.normalize_whatsapp_validation_phone(
          public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)
        )
    )
)
SELECT
  EXISTS(SELECT 1 FROM fn) AS rpc_existe,
  coalesce((SELECT def LIKE '%''contractVersion'',''R57''%' FROM fn),false) AS contrato_r57,
  coalesce((SELECT def LIKE '%''retainedReadyIds''%' FROM fn),false) AS retorna_ids_exatos,
  coalesce((SELECT def NOT LIKE '%v_pruned%' FROM fn),false) AS sem_prune_generico,
  (SELECT total FROM invisible_open) AS revisoes_abertas_inconsistentes,
  (SELECT total FROM released_validated) AS validados_liberados_ainda_existentes,
  (
    EXISTS(SELECT 1 FROM fn)
    AND coalesce((SELECT def LIKE '%''contractVersion'',''R57''%' FROM fn),false)
    AND coalesce((SELECT def LIKE '%''retainedReadyIds''%' FROM fn),false)
    AND coalesce((SELECT def NOT LIKE '%v_pruned%' FROM fn),false)
    AND (SELECT total FROM invisible_open)=0
  ) AS r57_limpa_e_ativa;
