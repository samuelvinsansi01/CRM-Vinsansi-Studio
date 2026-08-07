BEGIN;

-- Etapa 4: credenciais operacionais fora das tabelas expostas ao frontend.
-- Os valores ficam criptografados pelo Supabase Vault. As tabelas públicas
-- guardam somente a referência do segredo e não possuem policies para usuários.

DO $$
BEGIN
  IF to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault não está disponível neste projeto.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.instance_credentials (
  instances_id bigint PRIMARY KEY REFERENCES public.instances(instances_id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  vault_secret_id uuid NOT NULL UNIQUE,
  instance_credentials_created_at timestamptz NOT NULL DEFAULT now(),
  instance_credentials_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instance_credentials_users_idx
  ON public.instance_credentials(users_id, instances_id);

CREATE TABLE IF NOT EXISTS public.apify_account_credentials (
  apify_accounts_id bigint PRIMARY KEY REFERENCES public.apify_accounts(apify_accounts_id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  vault_secret_id uuid NOT NULL UNIQUE,
  apify_account_credentials_created_at timestamptz NOT NULL DEFAULT now(),
  apify_account_credentials_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apify_account_credentials_users_idx
  ON public.apify_account_credentials(users_id, apify_accounts_id);

ALTER TABLE public.instance_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apify_account_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instance_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.apify_account_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.instance_credentials TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apify_account_credentials TO service_role;

-- Migra as credenciais atuais para o Vault antes de neutralizar as colunas legadas.
DO $$
DECLARE
  v_row record;
  v_secret_id uuid;
BEGIN
  FOR v_row IN
    SELECT i.instances_id, i.users_id, i.instances_name, i.instances_apikey
    FROM public.instances i
    WHERE nullif(trim(coalesce(i.instances_apikey, '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.instance_credentials c WHERE c.instances_id = i.instances_id
      )
  LOOP
    v_secret_id := vault.create_secret(
      trim(v_row.instances_apikey),
      NULL,
      format('Painel CRM - Evolution instance %s (%s)', v_row.instances_id, coalesce(v_row.instances_name, 'sem nome'))
    );

    INSERT INTO public.instance_credentials(instances_id, users_id, vault_secret_id)
    VALUES (v_row.instances_id, v_row.users_id, v_secret_id);
  END LOOP;

  FOR v_row IN
    SELECT a.apify_accounts_id, a.users_id, a.account_name, a.token_secret
    FROM public.apify_accounts a
    WHERE nullif(trim(coalesce(a.token_secret, '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.apify_account_credentials c WHERE c.apify_accounts_id = a.apify_accounts_id
      )
  LOOP
    v_secret_id := vault.create_secret(
      trim(v_row.token_secret),
      NULL,
      format('Painel CRM - Apify account %s (%s)', v_row.apify_accounts_id, coalesce(v_row.account_name, 'sem nome'))
    );

    INSERT INTO public.apify_account_credentials(apify_accounts_id, users_id, vault_secret_id)
    VALUES (v_row.apify_accounts_id, v_row.users_id, v_secret_id);
  END LOOP;
END;
$$;

ALTER TABLE public.apify_accounts ALTER COLUMN token_secret DROP NOT NULL;
UPDATE public.instances SET instances_apikey = NULL WHERE instances_apikey IS NOT NULL;
UPDATE public.apify_accounts SET token_secret = NULL WHERE token_secret IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instances_apikey_must_remain_null'
      AND conrelid = 'public.instances'::regclass
  ) THEN
    ALTER TABLE public.instances
      ADD CONSTRAINT instances_apikey_must_remain_null CHECK (instances_apikey IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apify_token_secret_must_remain_null'
      AND conrelid = 'public.apify_accounts'::regclass
  ) THEN
    ALTER TABLE public.apify_accounts
      ADD CONSTRAINT apify_token_secret_must_remain_null CHECK (token_secret IS NULL);
  END IF;
END;
$$;

-- Remove toda policy de escrita direta. Leitura permanece permitida, mas as
-- colunas legadas estão obrigatoriamente nulas.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('instances', 'apify_accounts')
      AND upper(cmd) <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  END LOOP;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.instances FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.apify_accounts FROM anon, authenticated;
GRANT SELECT ON TABLE public.instances TO authenticated;
GRANT SELECT ON TABLE public.apify_accounts TO authenticated;

DROP POLICY IF EXISTS instances_secure_select ON public.instances;
CREATE POLICY instances_secure_select
  ON public.instances
  FOR SELECT
  TO authenticated
  USING (users_id = public.ensure_current_user());

DROP POLICY IF EXISTS apify_accounts_secure_select ON public.apify_accounts;
CREATE POLICY apify_accounts_secure_select
  ON public.apify_accounts
  FOR SELECT
  TO authenticated
  USING (users_id = public.ensure_current_user());

-- CRUD seguro das instâncias Evolution.
CREATE OR REPLACE FUNCTION public.save_instance_secure(
  p_instances_id bigint,
  p_name text,
  p_url text,
  p_api_key text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
DECLARE
  v_users_id bigint := public.ensure_current_user();
  v_id bigint;
  v_secret_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_url text := rtrim(trim(coalesce(p_url, '')), '/');
  v_api_key text := trim(coalesce(p_api_key, ''));
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'Nome da instância é obrigatório.';
  END IF;
  IF v_url = '' OR v_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Informe uma URL HTTP ou HTTPS válida para a Evolution.';
  END IF;

  IF p_instances_id IS NULL THEN
    IF v_api_key = '' THEN
      RAISE EXCEPTION 'API key é obrigatória para uma nova instância.';
    END IF;

    INSERT INTO public.instances(
      users_id, status_id, instances_name, instances_url, instances_apikey,
      instances_created_at, instances_updated_at
    )
    VALUES (v_users_id, 2, v_name, v_url, NULL, now(), now())
    RETURNING instances_id INTO v_id;

    v_secret_id := vault.create_secret(
      v_api_key,
      NULL,
      format('Painel CRM - Evolution instance %s (%s)', v_id, v_name)
    );

    INSERT INTO public.instance_credentials(instances_id, users_id, vault_secret_id)
    VALUES (v_id, v_users_id, v_secret_id);
  ELSE
    UPDATE public.instances
    SET instances_name = v_name,
        instances_url = v_url,
        instances_updated_at = now()
    WHERE instances_id = p_instances_id
      AND users_id = v_users_id
    RETURNING instances_id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Instância não encontrada.';
    END IF;

    IF v_api_key <> '' THEN
      SELECT c.vault_secret_id
      INTO v_secret_id
      FROM public.instance_credentials c
      WHERE c.instances_id = v_id
        AND c.users_id = v_users_id
      FOR UPDATE;

      IF v_secret_id IS NULL THEN
        v_secret_id := vault.create_secret(
          v_api_key,
          NULL,
          format('Painel CRM - Evolution instance %s (%s)', v_id, v_name)
        );
        INSERT INTO public.instance_credentials(instances_id, users_id, vault_secret_id)
        VALUES (v_id, v_users_id, v_secret_id);
      ELSE
        PERFORM vault.update_secret(
          v_secret_id,
          v_api_key,
          NULL,
          format('Painel CRM - Evolution instance %s (%s)', v_id, v_name)
        );
        UPDATE public.instance_credentials
        SET instance_credentials_updated_at = now()
        WHERE instances_id = v_id;
      END IF;

      UPDATE public.instances
      SET status_id = 2,
          instances_updated_at = now()
      WHERE instances_id = v_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_instance_secure(p_instances_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
DECLARE
  v_users_id bigint := public.ensure_current_user();
  v_secret_id uuid;
BEGIN
  SELECT c.vault_secret_id
  INTO v_secret_id
  FROM public.instance_credentials c
  WHERE c.instances_id = p_instances_id
    AND c.users_id = v_users_id;

  DELETE FROM public.instances
  WHERE instances_id = p_instances_id
    AND users_id = v_users_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instância não encontrada.';
  END IF;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;
END;
$$;

-- Mantém os nomes já existentes das RPCs Apify, agora usando Vault.
CREATE OR REPLACE FUNCTION public.save_apify_account(
  p_apify_accounts_id bigint,
  p_account_name text,
  p_token text,
  p_is_active boolean
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
DECLARE
  v_users_id bigint := public.ensure_current_user();
  v_id bigint;
  v_secret_id uuid;
  v_name text := trim(coalesce(p_account_name, ''));
  v_token text := trim(coalesce(p_token, ''));
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome da conta Apify.';
  END IF;

  IF p_apify_accounts_id IS NULL THEN
    IF v_token = '' THEN
      RAISE EXCEPTION 'Informe o token da nova conta Apify.';
    END IF;

    INSERT INTO public.apify_accounts(
      users_id, account_name, token_secret, is_active, connection_status,
      created_at, updated_at
    )
    VALUES (
      v_users_id, v_name, NULL, coalesce(p_is_active, true), 'not_verified',
      now(), now()
    )
    RETURNING apify_accounts_id INTO v_id;

    v_secret_id := vault.create_secret(
      v_token,
      NULL,
      format('Painel CRM - Apify account %s (%s)', v_id, v_name)
    );

    INSERT INTO public.apify_account_credentials(apify_accounts_id, users_id, vault_secret_id)
    VALUES (v_id, v_users_id, v_secret_id);
  ELSE
    UPDATE public.apify_accounts
    SET account_name = v_name,
        is_active = coalesce(p_is_active, true),
        connection_status = CASE WHEN v_token = '' THEN connection_status ELSE 'not_verified' END,
        last_error = CASE WHEN v_token = '' THEN last_error ELSE NULL END,
        updated_at = now()
    WHERE apify_accounts_id = p_apify_accounts_id
      AND users_id = v_users_id
    RETURNING apify_accounts_id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Conta Apify não encontrada.';
    END IF;

    IF v_token <> '' THEN
      SELECT c.vault_secret_id
      INTO v_secret_id
      FROM public.apify_account_credentials c
      WHERE c.apify_accounts_id = v_id
        AND c.users_id = v_users_id
      FOR UPDATE;

      IF v_secret_id IS NULL THEN
        v_secret_id := vault.create_secret(
          v_token,
          NULL,
          format('Painel CRM - Apify account %s (%s)', v_id, v_name)
        );
        INSERT INTO public.apify_account_credentials(apify_accounts_id, users_id, vault_secret_id)
        VALUES (v_id, v_users_id, v_secret_id);
      ELSE
        PERFORM vault.update_secret(
          v_secret_id,
          v_token,
          NULL,
          format('Painel CRM - Apify account %s (%s)', v_id, v_name)
        );
        UPDATE public.apify_account_credentials
        SET apify_account_credentials_updated_at = now()
        WHERE apify_accounts_id = v_id;
      END IF;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_apify_accounts()
RETURNS TABLE(
  apify_accounts_id bigint,
  account_name text,
  is_active boolean,
  token_mask text,
  connection_status text,
  external_username text,
  last_checked_at timestamptz,
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT
    a.apify_accounts_id,
    a.account_name,
    a.is_active,
    CASE WHEN c.vault_secret_id IS NULL THEN '' ELSE '••••••••' END AS token_mask,
    a.connection_status,
    coalesce(a.external_username, ''),
    a.last_checked_at,
    a.last_used_at,
    coalesce(a.last_error, ''),
    a.created_at,
    a.updated_at
  FROM public.apify_accounts a
  LEFT JOIN public.apify_account_credentials c
    ON c.apify_accounts_id = a.apify_accounts_id
   AND c.users_id = a.users_id
  WHERE a.users_id = public.ensure_current_user()
  ORDER BY a.is_active DESC, a.account_name, a.apify_accounts_id;
$$;

CREATE OR REPLACE FUNCTION public.delete_apify_account(p_apify_accounts_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
DECLARE
  v_users_id bigint := public.ensure_current_user();
  v_secret_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.apify_import_jobs j
    WHERE j.users_id = v_users_id
      AND j.apify_accounts_id = p_apify_accounts_id
  ) THEN
    RAISE EXCEPTION 'Esta conta possui histórico de coletas. Desative-a em vez de removê-la.';
  END IF;

  SELECT c.vault_secret_id
  INTO v_secret_id
  FROM public.apify_account_credentials c
  WHERE c.apify_accounts_id = p_apify_accounts_id
    AND c.users_id = v_users_id;

  DELETE FROM public.apify_accounts
  WHERE apify_accounts_id = p_apify_accounts_id
    AND users_id = v_users_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta Apify não encontrada.';
  END IF;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;
END;
$$;

-- RPCs estritamente internas. Somente service_role pode descriptografar.
CREATE OR REPLACE FUNCTION public.service_get_evolution_instances(
  p_users_id bigint DEFAULT NULL,
  p_instances_id bigint DEFAULT NULL,
  p_instance_name text DEFAULT NULL
)
RETURNS TABLE(
  instances_id bigint,
  users_id bigint,
  status_id bigint,
  instances_name text,
  instances_url text,
  api_key text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
  SELECT
    i.instances_id,
    i.users_id,
    i.status_id,
    i.instances_name,
    i.instances_url,
    d.decrypted_secret AS api_key
  FROM public.instances i
  LEFT JOIN public.instance_credentials c
    ON c.instances_id = i.instances_id
   AND c.users_id = i.users_id
  LEFT JOIN vault.decrypted_secrets d
    ON d.id = c.vault_secret_id
  WHERE (p_users_id IS NULL OR i.users_id = p_users_id)
    AND (p_instances_id IS NULL OR i.instances_id = p_instances_id)
    AND (nullif(trim(coalesce(p_instance_name, '')), '') IS NULL OR i.instances_name = trim(p_instance_name))
  ORDER BY i.instances_id;
$$;

CREATE OR REPLACE FUNCTION public.service_get_apify_account_secret(
  p_users_id bigint,
  p_apify_accounts_id bigint
)
RETURNS TABLE(
  apify_accounts_id bigint,
  users_id bigint,
  token_secret text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
  SELECT
    a.apify_accounts_id,
    a.users_id,
    d.decrypted_secret AS token_secret
  FROM public.apify_accounts a
  JOIN public.apify_account_credentials c
    ON c.apify_accounts_id = a.apify_accounts_id
   AND c.users_id = a.users_id
  JOIN vault.decrypted_secrets d
    ON d.id = c.vault_secret_id
  WHERE a.users_id = p_users_id
    AND a.apify_accounts_id = p_apify_accounts_id;
$$;

REVOKE ALL ON FUNCTION public.save_instance_secure(bigint, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_instance_secure(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_apify_account(bigint, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_apify_accounts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_apify_account(bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_instance_secure(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_instance_secure(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_apify_account(bigint, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_apify_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_apify_account(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.service_get_evolution_instances(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_get_apify_account_secret(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_evolution_instances(bigint, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_get_apify_account_secret(bigint, bigint) TO service_role;

COMMIT;
