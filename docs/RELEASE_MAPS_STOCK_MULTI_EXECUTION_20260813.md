# Fechamento Maps / Estoque / Multi-execução — 2026-08-13

Esta rodada implementa o contrato de fechamento do Google Maps sem redesenhar o Worker.

## Banco

Aplicar, uma única vez e manualmente em produção, a migration:

`supabase/migrations/20260813120000_maps_inventory_multi_execution_priority.sql`

Ela é forward-only e:

- inclui `google_maps` no `leads_origin_check`;
- preserva `leads_score` como nota Google (0..5);
- cria `leads_priority_score` para ranking interno;
- adiciona metas aditivas e contadores de buckets à execução Maps;
- adiciona rating, avaliações, status de negócio, bucket e proveniência aos candidatos;
- instala criação atômica com limite de 5 execuções ativas por usuário.

Não executar novamente as migrations históricas de identidade bloqueadas.

## Google Maps v0.17.1

- metas por estoque do ramo com override por execução;
- `1000 WA + 500 IG = 1500 candidatos únicos`;
- cada candidato satisfaz somente um `acquisition_bucket`;
- ao atingir a meta, conclui apenas a cobertura corrente e não inicia outra;
- empresas temporária ou permanentemente fechadas não entram no estoque comercial;
- dedupe por aliases e proveniência entre coberturas;
- estado local isolado por `executionId + tabId`;
- máximo global de 5 execuções ativas por usuário, validado no servidor/banco;
- promoção em lotes continua idempotente e expõe o primeiro erro real;
- rating/reviews/URL Maps são promovidos ao lead; a categoria do perfil Maps também é preservada em `leads_categories` junto do ramo/termos.

## CRM

- cadastro de ramo expõe estoque alvo WhatsApp/telefone e Instagram;
- `leads_score` deixa de ser score comercial e permanece nota Google;
- `leads_priority_score` ordena validação/fila; o mapper de leads persistidos carrega `leads_score`, avaliações e prioridade, e leads antigos com prioridade 0 têm fallback calculado em runtime sem reescrita histórica;
- histórico Maps passa a cidade -> cobertura -> Resultados / JSON contextual.

## WhatsApp / Worker

O Worker 3.6.0 não foi redesenhado. Seus contratos de persistência, idempotência por parte, janela operacional e identidade do destinatário foram revalidados.

## Instagram

A extensão foi atualizada para 1.6.0 apontando para a API operacional atual em `crm-vinsansi-studio.vercel.app` e continua aceitando o host customizado legado nas permissões.
