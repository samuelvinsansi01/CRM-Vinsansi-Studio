# V3.27 — Validação WhatsApp fail-closed

## Problema corrigido

Uma indisponibilidade do Worker Docker ou da Evolution não pode ser interpretada como
WhatsApp inexistente. Antes desta versão, uma resposta inadequada de uma integração
poderia chegar ao fluxo de validação e produzir resultados impróprios para o lote.

## Nova regra

Com o preflight obrigatório ativo, o fluxo é:

1. Vercel chama o Worker Docker em `POST /preflight/validation`.
2. O Worker confirma que está acessível, que os chips solicitados estão ativos e que a
   Evolution retorna a instância como conectada.
3. Somente após esse resultado o endpoint de validação consulta os números.
4. Se Docker, Worker, chip ou Evolution falharem, a API retorna HTTP 503 com
   `code: validation_unavailable`.
5. O frontend interrompe a ação e não altera nenhum lead: não aprova, não invalida,
   não envia a revisão e não move para Instagram.

## Variáveis Vercel obrigatórias para ativar a proteção

```text
WHATSAPP_VALIDATION_REQUIRE_WORKER_HEALTH=true
WHATSAPP_VALIDATION_WORKER_HEALTH_URL=https://SEU-WORKER-HTTPS
WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN=mesmo_valor_de_WORKER_HTTP_TOKEN
WHATSAPP_VALIDATION_HEALTH_TIMEOUT_MS=8000
```

A URL precisa ser acessível a partir da Vercel. `http://127.0.0.1:8787` e endereços
privados do Docker não funcionam para funções serverless publicadas.

## Resultado esperado com a infraestrutura indisponível

```text
Validação indisponível: Worker WhatsApp não respondeu ao preflight dentro do prazo.
Nenhum lead foi alterado.
```
