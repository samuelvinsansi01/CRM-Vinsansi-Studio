# Instagram operacional — v0.17.3

Esta rodada prioriza o fluxo Instagram antes da homologação do Worker WhatsApp.

## Contratos fechados

- Aprovação manual em lote continua explícita em Validação e roteamento.
- O drawer de aprovados consegue preencher a fila até a capacidade disponível do perfil.
- A extensão só exige mídia quando `queue_items_payload_snapshot.media.required = true`.
- Falha isolada antes do primeiro disparo vira `error` e não interrompe os próximos leads.
- Falha após o início das mensagens/mídia vira `reconciliation_required`; esse estado não pode ser reprocessado automaticamente.
- Reprocessamento pelo CRM aceita somente `instagram_queue_progress.step = 'error'`.
- Invalidação pelo CRM sincroniza progress, queue_item e lead em uma RPC atômica.
- Resultado final da extensão (`sent`, `error`, `reconciliation_required`) é persistido em `public.sents` com chave idempotente por queue_item + payload congelado.

## Ordem operacional

1. Aplicar `20260813130000_instagram_dispatch_operational.sql`.
2. Rodar `scripts/postcheck-instagram-v0173.sql` e exigir `readyForInstagramV0173 = true`.
3. Publicar o CRM.
4. Recarregar a extensão Instagram v1.6.1.
5. Aprovar leads Instagram em Validação e roteamento.
6. Em Fila Instagram, selecionar perfil/data e usar `Puxar aprovados` → `Adicionar até N vaga(s)`.
7. Vincular a extensão ao mesmo perfil.
8. Carregar a fila e homologar primeiro com 3–5 leads reais.
9. Conferir `queue_items`, `instagram_queue_progress` e `sents` antes de aumentar o volume.
