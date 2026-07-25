# V3.39.6 — limite diário Instagram com persistência direta

- Remove a segunda gravação por RPC do limite diário.
- Usa uma única operação atômica na tabela Instagram configurada pelo ambiente.
- Não altera `user_id` durante a edição de um perfil existente.
- Confirma o valor pelo próprio registro retornado pelo Supabase.
- Mantém `daily_limit` e `data.dailyLimit` no mesmo payload.
- Inclui migration mínima para garantir a coluna e remover as RPCs antigas.
