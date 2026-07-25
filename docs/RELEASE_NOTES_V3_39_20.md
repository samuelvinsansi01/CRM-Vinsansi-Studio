# V3.39.20

- Corrige falha `leads_user_normalized_phone_unique` durante a importação.
- Duplicidades continuam identificadas e registradas em `lead_imports`, mas não são reinseridas na tabela operacional `leads`.
- A gravação dos novos leads passa a ser feita em lote, evitando importações parcialmente concluídas.
- `normalized_phone` passa a ser enviado explicitamente no payload do lead.
- Regras de ramo, Base Permanente, sent_contacts, nota, avaliações e exceção Instagram permanecem inalteradas.
