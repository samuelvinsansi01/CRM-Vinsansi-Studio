BEGIN;

-- CRM Vinsansi Studio v1.6.0
-- Etapa 7: identidade canônica, deduplicação transversal e supressão de contato
-- adaptadas ao tenant canônico organizations_id.

DO $preflight$
DECLARE v_missing text[]:=ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN v_missing:=array_append(v_missing,'table:organizations'); END IF;
  IF to_regclass('public.leads') IS NULL THEN v_missing:=array_append(v_missing,'table:leads'); END IF;
  IF to_regclass('public.lead_identity_registry') IS NULL THEN v_missing:=array_append(v_missing,'table:lead_identity_registry'); END IF;
  IF to_regclass('public.contact_suppressions') IS NULL THEN v_missing:=array_append(v_missing,'table:contact_suppressions'); END IF;
  IF to_regclass('public.audit_transition_rules') IS NULL THEN v_missing:=array_append(v_missing,'table:audit_transition_rules'); END IF;
  IF to_regprocedure('public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)') IS NULL THEN v_missing:=array_append(v_missing,'function:append_audit_event'); END IF;
  IF to_regprocedure('public.current_organization_id()') IS NULL THEN v_missing:=array_append(v_missing,'function:current_organization_id'); END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'v1.6.0_requires_v1.5.0:%',array_to_string(v_missing,','); END IF;
END
$preflight$;

-- Normalizadores preservam os contratos públicos existentes.
CREATE OR REPLACE FUNCTION public.normalize_identity_phone(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $$
DECLARE v text:=regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
BEGIN
  IF v LIKE '00%' THEN v:=substr(v,3); END IF;
  IF v='' THEN RETURN ''; END IF;
  IF v LIKE '55%' THEN RETURN v; END IF;
  IF length(v) IN (10,11) THEN RETURN '55'||v; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_identity_instagram(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $$
DECLARE
  v_raw text:=lower(trim(coalesce(p_value,'')));
  v_path text;
  v_candidate text;
  v_reserved constant text[]:=ARRAY[
    'about','accounts','api','challenge','contact','developer','direct','directory',
    'download','emails','explore','graphql','invites','legal','oauth','p','press',
    'reel','reels','stories','tv','web'
  ];
BEGIN
  IF v_raw='' THEN RETURN ''; END IF;

  IF v_raw ~* '^https?://' THEN
    IF v_raw !~* '^https?://(www\.)?instagram\.com(?:/|$)' THEN RETURN ''; END IF;
    v_path:=regexp_replace(v_raw,'^https?://(www\.)?instagram\.com/?','','i');
  ELSIF v_raw ~* '^(www\.)?instagram\.com(?:/|$)' THEN
    v_path:=regexp_replace(v_raw,'^(www\.)?instagram\.com/?','','i');
  ELSE
    v_candidate:=regexp_replace(v_raw,'^@','');
    IF v_candidate='' OR v_candidate=ANY(v_reserved) OR length(v_candidate)>30 OR v_candidate !~ '^[a-z0-9._]+$' THEN RETURN ''; END IF;
    RETURN v_candidate;
  END IF;

  v_path:=split_part(split_part(v_path,'?',1),'#',1);
  v_path:=regexp_replace(v_path,'^/+|/+$','','g');
  IF v_path='' OR position('/' in v_path)>0 THEN RETURN ''; END IF;
  v_candidate:=regexp_replace(v_path,'^@','');
  IF v_candidate='' OR v_candidate=ANY(v_reserved) OR length(v_candidate)>30 OR v_candidate !~ '^[a-z0-9._]+$' THEN RETURN ''; END IF;
  RETURN v_candidate;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_identity_domain(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $$
DECLARE v text:=lower(trim(coalesce(p_value,'')));
BEGIN
  v:=regexp_replace(v,'^https?://','','i');
  v:=regexp_replace(v,'^www\.','','i');
  v:=split_part(v,'/',1); v:=split_part(v,'?',1); v:=split_part(v,'#',1);
  IF v IN ('','google.com','google.com.br','instagram.com','facebook.com','fb.com','wa.me','whatsapp.com','bit.ly','tinyurl.com','goo.gl','t.co','linktr.ee') THEN RETURN ''; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_identity_maps(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_value,'')),'/+$','','g'));
