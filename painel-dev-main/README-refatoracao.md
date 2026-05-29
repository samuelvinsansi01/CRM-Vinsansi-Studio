# Refactor V3 — Drawer/Ficha do Lead

Esta versão adiciona a primeira base de CRM sem mexer no fluxo atual da plataforma.

## O que foi adicionado

- Drawer lateral da Ficha do Lead.
- Botão **Ficha** na Fila WhatsApp e na lista de empresas do disparo.
- Pipeline comercial separado do status operacional.
- Notas por lead.
- Histórico simples por lead.
- Persistência local em `vs_lead_crm_v1`.

## O que não foi alterado

- Importação.
- Validação.
- Atribuição.
- Redis.
- Supabase/banco.
- Fluxo de disparo atual.

## Teste recomendado

1. Abrir Fila WhatsApp.
2. Clicar em **Ficha** em um lead.
3. Alterar pipeline.
4. Adicionar uma nota.
5. Fechar e abrir a ficha novamente.
6. Recarregar a página e confirmar que nota/pipeline continuam salvos.
