BEGIN;

-- Etapa 5: atualização instantânea das conversas no Gerenciador desktop.
-- A aplicação escuta apenas conversas e mensagens; presença de membros continua
-- no heartbeat próprio para não criar loops de atualização.
GRANT SELECT ON public.conversations, public.conversation_messages TO authenticated;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_messages REPLICA IDENTITY FULL;

DO $realtime$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    EXECUTE 'CREATE PUBLICATION supabase_realtime';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversation_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages';
  END IF;
END
$realtime$;

COMMIT;
