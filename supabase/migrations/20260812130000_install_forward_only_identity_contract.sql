BEGIN;

-- Instala o contrato de identidade apenas para leads criados a partir desta migration.
-- O marcador nao possui DEFAULT: todas as linhas historicas permanecem NULL e sao
-- deliberadamente ignoradas pelos triggers, inclusive em atualizacoes futuras.

CREATE OR REPLACE FUNCTION public.normalize_identity_phone(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog
AS $$
DECLARE
  v text := regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
BEGIN
  IF v LIKE '00%' THEN
    v := substr(v, 3);
  END IF;
  IF v = '' THEN
    RETURN '';
  END IF;
  IF v LIKE '55%' THEN
    RETURN v;
  END IF;
  IF length(v) IN (10, 11) THEN
    RETURN '55' || v;
  END IF;
  RETURN v;
END;
$$;

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
  v_candidate := trim(regexp_replace(v_candidate, '^@', ''));

  IF v_candidate = ''
     OR v_candidate = ANY(v_reserved)
     OR length(v_candidate) > 30
     OR v_candidate !~ '^[a-z0-9._]+$' THEN
    RETURN '';
  END IF;

  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_identity_domain(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog
AS $$
DECLARE
  v text := lower(trim(coalesce(p_value, '')));
BEGIN
  v := regexp_replace(v, '^https?://', '', 'i');
  v := regexp_replace(v, '^www\.', '', 'i');
  v := split_part(v, '/', 1);
  v := split_part(v, '?', 1);
  v := split_part(v, '#', 1);
  IF v IN (
    '', 'google.com', 'google.com.br', 'instagram.com', 'facebook.com', 'fb.com',
    'wa.me', 'whatsapp.com', 'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'linktr.ee'
  ) THEN
    RETURN '';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_identity_maps(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog
AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_value, '')), '/+$', '', 'g'));
$$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS leads_normalized_phone text,
  ADD COLUMN IF NOT EXISTS leads_normalized_instagram text,
  ADD COLUMN IF NOT EXISTS leads_normalized_domain text,
  ADD COLUMN IF NOT EXISTS leads_normalized_maps text,
  ADD COLUMN IF NOT EXISTS leads_identity_hash text,
  ADD COLUMN IF NOT EXISTS canonical_lead_id bigint,
  ADD COLUMN IF NOT EXISTS duplicate_reason text,
  ADD COLUMN IF NOT EXISTS leads_identity_contract_version smallint;

DO $$
DECLARE
  v_column record;
  v_actual_type text;
  v_is_nullable boolean;
  v_has_default boolean;
BEGIN
  FOR v_column IN
    SELECT *
    FROM (VALUES
      ('leads_normalized_phone', 'text'),
      ('leads_normalized_instagram', 'text'),
      ('leads_normalized_domain', 'text'),
      ('leads_normalized_maps', 'text'),
      ('leads_identity_hash', 'text'),
      ('canonical_lead_id', 'bigint'),
      ('duplicate_reason', 'text'),
      ('leads_identity_contract_version', 'smallint')
    ) AS expected(column_name, data_type)
  LOOP
    SELECT
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      NOT a.attnotnull,
      a.atthasdef
    INTO v_actual_type, v_is_nullable, v_has_default
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.leads'::regclass
      AND a.attname = v_column.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_actual_type IS NULL THEN
      RAISE EXCEPTION 'identity_contract_missing_leads_column:%', v_column.column_name;
    END IF;
    IF v_actual_type <> v_column.data_type OR NOT v_is_nullable OR v_has_default THEN
      RAISE EXCEPTION
        'identity_contract_divergent_leads_column:%:type=%:nullable=%:default=%',
        v_column.column_name, v_actual_type, v_is_nullable, v_has_default;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_constraint record;
  v_column_attnum smallint;
  v_referenced_attnum smallint;
