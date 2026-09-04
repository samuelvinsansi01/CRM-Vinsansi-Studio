CRM R59 BUILD FIX 49

Objetivo
- corrigir erro PostgreSQL: column reference "conversations_id" is ambiguous;
- preservar o mesmo fluxo de envio e idempotência;
- não alterar Gateway, Worker, webhook, QR ou inbound.

Aplicação
1. Aplique somente o SQL FIX49 no Supabase.
2. Não é necessário republicar frontend/Edge Function para esta correção.
3. Teste envio pelo CRM e pelo Gerenciador.

Causa
service_prepare_outgoing_chat_message é RETURNS TABLE e possui um output chamado conversations_id.
A consulta interna usava conversations_id sem alias, criando conflito entre a variável de saída PL/pgSQL e a coluna da tabela.
