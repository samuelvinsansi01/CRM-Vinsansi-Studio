CRM R59 BUILD FIX 45

Correção de recebimento entre chips próprios.

Causa: o FIX39 descartava todo tráfego entre chips cadastrados na mesma organização. Isso fazia uma mensagem normal entre dois chips próprios desaparecer antes de chegar a Conversas.

Correção:
- o webhook só ignora MESSAGE_EVENTS contendo o marcador invisível exclusivo do aquecimento;
- o remetente ainda precisa ser outro chip da mesma organização;
- mensagem normal entre chips próprios segue o pipeline canônico;
- o marcador é avaliado antes da persistência e não entra no banco;
- não há migration SQL neste FIX.

Importante: publicar novamente a Edge Function evolution-connection-webhook.
