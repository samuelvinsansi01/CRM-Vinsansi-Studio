DO $$
DECLARE
  missing text[]:=ARRAY[]::text[];
  unexpected_fks text[]:=ARRAY[]::text[];
  unexpected_triggers text[]:=ARRAY[]::text[];
  table_name text;
  function_name text;
  required_column record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations','organization_members','users','leads','branches','countries','states','cities','contact_sources','channels',
    'chips','instances','instance_credentials','instance_runtime_states','queues','queue_items','queue_item_dispatch_parts','templates','sents',
    'worker_batches','worker_batch_items','recovery_requests','platform_runtime_heartbeats','organization_tool_installations',
    'conversations','conversation_messages','conversation_contact_aliases','conversation_member_states','conversation_presence','evolution_webhook_receipts',
    'tool_executor_pairings','tool_browser_pairings','tool_installation_credentials','tool_user_sessions'
  ] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN missing:=array_append(missing,'table:'||table_name); END IF;
  END LOOP;

  FOR required_column IN SELECT * FROM (VALUES
    ('organizations','organizations_id'),('organizations','legacy_scope_users_id'),('users','auth_user_id'),
    ('organization_members','organization_members_id'),('organization_members','organizations_id'),('organization_members','users_id'),
    ('conversations','conversations_id'),('conversations','organizations_id'),('conversations','chips_id'),('conversations','instances_id'),('conversations','remote_jid'),('conversations','conversation_version'),
    ('conversation_messages','conversation_messages_id'),('conversation_messages','organizations_id'),('conversation_messages','instances_id'),('conversation_messages','external_message_id'),('conversation_messages','message_status'),
    ('queue_items','queue_items_id'),('queue_items','organizations_id'),('queue_items','queue_items_payload_snapshot'),('queue_items','queue_items_attempts'),
    ('queue_item_dispatch_parts','queue_item_dispatch_parts_id'),('queue_item_dispatch_parts','queue_items_id'),('queue_item_dispatch_parts','queue_item_dispatch_parts_key'),('queue_item_dispatch_parts','queue_item_dispatch_parts_content_hash'),
    ('instances','instances_id'),('instances','organizations_id'),('instance_credentials','instances_id'),('instance_credentials','vault_secret_id'),
    ('organization_tool_installations','organization_tool_installations_id'),('organization_tool_installations','external_installation_id')
  ) AS v(rel,col) LOOP
    IF to_regclass('public.'||required_column.rel) IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM pg_attribute a WHERE a.attrelid=('public.'||required_column.rel)::regclass AND a.attname=required_column.col AND a.attnum>0 AND NOT a.attisdropped
    ) THEN missing:=array_append(missing,'column:'||required_column.rel||'.'||required_column.col); END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'current_organization_id','current_organization_member_id','auth_user_has_organization_permission','has_organization_permission',
    'chat_message_status_rank','effective_whatsapp_phone','service_get_evolution_instances','service_runtime_heartbeat','refresh_operational_alerts',
    'service_claim_recovery_request','service_complete_recovery_request','instagram_recover_stale_items_v2'
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=function_name) THEN
      missing:=array_append(missing,'function:'||function_name);
    END IF;
  END LOOP;

  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('conversations','conversation_messages') AND NOT c.relrowsecurity) THEN
    missing:=array_append(missing,'rls:messaging_baseline_disabled');
  END IF;

  SELECT coalesce(array_agg(source.relname||'.'||c.conname||'->'||target.relname ORDER BY source.relname,c.conname),ARRAY[]::text[]) INTO unexpected_fks
  FROM pg_constraint c
  JOIN pg_class target ON target.oid=c.confrelid JOIN pg_namespace n ON n.oid=target.relnamespace JOIN pg_class source ON source.oid=c.conrelid
  WHERE c.contype='f' AND n.nspname='public'
    AND target.relname IN('conversation_presence','conversation_member_states','conversation_contact_aliases','conversation_messages','conversations','evolution_webhook_receipts')
    AND source.relname NOT IN('conversation_presence','conversation_member_states','conversation_contact_aliases','conversation_messages','conversations','evolution_webhook_receipts');

  SELECT coalesce(array_agg(t.relname||'.'||g.tgname ORDER BY t.relname,g.tgname),ARRAY[]::text[]) INTO unexpected_triggers
  FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname IN('conversations','conversation_messages','evolution_webhook_receipts') AND NOT g.tgisinternal
    AND g.tgname NOT IN('apply_organization_scope_conversations','validate_conversations_member_scope','apply_organization_scope_conversation_messages','validate_conversation_messages_member_scope','apply_organization_scope_evolution_webhook_receipts');

  IF array_length(missing,1) IS NOT NULL OR array_length(unexpected_fks,1) IS NOT NULL OR array_length(unexpected_triggers,1) IS NOT NULL THEN
    RAISE EXCEPTION 'r60_precheck_failed:%',jsonb_build_object('missing',missing,'unexpectedForeignKeys',unexpected_fks,'unexpectedTriggers',unexpected_triggers)::text;
  END IF;
END $$;
