# V3.39.39 — Extensão lateral para validação de leads com site

- Nova rota serverless autenticada por `SITE_LEADS_EXTENSION_SECRET`: `/api/site-leads`.
- Aprovação e invalidação em massa por URL de site.
- Correspondência por URL normalizada e fallback seguro por domínio único.
- Nova extensão Chrome Manifest V3 com Side Panel.
- Abas Aprovar e Invalidar com textos independentes persistidos em `chrome.storage.local`.
- A ação limpa somente o campo da aba executada após sucesso.
- Nenhum arquivo, schema ou mapeamento do módulo de templates foi alterado.
