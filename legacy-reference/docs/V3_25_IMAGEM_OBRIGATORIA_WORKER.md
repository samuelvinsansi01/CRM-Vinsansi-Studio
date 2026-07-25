# V3.25 — Imagem obrigatória no Worker WhatsApp

## Regra operacional

Cada ramo possui `imageName` e `imageRequired`.

- `imageRequired = false`: o Worker envia somente as duas mensagens e não procura arquivo de imagem.
- `imageRequired = true`: antes da primeira mensagem, o Worker procura `WORKER_IMAGES_DIR/{imageName}`. Arquivo ausente, vazio, fora da pasta ou com assinatura de imagem inválida bloqueia todo o disparo. O item é marcado como erro recuperável.

## Compatibilidade

Ramos legados com `imageName` já configurado e sem `imageRequired` são tratados como obrigatórios até que a configuração seja alterada explicitamente.

## Congelamento

Ao entrar na fila WhatsApp, `imageName` e `imageRequired` seguem no payload do item. Alterações posteriores no ramo não mudam itens já alocados.
