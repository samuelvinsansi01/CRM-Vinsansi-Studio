BEGIN;

-- R60.28: cadastro canônico de lead a partir da conversa.
-- Preserva whatsapp_contact, aliases, conversa e histórico; apenas cria o lead e materializa o vínculo.
CREATE OR REPLACE FUNCTION public.service_stage5_promote_unknown_contact_v2(
  p_organizations_id bigint,
  p_conversations_id bigint,
  p_name text,
  p_alternative_name text,
  p_branches_id bigint,
  p_countries_id bigint,
  p_states_id bigint,
  p_cities_id bigint,
  p_contact_sources_id bigint,
  p_instagram text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_maps text DEFAULT NULL,
  p_channels_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_member bigint;
  v_contact public.whatsapp_contacts%ROWTYPE;
  v_scope_user bigint;
  v_lead bigint;
  v_channel bigint;
  v_company text:=nullif(btrim(coalesce(p_name,'')),'');
BEGIN
  v_member:=public.r60_require_actor(p_organizations_id,'leads.create');
  IF v_company IS NULL THEN RAISE EXCEPTION 'company_name_required'; END IF;

  SELECT wc.* INTO v_contact
  FROM public.conversations c
  JOIN public.whatsapp_contacts wc ON wc.whatsapp_contacts_id=c.whatsapp_contacts_id
  WHERE c.organizations_id=p_organizations_id AND c.conversations_id=p_conversations_id
  FOR UPDATE OF wc;

  IF v_contact.whatsapp_contacts_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_contact.contact_state='lead' THEN
    RETURN jsonb_build_object('leadId',v_contact.leads_id,'contactId',v_contact.whatsapp_contacts_id,'state','lead','idempotent',true);
  END IF;
  IF v_contact.contact_state='ignored' THEN RAISE EXCEPTION 'ignored_contact_must_be_restored_first'; END IF;
  IF nullif(btrim(coalesce(v_contact.normalized_phone,'')),'') IS NULL THEN RAISE EXCEPTION 'whatsapp_phone_required'; END IF;

  IF NOT EXISTS(SELECT 1 FROM public.branches b WHERE b.organizations_id=p_organizations_id AND b.branches_id=p_branches_id AND b.status_id=1) THEN
    RAISE EXCEPTION 'branch_invalid';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.countries c WHERE c.countries_id=p_countries_id) THEN RAISE EXCEPTION 'country_invalid'; END IF;
  IF p_states_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.states s WHERE s.states_id=p_states_id AND s.countries_id=p_countries_id) THEN RAISE EXCEPTION 'state_invalid'; END IF;
  IF p_cities_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cities c WHERE c.cities_id=p_cities_id AND (p_states_id IS NULL OR c.states_id=p_states_id)) THEN RAISE EXCEPTION 'city_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contact_sources cs WHERE cs.organizations_id=p_organizations_id AND cs.contact_sources_id=p_contact_sources_id AND cs.status_id=1) THEN
    RAISE EXCEPTION 'contact_source_invalid';
  END IF;

  v_channel:=p_channels_id;
  IF v_channel IS NULL THEN
    SELECT channels_id INTO v_channel FROM public.channels WHERE lower(btrim(channels_name))='whatsapp' LIMIT 1;
  END IF;
  IF v_channel IS NULL THEN RAISE EXCEPTION 'whatsapp_channel_not_found'; END IF;

  SELECT legacy_scope_users_id INTO v_scope_user FROM public.organizations WHERE organizations_id=p_organizations_id;

  INSERT INTO public.leads(
    users_id,organizations_id,branches_id,countries_id,states_id,cities_id,channels_id,lead_status_id,
    leads_name,leads_alternative_name,leads_phone,leads_whatsapp,leads_instagram,leads_website,leads_maps,
    leads_origin,contact_sources_id,created_by_member_id
  ) VALUES(
    v_scope_user,p_organizations_id,p_branches_id,p_countries_id,p_states_id,p_cities_id,v_channel,1,
    left(v_company,160),nullif(left(btrim(coalesce(p_alternative_name,'')),160),''),
    v_contact.normalized_phone,v_contact.normalized_phone,
    nullif(left(btrim(coalesce(p_instagram,'')),500),''),
    nullif(left(btrim(coalesce(p_website,'')),1000),''),
    nullif(left(btrim(coalesce(p_maps,'')),2000),''),
    'manual',p_contact_sources_id,v_member
  ) RETURNING leads_id INTO v_lead;

  UPDATE public.whatsapp_contacts
  SET leads_id=v_lead,contact_state='lead',ignored_at=NULL,ignored_by_member_id=NULL,whatsapp_contacts_updated_at=now()
  WHERE whatsapp_contacts_id=v_contact.whatsapp_contacts_id;

  UPDATE public.conversations
  SET leads_id=v_lead,conversation_version=conversation_version+1,conversations_updated_at=now()
  WHERE organizations_id=p_organizations_id AND whatsapp_contacts_id=v_contact.whatsapp_contacts_id;

  UPDATE public.conversation_messages
  SET leads_id=v_lead,conversation_messages_updated_at=now()
  WHERE organizations_id=p_organizations_id AND conversations_id=p_conversations_id AND leads_id IS DISTINCT FROM v_lead;

  RETURN jsonb_build_object('leadId',v_lead,'contactId',v_contact.whatsapp_contacts_id,'state','lead','idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.service_stage5_promote_unknown_contact_v2(bigint,bigint,text,text,bigint,bigint,bigint,bigint,bigint,text,text,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_promote_unknown_contact_v2(bigint,bigint,text,text,bigint,bigint,bigint,bigint,bigint,text,text,text,bigint) TO authenticated;

COMMIT;
