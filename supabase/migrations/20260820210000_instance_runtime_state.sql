BEGIN;

-- A partir desta versão, instances.status_id deixa de representar o socket
-- momentâneo do WhatsApp. Ele volta a ser o estado administrativo do cadastro.
-- O estado operacional passa a ter armazenamento próprio e pode distinguir
-- sessão persistida, socket conectado e indisponibilidade temporária.
CREATE TABLE IF NOT EXISTS public.instance_runtime_states (
  instances_id bigint PRIMARY KEY REFERENCES public.instances(instances_id) ON DELETE CASCADE,
  users_id bigint NOT NULL REFERENCES public.users(users_id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'evolution-go',
  operational_state text NOT NULL DEFAULT 'unknown',
  session_saved boolean NOT NULL DEFAULT false,
  socket_connected boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  logged_in boolean NOT NULL DEFAULT false,
  jid text,
  provider_state text,
  last_error text,
  source text NOT NULL DEFAULT 'unknown',
  checked_at timestamptz NOT NULL DEFAULT now(),
  instance_runtime_states_created_at timestamptz NOT NULL DEFAULT now(),
  instance_runtime_states_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instance_runtime_states_operational_state_check
    CHECK (operational_state IN ('online','reconnecting','session_saved','disconnected','unavailable','unknown')),
  CONSTRAINT instance_runtime_states_source_check
    CHECK (source IN ('poll','webhook','bootstrap','unknown'))
);

CREATE INDEX IF NOT EXISTS instance_runtime_states_users_state_idx
  ON public.instance_runtime_states(users_id, operational_state, checked_at DESC);

ALTER TABLE public.instance_runtime_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instance_runtime_states FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.instance_runtime_states TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.instance_runtime_states TO service_role;

DROP POLICY IF EXISTS instance_runtime_states_owner_select ON public.instance_runtime_states;
CREATE POLICY instance_runtime_states_owner_select
  ON public.instance_runtime_states
  FOR SELECT
  TO authenticated
  USING (users_id = public.ensure_current_user());

-- Antes desta migration, status_id=2 podia significar apenas socket offline e
-- não havia controle administrativo manual para instâncias. Portanto, todo
-- cadastro existente é normalizado para ativo; a conexão real ficará na nova tabela.
UPDATE public.instances
SET status_id = 1,
    instances_updated_at = now()
WHERE status_id IN (1, 2);

INSERT INTO public.instance_runtime_states(
  instances_id, users_id, provider, operational_state, session_saved,
  socket_connected, connected, logged_in, source, checked_at
)
SELECT i.instances_id, i.users_id, 'evolution-go', 'unknown', false, false, false, false, 'bootstrap', now()
FROM public.instances i
ON CONFLICT (instances_id) DO NOTHING;

-- Novas instâncias já nascem administrativamente ativas. Trocar credencial não
-- deve mais marcar o cadastro como inativo; a Edge Function atualizará somente
-- instance_runtime_states após consultar o Gateway.
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
    VALUES (v_users_id, 1, v_name, v_url, NULL, now(), now())
    RETURNING instances_id INTO v_id;

    v_secret_id := vault.create_secret(
      v_api_key,
      NULL,
      format('Painel CRM - Evolution instance %s (%s)', v_id, v_name)
    );

    INSERT INTO public.instance_credentials(instances_id, users_id, vault_secret_id)
    VALUES (v_id, v_users_id, v_secret_id);

    INSERT INTO public.instance_runtime_states(instances_id, users_id, source)
    VALUES (v_id, v_users_id, 'bootstrap')
    ON CONFLICT (instances_id) DO NOTHING;
  ELSE
    UPDATE public.instances
    SET instances_name = v_name,
        instances_url = v_url,
        status_id = 1,
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

      UPDATE public.instance_runtime_states
      SET operational_state = 'unknown',
          session_saved = false,
          socket_connected = false,
          connected = false,
          logged_in = false,
          jid = NULL,
          provider_state = NULL,
          last_error = NULL,
          source = 'bootstrap',
          checked_at = now(),
          instance_runtime_states_updated_at = now()
      WHERE instances_id = v_id AND users_id = v_users_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_instance_secure(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_instance_secure(bigint, text, text, text) TO authenticated;

COMMIT;
