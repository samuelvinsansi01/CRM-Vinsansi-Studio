# Fluxo 1 — Ciclo de leads

## Regras oficiais

- `lead_status_id = 1` → Importado
- `lead_status_id = 2` → Validado
- `lead_status_id = 3` → Pré-Envio
- `lead_status_id = 4` → Na Fila
- `lead_status_id = 5` → Enviado
- `lead_status_id = 6` → Inválido
- `lead_status_id = 7` → Duplicado
- `lead_status_id = 8` → Arquivado
- `channels_id = 1` → WhatsApp
- `channels_id = 2` → Instagram
- `contact_sources_id = 2` → Domínio próprio
- `contact_sources_id = 3` → Agregador

## Início

Consulta somente `lead_status_id = 1` → Importado.

Cards exibem totais simples da própria página:

- Total: todos os importados;
- WhatsApp: importados que possuem telefone;
- Com site: importados com `contact_sources_id = 2` → Domínio próprio;
- Agregadores: importados com `contact_sources_id = 3` → Agregador;
- Instagram: importados que possuem Instagram.

Os filtros originais foram preservados e a busca permanece por último, à direita.

## Pré-Envio

Consulta somente:

- `lead_status_id = 3` → Pré-Envio;
- `channels_id = 1` → WhatsApp.

Aprovação envia para `lead_status_id = 2` → Validado.

## Válidos

Consulta somente `lead_status_id = 2` → Validado.

Cards:

- Total;
- `channels_id = 1` → WhatsApp;
- `channels_id = 2` → Instagram.

Filtros: Canal, Ramo e Busca, com a busca por último.

## Base Permanente

Consulta somente:

- `lead_status_id = 5` → Enviado;
- `lead_status_id = 6` → Inválido;
- `lead_status_id = 7` → Duplicado;
- `lead_status_id = 8` → Arquivado.

O card combinado foi renomeado para “Inválidos e duplicados”, exibindo apenas a soma.

## Arquitetura

As quatro páginas usam:

`página → useLeadCycle → leadCycleService → leads`

Não usam tabelas legadas do ciclo.
