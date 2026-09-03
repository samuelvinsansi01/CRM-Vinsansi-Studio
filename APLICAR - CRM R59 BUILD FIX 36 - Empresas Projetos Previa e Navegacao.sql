-- CRM R59 BUILD FIX 36
-- Arquitetura final da jornada: Empresas -> Comercial -> Projetos.
-- Navegacao e interface estao no pacote; este SQL migra a nomenclatura de Previa e cria a gestao simples de projetos/recebimentos.

BEGIN;

-- 1) Comercial: Design (pre-venda) passa a se chamar Previa em toda a fonte de verdade.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.lead_commercial'::regclass
      AND attname = 'design_due_date'
      AND NOT attisdropped
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.lead_commercial'::regclass
      AND attname = 'preview_due_date'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE public.lead_commercial RENAME COLUMN design_due_date TO preview_due_date;
  END IF;
END;
$do$;

ALTER TABLE public.lead_commercial DROP CONSTRAINT IF EXISTS lead_commercial_stage_check;
UPDATE public.lead_commercial SET commercial_stage = 'aguardando_previa' WHERE commercial_stage = 'aguardando_design';
UPDATE public.lead_commercial SET commercial_stage = 'previa_enviada' WHERE commercial_stage = 'design_enviado';
ALTER TABLE public.lead_commercial
  ADD CONSTRAINT lead_commercial_stage_check CHECK (
    commercial_stage = ANY (ARRAY[
      'aguardando_resposta'::text,
      'aguardando_previa'::text,
      'previa_enviada'::text,
      'fechado'::text,
      'recusado'::text
    ])
  );

DROP INDEX IF EXISTS public.lead_commercial_org_design_due_idx;
CREATE INDEX IF NOT EXISTS lead_commercial_org_preview_due_idx
  ON public.lead_commercial (organizations_id, preview_due_date)
  WHERE commercial_stage = 'aguardando_previa';

-- 2) Projeto e uma extensao 1:1 do mesmo lead. Nenhum dado de identidade e duplicado.
CREATE TABLE IF NOT EXISTS public.lead_projects (
  lead_projects_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  project_stage text NOT NULL DEFAULT 'aguardando_inicio',
  total_value numeric(12,2),
  payment_terms text,
  project_start_date date,
  project_due_date date,
  first_payment_due_date date,
  first_payment_received_on date,
  second_payment_due_date date,
  second_payment_received_on date,
  closed_at timestamptz NOT NULL DEFAULT now(),
  delivered_on date,
  updated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  lead_projects_created_at timestamptz NOT NULL DEFAULT now(),
  lead_projects_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_projects_org_lead_unique UNIQUE (organizations_id, leads_id),
  CONSTRAINT lead_projects_stage_check CHECK (project_stage = ANY (ARRAY[
    'aguardando_inicio'::text,
    'desenvolvendo_design'::text,
    'aguardando_aprovacao'::text,
    'em_revisao'::text,
    'passando_wordpress'::text,
    'aguardando_aprovacao_final'::text,
    'entregue'::text
  ])),
  CONSTRAINT lead_projects_value_check CHECK (total_value IS NULL OR total_value >= 0),
  CONSTRAINT lead_projects_payment_terms_check CHECK (payment_terms IS NULL OR payment_terms = ANY (ARRAY['100_inicio'::text,'50_50'::text]))
);

