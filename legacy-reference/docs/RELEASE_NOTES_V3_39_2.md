# V3.39.2 — Limite diário Instagram persistido ponta a ponta

- O limite diário do perfil passa a ser salvo em `instagram_profiles.daily_limit`.
- O mesmo valor é mantido em `data.dailyLimit` para compatibilidade com bases legadas.
- Após criar/editar, o sistema relê o registro diretamente do banco e só confirma sucesso quando o valor gravado coincide com o informado.
- Foi adicionada migration idempotente para criar/corrigir a coluna, preencher registros antigos, impor valor mínimo e recarregar o cache do PostgREST.
- Pré-Envio e fila continuam consumindo `profile.dailyLimit` dos perfis ativos.
