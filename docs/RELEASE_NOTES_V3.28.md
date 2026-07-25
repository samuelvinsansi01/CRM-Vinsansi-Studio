# Lead Certo V3.28

- Corrigido `worker_token_invalid` no envio da fila WhatsApp.
- O painel não chama mais o Worker público diretamente.
- Nova rota Vercel `/api/whatsapp/dispatch` valida sessão Supabase, confere posse dos itens via RLS e injeta o token do Worker somente no backend.
- `VITE_WHATSAPP_WORKER_DISPATCH_ENDPOINT` externo é ignorado para impedir que segredo de Worker seja exposto no navegador.
- Adicionada documentação de variáveis da Vercel e teste seguro com `DRY_RUN`.
