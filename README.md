# Painel CRM operacional

Plataforma de prospecção B2B local, qualificação, deduplicação, roteamento e execução multicanal.

## Fluxo canônico

Apify/Google Maps → importação → normalização → qualificação → deduplicação → roteamento → validação → fila → execução → histórico → Base Permanente.

## Componentes

- Painel React/Vite.
- Supabase/PostgreSQL, RLS, Vault e Edge Functions.
- Worker WhatsApp distribuído na página Ferramentas.
- Extensão Instagram distribuída na página Ferramentas.

## Verificação

```bash
npm ci
npm run verify:all
npm run build
```

Consulte `docs/` antes de implantar, recuperar ou publicar uma release.
