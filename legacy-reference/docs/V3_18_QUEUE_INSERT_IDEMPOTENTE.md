# V3.18 — Fila com inserção idempotente

## Correção

A fila Instagram usava `upsert(..., { onConflict: 'source_pre_send_id' })`.
No banco legado, `source_pre_send_id` possui apenas índice único parcial, que
não é aceito pelo `ON CONFLICT` usado via PostgREST. Por isso a criação do item
falhava mesmo quando template, perfil e capacidade estavam válidos.

A V3.18 mantém a verificação de duplicidade por `sourcePreSendId` antes de
inserir e grava com `insert`. A mesma correção foi aplicada à fila WhatsApp,
que compartilhava o mesmo padrão.

## Resultado esperado

Ao salvar um retorno Instagram com link válido, template compatível, perfil
ativo e capacidade disponível, o item é criado em `instagram_queue_items` e
só então o lead deixa o Pré-Envio.
