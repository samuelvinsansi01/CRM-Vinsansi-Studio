-- CRM - Vinsansi Studio v2.4.0-R58
-- Fluxo simples de leads + revisão por canal.
--
-- Contrato R58:
--   lead_status: 1 importado | 2 revisao | 3 sem_contato | 4 na_fila |
--                5 enviado | 6 invalido | 7 duplicado
--   channels: whatsapp | instagram | sem_destino
--
-- Regras:
--   Importado + WhatsApp/Sem destino -> Puxar WhatsApp -> Revisao + WhatsApp
--   Importado + Instagram/Sem destino -> Puxar Instagram -> Revisao + Instagram
--   WhatsApp invalido + Instagram -> Importado + Instagram
--   WhatsApp invalido sem Instagram -> Sem contato
--   Aprovar Revisao -> Na fila
--   Invalidar manualmente -> Invalido
--
-- Esta migration NÃO apaga permanent_records nem as tabelas de prova WhatsApp.
-- Primeiro remove somente dependências do runtime; as tabelas antigas podem ser
-- eliminadas em uma limpeza posterior, depois de confirmar os consumidores restantes.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Desacopla LEADS das camadas históricas já substituídas pelo próprio status.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_lead_state_change_trigger ON public.leads;
DROP FUNCTION IF EXISTS public.audit_lead_state_change() RESTRICT;

DROP TRIGGER IF EXISTS lead_lifecycle_leads ON public.leads;

DROP TRIGGER IF EXISTS refresh_permanent_record_lead_trigger ON public.leads;
DROP FUNCTION IF EXISTS public.refresh_permanent_record_from_lead_trigger() RESTRICT;

-- Base Permanente agora é uma visão de leads finais. Não manter cópia nova por envio.
DROP TRIGGER IF EXISTS refresh_permanent_record_sent_trigger ON public.sents;
DROP FUNCTION IF EXISTS public.refresh_permanent_record_from_sent_trigger() RESTRICT;

-- O bloqueio por permanent_records não faz mais parte do caminho de disparo.
-- Só leads em Revisão podem virar fila e os status finais nunca entram nessa seleção.
DROP TRIGGER IF EXISTS block_permanent_record_dispatch ON public.queue_items;
DROP FUNCTION IF EXISTS public.block_permanent_record_dispatch_trigger() RESTRICT;

-- -----------------------------------------------------------------------------
-- 2. Catálogo simples de status/canais.
-- -----------------------------------------------------------------------------
UPDATE public.lead_status
SET lead_status_name='revisao'
WHERE lead_status_id=2
  AND regexp_replace(lower(public.unaccent(trim(lead_status_name))), '[^a-z0-9]+', '', 'g') IN
      ('validado','validated','revisao','review');

UPDATE public.lead_status
SET lead_status_name='sem_contato'
WHERE lead_status_id=3
  AND regexp_replace(lower(public.unaccent(trim(lead_status_name))), '[^a-z0-9]+', '', 'g') IN
      ('preenvio','presend','semcontato','nocontact');

INSERT INTO public.channels(channels_name)
SELECT 'sem_destino'
WHERE NOT EXISTS(
  SELECT 1
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='semdestino'
);

-- As regras antigas de transição do lead descreviam Validado/Pré-envio/Arquivado.
-- Mantemos apenas o catálogo mínimo enquanto a camada de audit_transition_rules ainda existe.
DELETE FROM public.audit_transition_rules
WHERE entity_type='lead';

INSERT INTO public.audit_transition_rules(entity_type,from_status_id,to_status_id,action_key,is_active)
VALUES
  ('lead',1,2,'pull_to_review',true),
  ('lead',1,3,'mark_no_contact',true),
  ('lead',1,6,'invalidate',true),
  ('lead',1,7,'mark_duplicate',true),
  ('lead',2,1,'release_or_redirect',true),
  ('lead',2,3,'whatsapp_no_contact',true),
  ('lead',2,4,'enqueue',true),
  ('lead',2,6,'invalidate',true),
  ('lead',4,5,'dispatch_success',true),
  ('lead',4,6,'invalidate',true)
ON CONFLICT(entity_type,from_status_id,to_status_id)
DO UPDATE SET action_key=excluded.action_key,is_active=excluded.is_active;

-- O status 8 (arquivado) fica apenas como resíduo de catálogo nesta etapa.
-- Ele não participa mais do runtime e será removido fisicamente junto com as
-- estruturas históricas que ainda podem manter FK para esse ID.

-- -----------------------------------------------------------------------------
-- 3. Normaliza somente os Importados para a regra canônica de destino.
-- -----------------------------------------------------------------------------
DO $normalize_imported$
DECLARE
  v_whatsapp bigint;
  v_instagram bigint;
  v_sem_destino bigint;
