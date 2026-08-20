VINSANSI STUDIO — PATCH CRM v1.0.1 / EVOLUTION GO
=================================================

Este patch fecha a migração do CRM para o contrato estável do Vinsansi WhatsApp Gateway v1.

ARQUIVOS APLICADOS
------------------
1. api/desktop/worker-provision.ts
   Provisionamento server-side do Gerenciador. Entrega token Cloudflare cifrado por RSA-OAEP e nunca envia Service Role, GLOBAL_API_KEY da Evolution ou senha do PostgreSQL ao frontend.

2. api/chat/send.ts
   Envio do chat pelo endpoint próprio do Vinsansi Gateway v1.

3. supabase/functions/evolution-instance-sync/index.ts
   Status e configuração de webhook pelo Gateway v1.

4. src/services/whatsapp-queue/whatsapp.evolution.gateway.ts
   Fila/validação/envio usando apenas o contrato v1 do Gateway.

CONTRATO DE PRODUÇÃO
--------------------
CRM/Worker não dependem mais diretamente das rotas legadas da Evolution clássica.
O contrato canônico é:

/v1/whatsapp/instances/:instance/status
/v1/whatsapp/instances/:instance/messages/text
/v1/whatsapp/instances/:instance/messages/media
/v1/whatsapp/instances/:instance/numbers/check
/v1/whatsapp/instances/:instance/webhook

CLOUDFLARE
----------
A rota remota existente permanece de propósito:

evolution.samuelvinsansi.com.br -> http://host.docker.internal:8080

O Vinsansi WhatsApp Gateway publica a porta 8080 do host. Essa ponte é estável para o Tunnel remotamente gerenciado e evita exigir um Cloudflare API Token com permissão de edição de rotas. Internamente, Worker, Gateway, Evolution Go e PostgreSQL usam a rede Docker vinsansi-network e nomes de container.

VARIÁVEIS
---------
Use ENV-V1.0.1.txt somente no ambiente server-side do CRM.
Não coloque os segredos técnicos no frontend e não envie tokens/chaves pelo chat.

ORDEM DE APLICAÇÃO
------------------
1. Copie os quatro arquivos de produção para os mesmos caminhos do CRM. Se quiser manter os verificadores do repositório alinhados, copie também os scripts.
2. Aplique a migration supabase/migrations/20260820123000_instance_credential_rotation.sql no projeto Supabase (ou pelo fluxo normal de migrations do projeto).
3. Confira as variáveis de ENV-V1.0.1.txt no deploy.
4. Faça o deploy do CRM.
5. Depois use o Gerenciador v1.0.1 para Reparar instalação; ele detectará e corrigirá automaticamente as chaves legadas duplicadas.

VALIDAÇÃO OPCIONAL NO REPOSITÓRIO
---------------------------------
Os scripts em scripts/ podem ser executados no ambiente de desenvolvimento para validar provisionamento, contrato Gateway v1, ausência das rotas legadas nos arquivos migrados e inventário das Vercel Functions (10 rotas, dentro do limite do projeto).


CORREÇÃO v1.0.1
- Aplique também supabase/migrations/20260820123000_instance_credential_rotation.sql.
- A função nova rotaciona somente a credencial da instância do usuário autenticado.
- Isso corrige instalações legadas em que dois chips reutilizavam a mesma chave Evolution.
