# Checklist de deploy controlado — PRODUÇÃO

Este runbook é manual. Não executa migrations, não altera o banco e não inclui a extensão Google Maps. Antes de começar, registre os identificadores imutáveis dos builds atualmente publicados para permitir rollback de aplicação. As seis migrations aprovadas já devem constar como aplicadas; nunca inclua `20260802130000_identity_dedup_suppression.sql` nem `20260802131000_fix_instagram_identity_normalization.sql` em qualquer executor.

## A. Worker

### Pré-requisito

- Banco de produção com `readyForDeploy=true` e as seis migrations manuais já validadas.
- Host Docker capaz de executar a imagem baseada em Node 22 e com acesso HTTPS ao Supabase e à Evolution.
- Imagem/build anterior identificado e disponível para rollback.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `WORKER_HTTP_TOKEN` configurados como secrets; o token deve ter no mínimo 32 caracteres.
- Instâncias Evolution e credenciais já existentes no banco/Vault. O Worker não recebe API key Evolution por variável de ambiente.

### Pacote

- `worker/Dockerfile`
- `worker/package.json` e `worker/package-lock.json`
- `worker/src/worker.js`
- `worker/src/operational-window.js`
- `worker/src/contactIdentity.js`
- `worker/images/` montado como volume somente leitura quando houver mídia aprovada para os templates.

### Ação manual

1. Validar localmente com Node 22: `npm ci`, `npm run check` e `npm run verify` no diretório `worker`.
2. Construir uma imagem imutável a partir do `worker/Dockerfile`; não usar `latest` como única referência de rollback.
3. Configurar as variáveis obrigatórias e, quando necessário, as opcionais abaixo.
4. Publicar uma única réplica inicialmente. Não acionar `/dispatch/whatsapp` e não criar lote de teste antes do healthcheck e do heartbeat.
5. Iniciar com `npm start` — o `CMD` do Dockerfile já executa esse comando.

### Variáveis

