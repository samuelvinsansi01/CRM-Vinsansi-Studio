-- CRM - Vinsansi Studio v2.4.0-R57
-- Reconciliação determinística da revisão WhatsApp.
--
-- Corrige a causa da fila invisível observada na R56:
--   * cada lead reservado recebe um destino explícito no mesmo clique;
--   * p_approved_ids = exatamente os leads que devem permanecer em Revisão;
--   * p_release_ids = exatamente os demais leads reservados naquele clique;
--   * não existe prune genérico baseado em estado transitório;
--   * os prontos só permanecem se houver prova WhatsApp válida para o telefone atual;
--   * a RPC devolve os IDs efetivamente mantidos, permitindo conferência exata no frontend;
--   * itens validados pela R56 e liberados indevidamente são recuperados sem nova chamada ao chip,
--     desde que ainda exista prova WhatsApp válida e espaço no lote aberto.

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_queue_review_whatsapp_validation(
  p_batch_id bigint,
  p_approved_ids bigint[] DEFAULT '{}'::bigint[],
  p_release_ids bigint[] DEFAULT '{}'::bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_batch public.queue_review_batches%ROWTYPE;
  v_capacity record;
  v_ready_ids bigint[]:='{}'::bigint[];
  v_release_ids bigint[]:='{}'::bigint[];
  v_missing_ids bigint[]:='{}'::bigint[];
  v_retained_ready_ids bigint[]:='{}'::bigint[];
  v_open integer:=0;
  v_restored integer:=0;
  v_released integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  SELECT coalesce(array_agg(u.id ORDER BY u.id),'{}'::bigint[])
  INTO v_ready_ids
  FROM (
    SELECT DISTINCT id
    FROM unnest(coalesce(p_approved_ids,'{}'::bigint[])) AS x(id)
    WHERE id IS NOT NULL AND id>0
  ) u;

  SELECT coalesce(array_agg(u.id ORDER BY u.id),'{}'::bigint[])
  INTO v_release_ids
  FROM (
    SELECT DISTINCT id
    FROM unnest(coalesce(p_release_ids,'{}'::bigint[])) AS x(id)
    WHERE id IS NOT NULL AND id>0
  ) u;

  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id
    AND b.organizations_id=v_org
    AND b.users_id=v_user
    AND b.channel_key='whatsapp'
    AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date),0)
  );

  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id
    AND b.organizations_id=v_org
    AND b.users_id=v_user
    AND b.channel_key='whatsapp'
    AND b.review_status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  IF EXISTS(
    SELECT 1
    FROM unnest(v_ready_ids) r(id)
    JOIN unnest(v_release_ids) x(id) USING(id)
  ) THEN
    RAISE EXCEPTION 'queue_review_reconcile_overlap';
  END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),'{}'::bigint[])
  INTO v_missing_ids
  FROM unnest(v_ready_ids) x(id)
  WHERE NOT EXISTS(
    SELECT 1
    FROM public.queue_review_items i
    WHERE i.queue_review_batches_id=p_batch_id
      AND i.organizations_id=v_org
      AND i.leads_id=x.id
      AND i.review_status='open'
  );
  IF cardinality(v_missing_ids)>0 THEN
    RAISE EXCEPTION 'queue_review_ready_not_reserved:%',array_to_string(v_missing_ids,',');
  END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),'{}'::bigint[])
  INTO v_missing_ids
  FROM unnest(v_release_ids) x(id)
  WHERE NOT EXISTS(
    SELECT 1
    FROM public.queue_review_items i
    WHERE i.queue_review_batches_id=p_batch_id
      AND i.organizations_id=v_org
      AND i.leads_id=x.id
      AND i.review_status='open'
  );
  IF cardinality(v_missing_ids)>0 THEN
    RAISE EXCEPTION 'queue_review_release_not_reserved:%',array_to_string(v_missing_ids,',');
  END IF;

  -- Prontos: o resultado persistido do provider pode deixar o lead em Validado (2)
  -- ou já mantê-lo em Pré-envio (3). A fonte de verdade para permanecer na Revisão
  -- é: pertence ao batch aberto + foi informado como pronto + possui prova válida atual.
  UPDATE public.leads l
  SET lead_status_id=3,
      channels_id=v_batch.channels_id,
      leads_updated_at=now()
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.leads_id=ANY(v_ready_ids)
    AND l.lead_status_id IN (2,3)
    AND EXISTS(
      SELECT 1
      FROM public.queue_review_items i
      WHERE i.queue_review_batches_id=p_batch_id
        AND i.organizations_id=v_org
        AND i.leads_id=l.leads_id
        AND i.review_status='open'
    )
    AND EXISTS(
      SELECT 1
      FROM public.whatsapp_validation_proofs p
      WHERE p.organizations_id=v_org
        AND p.users_id=v_user
        AND p.leads_id=l.leads_id
        AND p.is_valid=true
        AND p.validated_phone=public.normalize_whatsapp_validation_phone(
          public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)
        )
    );
  GET DIAGNOSTICS v_restored=ROW_COUNT;

  SELECT coalesce(array_agg(i.leads_id ORDER BY i.leads_id),'{}'::bigint[])
  INTO v_retained_ready_ids
  FROM public.queue_review_items i
  JOIN public.leads l
    ON l.leads_id=i.leads_id
   AND l.organizations_id=v_org
   AND l.users_id=v_user
  WHERE i.queue_review_batches_id=p_batch_id
    AND i.organizations_id=v_org
    AND i.review_status='open'
    AND i.leads_id=ANY(v_ready_ids)
    AND l.lead_status_id=3
    AND l.channels_id=v_batch.channels_id
    AND EXISTS(
      SELECT 1
      FROM public.whatsapp_validation_proofs p
      WHERE p.organizations_id=v_org
        AND p.users_id=v_user
        AND p.leads_id=l.leads_id
        AND p.is_valid=true
        AND p.validated_phone=public.normalize_whatsapp_validation_phone(
          public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)
        )
    );

  IF cardinality(v_retained_ready_ids)<>cardinality(v_ready_ids) THEN
    SELECT coalesce(array_agg(x.id ORDER BY x.id),'{}'::bigint[])
    INTO v_missing_ids
    FROM unnest(v_ready_ids) x(id)
    WHERE NOT (x.id=ANY(v_retained_ready_ids));
    RAISE EXCEPTION 'queue_review_ready_not_persisted:%',array_to_string(v_missing_ids,',');
  END IF;

  -- Não prontos: libera somente os IDs que o cliente acabou de reservar e
  -- explicitamente classificou como não prontos. O resultado persistido do provider
  -- (ex.: redirecionado ao Instagram) é preservado quando já mudou o lead de estado/canal.
  UPDATE public.queue_review_items i
  SET review_status='released',updated_at=now()
  WHERE i.queue_review_batches_id=p_batch_id
    AND i.organizations_id=v_org
    AND i.review_status='open'
    AND i.leads_id=ANY(v_release_ids);
  GET DIAGNOSTICS v_released=ROW_COUNT;

  -- Erro técnico/conflito pode deixar o lead em Pré-envio. Nesse caso ele volta
  -- a Importado sem destino. Se o provider já redirecionou/inativou, não sobrescrevemos.
  UPDATE public.leads l
  SET lead_status_id=1,channels_id=NULL,leads_updated_at=now()
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.lead_status_id=3
    AND l.leads_id=ANY(v_release_ids);

  -- Se já voltou a Importado mas ainda reteve o canal WhatsApp, limpa somente esse
  -- destino; um redirecionamento legítimo para Instagram permanece intacto.
  UPDATE public.leads l
  SET channels_id=NULL,leads_updated_at=now()
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.lead_status_id=1
    AND l.channels_id=v_batch.channels_id
    AND l.leads_id=ANY(v_release_ids);

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date);

  UPDATE public.queue_review_batches
  SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
  WHERE queue_review_batches_id=p_batch_id;

  SELECT count(*)::integer INTO v_open
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=p_batch_id
    AND i.review_status='open';

  RETURN jsonb_build_object(
    'contractVersion','R57',
    'batchId',p_batch_id,
    'requestedReadyCount',cardinality(v_ready_ids),
    'retainedReadyCount',cardinality(v_retained_ready_ids),
    'retainedReadyIds',to_jsonb(v_retained_ready_ids),
    'restored',v_restored,
    'released',v_released,
    'targetCount',greatest(0,coalesce(v_capacity.available,0)),
    'openCount',greatest(0,coalesce(v_open,0)),
    'missingCount',greatest(0,coalesce(v_capacity.available,0)-coalesce(v_open,0))
  );
