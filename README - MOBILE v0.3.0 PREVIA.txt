MOBILE v0.3.0 — CONTRATO COMERCIAL COMPATÍVEL

O CRM BUILD FIX 36 atualiza a nomenclatura comercial compartilhada com o futuro app:
- aguardando_design -> aguardando_previa
- design_enviado -> previa_enviada
- designDueDate -> previewDueDate

Endpoint compartilhado:
/api/whatsapp/conversation-commercial
contractVersion: conversation-commercial-v0.3

Ações atuais:
- stage
- preview_due_date

Compatibilidade temporária mantida:
- action design_due_date ainda é aceita pelo backend.
- campo designDueDate ainda é devolvido como alias de previewDueDate.
- o parser web ainda aceita designDueDate de respostas antigas.

Projetos não fazem parte do escopo do app mobile v1 neste momento. O app continua voltado a Conversas WhatsApp + Comercial simples.
