-- Alinhamento de acesso para o schema real informado em 2026-07-28.
-- Nao cria tabelas nem colunas. Apenas adiciona policies RLS ausentes.

DO $$
DECLARE
  t text;
BEGIN
  -- Catalogos globais somente leitura.
  FOREACH t IN ARRAY ARRAY['status','lead_status','channels','countries','states','cities'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_authenticated_read'
    ) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_authenticated_read', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  action text;
  policy_name text;
  expression text := '(users_id = (SELECT u.users_id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1))';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'apify_accounts','apify_import_jobs','branches','chips','contact_sources','instances',
    'levels','queues','queue_items','sents','socials','template_channels','template_types',
    'template_variables','templates'
  ] LOOP
    FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      policy_name := t || '_own_' || lower(action);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = policy_name
      ) THEN
        IF action = 'SELECT' OR action = 'DELETE' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING %s', policy_name, t, action, expression);
        ELSIF action = 'INSERT' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK %s', policy_name, t, expression);
        ELSE
          EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING %s WITH CHECK %s', policy_name, t, expression, expression);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- A tabela users continua restrita ao proprio perfil.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_own_update'
  ) THEN
    CREATE POLICY users_own_update ON public.users
      FOR UPDATE TO authenticated
      USING (auth_user_id = auth.uid())
      WITH CHECK (auth_user_id = auth.uid());
  END IF;
END $$;

-- Grants explicitos para o papel autenticado. As policies acima continuam sendo
-- a barreira de isolamento por usuario; estes grants apenas liberam as operacoes
-- que o PostgREST precisa enxergar.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.status, public.lead_status, public.channels,
  public.countries, public.states, public.cities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apify_accounts,
  public.apify_import_jobs, public.branches, public.chips,
  public.contact_sources, public.instances, public.levels, public.queues,
  public.queue_items, public.sents, public.socials, public.template_channels,
  public.template_types, public.template_variables, public.templates,
  public.leads TO authenticated;
GRANT SELECT, UPDATE ON public.users TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
