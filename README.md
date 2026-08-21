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
