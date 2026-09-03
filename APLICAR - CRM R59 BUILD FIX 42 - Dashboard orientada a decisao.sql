BEGIN;

-- R59 BUILD FIX 42
-- Dashboard orientada a decisão.
-- O período controla eventos; estados operacionais continuam representando o estado atual.
-- Nenhuma tabela nova é criada e o contrato JSON permanece retrocompatível.

CREATE OR REPLACE FUNCTION public.dashboard_summary_r59(p_from timestamptz,p_to_exclusive timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_from timestamptz := p_from;
  v_to timestamptz := p_to_exclusive;
  v_from_date date;
  v_to_date_exclusive date;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_new_leads integer:=0; v_queued integer:=0; v_sent integer:=0; v_invalid integer:=0; v_no_contact integer:=0; v_previews_due integer:=0;
  v_aguardando_resposta integer:=0; v_aguardando_previa integer:=0; v_previa_enviada integer:=0; v_aprovado integer:=0; v_recusado integer:=0;
  v_projects_closed integer:=0; v_projects_active integer:=0; v_projects_deliveries integer:=0; v_projects_overdue integer:=0;
  v_value_closed numeric:=0; v_scheduled_receipts numeric:=0; v_pending_receipts numeric:=0; v_received numeric:=0; v_receivable_total numeric:=0;
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to<=v_from THEN RAISE EXCEPTION 'dashboard_period_invalid'; END IF;

  v_from_date := (v_from AT TIME ZONE 'America/Sao_Paulo')::date;
  v_to_date_exclusive := (v_to AT TIME ZONE 'America/Sao_Paulo')::date;

  -- EVENTOS DO PERÍODO
  SELECT count(*)::integer
    INTO v_new_leads
  FROM public.leads l
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.leads_created_at>=v_from
    AND l.leads_created_at<v_to;

  SELECT count(DISTINCT s.leads_id)::integer
    INTO v_sent
  FROM public.sents s
  WHERE s.organizations_id=v_org
    AND s.users_id=v_user
    AND s.leads_id IS NOT NULL
    AND s.sents_sent_at>=v_from
    AND s.sents_sent_at<v_to;

  -- ESTADO ATUAL DA BASE / OPERAÇÃO
  SELECT count(*) FILTER(WHERE l.lead_status_id=4)::integer,
         count(*) FILTER(WHERE l.lead_status_id=6)::integer,
         count(*) FILTER(WHERE l.lead_status_id=3)::integer
    INTO v_queued,v_invalid,v_no_contact
  FROM public.leads l
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user;

  -- ESTÁGIOS ABERTOS = estado atual.
  SELECT count(*) FILTER(WHERE coalesce(lc.commercial_stage,'aguardando_resposta')='aguardando_resposta')::integer,
         count(*) FILTER(WHERE lc.commercial_stage='aguardando_previa')::integer,
         count(*) FILTER(WHERE lc.commercial_stage='previa_enviada')::integer
    INTO v_aguardando_resposta,v_aguardando_previa,v_previa_enviada
  FROM public.leads l
  LEFT JOIN public.lead_commercial lc
    ON lc.organizations_id=l.organizations_id
   AND lc.leads_id=l.leads_id
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.lead_status_id=5
    AND coalesce(lc.commercial_stage,'aguardando_resposta') NOT IN ('aprovado','fechado','recusado');

  -- DESFECHOS = eventos ocorridos no período selecionado.
  SELECT count(*) FILTER(WHERE lc.commercial_stage IN ('aprovado','fechado'))::integer,
         count(*) FILTER(WHERE lc.commercial_stage='recusado')::integer
    INTO v_aprovado,v_recusado
  FROM public.lead_commercial lc
  JOIN public.leads l
    ON l.leads_id=lc.leads_id
   AND l.organizations_id=lc.organizations_id
  WHERE lc.organizations_id=v_org
    AND l.users_id=v_user
    AND lc.lead_commercial_updated_at>=v_from
    AND lc.lead_commercial_updated_at<v_to;

  -- AÇÕES AGENDADAS dentro do período selecionado.
  SELECT count(*)::integer
    INTO v_previews_due
  FROM public.lead_commercial lc
  JOIN public.leads l
    ON l.leads_id=lc.leads_id
   AND l.organizations_id=lc.organizations_id
  WHERE lc.organizations_id=v_org
    AND l.users_id=v_user
    AND l.lead_status_id=5
    AND lc.commercial_stage='aguardando_previa'
    AND lc.preview_due_date IS NOT NULL
    AND lc.preview_due_date>=v_from_date
    AND lc.preview_due_date<v_to_date_exclusive;

  -- Projetos: criação/valor no período; andamento/atraso como estado atual;
  -- entregas representam projetos ainda não entregues com prazo dentro do período.
  SELECT count(*) FILTER(WHERE p.closed_at>=v_from AND p.closed_at<v_to)::integer,
         count(*) FILTER(WHERE p.project_stage<>'entregue')::integer,
         count(*) FILTER(WHERE p.project_stage<>'entregue' AND p.project_due_date>=v_from_date AND p.project_due_date<v_to_date_exclusive)::integer,
         count(*) FILTER(WHERE p.project_stage<>'entregue' AND p.project_due_date IS NOT NULL AND p.project_due_date<v_today)::integer,
         coalesce(sum(p.total_value) FILTER(WHERE p.closed_at>=v_from AND p.closed_at<v_to),0)
    INTO v_projects_closed,v_projects_active,v_projects_deliveries,v_projects_overdue,v_value_closed
  FROM public.lead_projects p
  JOIN public.leads l
    ON l.leads_id=p.leads_id
   AND l.organizations_id=p.organizations_id
  WHERE p.organizations_id=v_org
    AND l.users_id=v_user;

  -- Financeiro: recebido/vencimentos no período; saldo em aberto como estado atual.
  SELECT coalesce(sum(x.scheduled),0),
         coalesce(sum(x.pending),0),
         coalesce(sum(x.received),0),
         coalesce(sum(x.open_amount),0)
    INTO v_scheduled_receipts,v_pending_receipts,v_received,v_receivable_total
  FROM (
    SELECT
      (CASE WHEN p.first_payment_due_date>=v_from_date AND p.first_payment_due_date<v_to_date_exclusive THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_due_date>=v_from_date AND p.second_payment_due_date<v_to_date_exclusive THEN coalesce(p.total_value,0)/2 ELSE 0 END) scheduled,
      (CASE WHEN p.first_payment_due_date>=v_from_date AND p.first_payment_due_date<v_to_date_exclusive AND p.first_payment_received_on IS NULL THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_due_date>=v_from_date AND p.second_payment_due_date<v_to_date_exclusive AND p.second_payment_received_on IS NULL THEN coalesce(p.total_value,0)/2 ELSE 0 END) pending,
      (CASE WHEN p.first_payment_received_on>=v_from_date AND p.first_payment_received_on<v_to_date_exclusive THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_received_on>=v_from_date AND p.second_payment_received_on<v_to_date_exclusive THEN coalesce(p.total_value,0)/2 ELSE 0 END) received,
      greatest(
        coalesce(p.total_value,0)
        - (
          CASE WHEN p.first_payment_received_on IS NOT NULL THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
          + CASE WHEN p.payment_terms='50_50' AND p.second_payment_received_on IS NOT NULL THEN coalesce(p.total_value,0)/2 ELSE 0 END
        ),
        0
      ) open_amount
    FROM public.lead_projects p
    JOIN public.leads l
      ON l.leads_id=p.leads_id
     AND l.organizations_id=p.organizations_id
    WHERE p.organizations_id=v_org
      AND l.users_id=v_user
  ) x;

  RETURN jsonb_build_object(
    'contractVersion','R59-FIX42',
    'from',v_from,
    'toExclusive',v_to,
    'newLeads',coalesce(v_new_leads,0),
    'queued',coalesce(v_queued,0),
    'sent',coalesce(v_sent,0),
    'invalid',coalesce(v_invalid,0),
    'noContact',coalesce(v_no_contact,0),
    'previewsDue',coalesce(v_previews_due,0),
    'designsDue',coalesce(v_previews_due,0),
    'commercial',jsonb_build_object(
      'aguardandoResposta',v_aguardando_resposta,
      'aguardandoPrevia',v_aguardando_previa,
      'previaEnviada',v_previa_enviada,
      'aprovado',v_aprovado,
      'fechado',v_aprovado,
      'recusado',v_recusado,
      'aguardandoDesign',v_aguardando_previa,
      'designEnviado',v_previa_enviada
    ),
    'projects',jsonb_build_object(
      'closed',v_projects_closed,
      'active',v_projects_active,
      'deliveries',v_projects_deliveries,
      'overdue',v_projects_overdue,
      'valueClosed',v_value_closed,
      'scheduledReceipts',v_scheduled_receipts,
      'pendingReceipts',v_pending_receipts,
      'received',v_received,
      'receivableTotal',v_receivable_total
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) TO authenticated;

COMMIT;
