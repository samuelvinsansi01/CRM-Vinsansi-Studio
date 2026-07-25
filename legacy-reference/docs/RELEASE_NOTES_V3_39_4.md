# V3.39.4

- Corrige a assinatura da RPC de limite diário do Instagram.
- `instagram_profiles.id` é `text`; a V3.39.3 recebia `uuid`.
- Remove a função incompatível e cria `save_instagram_profile_daily_limit(text, integer)`.
- Mantém validação por usuário, sincronização de `daily_limit`/`data.dailyLimit` e confirmação posterior pelo painel.