BEGIN
  SELECT attnum INTO v_column_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.leads'::regclass AND attname = 'canonical_lead_id';

  SELECT attnum INTO v_referenced_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.leads'::regclass AND attname = 'leads_id';

  SELECT c.* INTO v_constraint
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.leads'::regclass
    AND c.contype = 'f'
    AND c.conkey = ARRAY[v_column_attnum]::smallint[];

  IF FOUND THEN
    IF v_constraint.confrelid <> 'public.leads'::regclass
       OR v_constraint.confkey <> ARRAY[v_referenced_attnum]::smallint[]
       OR v_constraint.confdeltype <> 'n' THEN
      RAISE EXCEPTION 'identity_contract_divergent_canonical_lead_fk:%', v_constraint.conname;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.leads'::regclass
        AND conname = 'leads_canonical_lead_id_fkey'
    ) THEN
      RAISE EXCEPTION 'identity_contract_divergent_named_constraint:leads_canonical_lead_id_fkey';
    END IF;
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_canonical_lead_id_fkey
      FOREIGN KEY (canonical_lead_id)
      REFERENCES public.leads(leads_id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.leads'::regclass
      AND c.conname = 'leads_identity_contract_version_check'
      AND NOT (
        c.contype = 'c'
        AND regexp_replace(lower(pg_catalog.pg_get_constraintdef(c.oid)), '\s+', '', 'g')
          IN ('check((leads_identity_contract_version=1))', 'check((leads_identity_contract_version=1))notvalid')
      )
  ) THEN
    RAISE EXCEPTION 'identity_contract_divergent_named_constraint:leads_identity_contract_version_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.leads'::regclass
      AND c.conname = 'leads_identity_contract_version_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_identity_contract_version_check
      CHECK (leads_identity_contract_version = 1)
      NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.lead_identity_registry (
  lead_identity_registry_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  identity_type text NOT NULL CHECK (identity_type IN ('phone', 'instagram', 'domain', 'maps')),
  identity_value text NOT NULL,
  canonical_lead_id bigint NOT NULL REFERENCES public.leads(leads_id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (users_id, identity_type, identity_value)
);

CREATE TABLE IF NOT EXISTS public.contact_suppressions (
  contact_suppressions_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  identity_type text NOT NULL CHECK (identity_type IN ('phone', 'instagram', 'domain', 'maps')),
  identity_value text NOT NULL,
  reason text NOT NULL,
  source_lead_id bigint REFERENCES public.leads(leads_id) ON DELETE SET NULL,
  source_sent_id bigint REFERENCES public.sents(sents_id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (users_id, identity_type, identity_value)
);

DO $$
DECLARE
  v_expected record;
  v_actual_type text;
  v_actual_not_null boolean;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('lead_identity_registry', 'lead_identity_registry_id', 'bigint', true),
      ('lead_identity_registry', 'users_id', 'bigint', true),
      ('lead_identity_registry', 'identity_type', 'text', true),
      ('lead_identity_registry', 'identity_value', 'text', true),
      ('lead_identity_registry', 'canonical_lead_id', 'bigint', true),
      ('lead_identity_registry', 'first_seen_at', 'timestamp with time zone', true),
      ('lead_identity_registry', 'last_seen_at', 'timestamp with time zone', true),
      ('contact_suppressions', 'contact_suppressions_id', 'bigint', true),
      ('contact_suppressions', 'users_id', 'bigint', true),
      ('contact_suppressions', 'identity_type', 'text', true),
      ('contact_suppressions', 'identity_value', 'text', true),
      ('contact_suppressions', 'reason', 'text', true),
      ('contact_suppressions', 'source_lead_id', 'bigint', false),
      ('contact_suppressions', 'source_sent_id', 'bigint', false),
      ('contact_suppressions', 'is_active', 'boolean', true),
      ('contact_suppressions', 'expires_at', 'timestamp with time zone', false),
      ('contact_suppressions', 'created_at', 'timestamp with time zone', true),
      ('contact_suppressions', 'updated_at', 'timestamp with time zone', true)
    ) AS expected(table_name, column_name, data_type, is_not_null)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull
    INTO v_actual_type, v_actual_not_null
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = format('public.%I', v_expected.table_name)::regclass
      AND a.attname = v_expected.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_actual_type IS NULL
       OR v_actual_type <> v_expected.data_type
       OR v_actual_not_null <> v_expected.is_not_null THEN
      RAISE EXCEPTION
        'identity_contract_divergent_column:%.%:type=%:not_null=%',
        v_expected.table_name, v_expected.column_name, v_actual_type, v_actual_not_null;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_expected record;
  v_table regclass;
  v_id_attnum smallint;
  v_primary_key record;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('lead_identity_registry', 'lead_identity_registry_id', 'lead_identity_registry_pkey'),
      ('contact_suppressions', 'contact_suppressions_id', 'contact_suppressions_pkey')
    ) AS expected(table_name, column_name, constraint_name)
  LOOP
    v_table := format('public.%I', v_expected.table_name)::regclass;
    SELECT attnum INTO v_id_attnum
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = v_expected.column_name;

    SELECT c.* INTO v_primary_key
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = v_table AND c.contype = 'p';

    IF FOUND THEN
      IF v_primary_key.conkey <> ARRAY[v_id_attnum]::smallint[] THEN
        RAISE EXCEPTION 'identity_contract_divergent_primary_key:%', v_expected.table_name;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = v_table AND conname = v_expected.constraint_name
      ) THEN
        RAISE EXCEPTION 'identity_contract_divergent_named_constraint:%', v_expected.constraint_name;
      END IF;
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (%I)',
        v_expected.table_name,
        v_expected.constraint_name,
        v_expected.column_name
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_expected record;
  v_table regclass;
  v_referenced_table regclass;
  v_column_attnum smallint;
  v_referenced_attnum smallint;
  v_constraint record;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('lead_identity_registry', 'users_id', 'users', 'users_id', 'c', 'CASCADE', 'lead_identity_registry_users_id_fkey'),
      ('lead_identity_registry', 'canonical_lead_id', 'leads', 'leads_id', 'c', 'CASCADE', 'lead_identity_registry_canonical_lead_id_fkey'),
      ('contact_suppressions', 'users_id', 'users', 'users_id', 'c', 'CASCADE', 'contact_suppressions_users_id_fkey'),
      ('contact_suppressions', 'source_lead_id', 'leads', 'leads_id', 'n', 'SET NULL', 'contact_suppressions_source_lead_id_fkey'),
      ('contact_suppressions', 'source_sent_id', 'sents', 'sents_id', 'n', 'SET NULL', 'contact_suppressions_source_sent_id_fkey')
    ) AS expected(table_name, column_name, referenced_table_name, referenced_column_name, delete_type, delete_clause, constraint_name)
  LOOP
    v_table := format('public.%I', v_expected.table_name)::regclass;
    v_referenced_table := format('public.%I', v_expected.referenced_table_name)::regclass;

    SELECT attnum INTO v_column_attnum
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = v_expected.column_name;

    SELECT attnum INTO v_referenced_attnum
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_referenced_table AND attname = v_expected.referenced_column_name;

    SELECT c.* INTO v_constraint
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = v_table
      AND c.contype = 'f'
      AND c.conkey = ARRAY[v_column_attnum]::smallint[];

    IF FOUND THEN
      IF v_constraint.confrelid <> v_referenced_table
         OR v_constraint.confkey <> ARRAY[v_referenced_attnum]::smallint[]
         OR v_constraint.confdeltype::text <> v_expected.delete_type THEN
        RAISE EXCEPTION 'identity_contract_divergent_foreign_key:%.%', v_expected.table_name, v_expected.column_name;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = v_table AND conname = v_expected.constraint_name
      ) THEN
        RAISE EXCEPTION 'identity_contract_divergent_named_constraint:%', v_expected.constraint_name;
      END IF;
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s NOT VALID',
        v_expected.table_name,
        v_expected.constraint_name,
        v_expected.column_name,
        v_expected.referenced_table_name,
        v_expected.referenced_column_name,
        v_expected.delete_clause
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_expected record;
  v_table regclass;
  v_definition text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('lead_identity_registry', 'lead_identity_registry_identity_type_contract_check'),
      ('contact_suppressions', 'contact_suppressions_identity_type_contract_check')
    ) AS expected(table_name, constraint_name)
  LOOP
    v_table := format('public.%I', v_expected.table_name)::regclass;
    SELECT lower(pg_catalog.pg_get_constraintdef(c.oid)) INTO v_definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = v_table AND c.conname = v_expected.constraint_name;

    IF FOUND THEN
      IF v_definition NOT LIKE '%identity_type%'
         OR v_definition NOT LIKE '%phone%'
         OR v_definition NOT LIKE '%instagram%'
         OR v_definition NOT LIKE '%domain%'
         OR v_definition NOT LIKE '%maps%' THEN
        RAISE EXCEPTION 'identity_contract_divergent_named_constraint:%', v_expected.constraint_name;
      END IF;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (identity_type IN (''phone'', ''instagram'', ''domain'', ''maps'')) NOT VALID',
        v_expected.table_name,
        v_expected.constraint_name
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table regclass;
  v_columns smallint[];
