BEGIN;

-- CRM Vinsansi Studio v1.5.0
-- Etapa 6: auditoria persistente append-only e maquina de estados no PostgreSQL.
--
-- Objetivos:
--   * audit_events e imutavel em runtime;
--   * toda insercao valida organizacao/ator/entidade;
--   * transicoes de lead e queue_item sao validadas no banco;
--   * mudancas criticas sao auditadas mesmo quando nao passam pelo frontend;
--   * o contrato multi-organizacao das Etapas 2-5 e preservado.

DO $preflight$
DECLARE v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN v_missing:=array_append(v_missing,'table:organizations'); END IF;
  IF to_regclass('public.organization_members') IS NULL THEN v_missing:=array_append(v_missing,'table:organization_members'); END IF;
  IF to_regclass('public.audit_events') IS NULL THEN v_missing:=array_append(v_missing,'table:audit_events'); END IF;
  IF to_regclass('public.audit_transition_rules') IS NULL THEN v_missing:=array_append(v_missing,'table:audit_transition_rules'); END IF;
  IF to_regclass('public.leads') IS NULL THEN v_missing:=array_append(v_missing,'table:leads'); END IF;
  IF to_regclass('public.queue_items') IS NULL THEN v_missing:=array_append(v_missing,'table:queue_items'); END IF;
  IF to_regprocedure('public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint)') IS NULL THEN v_missing:=array_append(v_missing,'function:append_audit_event'); END IF;
  IF to_regprocedure('public.current_organization_id()') IS NULL THEN v_missing:=array_append(v_missing,'function:current_organization_id'); END IF;
  IF to_regprocedure('public.current_organization_member_id()') IS NULL THEN v_missing:=array_append(v_missing,'function:current_organization_member_id'); END IF;
  IF cardinality(v_missing)>0 THEN
    RAISE EXCEPTION 'v1.5.0_requires_v1.4.3:%',array_to_string(v_missing,',');
  END IF;
END
$preflight$;

