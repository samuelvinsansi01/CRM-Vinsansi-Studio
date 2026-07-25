# V3.37 - Templates com 4 partes fixas

## Objetivo

Evoluir o contrato de mensagens do CRM para 4 campos fixos de texto e 1 imagem final:

1. `message_1`
2. `message_2`
3. `message_3`
4. `message_4`
5. imagem do ramo, quando obrigatória

## Banco

Executar a migration:

```sql
supabase/migration_v3_37_four_message_templates.sql
```

Ela adiciona:

- `templates.part_3`
- `templates.part_4`
- `whatsapp_queue_items.message_3`
- `whatsapp_queue_items.message_4`
- `instagram_queue_items.message_3`
- `instagram_queue_items.message_4`

## Compatibilidade

Itens antigos com apenas `message_1` e `message_2` continuam funcionando. Os campos 3 e 4 podem ficar vazios em registros legados.

## Painel

A tela de Templates agora mostra e salva Mensagem 1, Mensagem 2, Mensagem 3 e Mensagem 4. As filas WhatsApp e Instagram também exibem/editam as 4 mensagens congeladas.

## Worker WhatsApp

O Worker envia todas as partes de texto preenchidas em sequência. A imagem continua como etapa final.

Novas variáveis recomendadas:

```env
DELAY_BETWEEN_TEXT_MESSAGES_SECONDS=10
DELAY_TEXT_TO_IMAGE_SECONDS=5
TYPING_PRESENCE_ENABLED=true
```

As variáveis antigas `DELAY_MSG1_TO_MSG2_SECONDS` e `DELAY_MSG2_TO_IMAGE_SECONDS` seguem funcionando como fallback.

## Extensão Instagram

A extensão passa a carregar e enviar `message_1`, `message_2`, `message_3` e `message_4`, com delay entre as mensagens e imagem final.