$$;

-- Stage 2 já criou organizations_id; a Etapa 7 torna essa coluna a chave real da identidade.
-- Antes de criar unicidades/validadores, aborta se houver dados legados cruzando tenants.
DO $identity_integrity$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.leads l
    JOIN public.organizations o ON o.organizations_id=l.organizations_id
   WHERE l.users_id<>o.legacy_scope_users_id;
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_lead_scope_mismatch:%',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.leads l
    JOIN public.leads c ON c.leads_id=l.canonical_lead_id
   WHERE l.canonical_lead_id IS NOT NULL AND c.organizations_id<>l.organizations_id;
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_canonical_cross_organization:%',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.lead_identity_registry r
    JOIN public.organizations o ON o.organizations_id=r.organizations_id
    JOIN public.leads l ON l.leads_id=r.canonical_lead_id
   WHERE r.users_id<>o.legacy_scope_users_id OR l.organizations_id<>r.organizations_id;
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_registry_scope_mismatch:%',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.contact_suppressions s
    JOIN public.organizations o ON o.organizations_id=s.organizations_id
    LEFT JOIN public.leads l ON l.leads_id=s.source_lead_id
    LEFT JOIN public.sents st ON st.sents_id=s.source_sent_id
   WHERE s.users_id<>o.legacy_scope_users_id
      OR (s.source_lead_id IS NOT NULL AND (l.leads_id IS NULL OR l.organizations_id<>s.organizations_id))
      OR (s.source_sent_id IS NOT NULL AND (st.sents_id IS NULL OR st.organizations_id<>s.organizations_id));
  IF v_count>0 THEN RAISE EXCEPTION 'stage7_existing_suppression_scope_mismatch:%',v_count; END IF;
END
$identity_integrity$;

ALTER TABLE public.lead_identity_registry ALTER COLUMN organizations_id SET NOT NULL;
ALTER TABLE public.contact_suppressions ALTER COLUMN organizations_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_identity_registry_org_identity_unique
  ON public.lead_identity_registry(organizations_id,identity_type,identity_value);
CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_org_identity_unique
  ON public.contact_suppressions(organizations_id,identity_type,identity_value);
CREATE INDEX IF NOT EXISTS leads_org_identity_phone_idx ON public.leads(organizations_id,leads_normalized_phone) WHERE leads_normalized_phone<>'';
CREATE INDEX IF NOT EXISTS leads_org_identity_instagram_idx ON public.leads(organizations_id,leads_normalized_instagram) WHERE leads_normalized_instagram<>'';
CREATE INDEX IF NOT EXISTS leads_org_identity_domain_idx ON public.leads(organizations_id,leads_normalized_domain) WHERE leads_normalized_domain<>'';
CREATE INDEX IF NOT EXISTS leads_org_identity_maps_idx ON public.leads(organizations_id,leads_normalized_maps) WHERE leads_normalized_maps<>'';
CREATE INDEX IF NOT EXISTS leads_org_canonical_idx ON public.leads(organizations_id,canonical_lead_id) WHERE canonical_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_suppressions_org_active_idx ON public.contact_suppressions(organizations_id,identity_type,identity_value) WHERE is_active;

-- Um canonical_lead_id jamais pode cruzar organizações.
CREATE OR REPLACE FUNCTION public.validate_lead_canonical_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint; v_org bigint;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.organizations_id IS DISTINCT FROM OLD.organizations_id OR NEW.users_id IS DISTINCT FROM OLD.users_id) THEN
    RAISE EXCEPTION 'lead_identity_tenant_immutable';
  END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'lead_identity_scope_mismatch'; END IF;
  IF NEW.canonical_lead_id IS NOT NULL THEN
    SELECT organizations_id INTO v_org FROM public.leads WHERE leads_id=NEW.canonical_lead_id;
    IF v_org IS NULL OR v_org<>NEW.organizations_id THEN RAISE EXCEPTION 'canonical_lead_cross_organization'; END IF;
    IF NEW.leads_id IS NOT NULL AND NEW.canonical_lead_id=NEW.leads_id THEN NEW.canonical_lead_id:=NULL; NEW.duplicate_reason:=NULL; END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_lead_canonical_scope_trigger ON public.leads;
