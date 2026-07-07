# V3.28 — proxy seguro para o Worker WhatsApp

## Problema corrigido

O Worker passou a exigir `x-worker-token`, mas o painel enviava a requisição diretamente pelo navegador sem esse cabeçalho. O resultado era `worker_token_invalid` e os itens selecionados acabavam em erro recuperável.

## Novo fluxo

```text
Painel autenticado
→ POST /api/whatsapp/dispatch (Vercel)
→ valida a sessão Supabase
→ confirma que os itens pertencem ao usuário atual via RLS
→ injeta WHATSAPP_WORKER_DISPATCH_TOKEN no backend
→ POST Worker/Tunnel /dispatch/whatsapp
```

O token não fica no bundle do navegador e `VITE_WHATSAPP_WORKER_DISPATCH_ENDPOINT` externo deixa de ser usado.

## Variáveis Vercel obrigatórias

```env
WHATSAPP_WORKER_DISPATCH_URL=https://worker.seudominio.com/dispatch/whatsapp
WHATSAPP_WORKER_DISPATCH_TOKEN=mesmo_valor_de_WORKER_HTTP_TOKEN
WHATSAPP_WORKER_DISPATCH_TIMEOUT_MS=55000
```

As variáveis já usadas pelo Supabase no projeto também precisam permanecer disponíveis para a função validar a sessão:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
```

Pode usar `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` como fallback, mas as versões sem `VITE_` são preferíveis para funções serverless.

## Worker

Mantenha no Worker:

```env
WORKER_HTTP_TOKEN=uma-chave-propria-e-secreta
```

O valor deve ser exatamente igual a `WHATSAPP_WORKER_DISPATCH_TOKEN` e a `WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN` da Vercel.

## Teste

1. Mantenha `DRY_RUN=true` durante o teste de infraestrutura.
2. Publique o CRM V3.28.
3. Faça logout/login no painel.
4. Reprocesse apenas o item que ficou em `error` por `worker_token_invalid`.
5. Com `DRY_RUN=true`, o erro esperado depois do proxy é `dry_run_enabled...`; isso confirma que o proxy chegou ao Worker, mas bloqueou o envio real.
6. Para um disparo real controlado, use um ambiente de teste ou `TEST_MODE=true` com número de teste e `DRY_RUN=false`.
