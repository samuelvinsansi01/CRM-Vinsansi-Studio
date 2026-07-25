# V3.31 — Preflight de validação

- Remove a dependência da função `preflightValidationInstances` no runtime serverless.
- A lista de instâncias é construída dentro do próprio preflight.
- Mantém o comportamento fail-closed: em falha de Worker/Evolution, nenhum lead é alterado.