CREATE INDEX IF NOT EXISTS lead_projects_org_stage_idx ON public.lead_projects (organizations_id, project_stage, project_due_date, lead_projects_updated_at DESC);
CREATE INDEX IF NOT EXISTS lead_projects_org_closed_idx ON public.lead_projects (organizations_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS lead_projects_org_payment_due_idx ON public.lead_projects (organizations_id, first_payment_due_date, second_payment_due_date);

ALTER TABLE public.lead_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_projects_org_select ON public.lead_projects;
CREATE POLICY lead_projects_org_select ON public.lead_projects
  FOR SELECT TO authenticated
  USING (
    organizations_id = public.current_organization_id()
    AND public.stage5_member_has_permission(organizations_id, public.current_organization_member_id(), 'leads.view')
  );
REVOKE ALL ON TABLE public.lead_projects FROM anon, authenticated;
GRANT SELECT ON TABLE public.lead_projects TO authenticated;

CREATE TABLE IF NOT EXISTS public.lead_project_stage_history (
  lead_project_stage_history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  lead_projects_id bigint NOT NULL REFERENCES public.lead_projects(lead_projects_id) ON DELETE CASCADE,
  project_stage text NOT NULL,
  started_on date,
  due_on date,
  completed_on date,
  updated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_project_stage_history_stage_check CHECK (project_stage = ANY (ARRAY[
    'aguardando_inicio'::text,
    'desenvolvendo_design'::text,
    'aguardando_aprovacao'::text,
    'em_revisao'::text,
    'passando_wordpress'::text,
    'aguardando_aprovacao_final'::text,
    'entregue'::text
  ]))
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_project_stage_history_one_active_idx
  ON public.lead_project_stage_history (organizations_id, lead_projects_id)
  WHERE completed_on IS NULL;
CREATE INDEX IF NOT EXISTS lead_project_stage_history_project_idx
  ON public.lead_project_stage_history (organizations_id, lead_projects_id, created_at DESC);
ALTER TABLE public.lead_project_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_project_stage_history_org_select ON public.lead_project_stage_history;
CREATE POLICY lead_project_stage_history_org_select ON public.lead_project_stage_history
  FOR SELECT TO authenticated
  USING (
    organizations_id = public.current_organization_id()
    AND public.stage5_member_has_permission(organizations_id, public.current_organization_member_id(), 'leads.view')
  );
REVOKE ALL ON TABLE public.lead_project_stage_history FROM anon, authenticated;
GRANT SELECT ON TABLE public.lead_project_stage_history TO authenticated;

-- Fechados que ja existem ganham projeto sem exigir acao manual retroativa.
INSERT INTO public.lead_projects (organizations_id, leads_id, project_stage, closed_at, lead_projects_created_at, lead_projects_updated_at)
SELECT lc.organizations_id, lc.leads_id, 'aguardando_inicio', coalesce(lc.lead_commercial_updated_at, now()), coalesce(lc.lead_commercial_updated_at, now()), now()
FROM public.lead_commercial lc
WHERE lc.commercial_stage = 'fechado'
ON CONFLICT (organizations_id, leads_id) DO NOTHING;

INSERT INTO public.lead_project_stage_history (organizations_id, lead_projects_id, project_stage, started_on, created_at, updated_at)
SELECT p.organizations_id, p.lead_projects_id, p.project_stage, (p.closed_at AT TIME ZONE 'America/Sao_Paulo')::date, p.closed_at, now()
FROM public.lead_projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_project_stage_history h
  WHERE h.organizations_id = p.organizations_id AND h.lead_projects_id = p.lead_projects_id AND h.completed_on IS NULL
);

-- 3) Comercial progressivo + criacao automatica do projeto ao fechar.
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
  v_stage text := lower(trim(coalesce(p_commercial_stage, '')));
  v_status bigint;
  v_current text;
  v_row public.lead_commercial%ROWTYPE;
  v_project_id bigint;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF NOT (v_stage = ANY (ARRAY['aguardando_resposta','aguardando_previa','previa_enviada','fechado','recusado'])) THEN
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
  v_current := coalesce(v_current, 'aguardando_resposta');

  IF v_current = v_stage THEN
    SELECT * INTO v_row FROM public.lead_commercial lc WHERE lc.organizations_id = v_org AND lc.leads_id = p_leads_id;
    IF v_row.lead_commercial_id IS NULL THEN
      INSERT INTO public.lead_commercial (organizations_id, leads_id, commercial_stage, updated_by_member_id)
      VALUES (v_org, p_leads_id, v_stage, v_member) RETURNING * INTO v_row;
    END IF;
    RETURN jsonb_build_object('leadId',v_row.leads_id,'stage',v_row.commercial_stage,'updatedAt',v_row.lead_commercial_updated_at,'updatedByMemberId',v_row.updated_by_member_id,'previewDueDate',v_row.preview_due_date);
  END IF;

  IF v_current IN ('fechado','recusado') THEN RAISE EXCEPTION 'commercial_stage_terminal'; END IF;
  IF v_current = 'aguardando_resposta' AND NOT (v_stage = ANY (ARRAY['aguardando_previa','recusado'])) THEN RAISE EXCEPTION 'commercial_stage_transition_invalid'; END IF;
  IF v_current = 'aguardando_previa' AND NOT (v_stage = ANY (ARRAY['previa_enviada','recusado'])) THEN RAISE EXCEPTION 'commercial_stage_transition_invalid'; END IF;
  IF v_current = 'previa_enviada' AND NOT (v_stage = ANY (ARRAY['fechado','recusado'])) THEN RAISE EXCEPTION 'commercial_stage_transition_invalid'; END IF;

  INSERT INTO public.lead_commercial (organizations_id,leads_id,commercial_stage,updated_by_member_id,lead_commercial_created_at,lead_commercial_updated_at)
  VALUES (v_org,p_leads_id,v_stage,v_member,now(),now())
  ON CONFLICT (organizations_id,leads_id) DO UPDATE SET
    commercial_stage=excluded.commercial_stage,
    updated_by_member_id=excluded.updated_by_member_id,
    lead_commercial_updated_at=now()
  RETURNING * INTO v_row;

  IF v_stage = 'fechado' THEN
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

