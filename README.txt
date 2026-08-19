PATCH CRM — WORKER + CLOUDFLARE TUNNEL v0.6.0

Substitua/adicione:
- api/desktop/worker-provision.ts
- scripts/verify-desktop-worker-provisioning.mjs (opcional para verificacao do projeto)

No ambiente server-side do CRM adicione:
DESKTOP_CLOUDFLARE_TUNNEL_TOKEN=<token do tunnel evolution>
DESKTOP_EVOLUTION_PUBLIC_URL=https://evolution.samuelvinsansi.com.br
DESKTOP_CLOUDFLARE_TUNNEL_NAME=evolution

Mantenha as variaveis da v0.5.0:
DESKTOP_WORKER_PROVISIONING_ENABLED=true
DESKTOP_WORKER_PROVISIONING_ALLOWED_EMAILS=<seu email Google>
SUPABASE_SERVICE_ROLE_KEY=<ja existente>

Nao coloque o token do Tunnel em variavel VITE_ e nao o envie em prints/logs.
