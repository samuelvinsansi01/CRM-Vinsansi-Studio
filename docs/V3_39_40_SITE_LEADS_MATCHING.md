# V3.39.40 — Correspondência de leads com site

- Corrige o endpoint da extensão lateral para localizar URLs salvas em `website`, `site`, `website_url`, `site_url`, `data`, `crm_data` e `raw_payload`.
- Reconhece variações de destino `Com site`, `com-site`, `website` e `site`, inclusive em `original_destination`.
- Compara URL normalizada e domínio, removendo duplicações do mesmo lead antes de classificar como ambíguo.
- Nenhum arquivo do módulo de Templates foi alterado.