CREATE OR REPLACE FUNCTION public.set_lead_preview_due_date_r59(p_leads_id bigint,p_preview_due_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_member bigint := public.current_organization_member_id();
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_status bigint;
  v_stage text;
  v_row public.lead_commercial%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_preview_due_date IS NOT NULL AND p_preview_due_date < v_today THEN RAISE EXCEPTION 'preview_due_date_past_invalid'; END IF;
  SELECT l.lead_status_id INTO v_status FROM public.leads l
   WHERE l.leads_id=p_leads_id AND l.organizations_id=v_org AND l.users_id=v_user FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF v_status <> 5 THEN RAISE EXCEPTION 'preview_due_date_requires_sent_lead'; END IF;
  SELECT lc.commercial_stage INTO v_stage FROM public.lead_commercial lc
   WHERE lc.organizations_id=v_org AND lc.leads_id=p_leads_id FOR UPDATE;
  IF coalesce(v_stage,'aguardando_resposta') <> 'aguardando_previa' THEN RAISE EXCEPTION 'preview_due_date_requires_awaiting_preview'; END IF;
  UPDATE public.lead_commercial
     SET preview_due_date=p_preview_due_date,updated_by_member_id=v_member,lead_commercial_updated_at=now()
   WHERE organizations_id=v_org AND leads_id=p_leads_id
  RETURNING * INTO v_row;
  IF v_row.lead_commercial_id IS NULL THEN RAISE EXCEPTION 'lead_commercial_not_found'; END IF;
  RETURN jsonb_build_object('leadId',v_row.leads_id,'stage',v_row.commercial_stage,'previewDueDate',v_row.preview_due_date,'designDueDate',v_row.preview_due_date,'updatedAt',v_row.lead_commercial_updated_at,'updatedByMemberId',v_row.updated_by_member_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_lead_preview_due_date_r59(bigint,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_preview_due_date_r59(bigint,date) TO authenticated;

-- Compatibilidade temporaria com bundles v0.2.0/v0.2.1.
CREATE OR REPLACE FUNCTION public.set_lead_design_due_date_r59(p_leads_id bigint,p_design_due_date date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$ SELECT public.set_lead_preview_due_date_r59($1,$2); $function$;
REVOKE ALL ON FUNCTION public.set_lead_design_due_date_r59(bigint,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_design_due_date_r59(bigint,date) TO authenticated;

-- 4) Gestao simples do projeto.
CREATE OR REPLACE FUNCTION public.update_project_financials_r59(
  p_project_id bigint,
  p_total_value numeric,
  p_payment_terms text,
  p_project_start_date date,
  p_project_due_date date,
  p_first_payment_due_date date,
  p_second_payment_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_member bigint := public.current_organization_member_id();
  v_terms text := nullif(lower(trim(coalesce(p_payment_terms,''))), '');
  v_row public.lead_projects%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_total_value IS NOT NULL AND p_total_value < 0 THEN RAISE EXCEPTION 'project_value_invalid'; END IF;
  IF v_terms IS NOT NULL AND NOT (v_terms = ANY(ARRAY['100_inicio','50_50'])) THEN RAISE EXCEPTION 'project_payment_terms_invalid'; END IF;
  IF p_project_start_date IS NOT NULL AND p_project_due_date IS NOT NULL AND p_project_due_date < p_project_start_date THEN RAISE EXCEPTION 'project_due_before_start'; END IF;
  IF v_terms = '50_50' AND p_first_payment_due_date IS NOT NULL AND p_second_payment_due_date IS NOT NULL AND p_second_payment_due_date < p_first_payment_due_date THEN RAISE EXCEPTION 'project_second_payment_before_first'; END IF;

  UPDATE public.lead_projects p SET
    total_value=p_total_value,
    payment_terms=v_terms,
    project_start_date=p_project_start_date,
    project_due_date=p_project_due_date,
    first_payment_due_date=p_first_payment_due_date,
    second_payment_due_date=CASE WHEN v_terms='50_50' THEN p_second_payment_due_date ELSE NULL END,
    second_payment_received_on=CASE WHEN v_terms='50_50' THEN p.second_payment_received_on ELSE NULL END,
    updated_by_member_id=v_member,
    lead_projects_updated_at=now()
  FROM public.leads l
  WHERE p.lead_projects_id=p_project_id AND p.organizations_id=v_org
    AND l.leads_id=p.leads_id AND l.organizations_id=v_org AND l.users_id=v_user
  RETURNING p.* INTO v_row;
  IF v_row.lead_projects_id IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;
  RETURN jsonb_build_object('projectId',v_row.lead_projects_id,'updatedAt',v_row.lead_projects_updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_project_financials_r59(bigint,numeric,text,date,date,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_financials_r59(bigint,numeric,text,date,date,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_project_stage_r59(p_project_id bigint,p_stage text,p_started_on date,p_due_on date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_member bigint := public.current_organization_member_id();
  v_stage text := lower(trim(coalesce(p_stage,'')));
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_project public.lead_projects%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF NOT (v_stage = ANY(ARRAY['aguardando_inicio','desenvolvendo_design','aguardando_aprovacao','em_revisao','passando_wordpress','aguardando_aprovacao_final','entregue'])) THEN RAISE EXCEPTION 'project_stage_invalid'; END IF;
  IF p_started_on IS NOT NULL AND p_due_on IS NOT NULL AND p_due_on < p_started_on THEN RAISE EXCEPTION 'project_stage_due_before_start'; END IF;
  SELECT p.* INTO v_project FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
   WHERE p.lead_projects_id=p_project_id AND p.organizations_id=v_org AND l.users_id=v_user FOR UPDATE OF p;
  IF v_project.lead_projects_id IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  IF v_project.project_stage <> v_stage THEN
    UPDATE public.lead_project_stage_history SET completed_on=coalesce(completed_on,v_today),updated_by_member_id=v_member,updated_at=now()
     WHERE organizations_id=v_org AND lead_projects_id=p_project_id AND completed_on IS NULL;
    INSERT INTO public.lead_project_stage_history(organizations_id,lead_projects_id,project_stage,started_on,due_on,updated_by_member_id)
    VALUES(v_org,p_project_id,v_stage,coalesce(p_started_on,v_today),p_due_on,v_member);
  ELSE
    UPDATE public.lead_project_stage_history SET started_on=p_started_on,due_on=p_due_on,updated_by_member_id=v_member,updated_at=now()
     WHERE organizations_id=v_org AND lead_projects_id=p_project_id AND completed_on IS NULL;
  END IF;

  UPDATE public.lead_projects SET
    project_stage=v_stage,
    project_start_date=coalesce(project_start_date,coalesce(p_started_on,v_today)),
    delivered_on=CASE WHEN v_stage='entregue' THEN coalesce(delivered_on,v_today) ELSE NULL END,
    updated_by_member_id=v_member,
    lead_projects_updated_at=now()
  WHERE lead_projects_id=p_project_id AND organizations_id=v_org
  RETURNING * INTO v_project;
  RETURN jsonb_build_object('projectId',v_project.lead_projects_id,'stage',v_project.project_stage,'deliveredOn',v_project.delivered_on,'updatedAt',v_project.lead_projects_updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_project_stage_r59(bigint,text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_stage_r59(bigint,text,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_project_stage_dates_r59(p_project_id bigint,p_started_on date,p_due_on date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_member bigint := public.current_organization_member_id();
  v_history_id bigint;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF p_started_on IS NOT NULL AND p_due_on IS NOT NULL AND p_due_on < p_started_on THEN RAISE EXCEPTION 'project_stage_due_before_start'; END IF;
  PERFORM 1 FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
   WHERE p.lead_projects_id=p_project_id AND p.organizations_id=v_org AND l.users_id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'project_not_found'; END IF;
  UPDATE public.lead_project_stage_history SET started_on=p_started_on,due_on=p_due_on,updated_by_member_id=v_member,updated_at=now()
   WHERE organizations_id=v_org AND lead_projects_id=p_project_id AND completed_on IS NULL
  RETURNING lead_project_stage_history_id INTO v_history_id;
  IF v_history_id IS NULL THEN RAISE EXCEPTION 'project_active_stage_not_found'; END IF;
  UPDATE public.lead_projects SET project_start_date=coalesce(project_start_date,p_started_on),updated_by_member_id=v_member,lead_projects_updated_at=now()
   WHERE organizations_id=v_org AND lead_projects_id=p_project_id;
  RETURN jsonb_build_object('projectId',p_project_id,'updatedAt',now());
END;
$function$;
REVOKE ALL ON FUNCTION public.update_project_stage_dates_r59(bigint,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_stage_dates_r59(bigint,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_project_payment_received_r59(p_project_id bigint,p_installment smallint,p_received boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_org bigint := public.current_organization_id();
  v_user bigint := public.ensure_current_user();
  v_member bigint := public.current_organization_member_id();
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_terms text;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  SELECT p.payment_terms INTO v_terms FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
   WHERE p.lead_projects_id=p_project_id AND p.organizations_id=v_org AND l.users_id=v_user FOR UPDATE OF p;
  IF v_terms IS NULL THEN RAISE EXCEPTION 'project_payment_not_configured'; END IF;
  IF p_installment NOT IN (1,2) THEN RAISE EXCEPTION 'project_installment_invalid'; END IF;
  IF p_installment=2 AND v_terms<>'50_50' THEN RAISE EXCEPTION 'project_installment_invalid'; END IF;
  UPDATE public.lead_projects SET
    first_payment_received_on=CASE WHEN p_installment=1 THEN CASE WHEN p_received THEN v_today ELSE NULL END ELSE first_payment_received_on END,
    second_payment_received_on=CASE WHEN p_installment=2 THEN CASE WHEN p_received THEN v_today ELSE NULL END ELSE second_payment_received_on END,
    updated_by_member_id=v_member,
    lead_projects_updated_at=now()
  WHERE organizations_id=v_org AND lead_projects_id=p_project_id;
  RETURN jsonb_build_object('projectId',p_project_id,'installment',p_installment,'received',coalesce(p_received,false),'receivedOn',CASE WHEN p_received THEN v_today ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_project_payment_received_r59(bigint,smallint,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_payment_received_r59(bigint,smallint,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_projects_r59(p_page integer DEFAULT 1,p_page_size integer DEFAULT 20,p_search text DEFAULT NULL,p_stage text DEFAULT NULL,p_status text DEFAULT NULL)
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

  RETURN jsonb_build_object('contractVersion','R59-PROJECTS-1','page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),'items',v_items,'summary',v_summary);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_projects_r59(integer,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_projects_r59(integer,integer,text,text,text) TO authenticated;

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
  v_commercial text := lower(trim(coalesce(p_commercial_stage, '')));
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
        WHEN l.lead_status_id = 5 THEN coalesce(lc.commercial_stage, 'aguardando_resposta')
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
      'fechado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'fechado')::integer,
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
        WHEN l.lead_status_id = 5 THEN coalesce(lc.commercial_stage, 'aguardando_resposta')
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
    'contractVersion', 'R59',
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
  v_value_closed numeric:=0; v_scheduled_receipts numeric:=0; v_received numeric:=0; v_receivable_total numeric:=0;
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

  SELECT coalesce(sum(x.scheduled),0),coalesce(sum(x.received),0),coalesce(sum(x.open_amount),0)
  INTO v_scheduled_receipts,v_received,v_receivable_total
  FROM (
    SELECT
      (CASE WHEN p.first_payment_due_date>=v_from_date AND p.first_payment_due_date<v_to_date_exclusive THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_due_date>=v_from_date AND p.second_payment_due_date<v_to_date_exclusive THEN coalesce(p.total_value,0)/2 ELSE 0 END) scheduled,
      (CASE WHEN p.first_payment_received_on>=v_from_date AND p.first_payment_received_on<v_to_date_exclusive THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END
       + CASE WHEN p.payment_terms='50_50' AND p.second_payment_received_on>=v_from_date AND p.second_payment_received_on<v_to_date_exclusive THEN coalesce(p.total_value,0)/2 ELSE 0 END) received,
      greatest(coalesce(p.total_value,0) - (CASE WHEN p.first_payment_received_on IS NOT NULL THEN CASE WHEN p.payment_terms='50_50' THEN coalesce(p.total_value,0)/2 ELSE coalesce(p.total_value,0) END ELSE 0 END + CASE WHEN p.payment_terms='50_50' AND p.second_payment_received_on IS NOT NULL THEN coalesce(p.total_value,0)/2 ELSE 0 END),0) open_amount
    FROM public.lead_projects p JOIN public.leads l ON l.leads_id=p.leads_id AND l.organizations_id=p.organizations_id
    WHERE p.organizations_id=v_org AND l.users_id=v_user
  ) x;

  RETURN jsonb_build_object(
    'contractVersion','R59-FIX36','from',v_from,'toExclusive',v_to,
    'newLeads',coalesce(v_new_leads,0),'queued',coalesce(v_queued,0),'sent',coalesce(v_sent,0),'invalid',coalesce(v_invalid,0),'noContact',coalesce(v_no_contact,0),
    'previewsDue',coalesce(v_previews_due,0),'designsDue',coalesce(v_previews_due,0),
    'commercial',jsonb_build_object('aguardandoResposta',v_aguardando_resposta,'aguardandoPrevia',v_aguardando_previa,'previaEnviada',v_previa_enviada,'fechado',v_fechado,'recusado',v_recusado,'aguardandoDesign',v_aguardando_previa,'designEnviado',v_previa_enviada),
    'projects',jsonb_build_object('closed',v_projects_closed,'active',v_projects_active,'deliveries',v_projects_deliveries,'overdue',v_projects_overdue,'valueClosed',v_value_closed,'scheduledReceipts',v_scheduled_receipts,'received',v_received,'receivableTotal',v_receivable_total)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary_r59(timestamptz,timestamptz) TO authenticated;

-- Publicacao Realtime: projeto e etapa podem refletir sem refresh quando houver cliente inscrito.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_projects; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_project_stage_history; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END;
$do$;

COMMIT;
