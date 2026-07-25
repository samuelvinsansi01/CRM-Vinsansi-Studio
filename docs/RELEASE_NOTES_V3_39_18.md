# V3.39.18

## Correção da exceção de qualificação para Instagram na importação

A regra complementar de Instagram agora é aplicada quando o lead não atinge os critérios normais de nota **ou** de quantidade de avaliações, desde que:

- tenha passado pelas validações anteriores de nome, duplicidade, Base Permanente e ramo configurado;
- a rota Instagram esteja ativa;
- a exceção esteja ativa;
- possua nota maior ou igual ao mínimo da exceção;
- possua avaliações maiores ou iguais ao mínimo da exceção.

Com os padrões atuais:

- fluxo normal: nota >= 4,0 e reviews >= 10;
- fluxo Instagram: nota >= 3,7 e reviews >= 5, somente quando o fluxo normal não for atendido.

A configuração de nota máxima deixou de participar da decisão. O campo antigo permanece compatível nos dados salvos, mas não é mais exibido nem utilizado pela importação.