BEGIN
  SELECT c.channels_id INTO v_whatsapp
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='whatsapp'
  ORDER BY c.channels_id LIMIT 1;

  SELECT c.channels_id INTO v_instagram
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='instagram'
  ORDER BY c.channels_id LIMIT 1;

  SELECT c.channels_id INTO v_sem_destino
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='semdestino'
  ORDER BY c.channels_id LIMIT 1;

  IF v_whatsapp IS NULL OR v_instagram IS NULL OR v_sem_destino IS NULL THEN
    RAISE EXCEPTION 'r58_channels_catalog_incomplete';
  END IF;

  UPDATE public.leads l
  SET channels_id=CASE
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))>=10
         AND length(btrim(coalesce(l.leads_instagram,'')))>0 THEN v_sem_destino
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))>=10 THEN v_whatsapp
        WHEN length(btrim(coalesce(l.leads_instagram,'')))>0 THEN v_instagram
        ELSE NULL
      END,
      lead_status_id=CASE
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))<10
         AND length(btrim(coalesce(l.leads_instagram,'')))=0 THEN 3
        ELSE 1
      END,
      leads_updated_at=now()
  WHERE l.lead_status_id=1;

  -- Corrige resíduos antigos marcados Na fila sem fila/revisão/envio real.
  UPDATE public.leads l
  SET channels_id=CASE
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))>=10
         AND length(btrim(coalesce(l.leads_instagram,'')))>0 THEN v_sem_destino
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))>=10 THEN v_whatsapp
        WHEN length(btrim(coalesce(l.leads_instagram,'')))>0 THEN v_instagram
        ELSE NULL
      END,
      lead_status_id=CASE
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))<10
         AND length(btrim(coalesce(l.leads_instagram,'')))=0 THEN 3
        ELSE 1
      END,
      leads_updated_at=now()
  WHERE l.lead_status_id=4
    AND NOT EXISTS(SELECT 1 FROM public.queue_items qi WHERE qi.leads_id=l.leads_id)
    AND NOT EXISTS(SELECT 1 FROM public.sents s WHERE s.leads_id=l.leads_id)
    AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.leads_id=l.leads_id);
END
$normalize_imported$;

