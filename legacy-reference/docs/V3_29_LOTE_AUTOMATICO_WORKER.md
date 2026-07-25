# V3.29 — Lote automático WhatsApp

## Objetivo

Um único clique em **Iniciar lote** inicia o processamento persistente no Worker local. O painel não envia lead a lead e pode ser fechado após a confirmação.

## Fluxo

```text
Painel autenticado
→ Vercel /api/whatsapp/batch
→ Worker pelo Tunnel HTTPS
→ app_settings (estado do lote)
→ Worker envia 1 lead por vez
→ intervalo do chip entre leads
→ ao concluir block_size, pausa BATCH_PAUSE_SECONDS
→ continua sozinho
```

## Regras

- O lote é limitado a um chip por vez.
- A seleção é congelada no `app_settings` em `queue_item_ids`; novos leads não entram no lote em execução.
- Cada item é movido para `sending` somente no momento em que o Worker assume o envio.
- Imagem obrigatória é validada antes da primeira mensagem.
- Falha em um item deixa apenas aquele item em `error`; o próximo item segue após o intervalo do chip.
- `Pausar` preserva os itens restantes. `Retomar` continua pelo próximo item pendente. `Parar` encerra o lote e deixa os itens restantes em fila.
- A cadência fica no Worker. A Vercel só inicia/pausa/consulta o lote, pois uma função serverless não deve ficar aguardando uma hora.

## Variáveis da Vercel

```env
WHATSAPP_WORKER_BATCH_URL=https://worker.seudominio.com/batch/whatsapp
WHATSAPP_WORKER_BATCH_TOKEN=<mesmo WORKER_HTTP_TOKEN>
WHATSAPP_WORKER_BATCH_TIMEOUT_MS=15000
```

As variáveis de dispatch e preflight já existentes continuam necessárias.

## Variáveis do Worker

```env
SCHEDULER_ENABLED=true
SCHEDULER_TICK_SECONDS=5
BATCH_PAUSE_SECONDS=3600
FORCE_IDLE_ON_POLL_START=false
```

## Teste seguro

1. Mantenha `TEST_MODE=true` e defina `TEST_PHONE`.
2. Mantenha `DRY_RUN=false` apenas para esse teste controlado.
3. Inicie um lote com dois ou mais itens de teste.
4. Verifique o primeiro envio, o intervalo entre leads e o estado do lote em `app_settings`.
5. Para testar a pausa de uma hora sem esperar, defina temporariamente `BATCH_PAUSE_SECONDS=60` no ambiente de teste.
6. Após confirmar, volte para `3600` e reinicie o Worker.