-- Garante as colunas organizacionais/atoriais mesmo em bancos que vieram do baseline antigo.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS organizations_id bigint REFERENCES public.organizations(organizations_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS actor_users_id bigint REFERENCES public.users(users_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_member_id bigint REFERENCES public.organization_members(organization_members_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'system';

DO $actor_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.audit_events'::regclass AND conname='audit_events_actor_type_check'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_actor_type_check
      CHECK (actor_type IN ('member','platform_owner','system'));
  END IF;
END
$actor_constraint$;

-- Backfill organizacional para eventos legados antes de tornar o contrato obrigatorio para novos eventos.
UPDATE public.audit_events a
   SET organizations_id=o.organizations_id
  FROM public.organizations o
 WHERE a.organizations_id IS NULL
   AND o.legacy_scope_users_id=a.users_id;

-- Um log imutavel nao pode depender de FKs com CASCADE/SET NULL, pois a acao
-- referencial alteraria o proprio historico. IDs historicos permanecem escalares e
-- sao validados no INSERT pelo trigger validate_audit_event_insert.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_lead_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_queue_item_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_channel_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_users_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_member_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_users_id_fkey;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_users_id_fkey FOREIGN KEY(users_id) REFERENCES public.users(users_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS audit_events_organization_created_idx
  ON public.audit_events(organizations_id,created_at DESC,audit_events_id DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_member_idx
  ON public.audit_events(organizations_id,actor_member_id,created_at DESC)
  WHERE actor_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON public.audit_events(organizations_id,entity_type,entity_id,created_at DESC,audit_events_id DESC);
CREATE INDEX IF NOT EXISTS audit_events_request_idx
  ON public.audit_events(request_id);

-- Regras canonicas. A tabela e global e somente leitura para clientes autenticados.
INSERT INTO public.audit_transition_rules(entity_type,from_status_id,to_status_id,action_key,is_active)
VALUES
  ('lead',1,2,'validate_or_route',true), ('lead',1,3,'route_to_pre_send',true),
  ('lead',1,6,'invalidate',true), ('lead',1,7,'mark_duplicate',true), ('lead',1,8,'archive',true),
  ('lead',2,1,'return_to_import',true), ('lead',2,3,'prepare_validation',true),
  ('lead',2,4,'enqueue',true), ('lead',2,6,'invalidate',true), ('lead',2,8,'archive',true),
  ('lead',3,1,'return_to_import',true), ('lead',3,2,'validation_success',true),
  ('lead',3,6,'validation_failure',true), ('lead',3,8,'archive',true),
  ('lead',4,2,'reconcile_to_valid',true), ('lead',4,5,'dispatch_success',true),
  ('lead',4,6,'invalidate',true), ('lead',4,8,'archive',true),
  ('lead',5,8,'archive',true), ('lead',6,2,'restore_valid',true), ('lead',6,8,'archive',true),
  ('lead',7,8,'archive',true), ('lead',8,2,'restore_valid',true),
  ('lead',8,5,'restore_sent',true), ('lead',8,6,'restore_invalid',true),
  ('queue_item',3,4,'start',true), ('queue_item',3,6,'fail',true), ('queue_item',3,7,'cancel',true), ('queue_item',3,8,'pause',true),
  ('queue_item',4,3,'recover',true), ('queue_item',4,5,'complete',true), ('queue_item',4,6,'fail',true), ('queue_item',4,7,'cancel',true), ('queue_item',4,8,'pause',true),
  ('queue_item',6,3,'reprocess',true), ('queue_item',6,5,'reconcile_sent',true), ('queue_item',6,7,'cancel',true), ('queue_item',6,8,'pause',true),
  ('queue_item',7,3,'restore',true),
  ('queue_item',8,3,'resume',true), ('queue_item',8,4,'resume_processing',true), ('queue_item',8,6,'fail',true), ('queue_item',8,7,'cancel',true)
ON CONFLICT(entity_type,from_status_id,to_status_id)
DO UPDATE SET action_key=excluded.action_key,is_active=excluded.is_active;

CREATE OR REPLACE FUNCTION public.assert_allowed_status_transition(
  p_entity_type text,
  p_from_status_id bigint,
  p_to_status_id bigint
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO pg_catalog,public
AS $$
BEGIN
  IF p_from_status_id IS NULL OR p_to_status_id IS NULL OR p_from_status_id=p_to_status_id THEN RETURN; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.audit_transition_rules r
     WHERE r.entity_type=p_entity_type
       AND r.from_status_id=p_from_status_id
       AND r.to_status_id=p_to_status_id
       AND r.is_active
  ) THEN
    RAISE EXCEPTION 'state_transition_not_allowed:%:%->%',p_entity_type,p_from_status_id,p_to_status_id;
  END IF;
END;
$$;

-- Valida qualquer insercao, inclusive as feitas por funcoes SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.validate_audit_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE v_scope bigint;
DECLARE v_member_users_id bigint;
BEGIN
  IF NEW.organizations_id IS NULL THEN RAISE EXCEPTION 'audit_organization_required'; END IF;
  IF nullif(trim(coalesce(NEW.source,'')),'') IS NULL OR nullif(trim(coalesce(NEW.action,'')),'') IS NULL THEN
    RAISE EXCEPTION 'audit_source_action_required';
  END IF;
  IF nullif(trim(coalesce(NEW.entity_type,'')),'') IS NULL THEN RAISE EXCEPTION 'audit_entity_type_required'; END IF;
  SELECT legacy_scope_users_id INTO v_scope FROM public.organizations WHERE organizations_id=NEW.organizations_id;
  IF v_scope IS NULL OR v_scope<>NEW.users_id THEN RAISE EXCEPTION 'audit_scope_mismatch'; END IF;
  IF NEW.actor_member_id IS NOT NULL THEN
    SELECT m.users_id INTO v_member_users_id
      FROM public.organization_members m
     WHERE m.organization_members_id=NEW.actor_member_id
       AND m.organizations_id=NEW.organizations_id;
    IF v_member_users_id IS NULL THEN RAISE EXCEPTION 'audit_actor_member_scope_mismatch'; END IF;
    IF NEW.actor_users_id IS NULL THEN NEW.actor_users_id:=v_member_users_id; END IF;
    IF NEW.actor_users_id<>v_member_users_id THEN RAISE EXCEPTION 'audit_actor_identity_mismatch'; END IF;
  END IF;
  IF NEW.actor_type='member' AND NEW.actor_member_id IS NULL THEN RAISE EXCEPTION 'audit_member_actor_required'; END IF;
  IF NEW.actor_type='platform_owner' AND (NEW.actor_users_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.platform_owners po WHERE po.users_id=NEW.actor_users_id
  )) THEN RAISE EXCEPTION 'audit_platform_owner_invalid'; END IF;
  IF NEW.actor_type='system' AND NEW.actor_member_id IS NOT NULL THEN RAISE EXCEPTION 'audit_system_member_invalid'; END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.leads l WHERE l.leads_id=NEW.lead_id AND l.organizations_id=NEW.organizations_id
  ) THEN RAISE EXCEPTION 'audit_lead_scope_mismatch'; END IF;
  IF NEW.queue_item_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.queue_items qi WHERE qi.queue_items_id=NEW.queue_item_id AND qi.organizations_id=NEW.organizations_id
  ) THEN RAISE EXCEPTION 'audit_queue_item_scope_mismatch'; END IF;
  NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb);
  NEW.request_id:=coalesce(NEW.request_id,gen_random_uuid());
  NEW.created_at:=coalesce(NEW.created_at,now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_audit_event_insert_trigger ON public.audit_events;
CREATE TRIGGER validate_audit_event_insert_trigger
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.validate_audit_event_insert();

-- Append-only real: depois desta etapa nenhum papel de aplicacao altera ou apaga historico.
CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_append_only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only_update_trigger ON public.audit_events;
DROP TRIGGER IF EXISTS audit_events_append_only_delete_trigger ON public.audit_events;
CREATE TRIGGER audit_events_append_only_update_trigger
BEFORE UPDATE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();
CREATE TRIGGER audit_events_append_only_delete_trigger
BEFORE DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

-- Mantem a assinatura publica usada pelo CRM, mas endurece escopo e ator.
CREATE OR REPLACE FUNCTION public.append_audit_event(
  p_source text,
  p_action text,
  p_entity_type text,
  p_entity_id text DEFAULT NULL,
  p_lead_id bigint DEFAULT NULL,
  p_queue_item_id bigint DEFAULT NULL,
  p_channel_id bigint DEFAULT NULL,
  p_previous_status_id bigint DEFAULT NULL,
  p_target_status_id bigint DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_users_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_scope_users_id bigint;
  v_org bigint;
  v_actor_users_id bigint;
  v_actor_member_id bigint;
  v_actor_type text;
  v_actor_name text;
  v_id bigint;
BEGIN
  IF auth.role()='service_role' THEN
    v_scope_users_id:=p_users_id;
    SELECT o.organizations_id INTO v_org FROM public.organizations o WHERE o.legacy_scope_users_id=v_scope_users_id LIMIT 1;
    v_actor_type:='system';
  ELSE
    v_scope_users_id:=public.ensure_current_user();
    v_org:=public.current_organization_id();
    v_actor_users_id:=public.current_actor_user_id();
    v_actor_member_id:=public.current_organization_member_id();
    v_actor_type:=CASE WHEN public.is_platform_owner(v_actor_users_id) AND v_actor_member_id IS NULL THEN 'platform_owner' ELSE 'member' END;
    SELECT u.users_name INTO v_actor_name FROM public.users u WHERE u.users_id=v_actor_users_id;
    IF p_users_id IS NOT NULL AND p_users_id<>v_scope_users_id THEN RAISE EXCEPTION 'audit_forbidden'; END IF;
  END IF;
  IF v_scope_users_id IS NULL THEN RAISE EXCEPTION 'audit_user_required'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'audit_organization_required'; END IF;
  IF nullif(trim(coalesce(p_source,'')),'') IS NULL OR nullif(trim(coalesce(p_action,'')),'') IS NULL THEN RAISE EXCEPTION 'audit_source_action_required'; END IF;

  INSERT INTO public.audit_events(
    users_id,organizations_id,actor_auth_user_id,actor_users_id,actor_member_id,actor_type,
    source,action,entity_type,entity_id,lead_id,queue_item_id,channel_id,
    previous_status_id,target_status_id,message,metadata
  ) VALUES(
    v_scope_users_id,v_org,auth.uid(),v_actor_users_id,v_actor_member_id,v_actor_type,
    trim(p_source),trim(p_action),coalesce(nullif(trim(p_entity_type),''),'system'),p_entity_id,
    p_lead_id,p_queue_item_id,p_channel_id,p_previous_status_id,p_target_status_id,p_message,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'actor_name',v_actor_name,
      'actor_type',v_actor_type,
      'actor_member_id',v_actor_member_id,
      'organization_id',v_org
    )
  ) RETURNING audit_events_id INTO v_id;
  RETURN v_id;
END;
$$;

-- Gatilhos de estado: a regra esta no banco, nao na interface.
CREATE OR REPLACE FUNCTION public.audit_lead_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.lead_status_id IS DISTINCT FROM OLD.lead_status_id THEN
    PERFORM public.assert_allowed_status_transition('lead',OLD.lead_status_id,NEW.lead_status_id);
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.append_audit_event('database','lead_created','lead',NEW.leads_id::text,NEW.leads_id,NULL,NEW.channels_id,NULL,NEW.lead_status_id,NULL,
      jsonb_build_object('origin',NEW.leads_origin,'organization_id',NEW.organizations_id),NEW.users_id);
  ELSIF NEW.lead_status_id IS DISTINCT FROM OLD.lead_status_id OR NEW.channels_id IS DISTINCT FROM OLD.channels_id THEN
    PERFORM public.append_audit_event('database','lead_state_changed','lead',NEW.leads_id::text,NEW.leads_id,NULL,NEW.channels_id,
      OLD.lead_status_id,NEW.lead_status_id,NULL,
      jsonb_build_object('previous_channel_id',OLD.channels_id,'target_channel_id',NEW.channels_id,'organization_id',NEW.organizations_id),NEW.users_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_lead_state_change_trigger ON public.leads;
CREATE TRIGGER audit_lead_state_change_trigger
AFTER INSERT OR UPDATE OF lead_status_id,channels_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.audit_lead_state_change();

CREATE OR REPLACE FUNCTION public.audit_queue_item_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.assert_allowed_status_transition('queue_item',OLD.status_id,NEW.status_id);
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.append_audit_event('database','queue_item_created','queue_item',NEW.queue_items_id::text,NEW.leads_id,NEW.queue_items_id,NULL,NULL,NEW.status_id,NULL,
      jsonb_build_object('queue_id',NEW.queues_id,'position',NEW.queue_items_position,'organization_id',NEW.organizations_id),NEW.users_id);
  ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    PERFORM public.append_audit_event('database','queue_item_state_changed','queue_item',NEW.queue_items_id::text,NEW.leads_id,NEW.queue_items_id,NULL,
      OLD.status_id,NEW.status_id,NEW.queue_items_error_message,
      jsonb_build_object('attempts',NEW.queue_items_attempts,'queue_id',NEW.queues_id,'organization_id',NEW.organizations_id),NEW.users_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_queue_item_state_change_trigger ON public.queue_items;
CREATE TRIGGER audit_queue_item_state_change_trigger
AFTER INSERT OR UPDATE OF status_id ON public.queue_items
FOR EACH ROW EXECUTE FUNCTION public.audit_queue_item_state_change();

-- Se um fluxo administrativo fizer hard-delete de lead, o evento preserva o ID historico.
CREATE OR REPLACE FUNCTION public.audit_lead_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  PERFORM public.append_audit_event('database','lead_deleted','lead',OLD.leads_id::text,OLD.leads_id,NULL,OLD.channels_id,
    OLD.lead_status_id,NULL,NULL,
    jsonb_build_object('origin',OLD.leads_origin,'organization_id',OLD.organizations_id),OLD.users_id);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS audit_lead_delete_trigger ON public.leads;
CREATE TRIGGER audit_lead_delete_trigger
BEFORE DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.audit_lead_delete();

-- Exclusao de item enfileirado continua permitida pelos contratos atuais, mas passa a deixar rastro.
CREATE OR REPLACE FUNCTION public.audit_queue_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  PERFORM public.append_audit_event('database','queue_item_deleted','queue_item',OLD.queue_items_id::text,OLD.leads_id,OLD.queue_items_id,NULL,
    OLD.status_id,NULL,OLD.queue_items_error_message,
    jsonb_build_object('queue_id',OLD.queues_id,'position',OLD.queue_items_position,'attempts',OLD.queue_items_attempts,'organization_id',OLD.organizations_id),OLD.users_id);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS audit_queue_item_delete_trigger ON public.queue_items;
CREATE TRIGGER audit_queue_item_delete_trigger
BEFORE DELETE ON public.queue_items
FOR EACH ROW EXECUTE FUNCTION public.audit_queue_item_delete();

-- Worker batches continuam auditados quando a tabela existe.
DO $worker_audit$
BEGIN
  IF to_regclass('public.worker_batches') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.audit_worker_batch_state_change()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO pg_catalog,public
      AS $body$
      BEGIN
        IF TG_OP='INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
          PERFORM public.append_audit_event(
            'worker','worker_batch_state_changed','worker_batch',NEW.worker_batches_id::text,NULL,NULL,NEW.channels_id,
            CASE WHEN TG_OP='UPDATE' THEN OLD.status_id ELSE NULL END,NEW.status_id,NEW.worker_batches_last_error,
            jsonb_build_object('chip_id',NEW.chips_id,'total',NEW.worker_batches_total_items,'processed',NEW.worker_batches_processed_items,'worker_id',NEW.worker_batches_worker_id,'organization_id',NEW.organizations_id),NEW.users_id
          );
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;
    DROP TRIGGER IF EXISTS audit_worker_batch_state_change_trigger ON public.worker_batches;
    CREATE TRIGGER audit_worker_batch_state_change_trigger
    AFTER INSERT OR UPDATE OF status_id ON public.worker_batches
    FOR EACH ROW EXECUTE FUNCTION public.audit_worker_batch_state_change();
  END IF;
END
$worker_audit$;

-- RLS/grants: leitura exige organizacao + audit.view; escrita somente por contratos server-side.
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_transition_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_own_select ON public.audit_events;
DROP POLICY IF EXISTS audit_events_organization_select ON public.audit_events;
CREATE POLICY audit_events_organization_select ON public.audit_events
FOR SELECT TO authenticated
USING(organizations_id=public.current_organization_id() AND public.has_organization_permission('audit.view'));
DROP POLICY IF EXISTS audit_transition_rules_read ON public.audit_transition_rules;
CREATE POLICY audit_transition_rules_read ON public.audit_transition_rules
FOR SELECT TO authenticated USING(is_active);

REVOKE INSERT,UPDATE,DELETE ON public.audit_events FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.audit_transition_rules FROM anon,authenticated;
GRANT SELECT ON public.audit_events,public.audit_transition_rules TO authenticated;
GRANT SELECT,INSERT ON public.audit_events TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_transition_rules TO service_role;
GRANT EXECUTE ON FUNCTION public.append_audit_event(text,text,text,text,bigint,bigint,bigint,bigint,bigint,text,jsonb,bigint) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.assert_allowed_status_transition(text,bigint,bigint) TO authenticated,service_role;

COMMIT;
