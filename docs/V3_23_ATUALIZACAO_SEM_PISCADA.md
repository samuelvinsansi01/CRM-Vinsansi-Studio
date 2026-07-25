# V3.23 — Atualização sem piscada

## Objetivo

Evitar que listas e lotes desapareçam visualmente a cada ação do operador ou atualização automática.

## Ajustes

- Separação entre carregamento inicial (`loading`) e atualização em segundo plano (`refreshing`).
- Dados existentes permanecem renderizados enquanto o Supabase é consultado novamente.
- Pré-Envio remove imediatamente da lista local os leads arquivados, invalidados ou marcados como já enviados, depois sincroniza em segundo plano.
- Ao salvar um lead do Instagram, a linha é atualizada localmente ou removida imediatamente quando a fila foi criada.
- Fila WhatsApp, fila Instagram, Início, Base Permanente e tabelas de configuração passaram a manter os dados durante atualizações posteriores ao carregamento inicial.
- Indicador discreto “Atualizando...” substitui a tela/lote vazio durante sincronização.

## Regra de segurança

A interface só aplica a alteração visual local depois de a operação no banco concluir com sucesso. Em seguida, realiza uma leitura de confirmação em segundo plano.
