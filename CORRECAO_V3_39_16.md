# V3.39.16 — persistência direta do limite Instagram

- Remove a RPC `set_instagram_profile_daily_limit_v4` do fluxo do frontend.
- Remove a gravação em duas etapas que atualizava metadados antes do limite.
- Executa uma única operação atômica na tabela `instagram_profiles`.
- Grava simultaneamente `daily_limit` e `data.dailyLimit` com o valor digitado.
- Filtra por `id` e `user_id` autenticado.
- Usa o registro retornado pelo próprio UPDATE para validar a persistência.
- Não altera `blocks`, `block_size` ou `interval_minutes`.
- Não exige migration nova.
