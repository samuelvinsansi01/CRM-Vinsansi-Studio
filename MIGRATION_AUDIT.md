# Auditoria de dependências do banco normalizado

## Corrigido nesta versão

- Tela Início não consulta mais `whatsapp_queue_items`, `instagram_queue_items` ou `pre_send_leads` para carregar leads.
- A listagem da Início usa somente os leads nos grupos de status `pending` e `approved`, mapeados para os status oficiais do banco normalizado.
- A etapa do funil é determinada por `leads.lead_status_id`.

## Telas verificadas

- Início: corrigida para `leads`.
- Importação: repository já direcionado para `leads`.
- Base: repository normalizado sobre `leads`.
- Pré-envio: repository normalizado sobre `leads`.
- Filas WhatsApp: ainda depende de `whatsapp_queue_items`.
- Filas Instagram: ainda depende de `instagram_queue_items`.
- Configuração operacional: ainda contém rotina que consulta as duas tabelas antigas de fila.

## Regra

Não criar novamente tabelas legadas. A migração das filas deve usar as tabelas reais do banco novo e os status oficiais, especialmente `na_fila` (4) e `enviado` (5).