BEGIN
  v_table := 'public.lead_identity_registry'::regclass;
  SELECT array_agg(a.attnum::smallint ORDER BY key.ordinality)
  INTO v_columns
  FROM unnest(ARRAY['users_id', 'identity_type', 'identity_value']) WITH ORDINALITY AS key(column_name, ordinality)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = v_table AND a.attname = key.column_name;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indrelid = v_table
      AND i.indisunique
      AND i.indnkeyatts = cardinality(v_columns)
      AND i.indkey::smallint[] @> v_columns
  ) THEN
    CREATE UNIQUE INDEX lead_identity_registry_owner_identity_uidx
      ON public.lead_identity_registry(users_id, identity_type, identity_value);
  END IF;

  v_table := 'public.contact_suppressions'::regclass;
  SELECT array_agg(a.attnum::smallint ORDER BY key.ordinality)
  INTO v_columns
  FROM unnest(ARRAY['users_id', 'identity_type', 'identity_value']) WITH ORDINALITY AS key(column_name, ordinality)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = v_table AND a.attname = key.column_name;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indrelid = v_table
      AND i.indisunique
      AND i.indnkeyatts = cardinality(v_columns)
      AND i.indkey::smallint[] @> v_columns
  ) THEN
    CREATE UNIQUE INDEX contact_suppressions_owner_identity_uidx
      ON public.contact_suppressions(users_id, identity_type, identity_value);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS leads_identity_phone_idx
  ON public.leads(users_id, leads_normalized_phone)
  WHERE leads_normalized_phone <> '';
