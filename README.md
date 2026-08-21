# CRM - Vinsansi Studio v1.1.0

CRM central da plataforma Vinsansi para aquisição, qualificação, roteamento, filas multicanal e gestão organizacional.

## Arquitetura desta versão

- CRM/Supabase continuam como fonte central de verdade.
- Worker WhatsApp continua embarcado no Gerenciador de Disparos; não existe download de Worker standalone no CRM.
- Extensão Instagram continua como executor do canal Instagram.
- Google Maps continua operacional e será evoluído para Vinsansi Captura nas etapas seguintes.
- Organizações passam a ser o tenant canônico dos dados.
- Acesso interno passa a usar Platform Owner, Dono, Gestor, Membro, funções editáveis e permissões granulares.
- Ações humanas relevantes passam a registrar autoria por membro e auditoria por organização.

## Instalação da v1.1.0

1. A v1.0.2 corrigida deve estar aplicada e homologada.
2. Execute `APLICAR-NO-SUPABASE-v1.1.0.sql` no SQL Editor do Supabase.
3. Atualize somente a Edge Function `evolution-instance-sync`, conforme `PASSO-A-PASSO-v1.1.0.md`.
4. Configure as variáveis server-side descritas em `.env.example`.
5. Publique o CRM.
6. Execute `npm run build` no ambiente de deploy e faça o checklist de homologação.

Consulte `PASSO-A-PASSO-v1.1.0.md` para a ordem exata.
