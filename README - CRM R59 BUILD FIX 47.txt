CRM R59 BUILD FIX 47

- Remove integralmente o filtro/marcador de aquecimento do webhook Evolution.
- Toda mensagem WhatsApp normal, inclusive entre dois números próprios, volta a seguir o pipeline canônico de Conversas.
- Corrige contaminação de nome: eventos outbound não podem gravar o pushName do próprio chip como nome do contato externo.
- Mantém Aprovado, Projetos, Dashboard, login por senha e todas as correções até o FIX46.
- Sem migration SQL nesta entrega.

IMPORTANTE
Após publicar o CRM, republique a Edge Function supabase/functions/evolution-connection-webhook/index.ts.
