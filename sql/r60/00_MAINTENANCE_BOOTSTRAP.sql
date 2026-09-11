BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_messaging_state (
  organizations_id bigint PRIMARY KEY REFERENCES public.organizations(organizations_id) ON DELETE CASCADE,
  maintenance boolean NOT NULL DEFAULT true,
  resume_allowed boolean NOT NULL DEFAULT false,
  release_sequence bigint NOT NULL DEFAULT 60,
  schema_target text NOT NULL DEFAULT 'r60',
  security_baseline text NOT NULL DEFAULT 'r60-security-baseline-v1',
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  state_reason text NOT NULL DEFAULT 'r60_bootstrap_closed',
  armed_release_candidate_id uuid NULL,
  last_service_actor text NULL,
  last_transition_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT resume_allowed OR maintenance = false)
);

ALTER TABLE public.organization_messaging_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_messaging_state FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.guard_messaging_resume_allowed_r60()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.resume_allowed = true AND (TG_OP='INSERT' OR COALESCE(OLD.resume_allowed,false) = false) THEN
    IF current_setting('vinsansi.r60_resume_gate', true) IS DISTINCT FROM 'armed' THEN
      RAISE EXCEPTION 'resume_allowed_requires_service_arm_messaging_resume_gate_r60';
    END IF;
  END IF;
  NEW.updated_at := now();
  IF TG_OP='INSERT' THEN
    NEW.revision:=greatest(coalesce(NEW.revision,1),1);
    NEW.last_transition_at:=coalesce(NEW.last_transition_at,now());
  ELSIF ROW(NEW.maintenance,NEW.resume_allowed,NEW.release_sequence,NEW.schema_target,NEW.security_baseline,NEW.state_reason)
     IS DISTINCT FROM ROW(OLD.maintenance,OLD.resume_allowed,OLD.release_sequence,OLD.schema_target,OLD.security_baseline,OLD.state_reason) THEN
    NEW.revision := OLD.revision + 1;
    NEW.last_transition_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_messaging_state_guard_r60 ON public.organization_messaging_state;
CREATE TRIGGER organization_messaging_state_guard_r60
BEFORE INSERT OR UPDATE ON public.organization_messaging_state
FOR EACH ROW EXECUTE FUNCTION public.guard_messaging_resume_allowed_r60();

INSERT INTO public.organization_messaging_state (organizations_id,maintenance,resume_allowed,state_reason)
SELECT organizations_id,true,false,'r60_bootstrap_closed'
FROM public.organizations
ON CONFLICT (organizations_id) DO UPDATE SET
  maintenance=true,
  resume_allowed=false,
  state_reason='r60_bootstrap_closed',
  release_sequence=60,
  schema_target='r60',
  security_baseline='r60-security-baseline-v1',
  updated_at=now();

COMMIT;