CREATE TRIGGER validate_lead_canonical_scope_trigger
BEFORE INSERT OR UPDATE OF organizations_id,users_id,canonical_lead_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.validate_lead_canonical_scope();

CREATE OR REPLACE FUNCTION public.validate_identity_registry_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint; v_lead_org bigint;
BEGIN
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'identity_registry_scope_mismatch'; END IF;
  SELECT organizations_id INTO v_lead_org FROM public.leads WHERE leads_id=NEW.canonical_lead_id;
  IF v_lead_org IS NULL OR v_lead_org<>NEW.organizations_id THEN RAISE EXCEPTION 'identity_registry_canonical_cross_organization'; END IF;
  NEW.identity_value:=trim(coalesce(NEW.identity_value,''));
  IF NEW.identity_value='' THEN RAISE EXCEPTION 'identity_value_required'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_identity_registry_scope_trigger ON public.lead_identity_registry;
CREATE TRIGGER validate_identity_registry_scope_trigger BEFORE INSERT OR UPDATE ON public.lead_identity_registry
FOR EACH ROW EXECUTE FUNCTION public.validate_identity_registry_scope();

CREATE OR REPLACE FUNCTION public.validate_contact_suppression_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_scope bigint; v_org bigint;
BEGIN
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'contact_suppression_scope_mismatch'; END IF;
  IF NEW.source_lead_id IS NOT NULL THEN
    SELECT organizations_id INTO v_org FROM public.leads WHERE leads_id=NEW.source_lead_id;
    IF v_org IS NULL OR v_org<>NEW.organizations_id THEN RAISE EXCEPTION 'contact_suppression_lead_cross_organization'; END IF;
  END IF;
  IF NEW.source_sent_id IS NOT NULL THEN
    SELECT organizations_id INTO v_org FROM public.sents WHERE sents_id=NEW.source_sent_id;
    IF v_org IS NULL OR v_org<>NEW.organizations_id THEN RAISE EXCEPTION 'contact_suppression_sent_cross_organization'; END IF;
  END IF;
  NEW.identity_value:=trim(coalesce(NEW.identity_value,''));
  IF NEW.identity_value='' THEN RAISE EXCEPTION 'suppression_identity_required'; END IF;
  NEW.updated_at:=coalesce(NEW.updated_at,now());
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_contact_suppression_scope_trigger ON public.contact_suppressions;
CREATE TRIGGER validate_contact_suppression_scope_trigger BEFORE INSERT OR UPDATE ON public.contact_suppressions
FOR EACH ROW EXECUTE FUNCTION public.validate_contact_suppression_scope();

-- Transições extras legítimas da deduplicação automática.
INSERT INTO public.audit_transition_rules(entity_type,from_status_id,to_status_id,action_key,is_active)
VALUES ('lead',2,7,'mark_duplicate',true),('lead',3,7,'mark_duplicate',true),('lead',6,7,'mark_duplicate',true),('lead',7,1,'duplicate_identity_cleared',true)
ON CONFLICT(entity_type,from_status_id,to_status_id) DO UPDATE SET is_active=true,action_key=excluded.action_key;

