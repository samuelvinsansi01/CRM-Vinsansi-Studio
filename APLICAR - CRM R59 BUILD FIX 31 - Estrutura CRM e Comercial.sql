-- CRM R59 BUILD FIX 31
-- Nova arquitetura de navegação + Leads consolidados + estágio comercial manual.
-- Regra central: nenhuma mensagem, webhook, notificação ou automação altera o estágio comercial.
-- Quando um lead enviado ainda não possui registro comercial, a interface o apresenta como
-- "Aguardando resposta" por padrão. Somente set_lead_commercial_stage_r59 grava/muda o estágio.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_commercial (
  lead_commercial_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizations_id bigint NOT NULL REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  leads_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  commercial_stage text NOT NULL,
  updated_by_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  lead_commercial_created_at timestamptz NOT NULL DEFAULT now(),
  lead_commercial_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_commercial_stage_check CHECK (
    commercial_stage = ANY (ARRAY[
      'aguardando_resposta'::text,
      'aguardando_design'::text,
      'design_enviado'::text,
      'fechado'::text,
      'recusado'::text
    ])
  ),
  CONSTRAINT lead_commercial_organization_lead_unique UNIQUE (organizations_id, leads_id)
);

CREATE INDEX IF NOT EXISTS lead_commercial_org_stage_idx
  ON public.lead_commercial (organizations_id, commercial_stage, lead_commercial_updated_at DESC);

CREATE INDEX IF NOT EXISTS lead_commercial_lead_idx
  ON public.lead_commercial (leads_id);

ALTER TABLE public.lead_commercial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_commercial_org_select ON public.lead_commercial;
CREATE POLICY lead_commercial_org_select
  ON public.lead_commercial
  FOR SELECT
  TO authenticated
  USING (
    organizations_id = public.current_organization_id()
    AND public.stage5_member_has_permission(
      organizations_id,
      public.current_organization_member_id(),
      'leads.view'
    )
  );

REVOKE ALL ON TABLE public.lead_commercial FROM anon, authenticated;
GRANT SELECT ON TABLE public.lead_commercial TO authenticated;

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
  v_row public.lead_commercial%ROWTYPE;
BEGIN
  PERFORM public.require_organization_permission('leads.edit');
  IF v_org IS NULL OR v_user IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'organization_context_required';
  END IF;

  IF NOT (v_stage = ANY (ARRAY[
    'aguardando_resposta'::text,
    'aguardando_design'::text,
    'design_enviado'::text,
    'fechado'::text,
    'recusado'::text
  ])) THEN
    RAISE EXCEPTION 'commercial_stage_invalid';
  END IF;

  SELECT l.lead_status_id
    INTO v_status
    FROM public.leads l
   WHERE l.leads_id = p_leads_id
     AND l.organizations_id = v_org
     AND l.users_id = v_user
   FOR UPDATE;

  IF v_status IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF v_status <> 5 THEN RAISE EXCEPTION 'commercial_stage_requires_sent_lead'; END IF;

  INSERT INTO public.lead_commercial (
    organizations_id,
    leads_id,
    commercial_stage,
    updated_by_member_id,
    lead_commercial_created_at,
    lead_commercial_updated_at
  ) VALUES (
    v_org,
    p_leads_id,
    v_stage,
    v_member,
    now(),
    now()
  )
  ON CONFLICT (organizations_id, leads_id)
  DO UPDATE SET
    commercial_stage = excluded.commercial_stage,
    updated_by_member_id = excluded.updated_by_member_id,
    lead_commercial_updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'leadId', v_row.leads_id,
    'stage', v_row.commercial_stage,
    'updatedAt', v_row.lead_commercial_updated_at,
    'updatedByMemberId', v_row.updated_by_member_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_lead_commercial_stage_r59(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_commercial_stage_r59(bigint,text) TO authenticated;

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
      'aguardandoDesign', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'aguardando_design')::integer,
      'designEnviado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'design_enviado')::integer,
      'fechado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'fechado')::integer,
      'recusado', count(*) FILTER (WHERE lead_status_id = 5 AND commercial_stage = 'recusado')::integer
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
      'commercialUpdatedBy', p.commercial_updated_by
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

COMMIT;
