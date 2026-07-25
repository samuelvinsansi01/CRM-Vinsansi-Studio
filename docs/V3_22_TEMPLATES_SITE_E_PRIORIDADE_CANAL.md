# V3.22 — Templates por site e prioridade de canal

## Regra de tipo

A classificação de mensagem passa a depender do dado do lead, e não do destino/canal atual:

- lead com site comercial/agregador: `com-site`;
- lead sem site, ou somente Instagram/Facebook/WhatsApp: `sem-site`.

A classificação é salva em `pre_send_leads.data.templateType`. Quando um lead sai de WhatsApp e vai para Instagram, seu tipo continua o mesmo.

## Prioridade de seleção

Para cada lead, somente templates ativos do tipo exato participam. A ordem é:

1. mesmo ramo + canal do lead + tipo exato;
2. mesmo ramo + canal `Geral` + tipo exato;
3. ramo global + canal do lead + tipo exato;
4. ramo global + canal `Geral` + tipo exato.

Quando existirem vários templates no melhor nível, um deles é sorteado.

Não existe fallback entre `com-site` e `sem-site`.

## Templates já atribuídos

No Pré-Envio, uma atribuição existente só é mantida quando ela ainda pertence ao melhor nível disponível. Atribuições antigas com tipo incorreto ou com `Geral` enquanto já existe template específico de canal serão substituídas na próxima tentativa de criar fila.

Itens que já estão em fila não são reescritos automaticamente, pois já possuem mensagem renderizada e podem estar sendo processados pela extensão. Eles permanecem estáveis; novas entradas seguirão a regra corrigida.
