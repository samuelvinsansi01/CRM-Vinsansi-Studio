# Painel CRM — base limpa

Esta pasta é a nova aplicação ativa. O CRM anterior foi preservado em `legacy-reference/` apenas para consulta de regras e telas; ele não participa do build.

## Começar

```bash
cp .env.example .env
npm install
npm run dev
```

## Regra arquitetural

Cada domínio novo deve ficar em `src/modules/<dominio>` e acessar o Supabase por uma camada própria. Não recrie helpers genéricos baseados em campos `data`, `status`, `active` ou tabelas antigas.

## Ordem sugerida

1. Gerar os tipos oficiais do banco.
2. Confirmar RLS da tabela `users`.
3. Implementar `leads`.
4. Implementar importações.
5. Implementar fila única.
6. Implementar disparos e histórico.
7. Implementar templates e configurações.
