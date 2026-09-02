MOBILE v0.2.1 - contrato de identidade de conversas

Este pacote não cria uma segunda base mobile.

A identidade da conversa continua centralizada no Stage 5 e em public.leads.
O FIX35 acrescenta ao contrato de listagem:
- lead_name
- lead_alternative_name
- display_name

e corrige a ingestão para resolver JID/LID/aliases antes da criação da thread.

Prioridade visual recomendada para todos os clientes:
Nome alternativo -> Nome da empresa -> nome útil do WhatsApp -> telefone.

O app mobile deverá consumir a mesma thread reconciliada usada pelo CRM/Gerenciador.
