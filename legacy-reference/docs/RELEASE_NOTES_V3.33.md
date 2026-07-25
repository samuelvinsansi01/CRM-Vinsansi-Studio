# V3.33 — Instagram: persistência UUID da Base Permanente

- Corrige a confirmação de envio pela extensão Instagram quando `base_permanente.id` exige UUID.
- Base Permanente, `sent_contacts` e `lead_events` agora usam o UUID do próprio item da fila Instagram.
- A persistência continua idempotente: repetir apenas a confirmação não gera duplicidade.
- A fila só é marcada como enviada depois de Base Permanente, contato enviado e auditoria serem gravados.
- Não altera templates, textos, imagens, extensão, Worker WhatsApp ou fluxo de lote.
