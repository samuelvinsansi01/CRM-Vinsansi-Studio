# V3.13 — Salvamento seguro de retornos Instagram

## Correção

O salvamento do link Instagram em um retorno de WhatsApp inválido não pode mais fazer o lead desaparecer do Pré-Envio quando faltar template, perfil ou outro requisito operacional.

## Novo comportamento

1. O link Instagram é salvo no lead.
2. O sistema tenta encaminhar o lead para a fila Instagram.
3. Se o encaminhamento for possível, o lead entra na fila e só então recebe status `queued`.
4. Se faltar template, perfil, capacidade ou houver outro bloqueio:
   - o lead fica no card Instagram do Pré-Envio;
   - o link salvo é preservado;
   - o status retorna/permanence em `review`;
   - a pendência é salva em `queueWaitReason` e exibida no drawer;
   - a tela mostra uma notificação agregada, sem lançar erro fatal.

## Proteções adicionais

- Retornos Instagram são listados no card Instagram independentemente de o link estar pendente, confirmado ou aguardando configuração.
- Uma falha em um lead não interrompe o preenchimento dos demais retornos prontos para fila.
- Leads aprovados para Instagram no Início que falharem por template/configuração permanecem no Início e não são marcados como `queued`.

## Banco

Não exige SQL, migração ou alteração de variáveis.
