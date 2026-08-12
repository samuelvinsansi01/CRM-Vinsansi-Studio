BEGIN;

DO $migration$
DECLARE
  fk record;
  existing_definition text;
  normalized_existing text;
  normalized_expected text;
BEGIN
  FOR fk IN
    SELECT *
    FROM (VALUES
      ('apify_accounts', 'apify_accounts_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('apify_import_jobs', 'apify_import_jobs_apify_accounts_id_fkey', 'FOREIGN KEY (apify_accounts_id) REFERENCES public.apify_accounts(apify_accounts_id) ON DELETE SET NULL'),
      ('apify_import_jobs', 'apify_import_jobs_apify_job_status_id_fkey', 'FOREIGN KEY (apify_job_status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('apify_import_jobs', 'apify_import_jobs_branches_id_fkey', 'FOREIGN KEY (branches_id) REFERENCES public.branches(branches_id)'),
      ('apify_import_jobs', 'apify_import_jobs_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('branches', 'branches_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('branches', 'branches_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('chips', 'chips_instances_id_fkey', 'FOREIGN KEY (instances_id) REFERENCES public.instances(instances_id) ON DELETE SET NULL'),
      ('chips', 'chips_levels_id_fkey', 'FOREIGN KEY (levels_id) REFERENCES public.levels(levels_id) ON DELETE RESTRICT'),
      ('chips', 'chips_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('chips', 'chips_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('cities', 'cities_states_id_fkey', 'FOREIGN KEY (states_id) REFERENCES public.states(states_id) ON DELETE RESTRICT'),
      ('contact_sources', 'contact_sources_default_channel_id_fkey', 'FOREIGN KEY (contact_sources_default_channel_id) REFERENCES public.channels(channels_id)'),
      ('contact_sources', 'contact_sources_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id)'),
      ('contact_sources', 'contact_sources_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id)'),
      ('import_rules', 'import_rules_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('import_rules', 'import_rules_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('instances', 'instances_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('instances', 'instances_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('lead_validation_attempts', 'lead_validation_attempts_channels_id_fkey', 'FOREIGN KEY (channels_id) REFERENCES public.channels(channels_id) ON DELETE RESTRICT'),
      ('lead_validation_attempts', 'lead_validation_attempts_chips_id_fkey', 'FOREIGN KEY (chips_id) REFERENCES public.chips(chips_id) ON DELETE SET NULL'),
      ('lead_validation_attempts', 'lead_validation_attempts_leads_id_fkey', 'FOREIGN KEY (leads_id) REFERENCES public.leads(leads_id) ON DELETE SET NULL'),
      ('lead_validation_attempts', 'lead_validation_attempts_queue_items_id_fkey', 'FOREIGN KEY (queue_items_id) REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL'),
      ('lead_validation_attempts', 'lead_validation_attempts_result_id_fkey', 'FOREIGN KEY (lead_validation_results_id) REFERENCES public.lead_validation_results(lead_validation_results_id) ON DELETE RESTRICT'),
      ('lead_validation_attempts', 'lead_validation_attempts_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('lead_validation_attempts', 'lead_validation_attempts_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('lead_validation_attempts', 'lead_validation_attempts_validation_rules_id_fkey', 'FOREIGN KEY (validation_rules_id) REFERENCES public.validation_rules(validation_rules_id) ON DELETE SET NULL'),
      ('lead_validation_results', 'lead_validation_results_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('leads', 'leads_apify_import_jobs_id_fkey', 'FOREIGN KEY (apify_import_jobs_id) REFERENCES public.apify_import_jobs(apify_import_jobs_id) ON DELETE SET NULL'),
      ('leads', 'leads_branches_id_fkey', 'FOREIGN KEY (branches_id) REFERENCES public.branches(branches_id) ON DELETE SET NULL'),
      ('leads', 'leads_channels_id_fkey', 'FOREIGN KEY (channels_id) REFERENCES public.channels(channels_id) ON DELETE RESTRICT'),
      ('leads', 'leads_cities_id_fkey', 'FOREIGN KEY (cities_id) REFERENCES public.cities(cities_id) ON DELETE SET NULL'),
      ('leads', 'leads_contact_sources_id_fkey', 'FOREIGN KEY (contact_sources_id) REFERENCES public.contact_sources(contact_sources_id)'),
      ('leads', 'leads_countries_id_fkey', 'FOREIGN KEY (countries_id) REFERENCES public.countries(countries_id) ON DELETE SET NULL'),
      ('leads', 'leads_lead_status_id_fkey', 'FOREIGN KEY (lead_status_id) REFERENCES public.lead_status(lead_status_id) ON DELETE RESTRICT'),
      ('leads', 'leads_states_id_fkey', 'FOREIGN KEY (states_id) REFERENCES public.states(states_id) ON DELETE SET NULL'),
      ('leads', 'leads_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('levels', 'levels_channels_id_fkey', 'FOREIGN KEY (channels_id) REFERENCES public.channels(channels_id) ON DELETE RESTRICT'),
      ('levels', 'levels_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('levels', 'levels_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('queue_items', 'queue_items_chips_id_fkey', 'FOREIGN KEY (chips_id) REFERENCES public.chips(chips_id) ON DELETE SET NULL'),
      ('queue_items', 'queue_items_leads_id_fkey', 'FOREIGN KEY (leads_id) REFERENCES public.leads(leads_id) ON DELETE CASCADE'),
      ('queue_items', 'queue_items_queues_id_fkey', 'FOREIGN KEY (queues_id) REFERENCES public.queues(queues_id) ON DELETE CASCADE'),
      ('queue_items', 'queue_items_socials_id_fkey', 'FOREIGN KEY (socials_id) REFERENCES public.socials(socials_id) ON DELETE SET NULL'),
      ('queue_items', 'queue_items_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('queue_items', 'queue_items_templates_id_fkey', 'FOREIGN KEY (templates_id) REFERENCES public.templates(templates_id) ON DELETE SET NULL'),
      ('queue_items', 'queue_items_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('queues', 'queues_channels_id_fkey', 'FOREIGN KEY (channels_id) REFERENCES public.channels(channels_id) ON DELETE RESTRICT'),
      ('queues', 'queues_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('queues', 'queues_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('sents', 'sents_channels_id_fkey', 'FOREIGN KEY (channels_id) REFERENCES public.channels(channels_id) ON DELETE SET NULL'),
      ('sents', 'sents_chips_id_fkey', 'FOREIGN KEY (chips_id) REFERENCES public.chips(chips_id) ON DELETE SET NULL'),
      ('sents', 'sents_leads_id_fkey', 'FOREIGN KEY (leads_id) REFERENCES public.leads(leads_id) ON DELETE SET NULL'),
      ('sents', 'sents_queue_items_id_fkey', 'FOREIGN KEY (queue_items_id) REFERENCES public.queue_items(queue_items_id) ON DELETE SET NULL'),
      ('sents', 'sents_socials_id_fkey', 'FOREIGN KEY (socials_id) REFERENCES public.socials(socials_id) ON DELETE SET NULL'),
      ('sents', 'sents_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('sents', 'sents_templates_id_fkey', 'FOREIGN KEY (templates_id) REFERENCES public.templates(templates_id) ON DELETE SET NULL'),
      ('sents', 'sents_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('socials', 'socials_levels_id_fkey', 'FOREIGN KEY (levels_id) REFERENCES public.levels(levels_id) ON DELETE RESTRICT'),
      ('socials', 'socials_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('socials', 'socials_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('states', 'states_countries_id_fkey', 'FOREIGN KEY (countries_id) REFERENCES public.countries(countries_id) ON DELETE RESTRICT'),
      ('template_channels', 'template_type_status_fk', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id)'),
      ('template_channels', 'template_type_users_fk', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id)'),
      ('template_types', 'template_types_status_fk', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id)'),
      ('template_types', 'template_types_users_fk', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id)'),
      ('template_variables', 'template_variables_status_fk', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id)'),
      ('template_variables', 'template_variables_users_fk', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id)'),
      ('templates', 'templates_branches_id_fkey', 'FOREIGN KEY (branches_id) REFERENCES public.branches(branches_id) ON DELETE SET NULL'),
      ('templates', 'templates_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('templates', 'templates_template_type_fk', 'FOREIGN KEY (template_channels_id) REFERENCES public.template_channels(template_channels_id)'),
      ('templates', 'templates_template_types_fk', 'FOREIGN KEY (template_types_id) REFERENCES public.template_types(template_types_id)'),
      ('templates', 'templates_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE'),
      ('users', 'users_auth_user_id_fkey', 'FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('users', 'users_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('validation_rules', 'validation_rules_channel_id_fkey', 'FOREIGN KEY (validation_rules_channel_id) REFERENCES public.channels(channels_id) ON DELETE RESTRICT'),
      ('validation_rules', 'validation_rules_fallback_channel_id_fkey', 'FOREIGN KEY (validation_rules_fallback_channel_id) REFERENCES public.channels(channels_id) ON DELETE RESTRICT'),
      ('validation_rules', 'validation_rules_source_id_fkey', 'FOREIGN KEY (validation_rules_source_id) REFERENCES public.contact_sources(contact_sources_id) ON DELETE RESTRICT'),
      ('validation_rules', 'validation_rules_status_id_fkey', 'FOREIGN KEY (status_id) REFERENCES public.status(status_id) ON DELETE RESTRICT'),
      ('validation_rules', 'validation_rules_users_id_fkey', 'FOREIGN KEY (users_id) REFERENCES public.users(users_id) ON DELETE CASCADE')
    ) AS expected(table_name, constraint_name, definition)
  LOOP
    SELECT pg_get_constraintdef(c.oid)
      INTO existing_definition
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public'
       AND c.conrelid = format('public.%I', fk.table_name)::regclass
       AND c.conname = fk.constraint_name;

    IF existing_definition IS NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I %s',
        fk.table_name,
        fk.constraint_name,
        fk.definition
      );
    ELSE
      normalized_existing := upper(regexp_replace(replace(existing_definition, 'public.', ''), '\s+', ' ', 'g'));
      normalized_expected := upper(regexp_replace(replace(fk.definition, 'public.', ''), '\s+', ' ', 'g'));

      IF normalized_existing <> normalized_expected THEN
        RAISE EXCEPTION
          'Constraint public.%.% already exists with a definition different from the canonical catalog: %',
          fk.table_name,
          fk.constraint_name,
          existing_definition;
      END IF;
    END IF;
  END LOOP;
END
$migration$;

COMMIT;
