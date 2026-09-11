BEGIN;

CREATE OR REPLACE FUNCTION public.r60_normalize_phone(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(regexp_replace(coalesce(p_value,''),'[^0-9]+','','g'),'');
$$;

CREATE OR REPLACE FUNCTION public.r60_normalize_provider_alias(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN lower(btrim(coalesce(p_value,''))) ~ '^[0-9]+@c\.us$' THEN regexp_replace(lower(btrim(p_value)),'@c\.us$','@s.whatsapp.net')
    ELSE lower(btrim(coalesce(p_value,'')))
  END;
$$;

CREATE OR REPLACE FUNCTION public.r60_alias_type(p_alias text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
 SELECT CASE
   WHEN lower(coalesce(p_alias,'')) LIKE '%@lid' THEN 'lid'
   WHEN lower(coalesce(p_alias,'')) LIKE '%@s.whatsapp.net' OR lower(coalesce(p_alias,'')) LIKE '%@c.us' THEN 'jid'
   ELSE 'phone'
 END;
$$;

CREATE OR REPLACE FUNCTION public.r60_is_direct_whatsapp_alias(p_alias text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
 SELECT CASE
   WHEN nullif(btrim(coalesce(p_alias,'')),'') IS NULL THEN false
   WHEN lower(p_alias) LIKE '%@g.us' THEN false
   WHEN lower(p_alias) LIKE '%@broadcast' THEN false
   WHEN lower(p_alias) LIKE 'status@%' THEN false
   WHEN lower(p_alias) LIKE '%@newsletter' THEN false
   WHEN lower(p_alias) ~ '^[0-9]+@(s\.whatsapp\.net|c\.us|lid)$' THEN true
   WHEN public.r60_normalize_phone(p_alias) ~ '^[0-9]{8,20}$' THEN true
   ELSE false
 END;
$$;

CREATE OR REPLACE FUNCTION public.r60_contact_aliases_from_payload(p_remote_jid text,p_raw_payload jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE v text[]:=ARRAY[]::text[]; candidate text;
BEGIN
  FOREACH candidate IN ARRAY ARRAY[
    p_remote_jid,
    p_raw_payload #>> '{key,remoteJid}', p_raw_payload #>> '{key,remoteJidAlt}',
    p_raw_payload #>> '{data,key,remoteJid}', p_raw_payload #>> '{data,key,remoteJidAlt}',
    p_raw_payload #>> '{info,chat}', p_raw_payload #>> '{info,chatAlt}',
    p_raw_payload #>> '{Info,Chat}', p_raw_payload #>> '{Info,ChatAlt}',
    p_raw_payload #>> '{data,Info,Chat}', p_raw_payload #>> '{data,Info,ChatAlt}'
  ] LOOP
    candidate:=public.r60_normalize_provider_alias(candidate);
    IF candidate<>'' AND public.r60_is_direct_whatsapp_alias(candidate) AND NOT candidate=ANY(v) THEN v:=array_append(v,candidate); END IF;
  END LOOP;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.r60_resolve_whatsapp_contact(
  p_organizations_id bigint,
  p_instances_id bigint,
  p_chips_id bigint,
  p_remote_jid text,
  p_remote_jid_alt text DEFAULT NULL,
  p_display_name text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE aliases text[]:=ARRAY[]::text[]; a text; contact_id bigint; phone text; v_lead bigint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  FOREACH a IN ARRAY ARRAY[p_remote_jid,p_remote_jid_alt] LOOP
    a:=public.r60_normalize_provider_alias(a);
    IF a<>'' AND public.r60_is_direct_whatsapp_alias(a) AND NOT a=ANY(aliases) THEN aliases:=array_append(aliases,a); END IF;
  END LOOP;
  IF array_length(aliases,1) IS NULL THEN RAISE EXCEPTION 'whatsapp_direct_identity_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('r60-whatsapp-contact:'||p_organizations_id||':'||array_to_string(aliases,','),0));

  SELECT wa.whatsapp_contacts_id INTO contact_id
  FROM public.whatsapp_contact_aliases wa
  WHERE wa.organizations_id=p_organizations_id AND wa.alias_value=ANY(aliases)
  ORDER BY wa.whatsapp_contact_aliases_id LIMIT 1 FOR UPDATE;

  SELECT public.r60_normalize_phone(regexp_replace(x,'@(s\.whatsapp\.net|c\.us)$','','i')) INTO phone
  FROM unnest(aliases) x WHERE x ~ '^[0-9]+@(s\.whatsapp\.net|c\.us)$' LIMIT 1;
  IF contact_id IS NULL AND phone IS NOT NULL THEN
    SELECT whatsapp_contacts_id INTO contact_id FROM public.whatsapp_contacts
    WHERE organizations_id=p_organizations_id AND normalized_phone=phone FOR UPDATE;
  END IF;
  IF phone IS NOT NULL THEN
    SELECT l.leads_id INTO v_lead FROM public.leads l
    WHERE l.organizations_id=p_organizations_id AND l.canonical_lead_id IS NULL
      AND (l.leads_normalized_phone=phone OR public.r60_normalize_phone(public.effective_whatsapp_phone(l.leads_whatsapp,l.leads_phone))=phone)
    ORDER BY l.leads_id LIMIT 1;
  END IF;
  IF contact_id IS NULL THEN
    INSERT INTO public.whatsapp_contacts(organizations_id,normalized_phone,display_name,leads_id,contact_state)
    VALUES(p_organizations_id,phone,nullif(btrim(coalesce(p_display_name,'')),''),v_lead,CASE WHEN v_lead IS NOT NULL THEN 'lead' ELSE 'unknown' END)
    RETURNING whatsapp_contacts_id INTO contact_id;
  ELSE
    UPDATE public.whatsapp_contacts SET
      normalized_phone=coalesce(normalized_phone,phone),
      leads_id=CASE WHEN contact_state='ignored' THEN leads_id ELSE coalesce(leads_id,v_lead) END,
      contact_state=CASE WHEN contact_state='ignored' THEN 'ignored' WHEN coalesce(leads_id,v_lead) IS NOT NULL THEN 'lead' ELSE contact_state END,
      display_name=coalesce(nullif(btrim(coalesce(display_name,'')),''),nullif(btrim(coalesce(p_display_name,'')),'')),
      whatsapp_contacts_updated_at=now()
    WHERE whatsapp_contacts_id=contact_id;
  END IF;

  FOREACH a IN ARRAY aliases LOOP
    INSERT INTO public.whatsapp_contact_aliases(organizations_id,whatsapp_contacts_id,instances_id,chips_id,alias_type,alias_value)
    VALUES(p_organizations_id,contact_id,p_instances_id,p_chips_id,public.r60_alias_type(a),a)
    ON CONFLICT(organizations_id,alias_type,alias_value) DO UPDATE SET
      whatsapp_contacts_id=excluded.whatsapp_contacts_id,
      instances_id=coalesce(whatsapp_contact_aliases.instances_id,excluded.instances_id),
      chips_id=coalesce(whatsapp_contact_aliases.chips_id,excluded.chips_id);
  END LOOP;
  IF phone IS NOT NULL THEN
    INSERT INTO public.whatsapp_contact_aliases(organizations_id,whatsapp_contacts_id,instances_id,chips_id,alias_type,alias_value)
    VALUES(p_organizations_id,contact_id,p_instances_id,p_chips_id,'phone',phone)
    ON CONFLICT(organizations_id,alias_type,alias_value) DO UPDATE SET whatsapp_contacts_id=excluded.whatsapp_contacts_id;
  END IF;
  RETURN contact_id;
END;
$$;

COMMIT;
