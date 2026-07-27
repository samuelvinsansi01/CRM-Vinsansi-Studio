# Fluxo 1 — Ciclo de Leads

## Implementado nesta entrega

- Início consulta somente `lead_status_id = 1`.
- Início voltou a exibir Total, WhatsApp, Com site, Agregadores e Instagram.
- Triagem do WhatsApp move o lead para `lead_status_id = 3` e `channels_id = 1`.
- Triagem do Instagram exige Instagram preenchido e move para `lead_status_id = 2` e `channels_id = 2`.
- Pré-Envio consulta exclusivamente `lead_status_id = 3` e `channels_id = 1`.
- Válidos consulta somente `lead_status_id = 2`.
- Válidos usa apenas `channels_id` para WhatsApp/Instagram.
- Base Permanente consulta somente `lead_status_id IN (5,6,7,8)`.
- Contadores de enviados por canal usam apenas `channels_id`.
- As quatro páginas deixaram de depender dos services/repositories antigos de importação, pré-envio e base.
- Criada uma camada única do fluxo em `services/lead-cycle` e `hooks/useLeadCycle.ts`.

## Legado removido das páginas do Fluxo 1

- `destination`
- `destino`
- `destination_override`
- `send_instagram`
- `situation`
- status textuais `Em aguarde` / `Aprovado`
- consultas a `pre_send_leads`
- consultas a `app_settings`
- inferência de canal por site/agregador/contact source

## Validação pendente

O build não pôde ser concluído neste ambiente porque o `node_modules` do ZIP não estava instalado e a instalação das dependências expirou. A validação estática do escopo foi feita por busca de referências legadas nos arquivos novos.
