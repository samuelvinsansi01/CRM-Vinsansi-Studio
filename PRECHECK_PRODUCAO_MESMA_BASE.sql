-- Painel CRM 3.73.1 — pré-checagem somente leitura para a base atual.
-- Execute no SQL Editor do Supabase. Este arquivo não altera dados nem schema.
BEGIN TRANSACTION READ ONLY;

-- 1) Tabelas obrigatórias. Resultado esperado: nenhuma linha.
WITH required(table_name) AS (
  VALUES
    ('users'), ('leads'), ('queues'), ('queue_items'), ('chips'), ('instances'),
    ('levels'), ('socials'), ('templates'), ('branches'), ('status'),
    ('lead_status'), ('channels'), ('sents'), ('apify_accounts'),
    ('apify_import_jobs'), ('import_rules'), ('validation_rules')
)
SELECT r.table_name AS missing_table
FROM required r
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = r.table_name
WHERE t.table_name IS NULL
ORDER BY r.table_name;

-- 2) Colunas críticas. Resultado esperado: nenhuma linha.
WITH required(table_name, column_name) AS (
  VALUES
    ('users','users_id'), ('users','auth_user_id'),
    ('leads','leads_id'), ('leads','users_id'), ('leads','lead_status_id'),
    ('leads','channels_id'), ('leads','branches_id'), ('leads','leads_instagram'),
    ('queues','queues_id'), ('queues','users_id'), ('queues','channels_id'),
    ('queue_items','queue_items_id'), ('queue_items','users_id'),
    ('queue_items','queues_id'), ('queue_items','leads_id'),
    ('queue_items','templates_id'), ('queue_items','status_id'),
    ('queue_items','queue_items_position'), ('queue_items','queue_items_scheduled_at'),
    ('chips','chips_id'), ('chips','users_id'), ('chips','instances_id'), ('chips','levels_id'),
    ('socials','socials_id'), ('socials','users_id'), ('socials','levels_id'),
    ('templates','templates_id'), ('templates','users_id'),
    ('templates','templates_message_1'), ('templates','templates_message_2'),
    ('templates','templates_message_3'), ('templates','templates_message_4')
)
SELECT r.table_name, r.column_name AS missing_column
FROM required r
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = r.table_name
 AND c.column_name = r.column_name
WHERE c.column_name IS NULL
ORDER BY r.table_name, r.column_name;

-- 3) Catálogos canônicos. Confira IDs e nomes antes do corte.
SELECT 'status' AS catalog, status_id::text AS id, status_name AS name
FROM public.status
UNION ALL
SELECT 'lead_status', lead_status_id::text, lead_status_name
FROM public.lead_status
UNION ALL
SELECT 'channels', channels_id::text, channels_name
FROM public.channels
ORDER BY catalog, id;

-- 4) RLS e quantidade de policies. rls_enabled deve ser true nas tabelas por usuário.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  COUNT(p.policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
WHERE c.relkind = 'r'
  AND c.relname IN (
    'users','leads','queues','queue_items','chips','instances','levels','socials',
    'templates','branches','sents','apify_accounts','apify_import_jobs',
    'import_rules','validation_rules'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

-- 5) Itens operacionais abertos. Faça o corte apenas sem itens em processamento.
SELECT
  qi.status_id,
  s.status_name,
  COUNT(*) AS items
FROM public.queue_items qi
LEFT JOIN public.status s ON s.status_id = qi.status_id
WHERE qi.status_id IN (3, 4, 8)
GROUP BY qi.status_id, s.status_name
ORDER BY qi.status_id;

COMMIT;
