# V3.39.29

- Corrige o cadastro de novos ramos após o refactor de `branches.id` para `bigint`.
- A coluna auxiliar `legacy_text_before_bigint` deixa de ser `NOT NULL`.
- Mantém os valores legados existentes e permite que novos registros sejam criados com `NULL` nessa coluna.
- Inclui migration idempotente para execução no Supabase.
