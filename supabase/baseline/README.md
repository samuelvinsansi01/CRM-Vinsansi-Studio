# Baseline reproduzível do banco

Esta pasta contém uma reconstrução cumulativa do schema público da plataforma.

## Arquivos

- `source/estrutura_banco_novo.sql`: fotografia estrutural recebida do banco novo, mantida como fonte auditável.
- `00000000000000_base_public_schema.sql`: schema público inicial sanitizado.
- `bootstrap_full.sql`: base inicial seguida de todas as migrations, em ordem.
- `manifest.json`: ordem, quantidade e SHA-256 do bootstrap.

## Novo ambiente

Use somente em um projeto Supabase novo e vazio:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/bootstrap_full.sql
```

Depois publique as Edge Functions, configure os secrets e valide:

```sql
select public.platform_schema_health();
```

## Ambiente existente

Nunca execute `bootstrap_full.sql` em produção ou homologação já criada. Em ambientes existentes, aplique apenas a migration nova da etapa correspondente.
