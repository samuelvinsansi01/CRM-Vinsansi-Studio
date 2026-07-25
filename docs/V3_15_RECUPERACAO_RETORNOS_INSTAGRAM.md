# V3.15 — Recuperação de retornos Instagram

## Correção

Versões anteriores podiam manter `dayId` com prefixo `whatsapp-` depois de um retorno mudar o canal para Instagram. Exemplo: `channel=Instagram` e `dayId=whatsapp-terca`.

Isso fazia o lead ficar fora do card Instagram selecionado, embora continuasse no Pré-Envio.

## Comportamento novo

- O prefixo de `dayId` é normalizado pelo canal ao ler e salvar o registro.
- Retornos WhatsApp → Instagram, inclusive os já existentes com link salvo, ficam em `review` no card Instagram.
- Ao salvar o drawer com Instagram válido, o retorno usa o primeiro perfil Instagram ativo e tenta a fila de forma segura.
- Se faltar template, perfil ou capacidade, permanece visível no card Instagram com a pendência.
- O campo do drawer e a coluna mostram `instagram_url` mesmo quando o campo legado `instagram` está vazio.

Nenhuma migração SQL é necessária.
