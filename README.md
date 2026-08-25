# CRM - Vinsansi Studio v2.4.0-R26

Release incremental sobre a R25.

## R26 — Revisão → Fila final

A fila operacional agora possui duas etapas visuais e funcionais:

1. **Revisão** — o operador analisa cada lead e usa o check verde para aprovar individualmente.
2. **Fila final** — recebe apenas os leads aprovados e é a base efetiva de disparo.

Não existe mais necessidade de **Trancar fila**. A aprovação individual chama o pipeline canônico de preparação, mantendo o snapshot e os contratos já existentes da fila definitiva.

### Capacidade

O limite diário pertence ao **chip/perfil selecionado**. A soma de posições ocupadas na Fila final e na Revisão não pode ultrapassar esse limite.

Exemplo: limite **20**, com **19** posições já ocupadas → **Puxar** adiciona somente **1**.

Somente invalidar/cancelar um item libera vaga; erros e reconciliações continuam pertencendo à capacidade daquele dia.

### Reposição

- Invalidar na Revisão remove o lead e repõe a vaga com o próximo melhor candidato.
- Invalidar um lead aprovado da Fila final libera uma vaga e envia o substituto para **Revisão**.
- O substituto só entra na Fila final depois de novo check de aprovação.

## Escopo por recurso

- WhatsApp: sempre um **chip específico**.
- Instagram: sempre um **perfil específico**.
- Não existem mais as opções **Todos os chips** e **Todos os perfis** nesta tela.
- Revisão e Fila final respeitam também a **data selecionada**.

## Tabelas

### Revisão antes do disparo

**# · Empresa · Ramo · Estado · Cidade · Nota · Avaliações · WhatsApp/Instagram · Site · Ações**

- Aprovar: check verde.
- Invalidar: ação vermelha.
- Paginação por leads.
- Numeração contínua apenas dos itens atuais.

### Fila final

**# · Empresa · Ramo · Estado · Cidade · Nota · Avaliações · WhatsApp/Instagram · Site · Status · Ações**

- Empresa/contatos/site continuam clicáveis quando existe destino.
- Visualizar em cor primária; invalidar em vermelho.
- Paginação por leads, substituindo a antiga listagem extensa por lotes.

## R25 — links, Site e WhatsApp

- Home com Site em Sim/Não e card Com site.
- Empresa abre Google Maps quando há `leads_maps`.
- Número, Instagram, WhatsApp e Site abrem seus respectivos destinos.
- Puxar WhatsApp exige chip selecionado.
- Falsos positivos de WhatsApp foram endurecidos no **Gerenciador v1.3.4 / Gateway v1.2.8 / Worker v3.13.3**.

## Banco

A R26 exige a migration:

`supabase/migrations/20260825234000_r26_incremental_queue_approval.sql`

Em instalação que ainda não recebeu a R23, aplique antes:

`supabase/migrations/20260825220000_r23_open_queue_review.sql`

O utilitário para Importados legados continua disponível:

`SQL - R23 - Limpar destino dos Importados.sql`

## Verificação

Execute:

`npm run verify:release`
