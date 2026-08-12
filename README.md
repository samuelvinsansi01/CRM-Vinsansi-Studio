# Painel CRM operacional

Plataforma de prospecção B2B local, qualificação, deduplicação, roteamento e execução multicanal.

## Fluxo canônico

Cadastro manual ou extensão Google Maps → importação → normalização → qualificação → deduplicação → roteamento → validação → fila → execução → histórico → Base Permanente.

Os componentes Apify permanecem apenas para compatibilidade histórica e não fazem parte do fluxo ativo.

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


## Conversas por chip

A Etapa 13 adiciona atendimento textual por chip via webhooks Evolution. Consulte `docs/DEPLOYMENT.md` e `docs/RECOVERY.md`.
