# Plano de etapas — Vinsansi completo

## Princípios definitivos

1. O CRM/Supabase é a fonte central de verdade do ecossistema.
2. Toda configuração alterável pelo usuário é administrada no CRM.
3. Extensões e apps recebem a configuração publicada pelo CRM e mantêm localmente apenas cache e estado transitório de execução.
4. Segredos permanecem no backend/Vault e nunca são distribuídos como configuração privilegiada ao navegador.
5. Filas continuam canônicas no CRM/Supabase; os executores não criam uma segunda fonte de verdade.
6. WhatsApp é executado pelo Gerenciador; Instagram, pela extensão Instagram.
7. Candidatos de extração que ainda não viraram leads não são persistidos como leads/rejeições permanentes no CRM.
8. Fatos permanentes (lead existente, contato já prospectado, fila, bloqueio explícito) permanecem no banco e participam da elegibilidade futura.

## Etapa 1 — Sanear e congelar a arquitetura atual

- Consolidar a semântica Evolution Go (`sessionSaved`, `socketConnected`, JID e estados operacionais).
- Manter estado administrativo separado de estado operacional.
- Unificar Worker oficial no runtime embarcado pelo Gerenciador e retirar distribuição standalone antiga.
- Preservar a fila canônica do CRM/Supabase.
- Preparar a migração de Conversas do CRM para o Gerenciador sem perda funcional.
- Remover integrações e referências legadas somente depois de suas substituições estarem homologadas.

## Etapa 2 — Central de ferramentas e configurações no CRM

Expandir a infraestrutura central já existente (`settings` / `extension_runtime_config`) para ser o contrato oficial de todos os módulos.

- Cadastro lógico de ferramenta: ID, produto, versão, capabilities e compatibilidade.
- Configuração central por workspace/usuário conforme o modelo atual evoluir.
- Publicação de configuração versionada para Vinsansi Captura, Instagram e Gerenciador.
- Heartbeat/status/última atividade onde fizer sentido.
- Cache da última configuração válida em extensões/apps.
- Extensões não terão configuração de negócio concorrente; poderão apenas exibir resumo e link para "Configurar no CRM".
- Estado transitório (aba atual, checkpoint, candidato pendente, socket, processo local) permanece local.
- Credenciais privilegiadas permanecem no backend/Vault.

## Etapa 3 — Completar o Gerenciador como módulo operacional WhatsApp

- Instâncias, chips, QR, sessão, reconexão e diagnóstico.
- Operação das filas WhatsApp canônicas: progresso e controles estritamente operacionais definidos no produto.
- Falhas, retry seguro e reconciliação.
- Conversas, mensagens recebidas/enviadas, mídia, entrega e filtro por chip.
- Remover Conversas do CRM depois da paridade e homologação.
- Revisar quais controles técnicos da tela Fila WhatsApp deixam o CRM.

## Etapa 4 — Evoluir Google Maps Extractor para Vinsansi Captura

- Uma única extensão de aquisição, começando por Google Maps + Website Reviewer.
- Múltiplas execuções simultâneas e independentes.
- Estado local estruturado (preferencialmente IndexedDB), recuperável após reinício.
- Candidatos não persistidos no CRM antes da aprovação real.
- Todas as regras da extensão vêm da configuração central da Etapa 2.

## Etapa 5 — Critérios e Website Reviewer

- Nota mínima, quantidade mínima de avaliações, exigência de telefone/site/Instagram e demais critérios configurados no CRM.
- Revisão de website integrada à Captura.
- Aprovar, invalidar na execução e bloquear permanentemente como decisões distintas.
- Invalidar por critério/revisão não cria rejeição permanente.

## Etapa 6 — Elegibilidade global e ingresso oficial no CRM

- API oficial de ingresso de aprovados; extensão não grava diretamente em `leads`.
- Deduplicação e concorrência no backend.
- Consultar lead existente, fila, histórico de prospecção e bloqueios permanentes.
- Disparos WhatsApp e demais fatos de prospecção participam da regra de reentrada.
- Envio em lotes X em X configurado no CRM.
- Somente aprovados/elegíveis viram leads oficiais.

## Etapa 7 — Equipes, membros, funções e permissões

- Workspace, equipes, membros, funções e permissões granulares.
- Owner permanece com acesso total no cenário atual.
- RLS/ownership preparados para expansão sem reconstruir o domínio posteriormente.

## Etapa 8 — Novas fontes de aquisição

- Facebook e grupos/novas fontes entram como módulos/adapters do Vinsansi Captura.
- Reutilizam configuração central, armazenamento local, critérios, aprovação, elegibilidade e ingresso oficial.
- Extração de membros é aquisição; execução/disparo WhatsApp permanece no Gerenciador.

## Etapa 9 — Ferramentas avançadas WhatsApp

- Aquecimento de chips.
- Gestão e utilitários de grupos.
- Rotinas de saúde/reputação e demais ferramentas auxiliares aprovadas no produto.
- Configurações centralizadas no CRM; execução técnica pertence ao Gerenciador quando aplicável.

## Etapa 10 — Navegação e IDV definitiva

- Reorganizar menus com os domínios finais já conhecidos.
- Consolidar Ferramentas/Plugins, Operação, Leads e Configurações.
- Aplicar IDV comum em CRM, Gerenciador, Captura e Instagram.
- Padronizar estados, ícones, erros, versões, notificações e onboarding.

# Final e fechamento

Sem novas features nesta fase.

- Homologação ponta a ponta WhatsApp e Instagram.
- Homologação das origens suportadas de aquisição.
- Concorrência: múltiplas extrações, múltiplos chips, Instagram e filas simultâneas.
- Recuperação: PC, Docker, containers, imagens, Chrome, extensões, Gerenciador, Worker/runtime, internet e WebSocket.
- Segurança: RLS, ownership, permissões, pairing, Vault e isolamento.
- Limpeza de banco/código legado, migrations e funções antigas.
- Backup e restore comprovados.
- Instalação/configuração sem edição manual de código.
- Diagnóstico por componente: versão, conexão, autenticação, heartbeat, erro e compatibilidade.
- Documentação operacional e técnica mínima.

## Critério de sistema completo

O sistema é considerado completo quando for possível captar, qualificar, aprovar, deduplicar, inserir, validar, rotear, enfileirar, executar e registrar a prospecção de ponta a ponta por todos os canais suportados, com múltiplos recursos, recuperação automática e sem intervenção manual em código ou banco.
