# V3.16 — Retorno Instagram no dia operacional

## Correção

Um lead que falhava na validação WhatsApp podia manter o `dayId` original do canal WhatsApp. Ao ser convertido para Instagram, um registro como `whatsapp-segunda` podia continuar associado à segunda-feira, mesmo quando a falha ocorria em uma terça-feira. Como a semana é exibida de domingo a sábado, isso fazia o retorno parecer estar no dia anterior ou na próxima semana.

## Regra V3.16

- WhatsApp inválido: entra em `instagram-<dia atual>`.
- Após 22h: entra em `instagram-<dia seguinte>`.
- Ao salvar/confirmar o link no drawer: o retorno é alocado para o mesmo dia operacional e tenta a fila Instagram.
- Se houver perfil ativo, capacidade e template compatível: cria item na fila e só então move o Pré-Envio para `queued`.
- Sem capacidade/configuração: continua no card Instagram do dia operacional, com o link preservado.

## Recuperação de retorno já afetado

Depois do deploy, abra o lead no card Instagram e clique em **Salvar** uma vez. A edição reposiciona o lead no dia operacional atual e tenta a fila novamente; não apaga link ou histórico.
