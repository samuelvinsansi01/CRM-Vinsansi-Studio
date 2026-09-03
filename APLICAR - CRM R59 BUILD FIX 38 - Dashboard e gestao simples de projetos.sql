-- CRM R59 BUILD FIX 38
-- Dashboard final de Projetos/Fluxo de caixa + filtro de pagamento em Projetos.
-- Não cria financeiro contábil, tarefas, Kanban ou controle de horas.

BEGIN;

DROP FUNCTION IF EXISTS public.list_projects_r59(integer,integer,text,text,text);

CREATE OR REPLACE FUNCTION public.list_projects_r59(p_page integer DEFAULT 1,p_page_size integer DEFAULT 20,p_search text DEFAULT NULL,p_stage text DEFAULT NULL,p_status text DEFAULT NULL,p_payment_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_page integer := greatest(1,coalesce(p_page,1));
  v_page_size integer := CASE WHEN p_page_size IN (10,20,50,100) THEN p_page_size ELSE 20 END;
  v_offset integer;
  v_search text := nullif(trim(coalesce(p_search,'')),'');
  v_stage text := nullif(lower(trim(coalesce(p_stage,''))),'');
  v_status text := nullif(lower(trim(coalesce(p_status,''))),'');
  v_payment_status text := nullif(lower(trim(coalesce(p_payment_status,''))),'');
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  v_offset := (v_page-1)*v_page_size;

  WITH base AS (
    SELECT p.*,
      CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2.0 ELSE coalesce(p.total_value,0) END AS first_amount,
      CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2.0 ELSE 0::numeric END AS second_amount
    FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
    WHERE p.organizations_id=v_org AND l.users_id=v_user
  ), calc AS (
    SELECT b.*,
      (CASE WHEN b.first_payment_received_on IS NOT NULL THEN b.first_amount ELSE 0 END + CASE WHEN b.second_payment_received_on IS NOT NULL THEN b.second_amount ELSE 0 END) AS received_amount
    FROM base b
  )
  SELECT jsonb_build_object(
    'total',count(*)::integer,
    'active',count(*) FILTER(WHERE project_stage<>'entregue')::integer,
    'delivered',count(*) FILTER(WHERE project_stage='entregue')::integer,
    'overdue',count(*) FILTER(WHERE project_stage<>'entregue' AND project_due_date IS NOT NULL AND project_due_date<v_today)::integer,
    'dueThisWeek',count(*) FILTER(WHERE project_stage<>'entregue' AND project_due_date>=v_today AND project_due_date<v_today+7)::integer,
    'totalValue',coalesce(sum(total_value),0),
    'received',coalesce(sum(received_amount),0),
    'receivable',coalesce(sum(greatest(coalesce(total_value,0)-received_amount,0)),0)
  ) INTO v_summary FROM calc;

  WITH candidates AS (
    SELECT p.*,l.leads_name,l.leads_alternative_name,coalesce(br.branches_name,'') branch_name,coalesce(st.states_code,st.states_name,'') state_name,coalesce(ci.cities_name,'') city_name,
      h.started_on stage_started_on,h.due_on stage_due_on,
      CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2.0 ELSE coalesce(p.total_value,0) END AS first_amount,
      CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2.0 ELSE 0::numeric END AS second_amount
    FROM public.lead_projects p
    JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
    LEFT JOIN public.branches br ON br.branches_id=l.branches_id
    LEFT JOIN public.states st ON st.states_id=l.states_id
    LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id
    LEFT JOIN LATERAL (
      SELECT sh.started_on,sh.due_on FROM public.lead_project_stage_history sh
      WHERE sh.organizations_id=p.organizations_id AND sh.lead_projects_id=p.lead_projects_id AND sh.completed_on IS NULL
      ORDER BY sh.lead_project_stage_history_id DESC LIMIT 1
    ) h ON true
    WHERE p.organizations_id=v_org AND l.users_id=v_user
  ), calc AS (
    SELECT c.*,
      (CASE WHEN c.first_payment_received_on IS NOT NULL THEN c.first_amount ELSE 0 END + CASE WHEN c.second_payment_received_on IS NOT NULL THEN c.second_amount ELSE 0 END) AS received_amount
    FROM candidates c
  ), filtered AS (
    SELECT * FROM calc c WHERE
      (v_stage IS NULL OR c.project_stage=v_stage)
      AND (v_status IS NULL OR
        (v_status='ativos' AND c.project_stage<>'entregue') OR
        (v_status='entregues' AND c.project_stage='entregue') OR
        (v_status='atrasados' AND c.project_stage<>'entregue' AND c.project_due_date IS NOT NULL AND c.project_due_date<v_today))
      AND (v_payment_status IS NULL OR (CASE
        WHEN c.total_value IS NULL OR c.total_value<=0 OR c.payment_terms IS NULL THEN 'nao_configurado'
        WHEN greatest(coalesce(c.total_value,0)-c.received_amount,0)<=0 THEN 'pago'
        WHEN (c.first_payment_received_on IS NULL AND c.first_payment_due_date IS NOT NULL AND c.first_payment_due_date<v_today) OR (c.payment_terms='50_50' AND c.second_payment_received_on IS NULL AND c.second_payment_due_date IS NOT NULL AND c.second_payment_due_date<v_today) THEN 'atrasado'
        WHEN c.received_amount>0 THEN 'parcial' ELSE 'pendente' END)=v_payment_status)
      AND (v_search IS NULL OR lower(public.unaccent(concat_ws(' ',c.leads_name,c.leads_alternative_name,c.branch_name,c.city_name,c.state_name))) LIKE '%'||lower(public.unaccent(v_search))||'%')
  ), counted AS (SELECT count(*)::integer total FROM filtered), page_rows AS (
    SELECT * FROM filtered ORDER BY CASE WHEN project_stage='entregue' THEN 1 ELSE 0 END,project_due_date ASC NULLS LAST,lead_projects_updated_at DESC LIMIT v_page_size OFFSET v_offset
  )
  SELECT ct.total,coalesce(jsonb_agg(jsonb_build_object(
    'id',p.lead_projects_id,'leadId',p.leads_id,'company',p.leads_name,'alternativeName',coalesce(p.leads_alternative_name,''),'branch',p.branch_name,'state',p.state_name,'city',p.city_name,
    'stage',p.project_stage,'stageStartedOn',p.stage_started_on,'stageDueOn',p.stage_due_on,'projectStartDate',p.project_start_date,'projectDueDate',p.project_due_date,'closedAt',p.closed_at,'deliveredOn',p.delivered_on,
    'totalValue',coalesce(p.total_value,0),'paymentTerms',p.payment_terms,'firstPaymentDueDate',p.first_payment_due_date,'firstPaymentReceivedOn',p.first_payment_received_on,'secondPaymentDueDate',p.second_payment_due_date,'secondPaymentReceivedOn',p.second_payment_received_on,
    'amountReceived',p.received_amount,'amountReceivable',greatest(coalesce(p.total_value,0)-p.received_amount,0),
    'paymentStatus',CASE
      WHEN p.total_value IS NULL OR p.total_value<=0 OR p.payment_terms IS NULL THEN 'nao_configurado'
      WHEN greatest(coalesce(p.total_value,0)-p.received_amount,0)<=0 THEN 'pago'
      WHEN (p.first_payment_received_on IS NULL AND p.first_payment_due_date IS NOT NULL AND p.first_payment_due_date<v_today) OR (p.payment_terms='50_50' AND p.second_payment_received_on IS NULL AND p.second_payment_due_date IS NOT NULL AND p.second_payment_due_date<v_today) THEN 'atrasado'
      WHEN p.received_amount>0 THEN 'parcial' ELSE 'pendente' END,
    'updatedAt',p.lead_projects_updated_at
  ) ORDER BY CASE WHEN p.project_stage='entregue' THEN 1 ELSE 0 END,p.project_due_date ASC NULLS LAST,p.lead_projects_updated_at DESC) FILTER(WHERE p.lead_projects_id IS NOT NULL),'[]'::jsonb)
  INTO v_total,v_items FROM counted ct LEFT JOIN page_rows p ON true GROUP BY ct.total;

  RETURN jsonb_build_object('contractVersion','R59-PROJECTS-2','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',v_items,'summary',v_summary);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_projects_r59(integer,integer,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_projects_r59(integer,integer,text,text,text,text) TO authenticated;


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
  v_aguardando_resposta integer:=0; v_aguardando_previa integer:=0; v_previa_enviada integer:=0; v_fechado integer:=0; v_recusado integer:=0;
  v_projects_closed integer:=0; v_projects_active integer:=0; v_projects_deliveries integer:=0; v_projects_overdue integer:=0;
  v_value_closed numeric:=0; v_scheduled_receipts numeric:=0; v_pending_receipts numeric:=0; v_received numeric:=0; v_receivable_total numeric:=0;
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to<=v_from THEN RAISE EXCEPTION 'dashboard_period_invalid'; END IF;
  v_from_date := (v_from AT TIME ZONE 'America/Sao_Paulo')::date;
  v_to_date_exclusive := (v_to AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT count(*)::integer INTO v_new_leads FROM public.leads l WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_created_at>=v_from AND l.leads_created_at<v_to;
  SELECT count(DISTINCT qi.leads_id)::integer INTO v_queued FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.users_id=v_user AND qi.status_id<>7 AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)>=v_from AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)<v_to;
  SELECT count(DISTINCT s.leads_id)::integer INTO v_sent FROM public.sents s WHERE s.organizations_id=v_org AND s.users_id=v_user AND s.leads_id IS NOT NULL AND s.sents_sent_at>=v_from AND s.sents_sent_at<v_to;
  SELECT count(*) FILTER(WHERE l.lead_status_id=6)::integer,count(*) FILTER(WHERE l.lead_status_id=3)::integer INTO v_invalid,v_no_contact FROM public.leads l WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_updated_at>=v_from AND l.leads_updated_at<v_to;

  SELECT count(*) FILTER(WHERE coalesce(lc.commercial_stage,'aguardando_resposta')='aguardando_resposta')::integer,
    count(*) FILTER(WHERE lc.commercial_stage='aguardando_previa')::integer,
    count(*) FILTER(WHERE lc.commercial_stage='previa_enviada')::integer,
    count(*) FILTER(WHERE lc.commercial_stage='fechado')::integer,
    count(*) FILTER(WHERE lc.commercial_stage='recusado')::integer
  INTO v_aguardando_resposta,v_aguardando_previa,v_previa_enviada,v_fechado,v_recusado
  FROM public.leads l LEFT JOIN public.lead_commercial lc ON lc.organizations_id=l.organizations_id AND lc.leads_id=l.leads_id
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=5 AND coalesce(lc.lead_commercial_updated_at,l.leads_updated_at)>=v_from AND coalesce(lc.lead_commercial_updated_at,l.leads_updated_at)<v_to;

  SELECT count(*)::integer INTO v_previews_due FROM public.lead_commercial lc JOIN public.leads l ON l.leads_id=lc.leads_id AND l.organizations_id=lc.organizations_id
  WHERE lc.organizations_id=v_org AND l.users_id=v_user AND l.lead_status_id=5 AND lc.commercial_stage='aguardando_previa' AND lc.preview_due_date IS NOT NULL AND lc.preview_due_date>=v_from_date AND lc.preview_due_date<v_to_date_exclusive;

  SELECT count(*) FILTER(WHERE p.closed_at>=v_from AND p.closed_at<v_to)::integer,
         count(*) FILTER(WHERE p.project_stage<>'entregue')::integer,
         count(*) FILTER(WHERE p.project_due_date>=v_from_date AND p.project_due_date<v_to_date_exclusive)::integer,
         count(*) FILTER(WHERE p.project_stage<>'entregue' AND p.project_due_date IS NOT NULL AND p.project_due_date<v_today)::integer,
         coalesce(sum(p.total_value) FILTER(WHERE p.closed_at>=v_from AND p.closed_at<v_to),0)
  INTO v_projects_closed,v_projects_active,v_projects_deliveries,v_projects_overdue,v_value_closed
  FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
  WHERE p.organizations_id=v_org AND l.users_id=v_user;

  SELECT coalesce(sum(x.scheduled),0),coalesce(sum(x.pending),0),coalesce(sum(x.received),0),coalesce(sum(x.open_amount),0)
  INTO v_scheduled_receipts,v_pending_receipts,v_received,v_receivable_total
  FROM (
    SELECT
      (CASE WHEN p.first_payment_due_date>=v_from_date AND p.first_payment_due_date<v_to_date_exclusive THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_due_date>=v_from_date AND p.second_payment_due_date<v_to_date_exclusive THEN coalesce(p.total_value,0)/2 ELSE 0 END) scheduled,
      (CASE WHEN p.first_payment_due_date>=v_from_date AND p.first_payment_due_date<v_to_date_exclusive AND p.first_payment_received_on IS NULL THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_due_date>=v_from_date AND p.second_payment_due_date<v_to_date_exclusive AND p.second_payment_received_on IS NULL THEN coalesce(p.total_value,0)/2 ELSE 0 END) pending,
      (CASE WHEN p.first_payment_received_on>=v_from_date AND p.first_payment_received_on<v_to_date_exclusive THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_received_on>=v_from_date AND p.second_payment_received_on<v_to_date_exclusive THEN coalesce(p.total_value,0)/2 ELSE 0 END) received,
      greatest(coalesce(p.total_value,0) - (CASE WHEN p.first_payment_received_on IS NOT NULL THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END + CASE WHEN p.payment_terms='50_50' AND p.second_payment_received_on IS NOT NULL THEN coalesce(p.total_value,0)/2 ELSE 0 END),0) open_amount
    FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
    WHERE p.organizations_id=v_org AND l.users_id=v_user
  ) x;

  RETURN jsonb_build_object(
    'contractVersion','R59-FIX38','from',v_from,'toExclusive',v_to,
    'newLeads',coalesce(v_new_leads,0),'queued',coalesce(v_queued,0),'sent',coalesce(v_sent,0),'invalid',coalesce(v_invalid,0),'noContact',coalesce(v_no_contact,0),
    'previewsDue',coalesce(v_previews_due,0),'designsDue',coalesce(v_previews_due,0),
    'commercial',jsonb_build_object('aguardandoResposta',v_aguardando_resposta,'aguardandoPrevia',v_aguardando_previa,'previaEnviada',v_previa_enviada,'fechado',v_fechado,'recusado',v_recusado,'aguardandoDesign',v_aguardando_previa,'designEnviado',v_previa_enviada),
    'projects',jsonb_build_object('closed',v_projects_closed,'active',v_projects_active,'deliveries',v_projects_deliveries,'overdue',v_projects_overdue,'valueClosed',v_value_closed,'scheduledReceipts',v_scheduled_receipts,'pendingReceipts',v_pending_receipts,'received',v_received,'receivableTotal',v_receivable_total)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) TO authenticated;


COMMIT;