CREATE OR REPLACE FUNCTION public.prepare_lead_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,extensions AS $$
DECLARE v_canonical bigint; v_reason text; v_scope bigint;
BEGIN
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR NEW.users_id<>v_scope THEN RAISE EXCEPTION 'lead_identity_scope_mismatch'; END IF;

  NEW.leads_normalized_phone:=public.normalize_identity_phone(NEW.leads_phone);
  NEW.leads_normalized_instagram:=public.normalize_identity_instagram(NEW.leads_instagram);
  NEW.leads_normalized_domain:=public.normalize_identity_domain(NEW.leads_website);
  NEW.leads_normalized_maps:=public.normalize_identity_maps(NEW.leads_maps);
  NEW.leads_identity_hash:=encode(extensions.digest(concat_ws('|',NEW.leads_normalized_phone,NEW.leads_normalized_instagram,NEW.leads_normalized_domain,NEW.leads_normalized_maps),'sha256'),'hex');

  SELECT r.canonical_lead_id,r.identity_type||':'||r.identity_value
    INTO v_canonical,v_reason
    FROM public.lead_identity_registry r
   WHERE r.organizations_id=NEW.organizations_id
     AND r.canonical_lead_id<>coalesce(NEW.leads_id,-1)
     AND ((r.identity_type='phone' AND r.identity_value=NEW.leads_normalized_phone AND NEW.leads_normalized_phone<>'')
       OR (r.identity_type='instagram' AND r.identity_value=NEW.leads_normalized_instagram AND NEW.leads_normalized_instagram<>'')
       OR (r.identity_type='domain' AND r.identity_value=NEW.leads_normalized_domain AND NEW.leads_normalized_domain<>'')
       OR (r.identity_type='maps' AND r.identity_value=NEW.leads_normalized_maps AND NEW.leads_normalized_maps<>''))
   ORDER BY r.first_seen_at,r.canonical_lead_id,r.lead_identity_registry_id LIMIT 1;

  IF v_canonical IS NOT NULL THEN
    NEW.canonical_lead_id:=v_canonical;
    NEW.duplicate_reason:=v_reason;
    IF NEW.lead_status_id IN (1,2,3,6) THEN NEW.lead_status_id:=7; END IF;
  ELSE
    NEW.canonical_lead_id:=NULL;
    NEW.duplicate_reason:=NULL;
    IF TG_OP='UPDATE' THEN
      IF OLD.canonical_lead_id IS NOT NULL AND OLD.lead_status_id=7 AND NEW.lead_status_id=7 THEN
        NEW.lead_status_id:=1;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.register_lead_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_canonical bigint:=coalesce(NEW.canonical_lead_id,NEW.leads_id); v_is_new_duplicate boolean:=false; v_previous_canonical bigint;
