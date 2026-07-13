# V3.39.27

- Corrige `permission denied for sequence branches_id_seq` ao cadastrar ramos.
- Adiciona migration idempotente concedendo `USAGE` e `SELECT` na sequência para `authenticated` e `service_role`.
- Não altera regras, dados ou interface do módulo de Ramos.