END
$$;

REVOKE ALL ON FUNCTION public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Recuperação automática dos casos já atingidos pela R56.
--
-- Só reabre item que:
--   * pertence a batch WhatsApp ainda aberto para hoje/futuro;
--   * foi liberado;
--   * o lead está Validado (2) no mesmo canal do batch;
--   * possui prova WhatsApp válida para o telefone atual;
--   * não está em outra revisão aberta nem na Base Permanente;
--   * cabe no target_count do próprio batch.
--
-- Assim a prova já paga pelo chip é reaproveitada; não ocorre nova validação.
-- ---------------------------------------------------------------------------
WITH open_counts AS (
  SELECT
    b.queue_review_batches_id,
    count(i.queue_review_items_id) FILTER (WHERE i.review_status='open')::integer AS open_count
  FROM public.queue_review_batches b
  LEFT JOIN public.queue_review_items i
    ON i.queue_review_batches_id=b.queue_review_batches_id
  WHERE b.review_status='open'
    AND b.channel_key='whatsapp'
    AND b.scheduled_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
  GROUP BY b.queue_review_batches_id
), lead_candidates AS (
  SELECT
    i.queue_review_items_id,
    i.queue_review_batches_id,
    i.leads_id,
    greatest(0,b.target_count-coalesce(oc.open_count,0)) AS free_slots,
    row_number() OVER(
      PARTITION BY i.leads_id
      ORDER BY i.updated_at DESC,i.queue_review_items_id DESC
    ) AS lead_rank
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b
    ON b.queue_review_batches_id=i.queue_review_batches_id
   AND b.organizations_id=i.organizations_id
  JOIN public.leads l
    ON l.leads_id=i.leads_id
   AND l.organizations_id=b.organizations_id
   AND l.users_id=b.users_id
  JOIN open_counts oc
    ON oc.queue_review_batches_id=b.queue_review_batches_id
  WHERE b.review_status='open'
    AND b.channel_key='whatsapp'
    AND b.scheduled_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND i.review_status='released'
    AND l.lead_status_id=2
    AND l.channels_id=b.channels_id
    AND NOT EXISTS(
      SELECT 1
      FROM public.queue_review_items oi
      WHERE oi.organizations_id=i.organizations_id
        AND oi.leads_id=i.leads_id
        AND oi.review_status='open'
    )
    AND NOT EXISTS(
      SELECT 1
      FROM public.permanent_records pr
      WHERE pr.organizations_id=b.organizations_id
        AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
    )
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
), unique_leads AS (
  SELECT *
  FROM lead_candidates
  WHERE lead_rank=1 AND free_slots>0
), ranked_batches AS (
  SELECT
    u.*,
    row_number() OVER(
      PARTITION BY u.queue_review_batches_id
      ORDER BY u.queue_review_items_id DESC
    ) AS batch_rank
  FROM unique_leads u
), picked AS (
  SELECT *
  FROM ranked_batches
  WHERE batch_rank<=free_slots
), reopened AS (
  UPDATE public.queue_review_items i
  SET review_status='open',updated_at=now()
  FROM picked p
  WHERE i.queue_review_items_id=p.queue_review_items_id
    AND i.review_status='released'
  RETURNING i.queue_review_items_id,i.queue_review_batches_id,i.leads_id
)
UPDATE public.leads l
SET lead_status_id=3,
    channels_id=b.channels_id,
    leads_updated_at=now()
FROM reopened r
JOIN public.queue_review_batches b
  ON b.queue_review_batches_id=r.queue_review_batches_id
WHERE l.leads_id=r.leads_id
  AND l.organizations_id=b.organizations_id
  AND l.users_id=b.users_id
  AND l.lead_status_id=2;

COMMIT;
