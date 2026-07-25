# V3.26 — mídia dinâmica do ramo em filas abertas

## Regra

O ramo passa a ser a fonte de verdade para a mídia de itens que ainda não foram enviados.

- Alterar **Nome da imagem** ou **Imagem obrigatória** no ramo atualiza itens de fila WhatsApp e Instagram em estado aberto/reprocessável.
- A leitura das filas também resolve os dados do ramo em tempo real. Isso cobre itens legados que tenham ficado com dados antigos no JSON.
- A extensão Instagram recebe o nome e a obrigatoriedade atuais pela rota `api/update.ts`.
- Quando `imageRequired = false`, `image_url` é devolvido vazio para que a extensão não anexe imagem.
- Quando `imageRequired = true`, `image_url` recebe o nome atual do arquivo configurado no ramo.

## Limites deliberados

Itens `sending`, `sent`, `invalid`, `deleted` ou `archived` preservam o snapshot histórico e não são alterados automaticamente.

Mensagens e templates continuam congelados na fila; esta mudança atualiza somente a configuração de mídia herdada do ramo.
