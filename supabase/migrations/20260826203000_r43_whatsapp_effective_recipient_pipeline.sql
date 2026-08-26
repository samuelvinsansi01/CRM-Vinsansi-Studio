-- CRM - Vinsansi Studio v2.4.0-R43
-- Destinatario WhatsApp canonico em toda a preparacao da fila:
-- leads_whatsapp tem prioridade; leads_phone existe apenas como fallback.

BEGIN;

CREATE OR REPLACE FUNCTION public.effective_whatsapp_phone(
  p_whatsapp text,
  p_phone text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO pg_catalog,public
AS $$
  SELECT coalesce(nullif(btrim(p_whatsapp),''),nullif(btrim(p_phone),''),'')
$$;

REVOKE ALL ON FUNCTION public.effective_whatsapp_phone(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.effective_whatsapp_phone(text,text) TO authenticated,service_role;

-- R15/R23: garante que a preparacao atomica use o mesmo telefone que a
-- validacao/prova WhatsApp. O patch e propositalmente retrocompativel com bancos
-- que ainda tenham a forma R15 e com bancos em que o patch R23 ja tenha rodado.
DO $patch_prepare$
DECLARE
  v_def text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb)'::regprocedure)
    INTO v_def;
  v_original:=v_def;

  v_def:=replace(
    v_def,
    'coalesce(nullif(v_lead.leads_whatsapp, ''''), v_lead.leads_phone, '''')',
    'public.effective_whatsapp_phone(v_lead.leads_whatsapp, v_lead.leads_phone)'
  );
  v_def:=replace(
    v_def,
    'coalesce(nullif(trim(v_lead.leads_whatsapp),''''),v_lead.leads_phone,'''')',
    'public.effective_whatsapp_phone(v_lead.leads_whatsapp,v_lead.leads_phone)'
  );
  v_def:=replace(
    v_def,
    'coalesce(v_lead.leads_phone, '''')',
    'public.effective_whatsapp_phone(v_lead.leads_whatsapp, v_lead.leads_phone)'
  );

  IF v_def IS DISTINCT FROM v_original THEN
    EXECUTE v_def;
  END IF;

  SELECT pg_get_functiondef('public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb)'::regprocedure)
    INTO v_def;
  IF v_def !~ 'effective_whatsapp_phone[[:space:]]*\(' THEN
    RAISE EXCEPTION 'r43_prepare_queue_items_effective_whatsapp_patch_failed';
  END IF;
END
$patch_prepare$;

-- R29: o snapshot e o contrato imutavel consumido pelo Worker. Ele nao pode
-- congelar leads_phone quando o numero realmente validado esta em leads_whatsapp.
DO $patch_snapshot$
DECLARE
  v_def text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.build_queue_item_payload_snapshot(bigint,bigint,bigint,bigint,timestamp with time zone)'::regprocedure)
    INTO v_def;
  v_original:=v_def;

  v_def:=replace(
    v_def,
    'v_phone:=coalesce(v_lead.leads_phone,'''');',
    'v_phone:=public.effective_whatsapp_phone(v_lead.leads_whatsapp,v_lead.leads_phone);'
  );
  v_def:=replace(
    v_def,
    'v_phone := coalesce(v_lead.leads_phone, '''');',
    'v_phone := public.effective_whatsapp_phone(v_lead.leads_whatsapp, v_lead.leads_phone);'
  );

  IF v_def IS DISTINCT FROM v_original THEN
    EXECUTE v_def;
  END IF;

  SELECT pg_get_functiondef('public.build_queue_item_payload_snapshot(bigint,bigint,bigint,bigint,timestamp with time zone)'::regprocedure)
    INTO v_def;
  IF v_def !~ 'v_phone[[:space:]]*:=[[:space:]]*public\.effective_whatsapp_phone[[:space:]]*\(' THEN
    RAISE EXCEPTION 'r43_queue_snapshot_effective_whatsapp_patch_failed';
  END IF;
END
$patch_snapshot$;

-- Defesa adicional: a prova corrente tambem passa a usar o helper canonico.
CREATE OR REPLACE FUNCTION public.record_current_whatsapp_validation_proof(
  p_lead_id bigint,
  p_validated_phone text,
  p_provider text DEFAULT 'evolution',
  p_provider_reference text DEFAULT NULL,
  p_is_valid boolean DEFAULT false,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.current_organization_scope_users_id();
  v_current_phone text;
  v_validated_phone text:=public.normalize_whatsapp_validation_phone(p_validated_phone);
  v_matches boolean:=false;
BEGIN
  PERFORM public.require_organization_permission('leads.validate');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_lead_id IS NULL OR p_lead_id<=0 THEN RAISE EXCEPTION 'whatsapp_validation_lead_invalid'; END IF;

  SELECT public.normalize_whatsapp_validation_phone(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone))
    INTO v_current_phone
  FROM public.leads l
  WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_id=p_lead_id
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_validation_lead_not_found'; END IF;
  IF coalesce(v_current_phone,'')='' THEN RAISE EXCEPTION 'whatsapp_validation_current_phone_missing'; END IF;

  v_matches:=v_validated_phone<>'' AND v_validated_phone=v_current_phone;

  INSERT INTO public.whatsapp_validation_proofs(
    organizations_id,users_id,leads_id,validated_phone,provider,provider_reference,
    proof_metadata,is_valid,validated_at,updated_at
  ) VALUES(
    v_org,v_user,p_lead_id,
    CASE WHEN v_validated_phone<>'' THEN v_validated_phone ELSE v_current_phone END,
    coalesce(nullif(trim(p_provider),''),'evolution'),nullif(trim(coalesce(p_provider_reference,'')),''),
    coalesce(p_metadata,'{}'::jsonb),coalesce(p_is_valid,false) AND v_matches,now(),now()
  )
  ON CONFLICT(organizations_id,leads_id) DO UPDATE SET
    users_id=excluded.users_id,
    validated_phone=excluded.validated_phone,
    provider=excluded.provider,
    provider_reference=excluded.provider_reference,
    proof_metadata=excluded.proof_metadata,
    is_valid=excluded.is_valid,
    validated_at=excluded.validated_at,
    updated_at=now();

  RETURN coalesce(p_is_valid,false) AND v_matches;
END
$$;

CREATE OR REPLACE FUNCTION public.current_user_whatsapp_validation_proofs(p_lead_ids bigint[])
RETURNS TABLE(lead_id bigint,has_valid_proof boolean)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.current_organization_scope_users_id();
BEGIN
  PERFORM public.require_organization_permission('leads.view');
  IF v_org IS NULL OR v_user IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT l.leads_id,
         EXISTS(
           SELECT 1
           FROM public.whatsapp_validation_proofs p
           WHERE p.organizations_id=v_org
             AND p.users_id=v_user
             AND p.leads_id=l.leads_id
             AND p.is_valid=true
             AND p.validated_phone=public.normalize_whatsapp_validation_phone(
               public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)
             )
         ) AS has_valid_proof
  FROM public.leads l
  WHERE l.organizations_id=v_org
    AND l.users_id=v_user
    AND l.leads_id=ANY(coalesce(p_lead_ids,'{}'::bigint[]));
END
$$;

REVOKE ALL ON FUNCTION public.record_current_whatsapp_validation_proof(bigint,text,text,text,boolean,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.current_user_whatsapp_validation_proofs(bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_current_whatsapp_validation_proof(bigint,text,text,text,boolean,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_user_whatsapp_validation_proofs(bigint[]) TO authenticated,service_role;

-- Repara snapshots WhatsApp ainda nao iniciados que foram congelados por uma
-- versao anterior com leads_phone vazio/diferente. Itens ja iniciados permanecem
-- imutaveis para preservar auditoria e idempotencia.
DO $repair_pending_snapshots$
BEGIN
  PERFORM set_config('vinsansi.allow_queue_snapshot_refresh','on',true);

  WITH candidates AS (
    SELECT
      qi.queue_items_id,
      now() AS frozen_at,
      public.build_queue_item_payload_snapshot(
        qi.users_id,
        qi.queues_id,
        qi.leads_id,
        qi.templates_id,
        now()
      ) AS snapshot
    FROM public.queue_items qi
    JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
    JOIN public.channels c ON c.channels_id=q.channels_id
    JOIN public.leads l ON l.leads_id=qi.leads_id AND l.users_id=qi.users_id
    WHERE qi.templates_id IS NOT NULL
      AND qi.queue_items_started_at IS NULL
      AND qi.queue_items_finished_at IS NULL
      AND regexp_replace(lower(public.unaccent(trim(c.channels_name))),'[^a-z0-9]+','','g')='whatsapp'
      AND public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone)<>''
      AND regexp_replace(coalesce(qi.queue_items_payload_snapshot#>>'{recipient,phone}',''),'[^0-9]+','','g')
          IS DISTINCT FROM regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g')
  )
  UPDATE public.queue_items qi
  SET queue_items_payload_snapshot=c.snapshot,
      queue_items_payload_hash=encode(extensions.digest(convert_to(c.snapshot::text,'UTF8'),'sha256'),'hex'),
      queue_items_payload_created_at=c.frozen_at,
      queue_items_updated_at=now()
  FROM candidates c
  WHERE qi.queue_items_id=c.queue_items_id;

  PERFORM set_config('vinsansi.allow_queue_snapshot_refresh','off',true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('vinsansi.allow_queue_snapshot_refresh','off',true);
  RAISE;
END
$repair_pending_snapshots$;

COMMIT;
