# Correção V3.39.24

- Domínios de encurtadores compartilhados, como `tinyurl.com`, deixam de ser usados como identidade única de site.
- Links encurtados continuam preservados no campo original do lead, mas não participam da deduplicação por domínio nem do `lead_registry`.
- `tinyurl.com` e outros encurtadores passam a ser classificados como links externos, não como site comercial próprio.
- Nenhuma regra de ramo, telefone, nota, reviews ou destino foi alterada.