CREATE INDEX IF NOT EXISTS leads_identity_instagram_idx
  ON public.leads(users_id, leads_normalized_instagram)
  WHERE leads_normalized_instagram <> '';
CREATE INDEX IF NOT EXISTS leads_identity_domain_idx
  ON public.leads(users_id, leads_normalized_domain)
  WHERE leads_normalized_domain <> '';
CREATE INDEX IF NOT EXISTS leads_identity_maps_idx
  ON public.leads(users_id, leads_normalized_maps)
  WHERE leads_normalized_maps <> '';
CREATE INDEX IF NOT EXISTS leads_canonical_idx
  ON public.leads(users_id, canonical_lead_id)
  WHERE canonical_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_suppressions_active_idx
  ON public.contact_suppressions(users_id, identity_type, identity_value)
  WHERE is_active;

DO $$
DECLARE
  v_expected record;
  v_index record;
  v_actual_columns text[];
  v_actual_predicate text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('leads_identity_phone_idx', 'leads', ARRAY['users_id', 'leads_normalized_phone']::text[], 'leads_normalized_phone<>'''''),
      ('leads_identity_instagram_idx', 'leads', ARRAY['users_id', 'leads_normalized_instagram']::text[], 'leads_normalized_instagram<>'''''),
      ('leads_identity_domain_idx', 'leads', ARRAY['users_id', 'leads_normalized_domain']::text[], 'leads_normalized_domain<>'''''),
      ('leads_identity_maps_idx', 'leads', ARRAY['users_id', 'leads_normalized_maps']::text[], 'leads_normalized_maps<>'''''),
      ('leads_canonical_idx', 'leads', ARRAY['users_id', 'canonical_lead_id']::text[], 'canonical_lead_idisnotnull'),
      ('contact_suppressions_active_idx', 'contact_suppressions', ARRAY['users_id', 'identity_type', 'identity_value']::text[], 'is_active')
    ) AS expected(index_name, table_name, column_names, predicate)
  LOOP
    SELECT i.*, t.relname AS table_name, am.amname
    INTO v_index
    FROM pg_catalog.pg_class idx
    JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
    JOIN pg_catalog.pg_index i ON i.indexrelid = idx.oid
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    WHERE n.nspname = 'public' AND idx.relname = v_expected.index_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'identity_contract_missing_index:%', v_expected.index_name;
    END IF;

    SELECT array_agg(a.attname ORDER BY key.ordinality)
    INTO v_actual_columns
    FROM unnest(v_index.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinality)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = v_index.indrelid
     AND a.attnum = key.attnum
    WHERE key.ordinality <= v_index.indnkeyatts;

    v_actual_predicate := replace(
      replace(
        replace(
          replace(
            regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(v_index.indpred, v_index.indrelid), '')), '\s+', '', 'g'),
            '::text',
            ''
          ),
          '(',
          ''
        ),
        ')',
        ''
      ),
      ' ',
      ''
    );

    IF v_index.table_name <> v_expected.table_name
       OR v_index.amname <> 'btree'
       OR v_index.indisunique
       OR v_actual_columns <> v_expected.column_names
       OR v_actual_predicate <> v_expected.predicate THEN
      RAISE EXCEPTION 'identity_contract_divergent_index:%', v_expected.index_name;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.lead_identity_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_expected record;
  v_policy record;
  v_normalized_qual text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('lead_identity_registry', 'lead_identity_registry_own_select'),
      ('contact_suppressions', 'contact_suppressions_own_select')
    ) AS expected(table_name, policy_name)
  LOOP
    SELECT p.*, regexp_replace(lower(coalesce(p.qual, '')), '\s+', '', 'g') AS normalized_qual
    INTO v_policy
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = v_expected.table_name
      AND p.policyname = v_expected.policy_name;

    IF FOUND THEN
      v_normalized_qual := v_policy.normalized_qual;
      IF v_policy.cmd <> 'SELECT'
         OR NOT ('authenticated' = ANY(v_policy.roles))
         OR v_normalized_qual NOT IN (
           '(users_id=ensure_current_user())',
           '(users_id=public.ensure_current_user())'
         ) THEN
        RAISE EXCEPTION 'identity_contract_divergent_policy:%.%', v_policy.tablename, v_policy.policyname;
      END IF;
    ELSIF v_expected.policy_name = 'lead_identity_registry_own_select' THEN
      CREATE POLICY lead_identity_registry_own_select
        ON public.lead_identity_registry
        FOR SELECT TO authenticated
        USING (users_id = public.ensure_current_user());
    ELSE
      CREATE POLICY contact_suppressions_own_select
        ON public.contact_suppressions
        FOR SELECT TO authenticated
        USING (users_id = public.ensure_current_user());
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('lead_identity_registry', 'contact_suppressions')
      AND p.roles && ARRAY['public', 'anon', 'authenticated']::name[]
      AND (
        p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        OR regexp_replace(lower(coalesce(p.qual, '')), '\s+', '', 'g') IN ('true', '(true)')
      )
  ) THEN
    RAISE EXCEPTION 'identity_contract_unsafe_existing_policy';
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE public.lead_identity_registry, public.contact_suppressions
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.lead_identity_registry, public.contact_suppressions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_identity_registry, public.contact_suppressions TO service_role;

