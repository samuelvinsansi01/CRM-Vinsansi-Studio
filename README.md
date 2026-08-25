# CRM - Vinsansi Studio v2.4.0-R25

Release incremental sobre a R24.

## R25 — links, Site e validação por chip

- A Home passa a exibir **Site** em Sim/Não e o card **Com site**.
- Empresa abre o perfil do **Google Maps** quando a origem possui `leads_maps`.
- Os `Sim` de Número, Instagram, WhatsApp e Site são acionáveis e abrem seus respectivos destinos.
- A revisão antes do disparo foi reorganizada em colunas separadas de Estado/Cidade e inclui Site.
- **Puxar WhatsApp exige um chip selecionado**; não existe mais fallback silencioso para o primeiro chip disponível.
- Ao puxar, a revisão WhatsApp aberta também é revalidada com o chip escolhido.
- Para eliminar falsos positivos de existência no WhatsApp, use em conjunto o **Gerenciador v1.3.4 / Gateway v1.2.8 / Worker v3.13.3**.

## Fluxo operacional mantido

1. Lead entra como **Importado**, sem destino operacional (`channels_id = NULL`).
2. A Home ordena por **nota DESC → avaliações DESC**.
3. O operador usa **Puxar WhatsApp** ou **Puxar Instagram**.
4. Os leads entram em **revisão aberta**, ainda sem `queue_items` e sem snapshot.
5. O operador invalida os leads ruins e a fila repõe a vaga com o próximo melhor elegível.
6. **Trancar fila** cria a fila definitiva e o snapshot.
7. A Base Permanente continua terminal e somente leitura.

## R24 — tabelas

### Importados

**Empresa · Ramo · Estado · Cidade · Nota · Avaliações · Número · Instagram · Status · Ações**

- Número e Instagram são exibidos como **Sim/Não**.
- Ações: **Editar** e **Invalidar**.
- Editar um Importado não atribui destino.

### Base Permanente

**Nome da empresa · Ramo · Estado · Cidade · Canal de envio · Instagram · WhatsApp · Data de envio · Status · Ações**

- Somente o contato correspondente ao canal final é exibido.
- Ações: **Visualizar** apenas.

## Identidade do ramo

- `leads.branches_id` é a referência canônica do **ramo pai**.
- O nome é resolvido pela tabela `branches`.
- Renomear o ramo altera a apresentação sem perder leads.
- Sub-ramos/categorias continuam apenas como contexto de origem/match.

## Banco

A R24 não exige migration nova.

Para uma instalação que ainda não recebeu a R23, aplique primeiro:

`supabase/migrations/20260825220000_r23_open_queue_review.sql`

Se ainda houver leads Importados com destino antigo, o utilitário permanece disponível:

`SQL - R23 - Limpar destino dos Importados.sql`
