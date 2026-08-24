# CRM - Vinsansi Studio v2.4.0 — Release Candidate das Etapas 1–15

**Revisão atual do pacote: R12.** Ajustes finais de telemetria e fila manual da Etapa 8 em `CORRECAO-CRM-2.4.0-R12.md`.

Esta árvore contém a implementação completa das Etapas 8–15 sobre a base homologada das Etapas 1–7. A v2.4.0 é **Release Candidate** até a checklist persistente da Etapa 15 ser aprovada. A migration final não promove Stable sozinha; a promoção exige uma rodada aprovada, schema saudável, ausência de alerta crítico e Platform Owner.

Componentes coordenados: Gerenciador 1.3.0, Worker 3.13.0, Gateway 1.2.7, Evolution Go 0.7.2, Vinsansi Captura 1.0.9 e Vinsansi Instagram 2.0.0. WhatsApp permanece texto-only.

Use `PASSO-A-PASSO-ETAPAS-8-A-15.md` e `ETAPAS-8-A-15-IMPLEMENTADAS.md`.

## v1.6.0 — Etapa 7: identidade canônica + deduplicação transversal

Esta release consolida a identidade dos leads por **organização**, não por usuário legado. Telefone, Instagram, domínio e Maps passam a usar registry canônico tenant-aware; referências canônicas não podem cruzar organizações e leads finalizados alimentam a supressão persistente que já é consultada pela importação. A Etapa 7 também audita deduplicações/supressões e permite restaurar para `importado` um lead marcado automaticamente como duplicado quando a identidade conflitante é corrigida.

Para atualizar a base v1.5.0, use `PATCH-ETAPA-7-IDENTIDADE-DEDUP-SUPRESSAO-v1.6.0.sql`. Para instalação limpa, use `APLICAR-NO-SUPABASE-v1.6.0.sql`. Esta etapa não exige alteração no Gerenciador, Worker, Gateway ou Evolution Go. Consulte `PASSO-A-PASSO-v1.6.0.md`.

## v1.5.0 — Etapa 6: auditoria persistente + máquina de estados

Esta release endurece a auditoria como histórico **append-only** no PostgreSQL e move a validação das transições críticas de leads e itens de fila para a camada de banco. O registro passa a validar organização/ator/entidade no momento da inserção, preserva `request_id` para rastreabilidade e bloqueia `UPDATE`/`DELETE` sobre eventos de auditoria.

Para atualizar a base v1.4.3, use `PATCH-ETAPA-6-AUDITORIA-ESTADOS-v1.5.0.sql`. Para instalação limpa, use `APLICAR-NO-SUPABASE-v1.5.0.sql`. Esta etapa não exige alteração no Gerenciador, Worker, Gateway ou Evolution Go. Consulte `PASSO-A-PASSO-v1.5.0.md`.

## v1.4.3 — Identidade canônica das Conversas

Use `PATCH-ETAPA-5-IDENTIDADE-CONVERSAS-v1.4.3.sql` sobre a base v1.4.2. Depois republique a Edge Function `evolution-connection-webhook`, porque ela agora entende diretamente o contrato Evolution Go com `Info.ChatAlt`/`Info.SenderAlt` e prefere o JID telefônico ao LID. O patch também repara threads antigas quando o payload histórico contém essa relação, sempre preservando a separação entre chips.

Para instalação limpa, use `APLICAR-NO-SUPABASE-v1.4.3.sql`.

## v1.4.2 — Supabase Realtime para Conversas

Esta release habilita `conversations` e `conversation_messages` no `supabase_realtime`, mantendo RLS por organização e somente leitura para o papel `authenticated`. Use `PATCH-ETAPA-5-REALTIME-v1.4.2.sql` sobre a base v1.4.1. Para instalação consolidada, use `APLICAR-NO-SUPABASE-v1.4.2.sql`. Não há mudança no Worker, Gateway, Evolution Go ou política text-only.

## v1.4.1 — fechamento da Etapa 5 (texto-only)

Esta release bloqueia mídia na resposta manual e no endpoint de mídia, mantém somente texto/caption no webhook sem armazenar bytes/arquivos, expõe o canal seguro usado pelo Gerenciador para presença `composing/paused` e reabre conversas arquivadas apenas quando chega uma mensagem inbound nova. Aplique `APLICAR-NO-SUPABASE-v1.4.1.sql` sobre a base atual ou o patch corretivo v1.4.1 quando a v1.4.0 já estiver instalada.

# CRM - Vinsansi Studio v1.2.0

CRM central da plataforma Vinsansi para aquisição, qualificação, roteamento, filas multicanal e gestão organizacional.

## Arquitetura desta versão

- CRM/Supabase continuam como fonte central de verdade.
- Worker WhatsApp continua embarcado no Gerenciador de Disparos; não existe download de Worker standalone no CRM.
- Extensão Instagram continua como executor do canal Instagram.
- Google Maps continua operacional e será evoluído para Vinsansi Captura nas etapas seguintes.
- Organizações são o tenant canônico dos dados e recursos.
- Platform Owner, Dono, Gestor, Membro, funções e permissões da Etapa 2 permanecem congelados.
- A Central de Ferramentas governa registro, instalações, settings, entitlements, versões, capabilities e presença.
- `organization_tool_settings` é a fonte única das configurações comerciais dos executores.

## Instalação da v1.2.0

1. A Etapa 2 / v1.1.0 deve estar aplicada e homologada.
2. Execute `APLICAR-NO-SUPABASE-v1.2.0.sql` no SQL Editor do Supabase.
3. Não há Edge Function nem variável de ambiente nova nesta etapa.
4. Publique o CRM e os handlers Maps junto da aplicação.
5. Execute `npm run verify:release`, `npm run verify:stage3:sql` e `npm run build`.

Consulte `PASSO-A-PASSO-v1.2.0.md` para a ordem exata.
