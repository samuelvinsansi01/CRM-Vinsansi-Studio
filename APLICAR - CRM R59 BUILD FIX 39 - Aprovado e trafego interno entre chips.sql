-- CRM R59 BUILD FIX 39
-- Comercial: Fechado passa definitivamente a Aprovado.
-- Tráfego entre chips próprios é filtrado no webhook do pacote antes de qualquer persistência de conversa/mensagem.
-- Este SQL NÃO cria tabelas de aquecimento nem persiste conteúdo dessas interações.

BEGIN;

-- 1) Migração canônica do estágio Comercial.
ALTER TABLE public.lead_commercial DROP CONSTRAINT IF EXISTS lead_commercial_stage_check;
UPDATE public.lead_commercial SET commercial_stage='aprovado' WHERE commercial_stage='fechado';
ALTER TABLE public.lead_commercial
  ADD CONSTRAINT lead_commercial_stage_check CHECK (
    commercial_stage = ANY (ARRAY[
      'aguardando_resposta'::text,
      'aguardando_previa'::text,
      'previa_enviada'::text,
      'aprovado'::text,
      'recusado'::text
    ])
  );

-- Garantia retroativa: todo aprovado possui o projeto 1:1 do mesmo lead.
INSERT INTO public.lead_projects (organizations_id,leads_id,project_stage,closed_at,updated_by_member_id,lead_projects_created_at,lead_projects_updated_at)
SELECT lc.organizations_id,lc.leads_id,'aguardando_inicio',coalesce(lc.lead_commercial_updated_at,now()),lc.updated_by_member_id,coalesce(lc.lead_commercial_updated_at,now()),now()
FROM public.lead_commercial lc
WHERE lc.commercial_stage='aprovado'
ON CONFLICT (organizations_id,leads_id) DO NOTHING;

INSERT INTO public.lead_project_stage_history (organizations_id,lead_projects_id,project_stage,started_on,updated_by_member_id,created_at,updated_at)
SELECT p.organizations_id,p.lead_projects_id,p.project_stage,(p.closed_at AT TIME ZONE 'America/Sao_Paulo')::date,p.updated_by_member_id,p.closed_at,now()
FROM public.lead_projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_project_stage_history h
  WHERE h.organizations_id=p.organizations_id AND h.lead_projects_id=p.lead_projects_id AND h.completed_on IS NULL
);

