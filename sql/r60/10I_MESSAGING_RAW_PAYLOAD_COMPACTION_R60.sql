-- VINSANSI R60.26 — conversation_messages sem armazenamento de payload bruto do provider
-- A identidade necessária para transporte já é materializada em whatsapp_contacts / whatsapp_contact_aliases.
-- O webhook continua usando o payload mínimo apenas durante a resolução da identidade e persiste raw_payload = {}.
BEGIN;

-- Limpeza one-shot do histórico. Nenhum fluxo R60 lê raw_payload persistido para renderização,
-- dedupe, resposta manual, status ou resolução de recipient.
UPDATE public.conversation_messages
SET raw_payload='{}'::jsonb,
    conversation_messages_updated_at=now()
WHERE raw_payload IS DISTINCT FROM '{}'::jsonb;

COMMIT;
