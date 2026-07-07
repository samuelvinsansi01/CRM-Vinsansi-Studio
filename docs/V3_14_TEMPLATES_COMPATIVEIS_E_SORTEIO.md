# V3.14 — Templates compatíveis e sorteio por lead

## Regras aplicadas

A regra de canal **Geral** não significa que o template ignore o ramo: ele atende WhatsApp e Instagram dentro do ramo correspondente. Templates globais legados (`Geral`, `Global`, `Todos` ou sem ramo) também são aceitos apenas como último fallback.

- Template ativo de canal **Geral** pode atender leads WhatsApp e Instagram do mesmo ramo.
- O sistema procura primeiro template específico do canal e, se não houver, usa o canal Geral.
- O tipo de destino (`com-site` / `sem-site`) tem prioridade. Quando não houver template daquele tipo, a plataforma usa outro tipo compatível do mesmo ramo antes de bloquear o lead.
- Quando houver mais de um template no mesmo nível de compatibilidade, um é escolhido aleatoriamente.
- A escolha fica registrada no Pré-Envio em `templateId`, `templateAssignedAt` e `templateSelectionSource`; uma nova tentativa preserva o template, desde que ele continue ativo e compatível.
- Se o template escolhido for arquivado, inativado ou deixar de ser compatível, a próxima tentativa sorteia outro template elegível.

## Segurança do fluxo Instagram

- Salvar Instagram válido mantém o retorno no card Instagram do Pré-Envio com `review` até a fila existir.
- O lead só muda para `queued` após a criação efetiva na fila Instagram.
- Falta de template, capacidade ou perfil deixa o lead visível no card Instagram, com a pendência operacional.
