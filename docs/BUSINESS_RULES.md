# Regras de negócio

## Lead

Estados: importado, validado, pré-envio, na fila, enviado, inválido, duplicado e arquivado.

## Identidade

A empresa é comparada por telefone normalizado, Instagram, domínio, Maps e identificador da fonte. Uma correspondência isolada em encurtador ou agregador não deve ser tratada como domínio empresarial.

## Capacidade

A capacidade é validada pelo banco por usuário, canal, recurso e data operacional. O frontend exibe apenas uma previsão.

## Disparo

Cada fila contém um snapshot imutável das quatro mensagens, variáveis, destinatário e referência de mídia. Partes confirmadas nunca são reenviadas em reprocessamentos.

## Resultado incerto

Quando o provedor pode ter recebido a mensagem, mas a confirmação não foi persistida, o item entra em reconciliação manual.

## Base Permanente

A Base é consolidada por identidade canônica e reúne leads relacionados, envios, supressão, desfecho, notas e snapshots históricos.
