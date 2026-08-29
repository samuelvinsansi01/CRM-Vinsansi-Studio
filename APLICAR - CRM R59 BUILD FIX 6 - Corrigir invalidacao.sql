-- CRM - Vinsansi Studio R59 BUILD FIX 6
-- CORRECAO CIRURGICA: invalidação da Revisão/Fila final.
-- Nao cria tabelas, nao cria status e nao altera o contrato estrutural congelado.
-- Contrato semantico R59:
--   public.status.status_id = 7           -> cancelado (encerramento deliberado pelo operador)
--   public.status.status_id = 6           -> erro (somente falha tecnica)
--   public.lead_status.lead_status_id = 6 -> invalido

BEGIN;

CREATE OR REPLACE FUNCTION public.invalidate_final_queue_item(
  p_queue_item_id bigint,
  p_reason text DEFAULT 'invalidado pelo operador'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_item record;
  v_status_key text;
BEGIN
  PERFORM public.require_organization_permission('leads.validate');

  SELECT qi.queue_items_id, qi.leads_id, qi.status_id, q.channels_id
  INTO v_item
  FROM public.queue_items qi
  JOIN public.queues q
    ON q.queues_id = qi.queues_id
   AND q.users_id = qi.users_id
  JOIN public.leads l
    ON l.leads_id = qi.leads_id
   AND l.users_id = qi.users_id
  WHERE qi.queue_items_id = p_queue_item_id
    AND qi.users_id = v_user
    AND l.organizations_id = v_org
  FOR UPDATE OF qi, l;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue_item_not_found';
  END IF;

  SELECT regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g')
  INTO v_status_key
  FROM public.status s
  WHERE s.status_id = v_item.status_id;

  IF v_status_key IN ('concluido', 'completed', 'sent', 'enviado') THEN
    RAISE EXCEPTION 'queue_item_already_sent';
  END IF;

  -- Invalidacao manual encerra o item como CANCELADO; ERRO fica reservado a falha tecnica.
  UPDATE public.queue_items
  SET status_id = 7,
      queue_items_error_message = NULL,
      queue_items_finished_at = now(),
      queue_items_updated_at = now()
  WHERE queue_items_id = p_queue_item_id
    AND users_id = v_user;

  UPDATE public.leads
  SET lead_status_id = 6,
      leads_updated_at = now()
  WHERE leads_id = v_item.leads_id
    AND users_id = v_user
    AND organizations_id = v_org;

  UPDATE public.instagram_queue_progress
  SET step = 'invalid',
      canonical_step = 'invalid',
      finished_at = now(),
      error_message = NULL,
      instagram_queue_progress_updated_at = now()
  WHERE queue_items_id = p_queue_item_id
    AND organizations_id = v_org;

  RETURN jsonb_build_object(
    'contractVersion', 'R59',
    'queueItemId', p_queue_item_id,
    'leadId', v_item.leads_id,
    'invalidated', true,
    'queueStatus', 'cancelado',
    'leadStatus', 'invalido'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.invalidate_queue_review_item(p_review_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_item record;
BEGIN
  PERFORM public.require_organization_permission('leads.validate');

  SELECT i.queue_review_items_id, i.queue_review_batches_id, i.leads_id,
         b.channel_key, b.resource_id, b.scheduled_date, b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b
    ON b.queue_review_batches_id = i.queue_review_batches_id
  WHERE i.queue_review_items_id = p_review_item_id
    AND i.organizations_id = v_org
    AND i.review_status = 'open'
    AND b.organizations_id = v_org
    AND b.users_id = v_user
    AND b.review_status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue_review_item_not_open';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format('queue-review:%s:%s:%s:%s', v_org, v_item.channel_key, v_item.resource_id, v_item.scheduled_date),
      0
    )
  );

  SELECT i.queue_review_items_id, i.queue_review_batches_id, i.leads_id,
         b.channel_key, b.resource_id, b.scheduled_date, b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b
    ON b.queue_review_batches_id = i.queue_review_batches_id
  WHERE i.queue_review_items_id = p_review_item_id
    AND i.organizations_id = v_org
    AND i.review_status = 'open'
    AND b.organizations_id = v_org
    AND b.users_id = v_user
    AND b.review_status = 'open'
  FOR UPDATE OF i, b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue_review_item_not_open';
  END IF;

  UPDATE public.leads l
  SET lead_status_id = 6,
      leads_updated_at = now()
  WHERE l.leads_id = v_item.leads_id
    AND l.organizations_id = v_org
    AND l.users_id = v_user
    AND l.lead_status_id = 2
    AND l.channels_id = v_item.channels_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue_review_lead_changed';
  END IF;

  UPDATE public.queue_review_items
  SET review_status = 'invalidated',
      updated_at = now()
  WHERE queue_review_items_id = p_review_item_id
    AND organizations_id = v_org
    AND review_status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue_review_item_changed';
  END IF;

  UPDATE public.queue_review_batches
  SET updated_at = now()
  WHERE queue_review_batches_id = v_item.queue_review_batches_id
    AND organizations_id = v_org;

  RETURN jsonb_build_object(
    'contractVersion', 'R59',
    'batchId', v_item.queue_review_batches_id,
    'leadId', v_item.leads_id,
    'status', 'invalido'
  );
END;
$function$;

-- Repara apenas itens gravados pela versão anterior como ERRO por uma invalidação manual.
-- Falhas tecnicas reais permanecem status_id = 6 e continuam reprocessaveis.
UPDATE public.queue_items qi
SET status_id = 7,
    queue_items_error_message = NULL,
    queue_items_updated_at = now()
FROM public.leads l
WHERE l.leads_id = qi.leads_id
  AND l.users_id = qi.users_id
  AND l.lead_status_id = 6
  AND qi.status_id = 6
  AND regexp_replace(lower(public.unaccent(trim(coalesce(qi.queue_items_error_message, '')))), '[^a-z0-9]+', '', 'g') = 'invalidadopelooperador';

UPDATE public.instagram_queue_progress p
SET error_message = NULL,
    instagram_queue_progress_updated_at = now()
FROM public.queue_items qi
WHERE qi.queue_items_id = p.queue_items_id
  AND qi.status_id = 7
  AND p.canonical_step = 'invalid';

COMMIT;
