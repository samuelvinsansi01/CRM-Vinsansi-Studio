# V3.39.15 — Correção estrutural de formulários e persistência

## Causa identificada

A camada de normalização misturava o registro antigo com o formulário editado antes de salvar. Campos vazios eram tratados como ausentes e recebiam novamente o valor anterior. No ramo Móveis Planejados, uma lista hardcoded ainda recolocava automaticamente palavras-chave removidas pelo usuário.

## Alterações

- Removida a reinserção hardcoded de palavras-chave de Móveis Planejados.
- Valores explicitamente apagados deixam de ser substituídos pelo conteúdo antigo.
- Listas de categorias e subramos passam a respeitar exatamente o texto atual do formulário.
- Campos editáveis de ramos, templates, chips e perfis Instagram usam o input atual como fonte de verdade.
- Remoção de conteúdo em campos opcionais passa a ser persistida.
- Após create/update, o sistema relê o registro do banco e compara campo a campo.
- A interface não informa sucesso quando o banco devolve conteúdo diferente do enviado.
- Nenhuma regra de importação, fila, WhatsApp, Instagram ou Pré-Envio foi removida.
- Não exige migration nova. A RPC save_branch_config_v1 já existente continua sendo utilizada.
