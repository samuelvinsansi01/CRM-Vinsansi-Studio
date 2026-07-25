# Lead Certo CRM V3.39.30

- Corrige o cadastro de novos ramos após a migração de `branches.id` para bigint.
- As colunas auxiliares `uuid_before_bigint` e `legacy_text_before_bigint` passam a aceitar `NULL`.
- Mantém todos os valores legados existentes e não altera IDs atuais.
- Atualiza também o script `branch_bigint_refactor.sql` para evitar que a restrição seja recriada em novas instalações.
