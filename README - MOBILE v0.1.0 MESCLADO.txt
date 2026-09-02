CRM VINSANSI STUDIO R59 BUILD FIX 33 + MOBILE BACKEND v0.1.0

BASE
- CRM_Vinsansi_Studio_v2.4.0-R59_BUILD_FIX_33.zip

INTEGRAÇÃO MOBILE ADITIVA
- server/routes/whatsapp/conversation-send.ts
- server/routes/whatsapp/conversation-commercial.ts
- server/routes/whatsapp/router.ts: registro aditivo das duas rotas
- supabase/functions/evolution-connection-webhook/index.ts: push best-effort após nova mensagem inbound persistida
- APLICAR - MOBILE V0.1.0 - PUSH.sql

ROTAS
- POST /api/whatsapp/conversation-send
- GET|POST /api/whatsapp/conversation-commercial

PRESERVADO DO FIX 33
- Fluxo comercial progressivo/somente para frente.
- design_due_date e set_lead_design_due_date_r59.
- Dashboard por período.
- Demais arquivos e regras do FIX33 não foram substituídos pelo FIX32.

SEGURANÇA MOBILE
- O app não recebe api_key da instância.
- Envio é resolvido server-side pelo contexto da organização/conversa.
- Texto-only também é imposto pelo backend.
- Idempotência e reconciliação do Stage 5 são reutilizadas.
- Timeout/resultado incerto não faz retry cego.

BANCO
- CRM R59 BUILD FIX 33 deve estar aplicado no Supabase real.
- APLICAR - MOBILE V0.1.0 - PUSH.sql deve estar aplicado.
