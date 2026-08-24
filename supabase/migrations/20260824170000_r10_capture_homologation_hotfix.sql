BEGIN;

-- R10 / homologação da Etapa 8
-- 1) Corrige o identity gate da Captura: lead_identity_registry não possui r.leads_id.
CREATE OR REPLACE FUNCTION public.service_capture_identity_gate(
  p_organizations_id bigint,
  p_phone text DEFAULT NULL,
  p_instagram text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_maps text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO pg_catalog,public AS $$
DECLARE
  v_phone text:=public.normalize_identity_phone(p_phone);
  v_instagram text:=public.normalize_identity_instagram(p_instagram);
  v_domain text:=public.normalize_identity_domain(p_domain);
  v_maps text:=public.normalize_identity_maps(p_maps);
  v_suppression bigint; v_lead bigint; v_type text; v_value text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organizations_id=p_organizations_id AND status_id=1) THEN RAISE EXCEPTION 'organization_not_found'; END IF;

  SELECT cs.contact_suppressions_id,cs.identity_type,cs.identity_value
    INTO v_suppression,v_type,v_value
  FROM public.contact_suppressions cs
  WHERE cs.organizations_id=p_organizations_id AND cs.is_active
    AND (cs.expires_at IS NULL OR cs.expires_at>now())
    AND ((v_phone<>'' AND cs.identity_type='phone' AND cs.identity_value=v_phone)
      OR (v_instagram<>'' AND cs.identity_type='instagram' AND cs.identity_value=v_instagram)
      OR (v_domain<>'' AND cs.identity_type='domain' AND cs.identity_value=v_domain)
      OR (v_maps<>'' AND cs.identity_type='maps' AND cs.identity_value=v_maps))
  ORDER BY cs.contact_suppressions_id LIMIT 1;
  IF v_suppression IS NOT NULL THEN
    RETURN jsonb_build_object('decision','suppressed','suppressed',true,'duplicate',false,'suppressionId',v_suppression,'identityType',v_type,'identityValue',v_value);
  END IF;

  SELECT r.canonical_lead_id,r.identity_type,r.identity_value
    INTO v_lead,v_type,v_value
  FROM public.lead_identity_registry r
  WHERE r.organizations_id=p_organizations_id
    AND ((v_phone<>'' AND r.identity_type='phone' AND r.identity_value=v_phone)
      OR (v_instagram<>'' AND r.identity_type='instagram' AND r.identity_value=v_instagram)
      OR (v_domain<>'' AND r.identity_type='domain' AND r.identity_value=v_domain)
      OR (v_maps<>'' AND r.identity_type='maps' AND r.identity_value=v_maps))
  ORDER BY r.lead_identity_registry_id LIMIT 1;
  IF v_lead IS NOT NULL THEN
    RETURN jsonb_build_object('decision','duplicate','suppressed',false,'duplicate',true,'canonicalLeadId',v_lead,'identityType',v_type,'identityValue',v_value);
  END IF;
  RETURN jsonb_build_object('decision','accept','suppressed',false,'duplicate',false);
END; $$;
REVOKE ALL ON FUNCTION public.service_capture_identity_gate(bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_capture_identity_gate(bigint,text,text,text,text) TO service_role;

-- 2) Corrige o trigger da Etapa 13. O registro NEW só expõe colunas da tabela
-- que disparou o trigger; por isso o entity_id precisa ser resolvido dentro de
-- cada ramo de TG_TABLE_NAME, e não por CASE que referencia todos os campos.
CREATE OR REPLACE FUNCTION public.record_lead_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE v_lead bigint;v_org bigint;v_event text;v_channel text;v_entity_id text;
BEGIN
 IF TG_TABLE_NAME='leads' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN TG_OP='INSERT' THEN 'lead:captured' ELSE 'lead:status_changed' END;v_channel:=CASE NEW.channels_id WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'instagram' ELSE NULL END;v_entity_id:=NEW.leads_id::text;
 ELSIF TG_TABLE_NAME='queue_items' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE NEW.status_id WHEN 3 THEN 'queue:queued' WHEN 4 THEN 'queue:processing' WHEN 5 THEN 'queue:completed' WHEN 6 THEN 'queue:error' ELSE 'queue:changed' END;v_entity_id:=NEW.queue_items_id::text;
 ELSIF TG_TABLE_NAME='sents' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN NEW.sents_sent_at IS NOT NULL THEN 'dispatch:sent' WHEN NEW.status_id=6 THEN 'dispatch:error' ELSE 'dispatch:changed' END;v_channel:=CASE NEW.channels_id WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'instagram' ELSE NULL END;v_entity_id:=NEW.sents_id::text;
 ELSIF TG_TABLE_NAME='conversation_messages' THEN v_lead:=NEW.leads_id;v_org:=NEW.organizations_id;v_event:=CASE WHEN NEW.direction='inbound' THEN 'conversation:inbound' ELSE 'conversation:outbound' END;v_channel:='whatsapp';v_entity_id:=NEW.conversation_messages_id::text;
 END IF;
 IF v_lead IS NOT NULL AND v_org IS NOT NULL THEN INSERT INTO public.lead_lifecycle_events(organizations_id,leads_id,event_type,channel,entity_type,entity_id,payload) VALUES(v_org,v_lead,v_event,v_channel,TG_TABLE_NAME,v_entity_id,to_jsonb(NEW));END IF;
 RETURN NEW;
END; $$;

COMMIT;
