# CRM - Vinsansi Studio v2.4.0-R23

Release do fluxo operacional simplificado:

1. Lead entra como **Importado**, sem destino operacional (`channels_id = NULL`).
2. A Home ordena por **nota DESC → avaliações DESC**.
3. O operador usa **Puxar WhatsApp** ou **Puxar Instagram**.
4. Os leads entram em **revisão aberta**, ainda sem `queue_items` e sem snapshot.
5. A única decisão humana da revisão é **Invalidar**; a vaga é reposta com o próximo melhor lead elegível.
6. **Trancar fila** resolve template/contato/mídia e só então cria a fila definitiva e o snapshot canônico.
7. A Base Permanente continua terminal e nunca é alterada por este fluxo.

## Identidade do ramo

- `leads.branches_id` é a referência canônica do **ramo pai**.
- O nome do ramo é sempre resolvido pela tabela `branches`, portanto renomear um ramo reflete automaticamente nos leads existentes.
- `leads_categories` guarda somente categoria/sub-ramo/termo de origem para auditoria do match; não é identidade do ramo.
- Remover ou alterar um sub-ramo não deixa o lead sem ramo.
- A desativação de um ramo é lógica, preservando as referências históricas.

## Atualização

Aplique primeiro:

`supabase/migrations/20260825220000_r23_open_queue_review.sql`

Depois publique o CRM.

Para remover o destino dos leads que **ainda estão Importados**, execute separadamente:

`SQL - R23 - Limpar destino dos Importados.sql`

Esse SQL não escreve na Base Permanente.

## Componentes coordenados

- Vinsansi Captura 1.0.10
- Vinsansi Instagram 2.0.5
- Gerenciador de Disparos 1.3.3
- Worker 3.13.2

R23 não exige release nova desses componentes.
