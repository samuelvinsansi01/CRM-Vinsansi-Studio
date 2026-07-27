# Fluxo 1 — Contadores exclusivos do Início

Os cards do Início agora formam categorias exclusivas. Cada lead com `lead_status_id = 1` (Importado) entra em exatamente um dos quatro cards operacionais, por esta prioridade:

1. Instagram: `contact_sources_id = 4` (Instagram) ou Instagram preenchido.
2. Agregadores: `contact_sources_id = 3` (Agregador).
3. Com site: `contact_sources_id = 2` (Domínio próprio).
4. WhatsApp: `contact_sources_id = 1` (Sem site) ou fallback operacional.

Assim:

`Total = WhatsApp + Com site + Agregadores + Instagram`

A página Válidos continua contando canal de disparo:

- `channels_id = 1` → WhatsApp
- `channels_id = 2` → Instagram
