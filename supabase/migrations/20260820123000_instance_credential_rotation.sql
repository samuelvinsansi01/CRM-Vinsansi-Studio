-- v1.0.1: rotação segura de credencial por instância, sempre limitada ao usuário autenticado.
CREATE OR REPLACE FUNCTION public.rotate_instance_credential_secure(
  p_instances_id bigint,
  p_api_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, vault
AS $$
DECLARE
  v_users_id bigint := public.ensure_current_user();
  v_secret_id uuid;
  v_instance_name text;
  v_api_key text := trim(coalesce(p_api_key, ''));
BEGIN
  IF p_instances_id IS NULL OR p_instances_id <= 0 THEN
    RAISE EXCEPTION 'Instância inválida.';
  END IF;
  IF v_api_key = '' OR length(v_api_key) < 24 THEN
    RAISE EXCEPTION 'Nova credencial inválida.';
  END IF;

  SELECT i.instances_name, c.vault_secret_id
    INTO v_instance_name, v_secret_id
  FROM public.instances i
  LEFT JOIN public.instance_credentials c
    ON c.instances_id = i.instances_id
   AND c.users_id = i.users_id
  WHERE i.instances_id = p_instances_id
    AND i.users_id = v_users_id
  FOR UPDATE OF i;

  IF v_instance_name IS NULL THEN
    RAISE EXCEPTION 'Instância não encontrada para o usuário autenticado.';
  END IF;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(
      v_api_key,
      NULL,
      format('Painel CRM - Evolution instance %s (%s)', p_instances_id, v_instance_name)
    );
    INSERT INTO public.instance_credentials(instances_id, users_id, vault_secret_id)
    VALUES (p_instances_id, v_users_id, v_secret_id)
    ON CONFLICT (instances_id) DO UPDATE
      SET users_id = EXCLUDED.users_id,
          vault_secret_id = EXCLUDED.vault_secret_id,
          instance_credentials_updated_at = now();
  ELSE
    PERFORM vault.update_secret(
      v_secret_id,
      v_api_key,
      NULL,
      format('Painel CRM - Evolution instance %s (%s)', p_instances_id, v_instance_name)
    );
    UPDATE public.instance_credentials
       SET instance_credentials_updated_at = now()
     WHERE instances_id = p_instances_id
       AND users_id = v_users_id;
  END IF;

  UPDATE public.instances
     SET status_id = 2,
         instances_updated_at = now()
   WHERE instances_id = p_instances_id
     AND users_id = v_users_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_instance_credential_secure(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_instance_credential_secure(bigint, text) TO authenticated;

COMMENT ON FUNCTION public.rotate_instance_credential_secure(bigint, text)
IS 'Rotaciona a credencial Vault de uma instância pertencente exclusivamente ao usuário autenticado. Usado pelo Gerenciador para reparar colisões legadas sem expor o segredo ao renderer.';
