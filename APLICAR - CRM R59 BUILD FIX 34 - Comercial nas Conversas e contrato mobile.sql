-- CRM R59 BUILD FIX 34
-- 1) Endurece a gravação da data prevista do design no banco.
-- 2) A nova data não pode nascer no passado segundo o fuso operacional America/Sao_Paulo.
-- 3) Datas que se tornam atrasadas continuam válidas e visíveis; não existe CHECK temporal na tabela.
-- 4) A edição continua exclusiva de leads enviados, estágio aguardando_design e permissão leads.edit.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_lead_design_due_date_r59(
  p_leads_id bigint,
  p_design_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_member bigint := public.current_organization_member_id();
  v_status bigint;
  v_stage text;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_row public.lead_commercial%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'organization_context_required';
  END IF;

  IF p_design_due_date IS NOT NULL AND p_design_due_date < v_today THEN
    RAISE EXCEPTION 'design_due_date_past_invalid';
  END IF;

  SELECT l.lead_status_id
    INTO v_status
    FROM public.leads l
   WHERE l.leads_id = p_leads_id
     AND l.organizations_id = v_org
     AND l.users_id = v_user
   FOR UPDATE;

  IF v_status IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF v_status <> 5 THEN RAISE EXCEPTION 'design_due_date_requires_sent_lead'; END IF;

  SELECT lc.commercial_stage
    INTO v_stage
    FROM public.lead_commercial lc
   WHERE lc.organizations_id = v_org
     AND lc.leads_id = p_leads_id
   FOR UPDATE;

  IF coalesce(v_stage, 'aguardando_resposta') <> 'aguardando_design' THEN
    RAISE EXCEPTION 'design_due_date_requires_awaiting_design';
  END IF;

  UPDATE public.lead_commercial
     SET design_due_date = p_design_due_date,
         updated_by_member_id = v_member,
         lead_commercial_updated_at = now()
   WHERE organizations_id = v_org
     AND leads_id = p_leads_id
  RETURNING * INTO v_row;

  IF v_row.lead_commercial_id IS NULL THEN
    RAISE EXCEPTION 'lead_commercial_not_found';
  END IF;

  RETURN jsonb_build_object(
    'leadId', v_row.leads_id,
    'stage', v_row.commercial_stage,
    'designDueDate', v_row.design_due_date,
    'updatedAt', v_row.lead_commercial_updated_at,
    'updatedByMemberId', v_row.updated_by_member_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_lead_design_due_date_r59(bigint,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_design_due_date_r59(bigint,date) TO authenticated;

COMMIT;
