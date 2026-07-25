# V3.20 — Correção da extensão Instagram no runtime Vercel

## Problema corrigido

A função `api/update.ts`, chamada pela extensão Chrome para carregar e atualizar a fila Instagram, importava `renderLeadMessages` do diretório `src/`. No runtime serverless esse módulo não foi resolvido:

`ERR_MODULE_NOT_FOUND: /var/task/src/services/templates/templateVariables`

Por isso o carregamento de fila e a autoatualização retornavam `FUNCTION_INVOCATION_FAILED`.

## Correção

A interpolação de variáveis de templates foi colocada localmente em `api/update.ts`. A função serverless não depende mais de import relativo ao frontend.

As variáveis continuam compatíveis com `{EMPRESA}`, `{{EMPRESA}}`, `[EMPRESA]` e `%EMPRESA%`, além de ramo, cidade, estado, telefone, Instagram e site.
