# V3.39.17

- Corrige a perda do limite diário digitado ao editar perfis Instagram.
- `rowToInstagramProfile` passa a aceitar `dailyLimit` em camelCase durante a normalização do formulário, além de `daily_limit` vindo do Supabase.
- Remove o fallback indevido para 60 antes do UPDATE.
- Não altera blocos, tamanho de bloco, intervalos ou regras de fila.