-- -----------------------------------------------------------------------------
-- 4. Puxada por capacidade: uma única seleção, sem quantidade manual/refill/retry.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pull_queue_review_to_capacity(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_key text:=lower(trim(coalesce(p_resource_key,'')));
  v_date date:=coalesce(p_scheduled_date,current_date);
  v_local_today date;
  v_tz text:='America/Sao_Paulo';
  v_active bigint;
  v_channel_id bigint;
  v_sem_destino_id bigint;
  v_resource_id bigint;
  v_resource_label text;
  v_provider_key text;
  v_capacity record;
  v_batch bigint;
  v_review_open_before integer:=0;
  v_review_open_after integer:=0;
  v_pos integer:=0;
  v_wanted integer:=0;
  v_reserved jsonb:='[]'::jsonb;
  v_reserved_count integer:=0;
  v_review_item_id bigint;
  v_lead record;
  v_available_after integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  IF v_channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'queue_review_invalid_channel'; END IF;
  IF v_key='' THEN RAISE EXCEPTION 'queue_review_resource_required'; END IF;

  SELECT coalesce(nullif(ots.settings->>'operationalTimezone',''),'America/Sao_Paulo')
  INTO v_tz
  FROM public.organization_tool_settings ots
  WHERE ots.organizations_id=v_org AND ots.tool_id='vinsansi_whatsapp_manager';
  v_tz:=coalesce(nullif(v_tz,''),'America/Sao_Paulo');
  v_local_today:=(now() AT TIME ZONE v_tz)::date;
  IF v_date<v_local_today OR v_date>v_local_today+366 THEN RAISE EXCEPTION 'queue_review_scheduled_date_invalid'; END IF;

  v_channel_id:=public.queue_review_channel_id(v_channel);
  SELECT c.channels_id INTO v_sem_destino_id
  FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='semdestino'
  ORDER BY c.channels_id LIMIT 1;
  IF v_channel_id IS NULL OR v_sem_destino_id IS NULL THEN RAISE EXCEPTION 'queue_review_channel_catalog_incomplete'; END IF;

  SELECT s.status_id INTO v_active
  FROM public.status s
  WHERE regexp_replace(lower(public.unaccent(trim(s.status_name))), '[^a-z0-9]+', '', 'g') IN ('ativo','active')
  ORDER BY s.status_id LIMIT 1;

  IF v_channel='whatsapp' THEN
    SELECT c.chips_id,
           coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text),
           coalesce(i.instances_name,'')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.chips c
    JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    JOIN public.levels l ON l.levels_id=c.levels_id AND l.users_id=c.users_id
    JOIN public.instance_runtime_states rs ON rs.instances_id=i.instances_id AND rs.users_id=i.users_id
    WHERE c.users_id=v_user
      AND c.status_id=v_active AND i.status_id=v_active AND l.status_id=v_active
      AND l.channels_id=v_channel_id
      AND rs.operational_state='online' AND rs.session_saved IS TRUE AND rs.socket_connected IS TRUE
      AND (c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key)
    ORDER BY c.chips_id LIMIT 1;
  ELSE
    SELECT so.socials_id,
           coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text),
           regexp_replace(coalesce(so.socials_username,''),'^@','','g')
    INTO v_resource_id,v_resource_label,v_provider_key
    FROM public.socials so
    JOIN public.levels l ON l.levels_id=so.levels_id AND l.users_id=so.users_id
    WHERE so.users_id=v_user AND so.status_id=v_active AND l.status_id=v_active AND l.channels_id=v_channel_id
      AND length(btrim(coalesce(so.socials_username,'')))>0
      AND (so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key
        OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g'))
    ORDER BY so.socials_id LIMIT 1;
  END IF;

  IF v_resource_id IS NULL THEN RAISE EXCEPTION 'queue_review_resource_not_operational'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_channel,v_resource_id,v_date),0));
  SELECT * INTO v_capacity FROM public.queue_review_resource_capacity(v_channel,v_resource_id,v_date);

  SELECT b.queue_review_batches_id INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.channel_key=v_channel
    AND b.resource_id=v_resource_id AND b.scheduled_date=v_date AND b.review_status='open'
  FOR UPDATE;

  IF v_batch IS NULL THEN
    INSERT INTO public.queue_review_batches(organizations_id,users_id,channels_id,channel_key,resource_id,scheduled_date,target_count)
    VALUES(v_org,v_user,v_channel_id,v_channel,v_resource_id,v_date,greatest(0,coalesce(v_capacity.available,0)))
    RETURNING queue_review_batches_id INTO v_batch;
  ELSE
    UPDATE public.queue_review_batches
    SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
    WHERE queue_review_batches_id=v_batch;
  END IF;

  SELECT count(*)::integer INTO v_review_open_before
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch AND i.review_status='open';

  SELECT coalesce(max(i.review_position),0) INTO v_pos
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=v_batch;

  v_wanted:=greatest(0,coalesce(v_capacity.available,0)-coalesce(v_review_open_before,0));

  IF v_wanted>0 AND v_channel='whatsapp' THEN
    FOR v_lead IN
      SELECT l.leads_id,l.leads_name,
             public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone) AS effective_phone,
             regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g') AS normalized_phone,
             coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org AND l.users_id=v_user
        AND l.lead_status_id=1
        AND l.channels_id IN (v_channel_id,v_sem_destino_id)
        AND length(regexp_replace(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),'[^0-9]+','','g'))>=10
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open')
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.queue_review_batches_id=v_batch AND ri.leads_id=l.leads_id AND ri.review_status IN ('invalidated','locked'))
      ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,v_batch,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO v_review_item_id;

      UPDATE public.leads
      SET lead_status_id=2,channels_id=v_channel_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id AND organizations_id=v_org AND users_id=v_user
        AND lead_status_id=1 AND channels_id IN (v_channel_id,v_sem_destino_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

      v_reserved:=v_reserved || jsonb_build_array(jsonb_build_object(
        'leadId',v_lead.leads_id,'reviewItemId',v_review_item_id,'company',v_lead.leads_name,
        'phone',coalesce(v_lead.effective_phone,''),'normalizedPhone',coalesce(v_lead.normalized_phone,''),'instagram',coalesce(v_lead.instagram,'')));
    END LOOP;
  ELSIF v_wanted>0 AND v_channel='instagram' THEN
    FOR v_lead IN
      SELECT l.leads_id,l.leads_name,coalesce(l.leads_instagram,'') AS instagram
      FROM public.leads l
      WHERE l.organizations_id=v_org AND l.users_id=v_user
        AND l.lead_status_id=1
        AND l.channels_id IN (v_channel_id,v_sem_destino_id)
        AND length(btrim(coalesce(l.leads_instagram,'')))>0
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.organizations_id=v_org AND ri.leads_id=l.leads_id AND ri.review_status='open')
        AND NOT EXISTS(SELECT 1 FROM public.queue_review_items ri WHERE ri.queue_review_batches_id=v_batch AND ri.leads_id=l.leads_id AND ri.review_status IN ('invalidated','locked'))
      ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC
      LIMIT v_wanted
      FOR UPDATE OF l SKIP LOCKED
    LOOP
      v_pos:=v_pos+1;
      INSERT INTO public.queue_review_items(organizations_id,queue_review_batches_id,leads_id,review_position)
      VALUES(v_org,v_batch,v_lead.leads_id,v_pos)
      RETURNING queue_review_items_id INTO v_review_item_id;

      UPDATE public.leads
      SET lead_status_id=2,channels_id=v_channel_id,leads_updated_at=now()
      WHERE leads_id=v_lead.leads_id AND organizations_id=v_org AND users_id=v_user
        AND lead_status_id=1 AND channels_id IN (v_channel_id,v_sem_destino_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

      v_reserved:=v_reserved || jsonb_build_array(jsonb_build_object(
        'leadId',v_lead.leads_id,'reviewItemId',v_review_item_id,'company',v_lead.leads_name,
        'phone','','normalizedPhone','','instagram',coalesce(v_lead.instagram,'')));
    END LOOP;
  END IF;

  v_reserved_count:=jsonb_array_length(v_reserved);
  v_review_open_after:=v_review_open_before+v_reserved_count;
  v_available_after:=greatest(0,coalesce(v_capacity.available,0)-v_review_open_after);

  UPDATE public.queue_review_batches
  SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
  WHERE queue_review_batches_id=v_batch;

  RETURN jsonb_build_object(
    'contractVersion','R58','batchId',v_batch,'resourceId',v_resource_id,'resourceLabel',v_resource_label,
    'providerKey',v_provider_key,'scheduledDate',v_date,'dailyLimit',greatest(0,coalesce(v_capacity.daily_limit,0)),
    'available',v_available_after,'capacityToFill',v_wanted,'reserved',v_reserved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pull_queue_review_to_capacity(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pull_queue_review_to_capacity(text,text,date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Reconciliação WhatsApp R58.
--    Resultado inválido do provider já é persistido pelo handler antes desta RPC.
--    Esta RPC só mantém os válidos em Revisão e libera o restante do clique.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_queue_review_whatsapp_validation(
  p_batch_id bigint,
  p_approved_ids bigint[] DEFAULT '{}'::bigint[],
  p_release_ids bigint[] DEFAULT '{}'::bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_batch public.queue_review_batches%ROWTYPE;
  v_capacity record;
  v_ready_ids bigint[]:='{}'::bigint[];
  v_release_ids bigint[]:='{}'::bigint[];
  v_missing_ids bigint[]:='{}'::bigint[];
  v_retained_ready_ids bigint[]:='{}'::bigint[];
  v_whatsapp_id bigint;
  v_instagram_id bigint;
  v_sem_destino_id bigint;
  v_open integer:=0;
  v_released integer:=0;
  v_restored integer:=0;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');

  SELECT coalesce(array_agg(u.id ORDER BY u.id),'{}'::bigint[]) INTO v_ready_ids
  FROM (SELECT DISTINCT id FROM unnest(coalesce(p_approved_ids,'{}'::bigint[])) x(id) WHERE id IS NOT NULL AND id>0) u;

  SELECT coalesce(array_agg(u.id ORDER BY u.id),'{}'::bigint[]) INTO v_release_ids
  FROM (SELECT DISTINCT id FROM unnest(coalesce(p_release_ids,'{}'::bigint[])) x(id) WHERE id IS NOT NULL AND id>0) u;

  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user
    AND b.channel_key='whatsapp' AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date),0));

  SELECT * INTO v_batch
  FROM public.queue_review_batches b
  WHERE b.queue_review_batches_id=p_batch_id AND b.organizations_id=v_org AND b.users_id=v_user
    AND b.channel_key='whatsapp' AND b.review_status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_batch_not_open'; END IF;

  IF EXISTS(SELECT 1 FROM unnest(v_ready_ids) r(id) JOIN unnest(v_release_ids) x(id) USING(id)) THEN
    RAISE EXCEPTION 'queue_review_reconcile_overlap';
  END IF;

  SELECT c.channels_id INTO v_whatsapp_id FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='whatsapp'
  ORDER BY c.channels_id LIMIT 1;
  SELECT c.channels_id INTO v_instagram_id FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='instagram'
  ORDER BY c.channels_id LIMIT 1;
  SELECT c.channels_id INTO v_sem_destino_id FROM public.channels c
  WHERE regexp_replace(lower(public.unaccent(trim(c.channels_name))), '[^a-z0-9]+', '', 'g')='semdestino'
  ORDER BY c.channels_id LIMIT 1;
  IF v_whatsapp_id IS NULL OR v_instagram_id IS NULL OR v_sem_destino_id IS NULL THEN RAISE EXCEPTION 'r58_channels_catalog_incomplete'; END IF;
  IF v_batch.channels_id IS DISTINCT FROM v_whatsapp_id THEN RAISE EXCEPTION 'queue_review_batch_channel_mismatch'; END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),'{}'::bigint[]) INTO v_missing_ids
  FROM unnest(v_ready_ids) x(id)
  WHERE NOT EXISTS(
    SELECT 1 FROM public.queue_review_items i
    WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org
      AND i.leads_id=x.id AND i.review_status='open'
  );
  IF cardinality(v_missing_ids)>0 THEN RAISE EXCEPTION 'queue_review_ready_not_reserved:%',array_to_string(v_missing_ids,','); END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),'{}'::bigint[]) INTO v_missing_ids
  FROM unnest(v_release_ids) x(id)
  WHERE NOT EXISTS(
    SELECT 1 FROM public.queue_review_items i
    WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org
      AND i.leads_id=x.id AND i.review_status='open'
  );
  IF cardinality(v_missing_ids)>0 THEN RAISE EXCEPTION 'queue_review_release_not_reserved:%',array_to_string(v_missing_ids,','); END IF;

  -- Válidos permanecem em Revisão/WhatsApp. Exigimos prova atual para o telefone atual.
  UPDATE public.leads l
  SET lead_status_id=2,channels_id=v_whatsapp_id,leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user
    AND l.leads_id=ANY(v_ready_ids)
    AND l.lead_status_id=2 AND l.channels_id=v_whatsapp_id
    AND EXISTS(
      SELECT 1 FROM public.whatsapp_validation_proofs p
      WHERE p.organizations_id=v_org AND p.users_id=v_user AND p.leads_id=l.leads_id AND p.is_valid=true
        AND p.validated_phone=public.normalize_whatsapp_validation_phone(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone))
    );

  SELECT coalesce(array_agg(i.leads_id ORDER BY i.leads_id),'{}'::bigint[]) INTO v_retained_ready_ids
  FROM public.queue_review_items i
  JOIN public.leads l ON l.leads_id=i.leads_id AND l.organizations_id=v_org AND l.users_id=v_user
  WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org AND i.review_status='open'
    AND i.leads_id=ANY(v_ready_ids)
    AND l.lead_status_id=2 AND l.channels_id=v_whatsapp_id
    AND EXISTS(
      SELECT 1 FROM public.whatsapp_validation_proofs p
      WHERE p.organizations_id=v_org AND p.users_id=v_user AND p.leads_id=l.leads_id AND p.is_valid=true
        AND p.validated_phone=public.normalize_whatsapp_validation_phone(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone))
    );

  IF cardinality(v_retained_ready_ids)<>cardinality(v_ready_ids) THEN
    SELECT coalesce(array_agg(x.id ORDER BY x.id),'{}'::bigint[]) INTO v_missing_ids
    FROM unnest(v_ready_ids) x(id) WHERE NOT (x.id=ANY(v_retained_ready_ids));
    RAISE EXCEPTION 'queue_review_ready_not_persisted:%',array_to_string(v_missing_ids,',');
  END IF;

  UPDATE public.queue_review_items i
  SET review_status='released',updated_at=now()
  WHERE i.queue_review_batches_id=p_batch_id AND i.organizations_id=v_org
    AND i.review_status='open' AND i.leads_id=ANY(v_release_ids);
  GET DIAGNOSTICS v_released=ROW_COUNT;

  -- Somente erros técnicos/conflitos ainda continuam Revisão/WhatsApp neste ponto.
  -- Resultados inválidos já foram movidos pelo handler para Importado/Instagram
  -- ou Sem contato, portanto não são sobrescritos aqui.
  UPDATE public.leads l
  SET lead_status_id=CASE
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))<10
         AND length(btrim(coalesce(l.leads_instagram,'')))=0 THEN 3
        ELSE 1
      END,
      channels_id=CASE
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))>=10
         AND length(btrim(coalesce(l.leads_instagram,'')))>0 THEN v_sem_destino_id
        WHEN length(regexp_replace(coalesce(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone),''),'[^0-9]+','','g'))>=10 THEN v_whatsapp_id
        WHEN length(btrim(coalesce(l.leads_instagram,'')))>0 THEN v_instagram_id
        ELSE NULL
      END,
      leads_updated_at=now()
  WHERE l.organizations_id=v_org AND l.users_id=v_user
    AND l.leads_id=ANY(v_release_ids)
    AND l.lead_status_id=2 AND l.channels_id=v_whatsapp_id;
  GET DIAGNOSTICS v_restored=ROW_COUNT;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_batch.channel_key,v_batch.resource_id,v_batch.scheduled_date);

  UPDATE public.queue_review_batches
  SET target_count=greatest(0,coalesce(v_capacity.available,0)),updated_at=now()
  WHERE queue_review_batches_id=p_batch_id;

  SELECT count(*)::integer INTO v_open
  FROM public.queue_review_items i
  WHERE i.queue_review_batches_id=p_batch_id AND i.review_status='open';

  RETURN jsonb_build_object(
    'contractVersion','R58','batchId',p_batch_id,
    'requestedReadyCount',cardinality(v_ready_ids),'retainedReadyCount',cardinality(v_retained_ready_ids),
    'retainedReadyIds',to_jsonb(v_retained_ready_ids),'released',v_released,'restored',v_restored,
    'targetCount',greatest(0,coalesce(v_capacity.available,0)),'openCount',greatest(0,coalesce(v_open,0)),
    'missingCount',greatest(0,coalesce(v_capacity.available,0)-coalesce(v_open,0))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_queue_review_whatsapp_validation(bigint,bigint[],bigint[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Core de preparação: preserva a implementação instalada e troca somente o
--    status exigido de Validado para Revisão. R43 continua usando destinatário efetivo.
-- -----------------------------------------------------------------------------
DO $patch_prepare_r58$
DECLARE
  v_def text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb)'::regprocedure) INTO v_def;
  v_original:=v_def;

  v_def:=regexp_replace(
    v_def,
    $rx$IN[[:space:]]*\([[:space:]]*'validado'[[:space:]]*,[[:space:]]*'validated'[[:space:]]*\)$rx$,
    $to$IN ('revisao', 'review')$to$,
    'g'
  );
  v_def:=replace(v_def,'O lead não está mais no status Validado.','O lead não está mais em Revisão.');
  v_def:=replace(v_def,'O lead nao esta mais no status Validado.','O lead nao esta mais em Revisao.');

  -- Compatibilidade caso R43 ainda não tenha reescrito este trecho no ambiente.
  v_def:=replace(
    v_def,
    'coalesce(v_lead.leads_phone, '''')',
    'public.effective_whatsapp_phone(v_lead.leads_whatsapp, v_lead.leads_phone)'
  );
  v_def:=replace(
    v_def,
    'coalesce(nullif(v_lead.leads_whatsapp, ''''), v_lead.leads_phone, '''')',
    'public.effective_whatsapp_phone(v_lead.leads_whatsapp, v_lead.leads_phone)'
  );

  IF v_def IS DISTINCT FROM v_original THEN EXECUTE v_def; END IF;

  SELECT pg_get_functiondef('public.prepare_queue_items_rbac_inner(text,bigint,date,jsonb)'::regprocedure) INTO v_def;
  IF v_def !~ $rx$'revisao'$rx$ THEN RAISE EXCEPTION 'r58_prepare_queue_items_review_patch_failed'; END IF;
  IF v_def !~ 'effective_whatsapp_phone[[:space:]]*\(' THEN RAISE EXCEPTION 'r58_prepare_queue_items_effective_whatsapp_missing'; END IF;
END
$patch_prepare_r58$;

-- A função pública deixa de consultar permanent_records. O próprio status do lead
-- é a trava: o inner aceita apenas Revisão e move para Na fila.
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
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  RETURN QUERY
  SELECT * FROM public.prepare_queue_items_rbac_inner(p_channel,p_resource_id,p_scheduled_date,p_items);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_queue_items(text,bigint,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_queue_items(text,bigint,date,jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Aprovação: Revisão -> Na fila sem Validado/Pré-envio intermediários.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_queue_review_item(
  p_review_item_id bigint,
  p_template_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_item record;
  v_capacity record;
  v_result record;
  v_queue_item record;
  v_effective_phone text;
  v_snapshot_phone text;
  v_snapshot_message_1 text;
BEGIN
  PERFORM public.require_organization_permission('queues.prepare');
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'organization_context_required'; END IF;
  IF p_review_item_id IS NULL OR p_review_item_id<=0 THEN RAISE EXCEPTION 'queue_review_item_required'; END IF;
  IF p_template_id IS NULL OR p_template_id<=0 THEN RAISE EXCEPTION 'queue_review_template_required'; END IF;

  SELECT i.queue_review_items_id,i.leads_id,b.queue_review_batches_id,b.channel_key,b.resource_id,b.scheduled_date,b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org AND i.review_status='open'
    AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_item.channel_key,v_item.resource_id,v_item.scheduled_date),0));

  SELECT i.queue_review_items_id,i.leads_id,b.queue_review_batches_id,b.channel_key,b.resource_id,b.scheduled_date,b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org AND i.review_status='open'
    AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  FOR UPDATE OF i,b;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  SELECT * INTO v_capacity
  FROM public.queue_review_resource_capacity(v_item.channel_key,v_item.resource_id,v_item.scheduled_date);
  IF coalesce(v_capacity.available,0)<=0 THEN RAISE EXCEPTION 'queue_review_resource_capacity_reached'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.leads l
    WHERE l.leads_id=v_item.leads_id AND l.organizations_id=v_org AND l.users_id=v_user
      AND l.lead_status_id=2 AND l.channels_id=v_item.channels_id
  ) THEN
    RAISE EXCEPTION 'queue_review_lead_changed';
  END IF;

  SELECT * INTO v_result
  FROM public.prepare_queue_items(
    v_item.channel_key,v_item.resource_id,v_item.scheduled_date,
    jsonb_build_array(jsonb_build_object('lead_id',v_item.leads_id,'template_id',p_template_id))
  );

  IF v_result.queue_item_id IS NULL OR v_result.outcome NOT IN ('queued','reconciled') THEN
    RAISE EXCEPTION 'queue_review_approval_failed:%',coalesce(v_result.reason,v_result.outcome,'unknown');
  END IF;

  UPDATE public.queue_review_items
  SET review_status='locked',queue_items_id=v_result.queue_item_id,updated_at=now()
  WHERE queue_review_items_id=p_review_item_id AND organizations_id=v_org AND review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_changed'; END IF;

  SELECT qi.queue_items_id,qi.leads_id,qi.chips_id,qi.socials_id,qi.queue_items_payload_snapshot,
         (coalesce(qi.queue_items_scheduled_at,q.queues_scheduled_at) AT TIME ZONE 'UTC')::date AS scheduled_date
  INTO v_queue_item
  FROM public.queue_items qi
  JOIN public.queues q ON q.queues_id=qi.queues_id AND q.users_id=qi.users_id
  WHERE qi.queue_items_id=v_result.queue_item_id AND qi.organizations_id=v_org AND qi.users_id=v_user
    AND qi.leads_id=v_item.leads_id AND q.channels_id=v_item.channels_id
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_queue_item_not_persisted'; END IF;
  IF v_queue_item.scheduled_date IS DISTINCT FROM v_item.scheduled_date THEN RAISE EXCEPTION 'queue_review_queue_item_wrong_date'; END IF;
  IF v_item.channel_key='whatsapp' AND v_queue_item.chips_id IS DISTINCT FROM v_item.resource_id THEN RAISE EXCEPTION 'queue_review_queue_item_wrong_chip'; END IF;
  IF v_item.channel_key='instagram' AND v_queue_item.socials_id IS DISTINCT FROM v_item.resource_id THEN RAISE EXCEPTION 'queue_review_queue_item_wrong_profile'; END IF;

  v_snapshot_message_1:=trim(coalesce(v_queue_item.queue_items_payload_snapshot#>>'{messages,message_1}',''));
  IF v_snapshot_message_1='' THEN RAISE EXCEPTION 'queue_review_snapshot_message_1_missing'; END IF;

  IF v_item.channel_key='whatsapp' THEN
    SELECT public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone) INTO v_effective_phone
    FROM public.leads l WHERE l.organizations_id=v_org AND l.users_id=v_user AND l.leads_id=v_item.leads_id;
    v_snapshot_phone:=coalesce(v_queue_item.queue_items_payload_snapshot#>>'{recipient,phone}','');
    IF regexp_replace(coalesce(v_snapshot_phone,''),'[^0-9]+','','g')=''
       OR regexp_replace(coalesce(v_snapshot_phone,''),'[^0-9]+','','g')
          IS DISTINCT FROM regexp_replace(coalesce(v_effective_phone,''),'[^0-9]+','','g') THEN
      RAISE EXCEPTION 'queue_review_snapshot_whatsapp_recipient_mismatch';
    END IF;
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.queue_review_items i
    WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org
      AND i.review_status='locked' AND i.queue_items_id=v_result.queue_item_id
  ) THEN RAISE EXCEPTION 'queue_review_lock_not_persisted'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.leads l
    WHERE l.leads_id=v_item.leads_id AND l.organizations_id=v_org AND l.users_id=v_user
      AND l.lead_status_id=4 AND l.channels_id=v_item.channels_id
  ) THEN RAISE EXCEPTION 'queue_review_lead_not_queued'; END IF;

  SELECT * INTO v_capacity FROM public.queue_review_resource_capacity(v_item.channel_key,v_item.resource_id,v_item.scheduled_date);
  UPDATE public.queue_review_batches SET target_count=v_capacity.available,updated_at=now()
  WHERE queue_review_batches_id=v_item.queue_review_batches_id AND organizations_id=v_org;

  RETURN jsonb_build_object(
    'contractVersion','R58','persisted',true,'reviewItemId',p_review_item_id,'leadId',v_item.leads_id,
    'queueItemId',v_result.queue_item_id,'outcome',v_result.outcome,'reviewStatus','locked'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_queue_review_item(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_queue_review_item(bigint,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_review_approval_state(p_review_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_row record;
BEGIN
  PERFORM public.require_organization_permission('queues.view');
  SELECT i.review_status,i.queue_items_id,i.leads_id,b.channel_key,b.resource_id,b.scheduled_date,qi.queue_items_payload_snapshot
  INTO v_row
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  LEFT JOIN public.queue_items qi ON qi.queue_items_id=i.queue_items_id AND qi.organizations_id=v_org AND qi.users_id=v_user
  WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org
    AND b.organizations_id=v_org AND b.users_id=v_user
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('contractVersion','R58','persisted',false,'reason','review_item_not_found'); END IF;

  RETURN jsonb_build_object(
    'contractVersion','R58',
    'persisted',v_row.review_status='locked' AND v_row.queue_items_id IS NOT NULL AND v_row.queue_items_payload_snapshot IS NOT NULL,
    'reviewStatus',v_row.review_status,'queueItemId',v_row.queue_items_id,'leadId',v_row.leads_id,
    'channel',v_row.channel_key,'resourceId',v_row.resource_id,'scheduledDate',v_row.scheduled_date
  );
END;
$$;
REVOKE ALL ON FUNCTION public.queue_review_approval_state(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_review_approval_state(bigint) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Invalidar na Revisão: invalida o lead inteiro; não redireciona outro canal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invalidate_queue_review_item(p_review_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_item record;
BEGIN
  PERFORM public.require_organization_permission('leads.validate');

  SELECT i.queue_review_items_id,i.queue_review_batches_id,i.leads_id,b.channel_key,b.resource_id,b.scheduled_date,b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org AND i.review_status='open'
    AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('queue-review:%s:%s:%s:%s',v_org,v_item.channel_key,v_item.resource_id,v_item.scheduled_date),0));

  SELECT i.queue_review_items_id,i.queue_review_batches_id,i.leads_id,b.channel_key,b.resource_id,b.scheduled_date,b.channels_id
  INTO v_item
  FROM public.queue_review_items i
  JOIN public.queue_review_batches b ON b.queue_review_batches_id=i.queue_review_batches_id
  WHERE i.queue_review_items_id=p_review_item_id AND i.organizations_id=v_org AND i.review_status='open'
    AND b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
  FOR UPDATE OF i,b;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_not_open'; END IF;

  UPDATE public.leads l
  SET lead_status_id=6,leads_updated_at=now()
  WHERE l.leads_id=v_item.leads_id AND l.organizations_id=v_org AND l.users_id=v_user
    AND l.lead_status_id=2 AND l.channels_id=v_item.channels_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_lead_changed'; END IF;

  UPDATE public.queue_review_items
  SET review_status='invalidated',updated_at=now()
  WHERE queue_review_items_id=p_review_item_id AND organizations_id=v_org AND review_status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_review_item_changed'; END IF;

  UPDATE public.queue_review_batches SET updated_at=now()
  WHERE queue_review_batches_id=v_item.queue_review_batches_id AND organizations_id=v_org;

  RETURN jsonb_build_object('contractVersion','R58','batchId',v_item.queue_review_batches_id,'leadId',v_item.leads_id,'status','invalido');
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_queue_review_item(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invalidate_queue_review_item(bigint) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Revisão visível: somente item aberto cujo lead ainda é Revisão + mesmo canal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_queue_review_for_resource(
  p_channel text,
  p_resource_key text,
  p_scheduled_date date
)
RETURNS TABLE(
  batch_id bigint,review_item_id bigint,channel_key text,resource_id bigint,resource_label text,
  scheduled_date date,target_count integer,lead_id bigint,"position" integer,company text,
  branch_id bigint,branch_name text,city text,state text,phone text,whatsapp text,instagram text,
  website text,maps_url text,rating numeric,reviews integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_org bigint:=public.current_organization_id();
  v_user bigint:=public.ensure_current_user();
  v_channel text:=lower(trim(coalesce(p_channel,'')));
  v_key text:=lower(trim(coalesce(p_resource_key,'')));
  v_resource_id bigint;
  v_resource_label text;
BEGIN
  PERFORM public.require_organization_permission('queues.view');
  IF v_channel NOT IN ('whatsapp','instagram') OR v_key='' THEN RETURN; END IF;

  IF v_channel='whatsapp' THEN
    SELECT c.chips_id,coalesce(nullif(btrim(c.chips_name),''),i.instances_name,c.chips_id::text)
    INTO v_resource_id,v_resource_label
    FROM public.chips c JOIN public.instances i ON i.instances_id=c.instances_id AND i.users_id=c.users_id
    WHERE c.users_id=v_user
      AND (c.chips_id::text=v_key OR lower(btrim(coalesce(c.chips_name,'')))=v_key OR lower(btrim(coalesce(i.instances_name,'')))=v_key)
    ORDER BY c.chips_id LIMIT 1;
  ELSE
    SELECT so.socials_id,coalesce(nullif(btrim(so.socials_name),''),concat('@',regexp_replace(coalesce(so.socials_username,''),'^@','','g')),so.socials_id::text)
    INTO v_resource_id,v_resource_label
    FROM public.socials so
    WHERE so.users_id=v_user
      AND (so.socials_id::text=v_key OR lower(btrim(coalesce(so.socials_name,'')))=v_key
        OR lower(regexp_replace(btrim(coalesce(so.socials_username,'')),'^@','','g'))=regexp_replace(v_key,'^@','','g'))
    ORDER BY so.socials_id LIMIT 1;
  END IF;
  IF v_resource_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT b.queue_review_batches_id,i.queue_review_items_id,b.channel_key,b.resource_id,v_resource_label,b.scheduled_date,b.target_count,
         l.leads_id,row_number() OVER(PARTITION BY b.queue_review_batches_id ORDER BY i.review_position,i.queue_review_items_id)::integer,
         coalesce(nullif(btrim(l.leads_alternative_name),''),l.leads_name),l.branches_id,coalesce(br.branches_name,''),coalesce(ci.cities_name,''),
         coalesce(st.states_code,st.states_name,''),coalesce(l.leads_phone,''),coalesce(l.leads_whatsapp,''),coalesce(l.leads_instagram,''),
         coalesce(l.leads_website,''),coalesce(l.leads_maps,''),coalesce(l.leads_score,0)::numeric,coalesce(l.leads_reviews_count,0)::integer
  FROM public.queue_review_batches b
  JOIN public.queue_review_items i ON i.queue_review_batches_id=b.queue_review_batches_id AND i.review_status='open'
  JOIN public.leads l ON l.leads_id=i.leads_id AND l.organizations_id=b.organizations_id
    AND l.users_id=b.users_id AND l.lead_status_id=2 AND l.channels_id=b.channels_id
  LEFT JOIN public.branches br ON br.branches_id=l.branches_id
  LEFT JOIN public.cities ci ON ci.cities_id=l.cities_id
  LEFT JOIN public.states st ON st.states_id=l.states_id
  WHERE b.organizations_id=v_org AND b.users_id=v_user AND b.review_status='open'
    AND b.channel_key=v_channel AND b.resource_id=v_resource_id AND b.scheduled_date=p_scheduled_date
  ORDER BY b.queue_review_batches_id,i.review_position,i.queue_review_items_id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_queue_review_for_resource(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_queue_review_for_resource(text,text,date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. Supressão temporária da captura alinhada aos status finais novos.
--     A tabela continua porque o motor de captura atual ainda a consulta.
--     Removemos apenas a gravação de audit_events desta função.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suppress_lead_identities(
  p_lead public.leads,
  p_reason text,
  p_sent_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
BEGIN
  INSERT INTO public.contact_suppressions(users_id,organizations_id,identity_type,identity_value,reason,source_lead_id,source_sent_id)
  SELECT p_lead.users_id,p_lead.organizations_id,x.t,x.v,p_reason,p_lead.leads_id,p_sent_id
  FROM (VALUES
    ('phone',p_lead.leads_normalized_phone),
    ('instagram',p_lead.leads_normalized_instagram),
    ('domain',p_lead.leads_normalized_domain),
    ('maps',p_lead.leads_normalized_maps)
  ) x(t,v)
  WHERE x.v IS NOT NULL AND x.v<>''
  ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET
    reason=excluded.reason,
    source_lead_id=excluded.source_lead_id,
    source_sent_id=coalesce(excluded.source_sent_id,public.contact_suppressions.source_sent_id),
    is_active=true,
    expires_at=NULL,
    updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_after_lead_finalized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $$
DECLARE
  v_reason text;
BEGIN
  IF NEW.lead_status_id NOT IN (3,5,6,7) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.lead_status_id IS NOT DISTINCT FROM NEW.lead_status_id THEN RETURN NEW; END IF;

  v_reason:=CASE NEW.lead_status_id
    WHEN 3 THEN 'lead_no_contact'
    WHEN 5 THEN 'lead_sent'
    WHEN 6 THEN 'lead_invalid'
    WHEN 7 THEN 'lead_duplicate'
    ELSE 'lead_final'
  END;
  PERFORM public.suppress_lead_identities(NEW,v_reason,NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppress_after_lead_sent_trigger ON public.leads;
DROP TRIGGER IF EXISTS suppress_after_lead_finalized_trigger ON public.leads;
CREATE TRIGGER suppress_after_lead_finalized_trigger
AFTER INSERT OR UPDATE OF lead_status_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.suppress_after_lead_finalized();

-- Backfill idempotente das identidades dos status finais atuais.
-- Uma mesma identidade pode existir em mais de um lead final legado.
-- Deduplicamos a fonte ANTES do ON CONFLICT para que a mesma chave única
-- nunca seja proposta duas vezes no mesmo INSERT.
WITH final_identities AS (
  SELECT DISTINCT ON (l.organizations_id,x.t,x.v)
         l.users_id,
         l.organizations_id,
         x.t AS identity_type,
         x.v AS identity_value,
         CASE l.lead_status_id
           WHEN 3 THEN 'lead_no_contact'
           WHEN 5 THEN 'lead_sent'
           WHEN 6 THEN 'lead_invalid'
           WHEN 7 THEN 'lead_duplicate'
           ELSE 'lead_final'
         END AS reason,
         l.leads_id AS source_lead_id
  FROM public.leads l
  CROSS JOIN LATERAL (VALUES
    ('phone'::text,l.leads_normalized_phone),
    ('instagram'::text,l.leads_normalized_instagram),
    ('domain'::text,l.leads_normalized_domain),
    ('maps'::text,l.leads_normalized_maps)
  ) x(t,v)
  WHERE l.lead_status_id IN (3,5,6,7)
    AND x.v IS NOT NULL
    AND x.v<>''
  ORDER BY l.organizations_id,x.t,x.v,l.leads_id DESC
)
INSERT INTO public.contact_suppressions(
  users_id,organizations_id,identity_type,identity_value,reason,source_lead_id
)
SELECT
  users_id,organizations_id,identity_type,identity_value,reason,source_lead_id
FROM final_identities
ON CONFLICT(organizations_id,identity_type,identity_value) DO UPDATE SET
  reason=excluded.reason,
  source_lead_id=excluded.source_lead_id,
  is_active=true,
  expires_at=NULL,
  updated_at=now();

COMMIT;
