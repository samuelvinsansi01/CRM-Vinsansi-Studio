# V3.19 — Retorno WhatsApp com Instagram automático

## Regra implementada

Quando a validação WhatsApp, inicial ou revalidação, retornar uma inexistência explícita:

1. O lead deixa de reservar capacidade no WhatsApp.
2. O sistema preserva o Instagram já cadastrado.
3. Se o Instagram for válido, o lead é marcado como pronto para fila Instagram no dia operacional atual — ou no próximo dia após 22h.
4. A fila Instagram é preenchida automaticamente, sempre priorizando retornos de WhatsApp antes de leads aprovados diretamente no Início.
5. Template compatível, perfil Instagram ativo e capacidade ainda são obrigatórios.
6. O lead só sai do Pré-Envio depois da criação real em `instagram_queue_items`.

Sem Instagram válido, o lead continua no card Instagram do Pré-Envio aguardando somente o link. Erros do provider ou respostas ambíguas continuam em revisão e não trocam de canal.
