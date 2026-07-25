# V3.39.28

- Reforça a correção de `permission denied for sequence branches_id_seq`.
- Concede `USAGE`, `SELECT` e `UPDATE` na sequence para `anon`, `authenticated` e `service_role`.
- Garante `USAGE` no schema `public`.
- Configura privilégios padrão para novas sequences.
- Inclui consulta de verificação de privilégios ao final da migration.

A migration precisa ser executada no SQL Editor do mesmo projeto Supabase utilizado pelo CRM.
