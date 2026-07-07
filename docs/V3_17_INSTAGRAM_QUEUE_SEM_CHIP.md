# V3.17 — Fila Instagram sem chip

## Correção

A tabela `instagram_queue_items` não possui, nem deve possuir, a coluna `chip_id`. Chips pertencem apenas ao fluxo WhatsApp.

A criação e atualização de itens da fila Instagram deixaram de enviar `chip_id` no payload do Supabase. O campo legado pode continuar sendo lido apenas a partir de `data.chip_id`, sem depender de uma coluna física.

## Efeito esperado

Ao salvar um retorno de WhatsApp inválido com Instagram válido, o sistema poderá:

1. localizar um template Geral ativo compatível;
2. selecionar um template de forma aleatória;
3. criar o item em `instagram_queue_items`;
4. só então remover o lead do Pré-Envio Instagram.

Nenhuma alteração de banco é necessária para esta correção.
