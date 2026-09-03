CRM R59 BUILD FIX 48

Objetivo
- reconciliar automaticamente conversas após novo QR/reconexão;
- convergir JID/LID/telefone para uma única thread canônica;
- remover nomes de contato contaminados pelo pushName do próprio chip;
- limpar erro antigo chip_disconnected quando a instância já voltou a ficar conectada.

Aplicação
1. Aplique o SQL FIX48.
2. Publique o CRM.
3. Republique supabase/functions/evolution-connection-webhook/index.ts.
4. Atualize o Gerenciador para 1.5.41.

Não altera Gateway 1.2.16 nem Worker 3.14.2.
