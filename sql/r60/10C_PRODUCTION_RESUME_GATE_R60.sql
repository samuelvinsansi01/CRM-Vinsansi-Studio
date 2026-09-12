BEGIN;

CREATE OR REPLACE FUNCTION public.service_arm_messaging_resume_gate_r60(p_organizations_id bigint,p_release_candidate_id uuid,p_installation_id uuid,p_expected_release_sequence bigint DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.platform_release_candidates%ROWTYPE;inst public.organization_tool_installations%ROWTYPE;s public.organization_messaging_state%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT * INTO c FROM public.platform_release_candidates WHERE release_candidate_id=p_release_candidate_id FOR UPDATE;
 IF c.release_candidate_id IS NULL OR c.manifest->>'releaseStage'<>'production' OR NOT c.production_ready OR NOT c.resume_allowed OR c.release_sequence<>p_expected_release_sequence OR c.release_sequence<>60 OR c.schema_target<>'r60' OR c.security_baseline<>'r60-security-baseline-v1' OR c.expires_at<=now() OR c.issued_at>now()+interval '5 minutes' OR c.signature_base64 IS NULL OR c.signature_verified_at IS NULL THEN RAISE EXCEPTION 'resume_release_gate_invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_release_promotions p WHERE p.release_candidate_id=c.release_candidate_id AND p.release_sequence=c.release_sequence AND p.canonical_manifest_sha256=c.canonical_manifest_sha256 AND p.component_hashes=c.component_hashes AND p.docker_digests=c.docker_digests) THEN RAISE EXCEPTION 'resume_release_not_promoted'; END IF;
 PERFORM public.service_schema_gate_r60();
 SELECT * INTO inst FROM public.organization_tool_installations WHERE organization_tool_installations_id=p_installation_id AND organizations_id=p_organizations_id AND tool_id='vinsansi_whatsapp_manager' AND registration_status='registered' AND is_current=true AND revoked_at IS NULL;
 IF inst.organization_tool_installations_id IS NULL THEN RAISE EXCEPTION 'resume_installation_invalid'; END IF;
 PERFORM set_config('vinsansi.r60_resume_gate','armed',true);
 INSERT INTO public.organization_messaging_state(organizations_id,maintenance,resume_allowed,release_sequence,schema_target,security_baseline,state_reason,armed_release_candidate_id,last_service_actor)
 VALUES(p_organizations_id,false,true,60,'r60','r60-security-baseline-v1','production_resume_gate_armed',c.release_candidate_id,'service_role')
 ON CONFLICT(organizations_id) DO UPDATE SET maintenance=false,resume_allowed=true,release_sequence=60,schema_target='r60',security_baseline='r60-security-baseline-v1',state_reason='production_resume_gate_armed',armed_release_candidate_id=c.release_candidate_id,last_service_actor='service_role';
 SELECT * INTO s FROM public.organization_messaging_state WHERE organizations_id=p_organizations_id;
 RETURN jsonb_build_object('organizationsId',p_organizations_id,'maintenance',s.maintenance,'resumeAllowed',s.resume_allowed,'revision',s.revision,'releaseSequence',s.release_sequence,'schemaTarget',s.schema_target,'securityBaseline',s.security_baseline,'candidateId',s.armed_release_candidate_id);
END $$;

REVOKE ALL ON FUNCTION public.service_arm_messaging_resume_gate_r60(bigint,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_arm_messaging_resume_gate_r60(bigint,uuid,uuid,bigint) TO service_role;

COMMIT;