Obrigatórias: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_HTTP_TOKEN`.

Opcionais, com fallback no código: `WORKER_HTTP_HOST`, `WORKER_HTTP_PORT`, `WORKER_IMAGES_DIR`, `MAX_IMAGE_BYTES`, `EVOLUTION_REQUEST_TIMEOUT_MS`, `EVOLUTION_INSTANCE_SYNC_SECONDS`, `WHATSAPP_VALIDATION_DELAY_MS`, `WHATSAPP_VALIDATION_MAX_LEADS`, `SCHEDULER_TICK_SECONDS`, `BATCH_PAUSE_SECONDS`, `DELAY_BETWEEN_TEXT_MESSAGES_SECONDS`, `DELAY_TEXT_TO_IMAGE_SECONDS`, `DRY_RUN`, `WORKER_INSTANCE_ID`, `WORKER_STALE_EXECUTION_SECONDS`, `WORKER_RECOVERY_INTERVAL_SECONDS`, `WORKER_HEARTBEAT_SECONDS`.

Não existe variável Apify no Worker. Janela, dias ativos, timezone, delays operacionais e capacidade são lidos das configurações centralizadas; os fallbacks locais não substituem o contrato persistido. Cutoff ausente ou inválido usa 22:00.

### Verificação pós-deploy

- `GET /health` deve responder HTTP 200 com `ok=true`, versão `3.6.0` e schema contendo `worker_batches` e `dispatch_parts`.
- A tela Monitoramento deve mostrar heartbeat recente do novo `WORKER_INSTANCE_ID` e ausência de erro recorrente de recovery/scheduler.
- Com `x-worker-token` válido, `POST /dispatch/whatsapp` deve responder HTTP 410 e orientar batch/scheduler.
- `POST /batch/whatsapp/status` ou `/state`, com token válido e escopo controlado, deve responder sem iniciar disparo.
- O scheduler deve continuar sendo o único chamador de `dispatchOne`; nenhum teste mínimo deve contornar `next_run_at`, janela ou prova WhatsApp.

### GO

Healthcheck 200, heartbeat recente, credenciais carregadas via RPC/Vault, sem loop de recovery e endpoint direto 410.

### STOP / rollback

Pare se healthcheck falhar, heartbeat não aparecer, houver 401 interno, erro de schema/RPC, recovery repetitivo ou tentativa fora da janela. Restaure a imagem/build anterior e preserve banco, lotes e `next_run_at`; não reverta migrations nem force itens para processamento.

## B. APIs/Vercel

### Pré-requisito

- Worker da etapa A em GO e URL HTTPS conhecida.
- Deployment anterior da Vercel identificado para rollback.
- Variáveis configuradas somente no ambiente Production; secrets nunca devem usar prefixo `VITE_`.

### Variáveis de produção na Vercel

Frontend públicas e obrigatórias: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

Server-side obrigatórias: `SUPABASE_URL`, uma entre `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_VALIDATION_WORKER_URL`, `WHATSAPP_VALIDATION_WORKER_TOKEN`, `WHATSAPP_WORKER_BATCH_URL`, `WHATSAPP_WORKER_BATCH_TOKEN`, `INSTAGRAM_EXTENSION_SIGNING_SECRET`.

Opcionais: `WHATSAPP_VALIDATION_TIMEOUT_MS`, `VITE_RECONCILIATION_STALE_MINUTES`. Os aliases `WHATSAPP_VALIDATION_WORKER_HEALTH_URL`, `WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN` e `WHATSAPP_VALIDATION_HEALTH_TIMEOUT_MS` existem apenas como compatibilidade. `VITE_WHATSAPP_WORKER_VALIDATE_ENDPOINT` e `VITE_WHATSAPP_WORKER_REVALIDATE_ENDPOINT` não são consumidas pelo gateway atual, que usa as rotas internas fixas. `WHATSAPP_WORKER_BATCH_TIMEOUT_MS` não é consumida pelo handler atual; não depender dela para alterar o timeout.

`EVOLUTION_WEBHOOK_SECRET` pertence às Edge Functions Evolution no Supabase, não às funções Vercel. Nenhuma variável Apify é necessária para este deploy.

### Ação manual

1. Instalar o CRM com o lockfile congelado: `npm ci` usando Node `>=22.12 <23` e npm 10.
2. Executar `npm run verify:production-deploy-package`, verificadores de WhatsApp/Instagram/identity, typecheck e `npm run build` antes de publicar.
3. Publicar as funções em `api/` pelo mecanismo normal da Vercel, sem executar Supabase CLI e sem incluir Edge Functions Apify como dependência.
4. Manter a promoção do frontend/alias principal para a etapa C quando a plataforma permitir validar as funções no mesmo artefato antes da promoção.

### Verificação pós-deploy

- Requisições sem sessão a `/api/whatsapp/validate`, `/api/whatsapp/batch`, `/api/instagram/pair` e `/api/whatsapp/dispatch` devem falhar por autenticação.
- Com sessão controlada, `/api/whatsapp/dispatch` deve responder HTTP 410 e não encaminhar ao Worker.
- A validação WhatsApp só pode responder sucesso depois de `record_whatsapp_validation_result` concluir.
- O endpoint de batch deve encaminhar exclusivamente para `/batch/whatsapp/*` com token server-side.
- O pareamento Instagram deve emitir token temporário vinculado ao proprietário e perfil autorizado; `SUPABASE_SERVICE_ROLE_KEY` e o signing secret não podem aparecer no bundle do navegador.

### GO

Autenticação aplicada, dispatch direto 410, validação/proof e batch respondendo conforme contrato, sem secret exposto e sem referência ativa a Apify.

### STOP / rollback

Pare se houver 5xx de configuração, prova não persistida, batch chamando rota direta, segredo no bundle ou API incompatível com o schema. Restaure o deployment Vercel anterior; não altere dados nem migrations.

## C. CRM

### Pré-requisito

- Etapas A e B em GO.
- Mesmo artefato verificado por typecheck e build, sem regenerar lockfiles ou trocar o gerenciador.
- Deployment anterior identificado.

### Ação manual

1. Promover/publicar o artefato verificado do CRM para o domínio principal.
2. Não publicar páginas, rotas ou Edge Functions Apify como requisito da aplicação.
3. Não executar migration, seed, backfill ou escrita administrativa durante a publicação.

### Verificação pós-deploy

- Login retorna o próprio `public.users`.
- Importação mostra exatamente `Manual` e `Google Maps Extension`; não mostra aba, CTA, conta, job ou fallback Apify.
- Cadastro manual exige nome, ramo ativo e WhatsApp ou Instagram, persiste `branches_id` e mantém `leads_origin=manual`.
- WhatsApp sem site resolve canal WhatsApp e `contact_sources_key=sem_site`; Instagram resolve canal Instagram e `contact_sources_key=instagram`.
- WhatsApp usa Evolution e prova persistida; Instagram é validado apenas por formato.
- JSON Google Maps passa por prévia, `simulationMode`, deduplicação e barreira de persistência existentes.
- Runtime não escreve `leads_identity_contract_version`, não exige registry para histórico e não executa backfill.

### GO

Login, navegação, importação, cadastro manual, filas e Monitoramento carregam sem erro; UX ativa contém somente as duas fontes aprovadas.

### STOP / rollback

Pare se Apify reaparecer, cadastro resolver WhatsApp como origem, simulação persistir dados, login/monitoramento falhar ou o frontend exigir backfill. Reverta para o deployment anterior da aplicação, mantendo o banco atual.

## D. Extensão Instagram

### Pré-requisito

- Etapas A–C em GO.
- Pasta contendo somente o pacote revisado: `manifest.json`, `background.js`, `content.js` e `popup.js`.
- Chrome 114 ou superior, conta remetente controlada e destinatário controlado.
- Pacote anterior da extensão guardado para rollback.

### Ação manual

1. Executar `node --check background.js`, `node --check content.js` e `node --check popup.js`.
2. Confirmar `manifest_version=3`, versão `1.5.0`, permissões esperadas e host `https://painel.samuelvinsansi.com.br/*`.
3. Carregar a pasta descompactada em `chrome://extensions` no modo de desenvolvedor.
4. No CRM, vincular um perfil Instagram autorizado e copiar o token temporário para a extensão. O token fica somente em `chrome.storage.session`.
5. Não inserir chave Supabase, service role, senha ou token permanente no pacote.

### Verificação pós-deploy

- Extensão consulta `https://painel.samuelvinsansi.com.br/api` e rejeita token expirado/perfil divergente.
- Inválidos aparecem em `skipped_invalid_recipient`, nunca são claimed e não bloqueiam o próximo válido.
- Upload executa probe e somente uma tentativa mutável; perda de resposta, ausência de preview após dispatch ou incerteza após clique resultam em `reconciliation_required` sem fallback textual.
- Mensagens confirmadas e progresso persistido não são reenviados.

### GO

Token temporário funciona para o perfil autorizado, claim válido ocorre uma vez e o teste controlado termina como enviado ou reconciliação explícita, sem duplicação.

### STOP / rollback

Pare se houver claim de destinatário inválido, retry mutável, fallback após incerteza, token permanente persistido ou chamada para host inesperado. Descarregue a pasta nova e recarregue o pacote anterior; não altere o banco para mascarar o resultado.

## E. Smoke test

### Pré-requisito

- A–D em GO.
- Usuário, ramo, chip Evolution, perfil Instagram e destinatários exclusivamente controlados.
- `simulationMode` confirmado antes de qualquer persistência e janela operacional conhecida.

### Ação manual

Executar, em ordem e sem ampliar o lote, o plano `scripts/production-smoke-test-plan.md`. Registrar IDs dos leads, prova, fila/lote, heartbeat e resultado Instagram usados no teste.

### Verificação pós-deploy

Conferir que cada efeito corresponde ao contrato persistido e que não existem envios, claims, filas ou alterações fora dos registros controlados.

### GO

Todos os 17 passos do plano concluídos, sem alerta crítico, duplicação, bypass de prova ou efeito em dados históricos.

### STOP / rollback

Interromper no primeiro resultado divergente. Pausar lotes pelo fluxo persistente, preservar itens incertos para reconciliação e aplicar apenas rollback de Worker, deployment Vercel/CRM ou pacote da extensão. Não reverter migrations.
