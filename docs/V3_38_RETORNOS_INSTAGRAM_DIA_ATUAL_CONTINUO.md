# V3.38 - Retornos WhatsApp inválido sempre no dia atual do Pré-Envio Instagram

## Correção

Leads que foram invalidados na validação do WhatsApp e redirecionados para Instagram continuam em revisão no Pré-Envio até serem aprovados para fila, invalidados ou arquivados.

Antes, esses retornos podiam ficar presos no card Instagram de um dia anterior. Agora, ao carregar o Pré-Envio, o CRM normaliza esses retornos para o dia operacional atual do Instagram.

## Escopo da normalização

A rotina afeta somente leads com:

- `channel = Instagram`
- `status = review`
- `send_instagram = true`
- `instagram_override_reason` contendo `whatsapp_invalid`

Não altera leads já aprovados, enfileirados, enviados, arquivados ou invalidados.

## Banco

Foi adicionada a migration opcional:

`supabase/migration_v3_38_pre_send_instagram_returns_current_day.sql`

Ela corrige imediatamente os registros antigos já existentes no banco. O código novo também faz essa correção automaticamente quando o Pré-Envio é carregado.
