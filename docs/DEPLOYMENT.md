# Implantação

## Ordem obrigatória

1. Pausar importações e disparos.
2. Confirmar backup.
3. Executar somente a migration nova no Supabase.
4. Publicar Edge Functions alteradas, quando houver.
5. Publicar o ZIP cumulativo do Painel.
6. Atualizar Worker e extensão pela página Ferramentas.
7. Executar testes controlados.
8. Retomar gradualmente.

## Novo ambiente

Use `supabase/baseline/bootstrap_full.sql` somente em projeto Supabase novo e vazio. Depois configure secrets, Edge Functions, Storage e autenticação.

## Verificações

```bash
npm ci
npm run verify:all
npm run build
```

No banco:

```sql
select public.platform_schema_health();
```
