# V3.39.41

- Leads de Instagram por exceção de nota/reviews entram como `pending`.
- WhatsApp inválido é movido para Instagram sem aprovação automática.
- Retornos de WhatsApp inválido permanecem em revisão/Em aguarde e não entram automaticamente na fila Instagram.
- O registro original em `leads` também é atualizado para `pending`.
- Migration para corrigir registros existentes incluída.
- Módulo de templates e contrato de quatro mensagens não foram alterados.
