# V3.7 — Hotfix de import ESM na Vercel

## Problema corrigido

No deploy Vercel, as funções `api/whatsapp/validate.ts` e `api/whatsapp/revalidate.ts` eram transpiladas para JavaScript ESM, mas importavam o módulo auxiliar sem extensão:

```ts
import { handleValidationRequest } from './validation.handler'
```

O Node ESM exige a extensão final no import relativo gerado. Isso causava:

```text
ERR_MODULE_NOT_FOUND: Cannot find module .../validation.handler
```

## Alteração

Os dois imports foram alterados para:

```ts
import { handleValidationRequest } from './validation.handler.js'
```

O TypeScript com `moduleResolution: Bundler` continua resolvendo o arquivo fonte `validation.handler.ts`, enquanto a Vercel resolve o JavaScript compilado `validation.handler.js` em runtime.

## Efeito

- A função volta a iniciar na Vercel.
- A validação pode chegar à Evolution API.
- Não altera tabela, RLS, status, leads ou regras de aprovação.
- Mantém as rotas separadas: `/api/whatsapp/validate` e `/api/whatsapp/revalidate`.
