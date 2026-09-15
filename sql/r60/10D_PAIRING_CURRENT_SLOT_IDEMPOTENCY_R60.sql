BEGIN;

-- R60.12: executor pairing must use the canonical installation registration path.
-- The previous pairing exchange inserted organization_tool_installations directly.
-- When a different external_installation_id already occupied the same current
-- operational slot, the database correctly rejected the second current row via
-- organization_tool_installations_one_current_slot_idx.
-- service_register_tool_installation() already owns the supersession contract:
-- advisory lock, current-slot handoff, credential/session revocation for the
-- superseded installation, and idempotent re-registration.
CREATE OR REPLACE FUNCTION public.service_exchange_executor_pairing(
  p_pairing_code_hash text,
  p_credential_hash text,
  p_session_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  p public.tool_executor_pairings%ROWTYPE;
  inst uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_pairing_code_hash !~ '^[0-9a-f]{64}$'
     OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_session_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'pairing_hash_invalid';
  END IF;

  SELECT * INTO p
  FROM public.tool_executor_pairings
  WHERE pairing_code_hash=p_pairing_code_hash
  FOR UPDATE;

  IF p.tool_executor_pairings_id IS NULL THEN RAISE EXCEPTION 'pairing_invalid'; END IF;
  IF p.exchanged_at IS NOT NULL OR p.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'pairing_already_consumed'; END IF;
  IF p.expires_at<=now() THEN
    UPDATE public.tool_executor_pairings
    SET revoked_at=now()
    WHERE tool_executor_pairings_id=p.tool_executor_pairings_id;
    RAISE EXCEPTION 'pairing_expired';
  END IF;

  inst:=public.service_register_tool_installation(
    p.organizations_id,
    p.tool_id,
    p.external_installation_id,
    p.requested_version,
    p.requested_capabilities,
    p.organization_members_id,
    jsonb_build_object('pairing','r60','pairingVersion','r60.12')
  );

  -- Preserve the activity metadata historically written by the pairing path.
  UPDATE public.organization_tool_installations
  SET last_seen_member_id=p.organization_members_id,
      last_seen_at=now(),
      last_activity_at=now()
  WHERE organization_tool_installations_id=inst;

  INSERT INTO public.tool_installation_credentials(
    organization_tool_installations_id,
    credential_hash,
    issued_to_external_installation_id
  ) VALUES(inst,p_credential_hash,p.external_installation_id);

  INSERT INTO public.tool_user_sessions(
    organization_tool_installations_id,
    auth_users_id,
    users_id,
    organizations_id,
    organization_members_id,
    session_hash
  ) VALUES(inst,p.auth_users_id,p.users_id,p.organizations_id,p.organization_members_id,p_session_hash);

  UPDATE public.tool_executor_pairings
  SET exchanged_at=now()
  WHERE tool_executor_pairings_id=p.tool_executor_pairings_id
    AND exchanged_at IS NULL;

  RETURN jsonb_build_object(
    'toolId',p.tool_id,
    'organizationId',p.organizations_id,
    'memberId',p.organization_members_id,
    'organizationToolInstallationId',inst
  );
END $$;

REVOKE ALL ON FUNCTION public.service_exchange_executor_pairing(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_exchange_executor_pairing(text,text,text) TO service_role;

COMMIT;
