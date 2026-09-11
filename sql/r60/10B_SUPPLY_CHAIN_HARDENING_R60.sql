BEGIN;

CREATE OR REPLACE FUNCTION public.service_register_release_candidate_r60(
 p_manifest jsonb,p_canonical_manifest_sha256 text,p_signature_base64 text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE id uuid; seq bigint; issued timestamptz; expires timestamptz; prod boolean; resume boolean; target text; baseline text; hashes jsonb;digests jsonb;key_id text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF jsonb_typeof(p_manifest)<>'object' OR coalesce((p_manifest->>'schemaVersion')::integer,0)<>2 THEN RAISE EXCEPTION 'manifest_schema_invalid'; END IF;
 IF p_canonical_manifest_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'manifest_hash_invalid'; END IF;
 seq:=(p_manifest->>'releaseSequence')::bigint;issued:=(p_manifest->>'issuedAt')::timestamptz;expires:=(p_manifest->>'expiresAt')::timestamptz;prod:=coalesce((p_manifest->>'productionReady')::boolean,false);resume:=coalesce((p_manifest->>'resumeAllowed')::boolean,false);target:=p_manifest->>'schemaTarget';baseline:=p_manifest->>'securityBaseline';hashes:=coalesce(p_manifest->'resources','{}'::jsonb);digests:=coalesce(p_manifest->'imageDigests','{}'::jsonb);key_id:=nullif(btrim(coalesce(p_manifest#>>'{signature,keyId}','')),'');
 IF seq<60 OR target<>'r60' OR baseline<>'r60-security-baseline-v1' OR expires<=issued OR issued>now()+interval '5 minutes' OR expires<=now() THEN RAISE EXCEPTION 'manifest_gate_invalid'; END IF;
 IF resume AND NOT prod THEN RAISE EXCEPTION 'candidate_manifest_cannot_allow_resume'; END IF;
 IF prod AND NOT resume THEN RAISE EXCEPTION 'production_manifest_resume_flag_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_release_promotions WHERE release_sequence>seq) THEN RAISE EXCEPTION 'release_downgrade_rejected'; END IF;
 IF prod AND (nullif(btrim(coalesce(p_signature_base64,'')),'') IS NULL OR key_id IS NULL) THEN RAISE EXCEPTION 'production_manifest_signature_required'; END IF;
 INSERT INTO public.platform_release_candidates(release_sequence,schema_target,security_baseline,issued_at,expires_at,production_ready,resume_allowed,manifest,canonical_manifest_sha256,signature_base64,signature_key_id,component_hashes,docker_digests)
 VALUES(seq,target,baseline,issued,expires,prod,resume,p_manifest,p_canonical_manifest_sha256,nullif(p_signature_base64,''),key_id,hashes,digests)
 ON CONFLICT(release_sequence,canonical_manifest_sha256) DO UPDATE SET
   signature_verified_at=CASE WHEN coalesce(excluded.signature_base64,'')=coalesce(platform_release_candidates.signature_base64,'') AND coalesce(excluded.signature_key_id,'')=coalesce(platform_release_candidates.signature_key_id,'') THEN platform_release_candidates.signature_verified_at ELSE NULL END,
   signature_base64=coalesce(excluded.signature_base64,platform_release_candidates.signature_base64),
   signature_key_id=coalesce(excluded.signature_key_id,platform_release_candidates.signature_key_id)
 RETURNING release_candidate_id INTO id;
 RETURN id;
END $$;


CREATE OR REPLACE FUNCTION public.service_mark_release_signature_verified_r60(p_release_candidate_id uuid,p_key_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 UPDATE public.platform_release_candidates SET signature_verified_at=now(),signature_key_id=coalesce(nullif(btrim(p_key_id),''),signature_key_id)
 WHERE release_candidate_id=p_release_candidate_id AND signature_base64 IS NOT NULL AND signature_key_id=coalesce(nullif(btrim(p_key_id),''),signature_key_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'release_signature_verification_target_invalid'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.service_mark_release_candidate_homologated_r60(p_release_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.platform_release_candidates%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT * INTO c FROM public.platform_release_candidates WHERE release_candidate_id=p_release_candidate_id FOR UPDATE;
 IF c.release_candidate_id IS NULL THEN RAISE EXCEPTION 'release_candidate_not_found'; END IF;
 IF c.production_ready OR c.resume_allowed OR c.release_sequence<>60 OR c.schema_target<>'r60' OR c.security_baseline<>'r60-security-baseline-v1' OR c.expires_at<=now() THEN RAISE EXCEPTION 'homologation_candidate_gate_invalid'; END IF;
 UPDATE public.platform_release_candidates SET homologated_at=coalesce(homologated_at,now()) WHERE release_candidate_id=p_release_candidate_id;
 RETURN jsonb_build_object('releaseCandidateId',p_release_candidate_id,'releaseSequence',c.release_sequence,'manifestSha256',c.canonical_manifest_sha256,'homologated',true);
END $$;

CREATE OR REPLACE FUNCTION public.service_promote_release_candidate_r60(p_release_candidate_id uuid,p_promoted_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.platform_release_candidates%ROWTYPE; prior public.platform_release_candidates%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT * INTO c FROM public.platform_release_candidates WHERE release_candidate_id=p_release_candidate_id FOR UPDATE;
 IF c.release_candidate_id IS NULL THEN RAISE EXCEPTION 'release_candidate_not_found'; END IF;
 IF NOT c.production_ready OR NOT c.resume_allowed OR c.signature_base64 IS NULL OR c.signature_verified_at IS NULL OR c.expires_at<=now() OR c.release_sequence<60 THEN RAISE EXCEPTION 'release_candidate_not_promotable'; END IF;
 SELECT * INTO prior FROM public.platform_release_candidates WHERE release_sequence=c.release_sequence AND homologated_at IS NOT NULL ORDER BY homologated_at DESC LIMIT 1;
 IF prior.release_candidate_id IS NULL THEN RAISE EXCEPTION 'homologated_candidate_required'; END IF;
 IF prior.component_hashes<>c.component_hashes OR prior.docker_digests<>c.docker_digests OR prior.schema_target<>c.schema_target OR prior.security_baseline<>c.security_baseline THEN RAISE EXCEPTION 'immutable_promotion_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_release_promotions WHERE release_sequence>c.release_sequence) THEN RAISE EXCEPTION 'release_downgrade_rejected'; END IF;
 INSERT INTO public.platform_release_promotions(release_candidate_id,release_sequence,canonical_manifest_sha256,component_hashes,docker_digests,schema_target,security_baseline,promoted_by)
 VALUES(c.release_candidate_id,c.release_sequence,c.canonical_manifest_sha256,c.component_hashes,c.docker_digests,c.schema_target,c.security_baseline,left(coalesce(p_promoted_by,'service'),160));
 UPDATE public.platform_release_candidates SET promoted_at=now() WHERE release_candidate_id=c.release_candidate_id;
 RETURN jsonb_build_object('releaseCandidateId',c.release_candidate_id,'releaseSequence',c.release_sequence,'manifestSha256',c.canonical_manifest_sha256);
END $$;

DO $$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('service_register_release_candidate_r60','service_mark_release_signature_verified_r60','service_mark_release_candidate_homologated_r60','service_promote_release_candidate_r60') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.sig);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig);END LOOP;END $$;

COMMIT;
