# V3.30 — Correção do preflight de validação

- Corrige a referência interna da coleta de instâncias usada pelo preflight de validação.
- A rotina agora chama explicitamente `preflightValidationInstances` antes de consultar o Worker.
- Em qualquer falha de preflight, a validação continua fail-closed: nenhum lead é alterado.