-- Regras necessarias apenas para uma futura atualizacao de um lead do contrato novo.
-- Regras existentes divergentes nao sao sobrescritas silenciosamente.
INSERT INTO public.audit_transition_rules(entity_type, from_status_id, to_status_id, action_key)
VALUES
  ('lead', 1, 7, 'mark_duplicate'),
  ('lead', 2, 7, 'mark_duplicate'),
  ('lead', 3, 7, 'mark_duplicate'),
  ('lead', 6, 7, 'mark_duplicate')
ON CONFLICT (entity_type, from_status_id, to_status_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES (1::bigint), (2::bigint), (3::bigint), (6::bigint)) expected(from_status_id)
    LEFT JOIN public.audit_transition_rules r
      ON r.entity_type = 'lead'
     AND r.from_status_id = expected.from_status_id
     AND r.to_status_id = 7
    WHERE r.audit_transition_rules_id IS NULL
       OR r.action_key <> 'mark_duplicate'
       OR NOT r.is_active
  ) THEN
    RAISE EXCEPTION 'identity_contract_divergent_duplicate_transition_rule';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_lead_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions
AS $$
DECLARE
  v_canonical bigint;
  v_reason text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.leads_identity_contract_version IS DISTINCT FROM 1 THEN
    NEW.leads_identity_contract_version := OLD.leads_identity_contract_version;
    RETURN NEW;
  END IF;

  NEW.leads_identity_contract_version := 1;
  NEW.leads_normalized_phone := public.normalize_identity_phone(NEW.leads_phone);
  NEW.leads_normalized_instagram := public.normalize_identity_instagram(NEW.leads_instagram);
  NEW.leads_normalized_domain := public.normalize_identity_domain(NEW.leads_website);
  NEW.leads_normalized_maps := public.normalize_identity_maps(NEW.leads_maps);
  NEW.leads_identity_hash := encode(
    extensions.digest(
      concat_ws(
        '|',
        NEW.leads_normalized_phone,
        NEW.leads_normalized_instagram,
        NEW.leads_normalized_domain,
        NEW.leads_normalized_maps
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT r.canonical_lead_id, r.identity_type || ':' || r.identity_value
  INTO v_canonical, v_reason
  FROM public.lead_identity_registry r
  WHERE r.users_id = NEW.users_id
    AND r.canonical_lead_id <> coalesce(NEW.leads_id, -1)
    AND (
      (r.identity_type = 'phone' AND r.identity_value = NEW.leads_normalized_phone AND NEW.leads_normalized_phone <> '')
      OR (r.identity_type = 'instagram' AND r.identity_value = NEW.leads_normalized_instagram AND NEW.leads_normalized_instagram <> '')
      OR (r.identity_type = 'domain' AND r.identity_value = NEW.leads_normalized_domain AND NEW.leads_normalized_domain <> '')
      OR (r.identity_type = 'maps' AND r.identity_value = NEW.leads_normalized_maps AND NEW.leads_normalized_maps <> '')
    )
  ORDER BY r.canonical_lead_id, r.lead_identity_registry_id
  LIMIT 1;

  IF v_canonical IS NOT NULL THEN
    NEW.canonical_lead_id := v_canonical;
    NEW.duplicate_reason := v_reason;
    IF NEW.lead_status_id IN (1, 2, 3, 6) THEN
      NEW.lead_status_id := 7;
    END IF;
  ELSIF NEW.canonical_lead_id = NEW.leads_id THEN
    NEW.canonical_lead_id := NULL;
    NEW.duplicate_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_lead_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_canonical bigint := coalesce(NEW.canonical_lead_id, NEW.leads_id);
BEGIN
  IF NEW.leads_identity_contract_version IS DISTINCT FROM 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.leads_normalized_phone <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'phone', NEW.leads_normalized_phone, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  IF NEW.leads_normalized_instagram <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'instagram', NEW.leads_normalized_instagram, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  IF NEW.leads_normalized_domain <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'domain', NEW.leads_normalized_domain, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  IF NEW.leads_normalized_maps <> '' THEN
    INSERT INTO public.lead_identity_registry(users_id, identity_type, identity_value, canonical_lead_id)
    VALUES (NEW.users_id, 'maps', NEW.leads_normalized_maps, v_canonical)
    ON CONFLICT (users_id, identity_type, identity_value)
    DO UPDATE SET last_seen_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_lead_identities(
  p_lead public.leads,
  p_reason text,
  p_sent_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF p_lead.leads_identity_contract_version IS DISTINCT FROM 1 THEN
    RETURN;
  END IF;

  INSERT INTO public.contact_suppressions(
    users_id, identity_type, identity_value, reason, source_lead_id, source_sent_id
  )
  SELECT p_lead.users_id, identity.identity_type, identity.identity_value, p_reason, p_lead.leads_id, p_sent_id
  FROM (VALUES
    ('phone', p_lead.leads_normalized_phone),
    ('instagram', p_lead.leads_normalized_instagram),
    ('domain', p_lead.leads_normalized_domain),
    ('maps', p_lead.leads_normalized_maps)
  ) AS identity(identity_type, identity_value)
  WHERE identity.identity_value IS NOT NULL
    AND identity.identity_value <> ''
  ON CONFLICT (users_id, identity_type, identity_value)
  DO UPDATE SET
    reason = excluded.reason,
    source_lead_id = excluded.source_lead_id,
    source_sent_id = coalesce(excluded.source_sent_id, public.contact_suppressions.source_sent_id),
    is_active = true,
    expires_at = NULL,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_after_lead_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.leads_identity_contract_version IS DISTINCT FROM 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_status_id = 5
     AND (TG_OP = 'INSERT' OR OLD.lead_status_id IS DISTINCT FROM NEW.lead_status_id) THEN
    PERFORM public.suppress_lead_identities(NEW, 'lead_sent', NULL);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_lead_identity(
  p_phone text DEFAULT NULL,
  p_instagram text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_maps text DEFAULT NULL
)
RETURNS TABLE(
  identity_type text,
  identity_value text,
  canonical_lead_id bigint,
  is_suppressed boolean,
  suppression_reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
WITH input AS (
  SELECT 'phone'::text AS identity_type, public.normalize_identity_phone(p_phone) AS identity_value
  UNION ALL
  SELECT 'instagram', public.normalize_identity_instagram(p_instagram)
  UNION ALL
  SELECT 'domain', public.normalize_identity_domain(p_website)
  UNION ALL
  SELECT 'maps', public.normalize_identity_maps(p_maps)
), current_owner AS (
  SELECT public.ensure_current_user() AS users_id
)
SELECT
  input.identity_type,
  input.identity_value,
  registry.canonical_lead_id,
  coalesce(
    suppression.is_active
    AND (suppression.expires_at IS NULL OR suppression.expires_at > now()),
    false
  ),
  suppression.reason
FROM input
CROSS JOIN current_owner
LEFT JOIN public.lead_identity_registry registry
  ON registry.users_id = current_owner.users_id
 AND registry.identity_type = input.identity_type
 AND registry.identity_value = input.identity_value
LEFT JOIN public.contact_suppressions suppression
  ON suppression.users_id = current_owner.users_id
 AND suppression.identity_type = input.identity_type
 AND suppression.identity_value = input.identity_value
WHERE input.identity_value <> '';
$$;

REVOKE ALL ON FUNCTION public.prepare_lead_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_lead_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_lead_identities(public.leads, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_after_lead_sent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_lead_identity(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_lead_identity(text, text, text, text) TO authenticated;

DROP TRIGGER IF EXISTS prepare_lead_identity_trigger ON public.leads;
CREATE TRIGGER prepare_lead_identity_trigger
BEFORE INSERT OR UPDATE OF
  leads_phone,
  leads_instagram,
  leads_website,
  leads_maps,
  leads_identity_contract_version
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.prepare_lead_identity();

DROP TRIGGER IF EXISTS register_lead_identity_trigger ON public.leads;
CREATE TRIGGER register_lead_identity_trigger
AFTER INSERT OR UPDATE OF
  leads_phone,
  leads_instagram,
  leads_website,
  leads_maps,
  leads_identity_contract_version
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.register_lead_identity();

DROP TRIGGER IF EXISTS suppress_after_lead_sent_trigger ON public.leads;
CREATE TRIGGER suppress_after_lead_sent_trigger
AFTER INSERT OR UPDATE OF lead_status_id
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.suppress_after_lead_sent();

COMMIT;
