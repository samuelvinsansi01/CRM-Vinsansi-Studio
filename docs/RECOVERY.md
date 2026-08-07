# Recuperação operacional

## Worker reiniciado

O lote é retomado do banco. Partes confirmadas são puladas. Partes em janela incerta ficam bloqueadas para reconciliação.

## Item travado

Abra Monitoramento, revise alertas e solicite recuperação. O pedido é persistido e executado pelo Worker ativo.

## Evolution indisponível

Não presuma invalidade do número. Erros técnicos devem permanecer como erro recuperável.

## Instagram interrompido

Etapas anteriores ao envio podem voltar à fila. Interrupções durante mensagens ou mídia exigem reconciliação.

## Banco

Não execute o bootstrap completo em ambiente existente. Restaure backup ou aplique migrations faltantes em ordem.


## Mensagem de chat com resultado incerto

Não envie novamente automaticamente. Verifique a conversa no WhatsApp/Evolution. A mensagem fica em `reconciliation_required`; um webhook posterior com o identificador externo pode reconciliar o estado.

## Webhook de conversa com erro

Consulte `evolution_webhook_receipts`. Recibos em `error` podem ser reenviados pela Evolution e serão reprocessados; recibos `processed` ou `ignored` são deduplicados pelo hash.
