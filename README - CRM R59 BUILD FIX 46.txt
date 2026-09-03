CRM R59 BUILD FIX 46

Correção crítica do webhook de entrada WhatsApp.

- Corrige uso incorreto de Set.includes() no classificador de mensagens de aquecimento.
- MESSAGE_EVENTS agora usa Set.has().
- O classificador de aquecimento passa a operar em fail-open: qualquer erro de classificação não bloqueia uma mensagem normal.
- Mensagens normais seguem para evolution_webhook_receipts, service_ingest_evolution_message e Conversas.
- Não há alteração de banco nesta versão.

Após publicar o CRM, é obrigatório republicar:
supabase/functions/evolution-connection-webhook/index.ts
