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
