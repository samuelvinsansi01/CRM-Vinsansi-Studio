# Arquitetura

## Fonte de verdade

O Painel novo e o banco novo são canônicos. O legado permanece apenas como referência funcional.

## Domínios

1. Aquisição: cadastro manual e dados fornecidos pela extensão Google Maps. Componentes Apify são legado não montado.
2. Leads: identidade, qualificação, canal e status.
3. Operação: filas, itens, lotes e partes de envio.
4. Remetentes: chips, instâncias Evolution e perfis Instagram.
5. Mensagens: templates, snapshots e mídia versionada.
6. Memória: auditoria, supressões e Base Permanente.
7. Operação da plataforma: configurações, heartbeats, alertas e recuperação.
8. Conversas: threads por chip, mensagens, eventos e recibos dos webhooks Evolution.

## Regras estruturais

- Estado e fila mudam em transações do banco.
- Conteúdo é congelado ao enfileirar.
- Worker é idempotente por parte.
- Segredos permanecem no Vault ou em ambientes server-side.
- Histórico é append-only.
- Duplicidade e supressão são políticas do backend.
- Resultados incertos não são reenviados automaticamente.
- Conversas não reutilizam `sents`: campanhas e atendimento permanecem domínios separados.
- Mensagens do chat entram por webhook idempotente e saem apenas pelo backend autenticado.
