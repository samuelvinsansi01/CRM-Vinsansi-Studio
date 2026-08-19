Vinsansi Studio - patch Worker + Cloudflare Tunnel local (v0.6.2)

Este patch corrige a v0.6.0 para o tipo real do Tunnel `evolution`: GERENCIADO LOCALMENTE.

Arquivos:
- api/desktop/worker-provision.ts
- supabase/migrations/20260819170000_desktop_local_tunnel_credentials.sql
- scripts/verify-desktop-worker-provisioning.mjs
- ENV-V0.6.2.txt

Fluxo da primeira migração, no computador que já possui o Tunnel antigo:
1. Aplicar a migration SQL no Supabase.
2. Publicar o endpoint atualizado no CRM.
3. Abrir o Gerenciador v0.6.2 e entrar com Google.
4. Clicar em Reparar instalação.
5. O processo principal procura instalações portáteis X:\cloudflared\config.yml (C:–Z:) e também as pastas .cloudflared padrão. No cenário atual ele detecta D:\cloudflared\config.yml e segue o credentials-file para C:\Users\Samuel\.cloudflared\1886e172-0796-49af-8e88-ffa7fc206fbc.json.
6. Somente o JSON restrito do Tunnel é enviado ao endpoint autenticado/allowlisted por HTTPS e salvo no Supabase Vault.
7. O app armazena localmente a cópia usando safeStorage e gera seu próprio config.yml.

Fluxo em computadores novos:
- Login Google -> provisionamento cifrado -> cloudflared/config.yml -> Tunnel local -> Worker.

O cert.pem NÃO é lido, enviado ou armazenado pelo Gerenciador. Ele possui poderes de administração da conta Cloudflare e não é necessário para executar um Tunnel já existente.

Rotas preservadas:
- evolution.samuelvinsansi.com.br -> http://127.0.0.1:8080
- worker.samuelvinsansi.com.br -> http://127.0.0.1:8787
