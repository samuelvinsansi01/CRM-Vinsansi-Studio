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
