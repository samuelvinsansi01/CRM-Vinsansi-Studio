BEGIN;
-- Executar SOMENTE após 02_PRECHECK. Deliberadamente sem CASCADE.
DELETE FROM public.conversation_presence;
DELETE FROM public.conversation_member_states;
DELETE FROM public.conversation_contact_aliases;
DELETE FROM public.conversation_messages;
DELETE FROM public.conversations;
DELETE FROM public.evolution_webhook_receipts;
COMMIT;
