# Painel CRM — interface preservada

Esta versão mantém a interface, navegação, páginas, componentes e estilos do CRM original.

A camada de persistência antiga foi removida. Os repositórios ativos retornam estados vazios de leitura e bloqueiam alterações com uma mensagem clara até que cada módulo seja ligado ao banco novo.

## Mantido
- Design e estilos originais
- Layout e navegação
- Páginas, tabelas, filtros, modais e componentes
- Tipos usados pela interface

## Removido
- Repositórios Supabase antigos
- Repositórios mock com regras duplicadas
- APIs e migrations do banco antigo
- Documentação de releases antigas

## Próximo passo
Implementar os repositórios por domínio usando somente o novo schema do Supabase.
