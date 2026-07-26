# Correção dos contadores e carregamento de leads

Alterações aplicadas:

- Base Permanente agora percorre todas as páginas da tabela `leads`, sem ficar limitada aos primeiros 1000 registros.
- A tela Início agora lê a estrutura normalizada da tabela `leads` (`leads_id`, relacionamentos e status), eliminando o colapso dos registros em um único ID indefinido.
- As consultas são refeitas contra o banco a cada atualização da tela/evento; novos leads inseridos futuramente entram nas contagens e listagens.
- Ordenação estável por `leads_created_at` e `leads_id`.

Validação esperada com o banco atual:

- Base Permanente: 2267 registros.
- Início operacional: 1037 importados + 110 validados = 1147 registros.

Observação: o ambiente de empacotamento não conseguiu baixar as dependências NPM, portanto o build local completo não foi concluído aqui. O código-fonte foi atualizado no ZIP.
