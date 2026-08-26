## v2.4.0-R28 — resposta manual pelo JID canônico

Respostas manuais agora preservam `remote_jid` da conversa e usam telefone apenas como fallback. Isso evita erro `not registered on WhatsApp` causado por reconstrução indevida do destino.

# CRM - Vinsansi Studio v2.4.0-R27

Release incremental sobre a R26.


## R27 — WhatsApp com reposição manual

No WhatsApp, invalidar um lead **não puxa outro automaticamente**. A vaga fica aberta até o operador clicar em **Puxar WhatsApp** com o chip escolhido. Isso vale tanto para a Revisão quanto para a Fila final.

Dessa forma, a invalidação não chama o worker de validação e pode ser feita normalmente mesmo quando `WHATSAPP_VALIDATION_WORKER_URL` não estiver disponível naquele fluxo. A configuração do worker continua necessária no clique em **Puxar WhatsApp**, porque é ali que os novos números são validados de verdade.

O Instagram permanece como estava: invalidação com reposição automática para Revisão.

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

- **WhatsApp:** invalidar apenas libera a vaga; o substituto só é buscado ao clicar em **Puxar WhatsApp**.
- **Instagram:** invalidar mantém a reposição automática com o próximo melhor candidato em **Revisão**.
- Em ambos os canais, o substituto só entra na Fila final depois de novo check de aprovação.

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


## R29
Filas manuais, nome alternativo canônico e padronização única das tabelas. Aplicar `SQL - CRM R29 - Nome alternativo e filas manuais.sql` antes de publicar.

## R30
Resposta manual usa o JID real preservado no webhook da conversa, priorizando `@lid`. Não exige SQL novo além das migrations anteriores.

## R31
Correção de empacotamento/build da Homologação final. O repository `src/repositories/release/homologation.repository.ts` volta a fazer parte do pacote e a redução de status possui tipos explícitos. Não exige SQL novo além das migrations anteriores.
