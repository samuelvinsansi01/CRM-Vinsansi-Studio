# V3.39.32

- Corrige a limpeza dos leads recusados antigos quando o banco possui o trigger `prevent_hard_delete_leads()`.
- A migration habilita `app.allow_hard_delete_leads = on` somente durante a própria transação.
- A proteção contra DELETE físico volta automaticamente após `COMMIT` ou `ROLLBACK`.
- Remove dependências em `lead_imports` e `lead_registry` antes de excluir os recusados.