BEGIN
  IF NEW.leads_normalized_phone<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'phone',NEW.leads_normalized_phone,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;
  IF NEW.leads_normalized_instagram<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'instagram',NEW.leads_normalized_instagram,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;
  IF NEW.leads_normalized_domain<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'domain',NEW.leads_normalized_domain,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;
  IF NEW.leads_normalized_maps<>'' THEN
    INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id)
    VALUES(NEW.users_id,NEW.organizations_id,'maps',NEW.leads_normalized_maps,v_canonical)
    ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=now();
  END IF;

  IF TG_OP='UPDATE' THEN
    v_previous_canonical:=OLD.canonical_lead_id;
    v_is_new_duplicate:=NEW.canonical_lead_id IS NOT NULL
      AND NEW.canonical_lead_id<>NEW.leads_id
      AND v_previous_canonical IS DISTINCT FROM NEW.canonical_lead_id;
  ELSE
    v_is_new_duplicate:=NEW.canonical_lead_id IS NOT NULL AND NEW.canonical_lead_id<>NEW.leads_id;
  END IF;
  IF v_is_new_duplicate THEN
    PERFORM public.append_audit_event('identity','lead_deduplicated','lead',NEW.leads_id::text,NEW.leads_id,NULL,NEW.channels_id,NULL,NEW.lead_status_id,
      'Lead vinculado a identidade canônica',jsonb_build_object('canonical_lead_id',NEW.canonical_lead_id,'duplicate_reason',NEW.duplicate_reason,'organization_id',NEW.organizations_id),NEW.users_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.suppress_lead_identities(p_lead public.leads,p_reason text,p_sent_id bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_count integer:=0;
BEGIN
  INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,source_lead_id,source_sent_id)
  SELECT p_lead.users_id,p_lead.organizations_id,x.t,x.v,p_reason,p_lead.leads_id,p_sent_id
  FROM (VALUES ('phone',p_lead.leads_normalized_phone),('instagram',p_lead.leads_normalized_instagram),('domain',p_lead.leads_normalized_domain),('maps',p_lead.leads_normalized_maps)) x(t,v)
  WHERE x.v IS NOT NULL AND x.v<>''
  ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET
    reason=excluded.reason,source_lead_id=excluded.source_lead_id,
    source_sent_id=coalesce(excluded.source_sent_id,public.contact_suppressions.source_sent_id),
    is_active=true,expires_at=NULL,updated_at=now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count>0 THEN
    PERFORM public.append_audit_event('identity','contact_suppressed','lead',p_lead.leads_id::text,p_lead.leads_id,NULL,p_lead.channels_id,p_lead.lead_status_id,p_lead.lead_status_id,
      'Identidades bloqueadas para novo contato',jsonb_build_object('reason',p_reason,'identity_count',v_count,'sent_id',p_sent_id,'organization_id',p_lead.organizations_id),p_lead.users_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.suppress_after_lead_finalized()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
  IF NEW.lead_status_id IN (5,8) THEN
    IF TG_OP='INSERT' THEN
      PERFORM public.suppress_lead_identities(NEW,CASE WHEN NEW.lead_status_id=5 THEN 'lead_sent' ELSE 'lead_archived' END,NULL);
    ELSIF OLD.lead_status_id IS DISTINCT FROM NEW.lead_status_id THEN
      PERFORM public.suppress_lead_identities(NEW,CASE WHEN NEW.lead_status_id=5 THEN 'lead_sent' ELSE 'lead_archived' END,NULL);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS prepare_lead_identity_trigger ON public.leads;
CREATE TRIGGER prepare_lead_identity_trigger BEFORE INSERT OR UPDATE OF leads_phone,leads_instagram,leads_website,leads_maps ON public.leads FOR EACH ROW EXECUTE FUNCTION public.prepare_lead_identity();
DROP TRIGGER IF EXISTS register_lead_identity_trigger ON public.leads;
CREATE TRIGGER register_lead_identity_trigger AFTER INSERT OR UPDATE OF leads_phone,leads_instagram,leads_website,leads_maps ON public.leads FOR EACH ROW EXECUTE FUNCTION public.register_lead_identity();
DROP TRIGGER IF EXISTS suppress_after_lead_sent_trigger ON public.leads;
DROP TRIGGER IF EXISTS suppress_after_lead_finalized_trigger ON public.leads;
CREATE TRIGGER suppress_after_lead_finalized_trigger AFTER INSERT OR UPDATE OF lead_status_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.suppress_after_lead_finalized();

-- Reforça o registry com o tenant canônico preservando o canonical já conhecido.
INSERT INTO public.lead_identity_registry(users_id,organizations_id,identity_type,identity_value,canonical_lead_id,first_seen_at,last_seen_at)
SELECT l.users_id,l.organizations_id,x.identity_type,x.identity_value,
       min(coalesce(l.canonical_lead_id,l.leads_id)),min(l.leads_created_at),max(l.leads_updated_at)
FROM public.leads l
CROSS JOIN LATERAL (VALUES
  ('phone'::text,l.leads_normalized_phone),('instagram',l.leads_normalized_instagram),('domain',l.leads_normalized_domain),('maps',l.leads_normalized_maps)
) x(identity_type,identity_value)
WHERE x.identity_value IS NOT NULL AND x.identity_value<>''
GROUP BY l.users_id,l.organizations_id,x.identity_type,x.identity_value
ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET last_seen_at=greatest(public.lead_identity_registry.last_seen_at,excluded.last_seen_at);

-- Backfill administrativo da migration:
-- a Etapa 6 exige ator autenticado para mudanças operacionais, mas o SQL Editor
-- não possui auth.uid(). Desabilitamos SOMENTE o trigger de auditoria de estado
-- durante este backfill histórico. As validações de tenant/canonical continuam ativas.
-- O ALTER TABLE é transacional: em qualquer erro, o estado anterior é restaurado.
ALTER TABLE public.leads DISABLE TRIGGER audit_lead_state_change_trigger;

-- Corrige leads históricos ainda não marcados quando a identidade canônica já é inequívoca.
WITH matches AS (
  SELECT l.leads_id,r.canonical_lead_id,r.identity_type||':'||r.identity_value reason,
         row_number() OVER(PARTITION BY l.leads_id ORDER BY r.first_seen_at,r.canonical_lead_id,r.lead_identity_registry_id) rn
  FROM public.leads l
  JOIN public.lead_identity_registry r ON r.organizations_id=l.organizations_id AND r.canonical_lead_id<>l.leads_id
   AND ((r.identity_type='phone' AND r.identity_value=l.leads_normalized_phone AND coalesce(l.leads_normalized_phone,'')<>'')
     OR (r.identity_type='instagram' AND r.identity_value=l.leads_normalized_instagram AND coalesce(l.leads_normalized_instagram,'')<>'')
     OR (r.identity_type='domain' AND r.identity_value=l.leads_normalized_domain AND coalesce(l.leads_normalized_domain,'')<>'')
     OR (r.identity_type='maps' AND r.identity_value=l.leads_normalized_maps AND coalesce(l.leads_normalized_maps,'')<>''))
  WHERE l.canonical_lead_id IS NULL
)
UPDATE public.leads l
   SET canonical_lead_id=m.canonical_lead_id,duplicate_reason=m.reason,
       lead_status_id=CASE WHEN l.lead_status_id IN(1,2,3,6) THEN 7 ELSE l.lead_status_id END,
       leads_updated_at=now()
  FROM matches m
 WHERE m.rn=1 AND l.leads_id=m.leads_id;

-- Restaura imediatamente a auditoria operacional obrigatória.
ALTER TABLE public.leads ENABLE TRIGGER audit_lead_state_change_trigger;


-- Status finais antigos também entram na supressão por organização.
WITH candidates AS (
  SELECT l.users_id,l.organizations_id,x.t identity_type,x.v identity_value,l.leads_id source_lead_id,l.leads_updated_at,
         row_number() OVER(PARTITION BY l.organizations_id,x.t,x.v ORDER BY l.leads_updated_at DESC NULLS LAST,l.leads_id DESC) rn
  FROM public.leads l
  CROSS JOIN LATERAL (VALUES ('phone',l.leads_normalized_phone),('instagram',l.leads_normalized_instagram),('domain',l.leads_normalized_domain),('maps',l.leads_normalized_maps)) x(t,v)
  WHERE l.lead_status_id IN(5,8) AND x.v IS NOT NULL AND x.v<>''
)
INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,source_lead_id)
SELECT users_id,organizations_id,identity_type,identity_value,'historical_final_lead',source_lead_id FROM candidates WHERE rn=1
ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET
  reason=excluded.reason,source_lead_id=excluded.source_lead_id,is_active=true,expires_at=NULL,updated_at=now();

CREATE OR REPLACE FUNCTION public.check_lead_identity(p_phone text DEFAULT NULL,p_instagram text DEFAULT NULL,p_website text DEFAULT NULL,p_maps text DEFAULT NULL)
RETURNS TABLE(identity_type text,identity_value text,canonical_lead_id bigint,is_suppressed boolean,suppression_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_org bigint;
BEGIN
  v_org:=public.current_organization_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF NOT public.has_organization_permission('leads.view') THEN RAISE EXCEPTION 'permission_denied:leads.view'; END IF;
  RETURN QUERY
  WITH input AS (
    SELECT 'phone'::text t,public.normalize_identity_phone(p_phone) v UNION ALL
    SELECT 'instagram',public.normalize_identity_instagram(p_instagram) UNION ALL
    SELECT 'domain',public.normalize_identity_domain(p_website) UNION ALL
    SELECT 'maps',public.normalize_identity_maps(p_maps)
  )
  SELECT i.t,i.v,r.canonical_lead_id,
         coalesce(s.is_active AND (s.expires_at IS NULL OR s.expires_at>now()),false),s.reason
    FROM input i
    LEFT JOIN public.lead_identity_registry r ON r.organizations_id=v_org AND r.identity_type=i.t AND r.identity_value=i.v
    LEFT JOIN public.contact_suppressions s ON s.organizations_id=v_org AND s.identity_type=i.t AND s.identity_value=i.v
   WHERE i.v<>'';
END; $$;

-- RLS canônico por organização. DML continua apenas em funções/serviços.
ALTER TABLE public.lead_identity_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public' AND tablename IN('lead_identity_registry','contact_suppressions') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,p.tablename);
  END LOOP;
END
$policies$;
CREATE POLICY lead_identity_registry_org_select ON public.lead_identity_registry FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
CREATE POLICY contact_suppressions_org_select ON public.contact_suppressions FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('leads.view'));
REVOKE INSERT,UPDATE,DELETE ON public.lead_identity_registry,public.contact_suppressions FROM anon,authenticated;
GRANT SELECT ON public.lead_identity_registry,public.contact_suppressions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_identity_registry,public.contact_suppressions TO service_role;
GRANT EXECUTE ON FUNCTION public.check_lead_identity(text,text,text,text) TO authenticated,service_role;

COMMIT;
