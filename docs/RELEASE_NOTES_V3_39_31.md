# V3.39.31 — Recusados somente na sessão

- Recusados continuam visíveis na prévia atual, mas não são gravados em `leads`.
- Recusados e duplicados não são gravados em `lead_imports` nem em `lead_registry`.
- O JSON bruto não é mais armazenado em `import_batches.raw_metadata`.
- Apenas leads `approved` e `pending` são persistidos.
- Registros recusados antigos deixam de participar da deduplicação, permitindo reprocessar o mesmo JSON após mudanças em ramos e sub-ramos.
- Inclui migration opcional para limpar recusados e payloads brutos antigos do banco.
