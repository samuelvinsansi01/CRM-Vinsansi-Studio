# Fluxo de leads válidos

- Início exibe somente leads pendentes/importados.
- Pré-Envio exibe somente WhatsApp que ainda precisa de validação.
- Ao validar o WhatsApp, o registro de origem muda para `validado` e sai do Pré-Envio.
- A tela fixa **Válidos** exibe somente `lead_status_id = 2`.
- As filas continuam consumindo apenas registros `validado` compatíveis com o destino.
- Quando a fila incorpora o lead, o status muda para `na_fila`.
- Instagram não passa pelo Pré-Envio: o link é informado no Início e, ao validar, o lead aparece em Válidos.
