-- CRM - Vinsansi Studio v2.4.0-R18
-- Etapa 10: Base Permanente é terminal para prospecção.
-- Uma empresa presente em permanent_records nunca volta a ser elegível para disparo.

BEGIN;

-- Compatibilidade: mantemos as colunas legadas, mas nenhuma classificação comercial
-- pode liberar reentrada. Resultado comercial passa a ser apenas memória/analytics.
UPDATE public.commercial_outcomes
SET allow_reentry = false,
    minimum_reentry_days = NULL;

-- A função pública/legada de decisão continua existindo para não quebrar consumidores,
-- mas a semântica agora é definitiva: existe na Base Permanente => não contatar novamente.
CREATE OR REPLACE FUNCTION public.commercial_reentry_decision(
  p_organizations_id bigint,
  p_canonical_lead_id bigint,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_record public.permanent_records%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' AND p_organizations_id<>public.current_organization_id() THEN
    RAISE EXCEPTION 'organization_access_denied';
  END IF;

  SELECT pr.*
    INTO v_record
  FROM public.permanent_records pr
  WHERE pr.organizations_id=p_organizations_id
    AND pr.canonical_lead_id=p_canonical_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'not_in_permanent_base'
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'permanent_record_blocks_contact',
    'permanentRecordId', v_record.permanent_records_id,
    'outcome', v_record.commercial_outcome,
    'recordStatus', v_record.record_status,
    'lastContactAt', v_record.last_contact_at,
    'lastSentAt', v_record.last_sent_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commercial_reentry_decision(bigint,bigint,timestamptz) TO authenticated,service_role;

-- A preparação manual da fila também respeita a Base Permanente. Itens bloqueados
-- retornam como "blocked" sem impedir que outros leads elegíveis do mesmo lote avancem.
CREATE OR REPLACE FUNCTION public.prepare_queue_items(
  p_channel text,
  p_resource_id bigint,
  p_scheduled_date date,
  p_items jsonb
)
RETURNS TABLE(
  lead_id bigint,
  queue_item_id bigint,
  outcome text,
  reason text,
  queue_id bigint,
  queue_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_allowed jsonb;
  v_row record;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  -- Preserva as validações e mensagens do contrato interno para payloads inválidos.
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN
    RETURN QUERY
    SELECT * FROM public.prepare_queue_items_rbac_inner(p_channel,p_resource_id,p_scheduled_date,p_items);
    RETURN;
  END IF;

  FOR v_row IN
    WITH parsed AS (
      SELECT
        e.value,
        e.ordinal,
        CASE
          WHEN coalesce(e.value->>'lead_id','') ~ '^[0-9]+$' THEN (e.value->>'lead_id')::bigint
          ELSE NULL
        END AS parsed_lead_id
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value,ordinal)
    )
    SELECT p.parsed_lead_id AS blocked_lead_id
    FROM parsed p
    JOIN public.leads l
      ON l.leads_id=p.parsed_lead_id
     AND l.organizations_id=v_org
    WHERE EXISTS(
      SELECT 1
      FROM public.permanent_records pr
      WHERE pr.organizations_id=v_org
        AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
    )
    ORDER BY p.ordinal
  LOOP
    lead_id:=v_row.blocked_lead_id;
    queue_item_id:=NULL;
    outcome:='blocked';
    reason:='Empresa já está na Base Permanente e não pode ser contatada novamente.';
    queue_id:=NULL;
    queue_position:=NULL;
    RETURN NEXT;
  END LOOP;

  WITH parsed AS (
    SELECT
      e.value,
      e.ordinal,
      CASE
        WHEN coalesce(e.value->>'lead_id','') ~ '^[0-9]+$' THEN (e.value->>'lead_id')::bigint
        ELSE NULL
      END AS parsed_lead_id
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value,ordinal)
  )
  SELECT coalesce(jsonb_agg(p.value ORDER BY p.ordinal),'[]'::jsonb)
    INTO v_allowed
  FROM parsed p
  LEFT JOIN public.leads l
    ON l.leads_id=p.parsed_lead_id
   AND l.organizations_id=v_org
  WHERE l.leads_id IS NULL
     OR NOT EXISTS(
       SELECT 1
       FROM public.permanent_records pr
       WHERE pr.organizations_id=v_org
         AND pr.canonical_lead_id=coalesce(l.canonical_lead_id,l.leads_id)
     );

  IF jsonb_array_length(coalesce(v_allowed,'[]'::jsonb))>0 THEN
    RETURN QUERY
    SELECT *
    FROM public.prepare_queue_items_rbac_inner(p_channel,p_resource_id,p_scheduled_date,v_allowed);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text,bigint,date,jsonb) TO authenticated;

-- Defesa em profundidade para executores. Mesmo que exista um queue_item antigo,
-- qualquer tentativa de colocá-lo em processamento é recusada se a empresa já entrou
-- na Base Permanente. O trigger cobre Instagram e o Worker WhatsApp.
CREATE OR REPLACE FUNCTION public.block_permanent_record_dispatch_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_status_key text;
  v_org bigint;
  v_canonical bigint;
  v_record_id bigint;
BEGIN
  IF NEW.leads_id IS NULL OR NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  SELECT regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g')
    INTO v_status_key
  FROM public.status s
  WHERE s.status_id=NEW.status_id;

  IF coalesce(v_status_key,'') NOT IN ('processando','processing','sending') THEN
    RETURN NEW;
  END IF;

  SELECT l.organizations_id,coalesce(l.canonical_lead_id,l.leads_id)
    INTO v_org,v_canonical
  FROM public.leads l
  WHERE l.leads_id=NEW.leads_id;

  IF v_org IS NULL OR v_canonical IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pr.permanent_records_id
    INTO v_record_id
  FROM public.permanent_records pr
  WHERE pr.organizations_id=v_org
    AND pr.canonical_lead_id=v_canonical
  LIMIT 1;

  IF v_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'permanent_record_blocks_contact:%',v_record_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_permanent_record_dispatch ON public.queue_items;
CREATE TRIGGER block_permanent_record_dispatch
BEFORE UPDATE OF status_id ON public.queue_items
FOR EACH ROW
EXECUTE FUNCTION public.block_permanent_record_dispatch_trigger();

-- Atualiza evidências de homologação já criadas para refletir a regra definitiva.
UPDATE public.production_homologation_checks
SET label='Base Permanente bloqueia definitivamente nova prospecção e novo disparo'
WHERE check_key='suppression_reentry';

COMMIT;
