CRM - VINSANSI STUDIO R59 BUILD FIX 39

ESCOPO DESTA ENTREGA
- O estágio comercial canônico final passa de "Fechado" para "Aprovado".
- Fluxo canônico: Aguardando resposta -> Aguardando prévia -> Prévia enviada -> Aprovado / Recusado.
- Clientes antigos que ainda enviarem "fechado" são normalizados para "aprovado"; o banco não persiste mais "fechado".
- Aprovado continua sendo o gatilho para criar o projeto 1:1 vinculado ao mesmo leads_id.
- Conversas e Dashboard usam Aprovado como nome e contrato canônico.
- O webhook Evolution descarta tráfego entre chips pertencentes à própria organização antes de evolution_webhook_receipts e antes do ingest de Conversas.
- Portanto o conteúdo dessas interações internas não entra em evolution_webhook_receipts, conversations ou conversation_messages.
- Nenhuma tabela de aquecimento foi criada no banco.

ORDEM DE ATUALIZAÇÃO
1. Aplicar: APLICAR - CRM R59 BUILD FIX 39 - Aprovado e trafego interno entre chips.sql
2. Publicar o CRM R59 BUILD FIX 39.
3. Publicar/atualizar a Supabase Edge Function evolution-connection-webhook deste pacote. Esta etapa é necessária para o filtro de tráfego interno funcionar.
4. Depois instalar o Gerenciador 1.5.35 / Worker 3.14.0.

IMPORTANTE
- Não é necessário alterar o WhatsApp Gateway 1.2.14.
- Não reaplique FIX36/FIX37/FIX38 se eles já foram aplicados.
- O alias JSON "fechado" existe apenas para compatibilidade de clientes antigos; a fonte canônica é "aprovado".
