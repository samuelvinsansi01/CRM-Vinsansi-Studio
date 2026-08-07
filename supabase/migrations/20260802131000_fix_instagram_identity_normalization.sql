BEGIN;

-- Corrige URLs institucionais/funcionais do Instagram que não representam perfis.
CREATE OR REPLACE FUNCTION public.normalize_identity_instagram(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog
AS $$
DECLARE
  v_raw text := lower(trim(coalesce(p_value, '')));
  v_candidate text;
  v_reserved constant text[] := ARRAY[
    'about','accounts','api','challenge','contact','developer','direct','directory',
    'download','emails','explore','graphql','invites','legal','oauth','p','press',
    'reel','reels','stories','tv','web'
  ];
BEGIN
  IF v_raw = '' THEN
    RETURN '';
  END IF;

  IF v_raw ~* '^https?://' THEN
    IF v_raw !~* '^https?://(www\.)?instagram\.com(?:/|$)' THEN
      RETURN '';
    END IF;
    v_raw := regexp_replace(v_raw, '^https?://(www\.)?instagram\.com/?', '', 'i');
  ELSIF v_raw ~* '^(www\.)?instagram\.com(?:/|$)' THEN
    v_raw := regexp_replace(v_raw, '^(www\.)?instagram\.com/?', '', 'i');
  ELSE
    v_raw := regexp_replace(v_raw, '^@', '');
  END IF;

  v_candidate := split_part(split_part(split_part(v_raw, '/', 1), '?', 1), '#', 1);
  v_candidate := regexp_replace(v_candidate, '^@', '');
  v_candidate := trim(v_candidate);

  IF v_candidate = ''
     OR v_candidate = ANY(v_reserved)
     OR length(v_candidate) > 30
     OR v_candidate !~ '^[a-z0-9._]+$' THEN
    RETURN '';
  END IF;

  RETURN v_candidate;
END;
$$;

-- Remove identidades institucionais/reservadas já registradas.
DELETE FROM public.contact_suppressions
WHERE identity_type = 'instagram'
  AND identity_value = ANY(ARRAY[
    'about','accounts','api','challenge','contact','developer','direct','directory',
    'download','emails','explore','graphql','invites','legal','oauth','p','press',
    'reel','reels','stories','tv','web'
  ]::text[]);

DELETE FROM public.lead_identity_registry
WHERE identity_type = 'instagram'
  AND identity_value = ANY(ARRAY[
    'about','accounts','api','challenge','contact','developer','direct','directory',
    'download','emails','explore','graphql','invites','legal','oauth','p','press',
    'reel','reels','stories','tv','web'
  ]::text[]);

-- Remove valores brutos que não representam perfis e recalcula a identidade.
UPDATE public.leads
SET leads_instagram = NULL
WHERE coalesce(trim(leads_instagram), '') <> ''
  AND public.normalize_identity_instagram(leads_instagram) = '';

UPDATE public.leads
SET leads_instagram = leads_instagram
WHERE coalesce(leads_normalized_instagram, '')
      IS DISTINCT FROM public.normalize_identity_instagram(leads_instagram);

-- URLs internas de convite/login não são website comercial nem perfil utilizável.
UPDATE public.leads
SET leads_website = NULL
WHERE coalesce(leads_website, '') ~* '^https?://(www\.)?instagram\.com/(about|accounts|api|challenge|contact|developer|direct|directory|download|emails|explore|graphql|invites|legal|oauth|p|press|reel|reels|stories|tv|web)(/|\?|#|$)';

-- Remove vínculos de duplicidade que tenham sido criados apenas por caminhos reservados.
UPDATE public.leads
SET canonical_lead_id = NULL,
    duplicate_reason = NULL
WHERE duplicate_reason = ANY(ARRAY[
  'instagram:about','instagram:accounts','instagram:api','instagram:challenge',
  'instagram:contact','instagram:developer','instagram:direct','instagram:directory',
  'instagram:download','instagram:emails','instagram:explore','instagram:graphql',
  'instagram:invites','instagram:legal','instagram:oauth','instagram:p',
  'instagram:press','instagram:reel','instagram:reels','instagram:stories',
  'instagram:tv','instagram:web'
]::text[]);

COMMIT;