-- 2) Regra progressiva: aceita 'fechado' apenas como alias de compatibilidade de clientes antigos,
-- mas sempre persiste/retorna 'aprovado'.
CREATE OR REPLACE FUNCTION public.set_lead_commercial_stage_r59(
  p_leads_id bigint,
  p_commercial_stage text
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
  v_stage text := CASE WHEN lower(trim(coalesce(p_commercial_stage, ''))) = 'fechado' THEN 'aprovado' ELSE lower(trim(coalesce(p_commercial_stage, ''))) END;
  v_status bigint;
  v_current text;
  v_row public.lead_commercial%ROWTYPE;
  v_project_id bigint;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF NOT (v_stage = ANY (ARRAY['aguardando_resposta','aguardando_previa','previa_enviada','aprovado','recusado'])) THEN
    RAISE EXCEPTION 'commercial_stage_invalid';
  END IF;

  SELECT l.lead_status_id INTO v_status
  FROM public.leads l
  WHERE l.leads_id = p_leads_id AND l.organizations_id = v_org AND l.users_id = v_user
  FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF v_status <> 5 THEN RAISE EXCEPTION 'commercial_stage_requires_sent_lead'; END IF;

  SELECT lc.commercial_stage INTO v_current
  FROM public.lead_commercial lc
  WHERE lc.organizations_id = v_org AND lc.leads_id = p_leads_id
  FOR UPDATE;
  v_current := CASE WHEN v_current = 'fechado' THEN 'aprovado' ELSE coalesce(v_current, 'aguardando_resposta') END;

  IF v_current = v_stage THEN
    SELECT * INTO v_row FROM public.lead_commercial lc WHERE lc.organizations_id = v_org AND lc.leads_id = p_leads_id;
    IF v_row.lead_commercial_id IS NULL THEN
      INSERT INTO public.lead_commercial (organizations_id, leads_id, commercial_stage, updated_by_member_id)
      VALUES (v_org, p_leads_id, v_stage, v_member) RETURNING * INTO v_row;
    END IF;
    RETURN jsonb_build_object('leadId',v_row.leads_id,'stage',v_row.commercial_stage,'updatedAt',v_row.lead_commercial_updated_at,'updatedByMemberId',v_row.updated_by_member_id,'previewDueDate',v_row.preview_due_date);
  END IF;

  IF v_current IN ('aprovado','recusado') THEN RAISE EXCEPTION 'commercial_stage_terminal'; END IF;
  IF v_current = 'aguardando_resposta' AND NOT (v_stage = ANY (ARRAY['aguardando_previa','recusado'])) THEN RAISE EXCEPTION 'commercial_stage_transition_invalid'; END IF;
  IF v_current = 'aguardando_previa' AND NOT (v_stage = ANY (ARRAY['previa_enviada','recusado'])) THEN RAISE EXCEPTION 'commercial_stage_transition_invalid'; END IF;
  IF v_current = 'previa_enviada' AND NOT (v_stage = ANY (ARRAY['aprovado','recusado'])) THEN RAISE EXCEPTION 'commercial_stage_transition_invalid'; END IF;

  INSERT INTO public.lead_commercial (organizations_id,leads_id,commercial_stage,updated_by_member_id,lead_commercial_created_at,lead_commercial_updated_at)
  VALUES (v_org,p_leads_id,v_stage,v_member,now(),now())
  ON CONFLICT (organizations_id,leads_id) DO UPDATE SET
    commercial_stage=excluded.commercial_stage,
    updated_by_member_id=excluded.updated_by_member_id,
    lead_commercial_updated_at=now()
  RETURNING * INTO v_row;

  IF v_stage = 'aprovado' THEN
    INSERT INTO public.lead_projects (organizations_id,leads_id,project_stage,closed_at,updated_by_member_id)
    VALUES (v_org,p_leads_id,'aguardando_inicio',now(),v_member)
    ON CONFLICT (organizations_id,leads_id) DO UPDATE SET
      updated_by_member_id=excluded.updated_by_member_id,
      lead_projects_updated_at=now()
    RETURNING lead_projects_id INTO v_project_id;

    INSERT INTO public.lead_project_stage_history (organizations_id,lead_projects_id,project_stage,started_on,updated_by_member_id)
    SELECT v_org,v_project_id,'aguardando_inicio',(now() AT TIME ZONE 'America/Sao_Paulo')::date,v_member
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lead_project_stage_history h
      WHERE h.organizations_id=v_org AND h.lead_projects_id=v_project_id AND h.completed_on IS NULL
    );
  END IF;

  RETURN jsonb_build_object('leadId',v_row.leads_id,'stage',v_row.commercial_stage,'updatedAt',v_row.lead_commercial_updated_at,'updatedByMemberId',v_row.updated_by_member_id,'previewDueDate',v_row.preview_due_date);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_lead_commercial_stage_r59(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_commercial_stage_r59(bigint,text) TO authenticated;


-- 3) Empresas/Comercial: resumo e filtros passam a trabalhar com Aprovado.
-- A chave JSON legado 'fechado' continua por compatibilidade, apontando para a mesma contagem.
CREATE OR REPLACE FUNCTION public.list_leads_page_r59(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_status_id bigint DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_commercial_stage text DEFAULT NULL,
  p_branch_id bigint DEFAULT NULL,
  p_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := CASE WHEN p_page_size IN (10,20,50,100) THEN p_page_size ELSE 20 END;
  v_offset integer;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_commercial text := CASE WHEN lower(trim(coalesce(p_commercial_stage, ''))) = 'fechado' THEN 'aprovado' ELSE lower(trim(coalesce(p_commercial_stage, ''))) END;
  v_state text := nullif(trim(coalesce(p_state, '')), '');
  v_whatsapp bigint;
  v_instagram bigint;
  v_no_destination bigint;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;

  v_offset := (v_page - 1) * v_page_size;
  v_whatsapp := public.queue_review_channel_id('whatsapp');
  v_instagram := public.queue_review_channel_id('instagram');
  SELECT c.channels_id INTO v_no_destination
    FROM public.channels c
   WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g') = 'semdestino'
   ORDER BY c.channels_id
   LIMIT 1;

  WITH all_leads AS (
    SELECT
      l.lead_status_id,
      CASE
        WHEN l.lead_status_id = 5 THEN CASE WHEN lc.commercial_stage = 'fechado' THEN 'aprovado' ELSE coalesce(lc.commercial_stage, 'aguardando_resposta') END
        ELSE NULL
      END AS commercial_stage
    FROM public.leads l
    LEFT JOIN public.lead_commercial lc
      ON lc.organizations_id = l.organizations_id
     AND lc.leads_id = l.leads_id
    WHERE l.organizations_id = v_org
      AND l.users_id = v_user
  )
  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'imported', count(*) FILTER (WHERE lead_status_id = 1)::integer,
    'review', count(*) FILTER (WHERE lead_status_id = 2)::integer,
    'noContact', count(*) FILTER (WHERE lead_status_id = 3)::integer,
    'queued', count(*) FILTER (WHERE lead_status_id = 4)::integer,
    'sent', count(*) FILTER (WHERE lead_status_id = 5)::integer,
    'invalid', count(*) FILTER (WHERE lead_status_id = 6)::integer,
    'duplicates', count(*) FILTER (WHERE lead_status_id = 7)::integer,
    'commercial', jsonb_build_object(
      'aguardandoResposta', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'aguardando_resposta')::integer,
      'aguardandoPrevia', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'aguardando_previa')::integer,
      'previaEnviada', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'previa_enviada')::integer,
      'aprovado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'aprovado')::integer,
      'fechado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'aprovado')::integer,
      'recusado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'recusado')::integer,
      'aguardandoDesign', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'aguardando_previa')::integer,
      'designEnviado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'previa_enviada')::integer
    )
  ) INTO v_summary
  FROM all_leads;

  WITH candidates AS (
    SELECT
      l.leads_id,
      l.branches_id,
      l.lead_status_id,
      l.channels_id,
      l.leads_name,
      l.leads_alternative_name,
      l.leads_phone,
      l.leads_whatsapp,
      l.leads_instagram,
      l.leads_website,
      l.leads_maps,
      l.leads_score,
      l.leads_reviews_count,
      l.leads_origin,
      l.leads_created_at,
      l.leads_updated_at,
      coalesce(br.branches_name, '') AS branch_name,
      coalesce(st.states_code, st.states_name, '') AS state_name,
      coalesce(ci.cities_name, '') AS city_name,
      coalesce(ls.lead_status_name, '') AS status_name,
      CASE
        WHEN l.channels_id = v_whatsapp THEN 'WhatsApp'
        WHEN l.channels_id = v_instagram THEN 'Instagram'
        WHEN l.channels_id = v_no_destination THEN 'Sem destino'
        WHEN sent.channels_id = v_whatsapp THEN 'WhatsApp'
        WHEN sent.channels_id = v_instagram THEN 'Instagram'
        ELSE 'Sem canal'
      END AS channel_name,
      sent.sents_sent_at AS last_sent_at,
      CASE
        WHEN l.lead_status_id = 5 THEN CASE WHEN lc.commercial_stage = 'fechado' THEN 'aprovado' ELSE coalesce(lc.commercial_stage, 'aguardando_resposta') END
        ELSE NULL
      END AS commercial_stage,
      lc.lead_commercial_updated_at AS commercial_updated_at,
      lc.preview_due_date AS preview_due_date,
      coalesce(u.users_name, '') AS commercial_updated_by
    FROM public.leads l
    LEFT JOIN public.branches br
      ON br.branches_id = l.branches_id
     AND br.users_id = l.users_id
    LEFT JOIN public.states st ON st.states_id = l.states_id
    LEFT JOIN public.cities ci ON ci.cities_id = l.cities_id
    LEFT JOIN public.lead_status ls ON ls.lead_status_id = l.lead_status_id
    LEFT JOIN public.lead_commercial lc
      ON lc.organizations_id = l.organizations_id
     AND lc.leads_id = l.leads_id
    LEFT JOIN public.organization_members om
      ON om.organization_members_id = lc.updated_by_member_id
     AND om.organizations_id = l.organizations_id
    LEFT JOIN public.users u ON u.users_id = om.users_id
    LEFT JOIN LATERAL (
      SELECT s.sents_sent_at, s.channels_id
      FROM public.sents s
      WHERE s.organizations_id = v_org
        AND s.users_id = v_user
        AND s.leads_id = l.leads_id
        AND s.sents_sent_at IS NOT NULL
      ORDER BY s.sents_sent_at DESC, s.sents_id DESC
      LIMIT 1
    ) sent ON l.lead_status_id = 5 OR l.channels_id IS NULL
    WHERE l.organizations_id = v_org
      AND l.users_id = v_user
  ), filtered AS (
    SELECT *
    FROM candidates c
    WHERE (p_status_id IS NULL OR c.lead_status_id = p_status_id)
      AND (
        v_channel = '' OR v_channel = 'todos'
        OR lower(public.unaccent(c.channel_name)) = lower(public.unaccent(p_channel))
      )
      AND (
        v_commercial = '' OR v_commercial = 'todos'
        OR c.commercial_stage = v_commercial
      )
      AND (p_branch_id IS NULL OR c.branches_id = p_branch_id)
      AND (
        v_state IS NULL
        OR upper(c.state_name) = upper(v_state)
        OR lower(public.unaccent(c.state_name)) = lower(public.unaccent(v_state))
      )
      AND (
        v_search IS NULL
        OR lower(public.unaccent(concat_ws(' ',
          c.leads_name,
          c.leads_alternative_name,
          c.leads_phone,
          c.leads_whatsapp,
          c.leads_instagram,
          c.leads_website,
          c.city_name,
          c.state_name,
          c.branch_name
        ))) LIKE '%' || lower(public.unaccent(v_search)) || '%'
      )
  ), counted AS (
    SELECT count(*)::integer AS total FROM filtered
  ), page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY leads_updated_at DESC NULLS LAST, leads_id DESC
    LIMIT v_page_size OFFSET v_offset
  )
  SELECT
    c.total,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.leads_id,
      'company', p.leads_name,
      'alternativeName', coalesce(p.leads_alternative_name, ''),
      'branchId', p.branches_id,
      'branch', p.branch_name,
      'state', p.state_name,
      'city', p.city_name,
      'channel', p.channel_name,
      'phone', public.effective_whatsapp_phone(p.leads_whatsapp, p.leads_phone),
      'instagram', coalesce(p.leads_instagram, ''),
      'website', coalesce(p.leads_website, ''),
      'mapsUrl', coalesce(p.leads_maps, ''),
      'rating', coalesce(p.leads_score, 0),
      'reviews', coalesce(p.leads_reviews_count, 0),
      'origin', p.leads_origin,
      'statusId', p.lead_status_id,
      'status', p.status_name,
      'createdAt', p.leads_created_at,
      'updatedAt', p.leads_updated_at,
      'lastSentAt', p.last_sent_at,
      'commercialStage', p.commercial_stage,
      'commercialUpdatedAt', p.commercial_updated_at,
      'commercialUpdatedBy', p.commercial_updated_by,
      'previewDueDate', p.preview_due_date,
      'designDueDate', p.preview_due_date
    ) ORDER BY p.leads_updated_at DESC NULLS LAST, p.leads_id DESC)
      FILTER (WHERE p.leads_id IS NOT NULL), '[]'::jsonb)
  INTO v_total, v_items
  FROM counted c
  LEFT JOIN page_rows p ON true
  GROUP BY c.total;

  RETURN jsonb_build_object(
    'contractVersion', 'R59-FIX39',
    'page', v_page,
    'pageSize', v_page_size,
    'total', coalesce(v_total, 0),
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', coalesce(v_summary, '{}'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_leads_page_r59(integer,integer,text,bigint,text,text,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_leads_page_r59(integer,integer,text,bigint,text,text,bigint,text) TO authenticated;


-- 4) Dashboard: Aprovado é a fonte canônica; alias 'fechado' fica apenas no contrato de compatibilidade.
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

  SELECT count(*)::integer INTO v_new_leads FROM public.leads l WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_created_at>=v_from AND l.leads_created_at<v_to;
  SELECT count(DISTINCT qi.leads_id)::integer INTO v_queued FROM public.queue_items qi WHERE qi.organizations_id=v_org AND qi.users_id=v_user AND qi.status_id<>7 AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)>=v_from AND coalesce(qi.queue_items_scheduled_at,qi.queue_items_created_at)<v_to;
  SELECT count(DISTINCT s.leads_id)::integer INTO v_sent FROM public.sents s WHERE s.organizations_id=v_org AND s.users_id=v_user AND s.leads_id IS NOT NULL AND s.sents_sent_at>=v_from AND s.sents_sent_at<v_to;
  SELECT count(*) FILTER(WHERE l.lead_status_id=6)::integer,count(*) FILTER(WHERE l.lead_status_id=3)::integer INTO v_invalid,v_no_contact FROM public.leads l WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_updated_at>=v_from AND l.leads_updated_at<v_to;

  SELECT count(*) FILTER(WHERE coalesce(lc.commercial_stage,'aguardando_resposta')='aguardando_resposta')::integer,
    count(*) FILTER(WHERE lc.commercial_stage='aguardando_previa')::integer,
    count(*) FILTER(WHERE lc.commercial_stage='previa_enviada')::integer,
    count(*) FILTER(WHERE lc.commercial_stage IN ('aprovado','fechado'))::integer,
    count(*) FILTER(WHERE lc.commercial_stage='recusado')::integer
  INTO v_aguardando_resposta,v_aguardando_previa,v_previa_enviada,v_aprovado,v_recusado
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
    'contractVersion','R59-FIX39','from',v_from,'toExclusive',v_to,
    'newLeads',coalesce(v_new_leads,0),'queued',coalesce(v_queued,0),'sent',coalesce(v_sent,0),'invalid',coalesce(v_invalid,0),'noContact',coalesce(v_no_contact,0),
    'previewsDue',coalesce(v_previews_due,0),'designsDue',coalesce(v_previews_due,0),
    'commercial',jsonb_build_object('aguardandoResposta',v_aguardando_resposta,'aguardandoPrevia',v_aguardando_previa,'previaEnviada',v_previa_enviada,'aprovado',v_aprovado,'fechado',v_aprovado,'recusado',v_recusado,'aguardandoDesign',v_aguardando_previa,'designEnviado',v_previa_enviada),
    'projects',jsonb_build_object('closed',v_projects_closed,'active',v_projects_active,'deliveries',v_projects_deliveries,'overdue',v_projects_overdue,'valueClosed',v_value_closed,'scheduledReceipts',v_scheduled_receipts,'pendingReceipts',v_pending_receipts,'received',v_received,'receivableTotal',v_receivable_total)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) TO authenticated;


COMMIT;
