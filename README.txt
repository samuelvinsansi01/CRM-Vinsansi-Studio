Vinsansi Studio - patch Worker + Cloudflare Tunnel Docker (v0.7.0)

A v0.7.0 abandona definitivamente cloudflared.exe, config.yml e <UUID>.json locais.
O Tunnel passa a ser remotamente gerenciado e executado como container Docker.

Arquivos:
- api/desktop/worker-provision.ts
- ENV-V0.7.0.txt

Não há migration SQL nova nesta versão.

Fluxo:
1. Rotacione o token do Tunnel no Cloudflare porque um token anterior foi exposto durante o teste.
2. Configure o NOVO token em DESKTOP_CLOUDFLARE_TUNNEL_TOKEN no ambiente server-side do CRM.
3. Atualize as rotas do Tunnel no Cloudflare Dashboard:
   evolution.samuelvinsansi.com.br -> http://host.docker.internal:8080
   worker.samuelvinsansi.com.br -> http://lead-certo-whatsapp-worker:8787
4. Publique api/desktop/worker-provision.ts e faça deploy do CRM.
5. No Gerenciador v0.7.0, entre com Google e use Reparar/Instalar.

O app cria:
- rede: vinsansi-network
- container: vinsansi-cloudflared
- imagem: cloudflare/cloudflared:2026.7.3
- container Worker: lead-certo-whatsapp-worker na mesma rede

O token é enviado cifrado ao processo principal do Electron e montado no container via --token-file.
Ele não aparece no renderer nem na linha de comando do container.
