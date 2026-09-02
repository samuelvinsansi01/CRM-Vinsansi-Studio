CRM VINSANSI STUDIO R59 BUILD FIX 34 + MOBILE COMMERCIAL CONTRACT v0.2.0

BASE
- CRM R59 BUILD FIX 33 + MOBILE BACKEND v0.1.0.

ALTERAÇÕES DESTA VERSÃO
- Comercial integrado visualmente à Central de Conversas do CRM.
- GET conversation-commercial agora devolve displayName, allowedTransitions, designDueDate e designDueDateEditable.
- POST conversation-commercial aceita action=stage e action=design_due_date.
- A permissão da mudança comercial é leads.edit; whatsapp.reply não é requisito para classificação comercial.
- Validação de nova data passada foi adicionada ao backend e à RPC.
- A regra progressiva continua sendo validada por set_lead_commercial_stage_r59.

BANCO
Aplicar, nesta ordem quando necessário:
1. APLICAR - CRM R59 BUILD FIX 31 - Estrutura CRM e Comercial.sql
2. APLICAR - CRM R59 BUILD FIX 33 - Comercial progressivo e Dashboard por periodo.sql
3. APLICAR - CRM R59 BUILD FIX 34 - Comercial nas Conversas e contrato mobile.sql
4. APLICAR - MOBILE V0.1.0 - PUSH.sql (para push do app)

NÃO ALTERADO
- Worker.
- WhatsApp Gateway.
- Instagram.
- Captura.
- Motor/fila de disparos.
