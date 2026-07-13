# V3.39.21

- Corrige o erro `cannot insert a non-DEFAULT value into column "normalized_phone"`.
- A coluna `leads.normalized_phone` é gerada pelo PostgreSQL e não recebe mais valor explícito em INSERT/UPDATE.
- A deduplicação continua usando o telefone normalizado em memória antes da gravação.
- As regras de ramo, Base Permanente, nota, avaliações e rota Instagram não foram alteradas.
