# V3.39.25 — Encurtadores removidos de toda deduplicação por site

- Corrige o caso `duplicate_identity:site:bit.ly`.
- Normaliza com `normalizeSiteIdentity` os sites existentes, Base Permanente e `sent_contacts`.
- Remove encurtadores também dos mapas usados pela reimportação inteligente.
- Impede gravação de `bit.ly`, `tinyurl.com` e equivalentes no `lead_registry`, mesmo quando `normalizedSite` legado já contém o domínio.
- Mantém o link original no cadastro do lead; apenas deixa de usá-lo como identidade única.

- Na tabela `leads`, a coluna `website` fica vazia para encurtadores; o link original permanece em `data`, `crm_data` e `raw_payload`, sendo recuperado normalmente pela interface. Isso neutraliza triggers legados do banco que ainda geravam `duplicate_identity`.
