# Correção de separação por etapa do ciclo

Regras aplicadas:

- Início: `importado` (1) e a visualização de validados continua separada pelo filtro `validado` (2).
- Pré-envio: somente `pre_envio` (3).
- Fila: somente estados operacionais de fila (`na_fila`, enviando ou pausado).
- Base Permanente: somente estados finais `enviado` (5), `invalido` (6), `duplicado` (7) e `arquivado` (8).
- `pre_envio` não é mais interpretado como `na_fila`.

As consultas continuam paginadas, portanto novos leads aparecem automaticamente na etapa correspondente ao `lead_status_id`.
