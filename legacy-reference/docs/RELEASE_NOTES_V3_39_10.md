# V3.39.10

- Remove a dependência da RPC sobrecarregada `save_instagram_profile_config`.
- Usa a nova RPC de assinatura única `save_instagram_profile_config_v2`.
- Persiste `daily_limit` e `data.dailyLimit` na mesma transação.
- Valida o usuário autenticado e o valor retornado pelo banco.
- Não envia nem altera `blocks`, `block_size` ou `interval_minutes`.
