# Implantação

## Ordem obrigatória

1. Pausar importações e disparos.
2. Confirmar backup.
3. Executar somente a migration nova no Supabase.
4. Publicar Edge Functions alteradas, quando houver.
5. Publicar o ZIP cumulativo do Painel.
6. Atualizar Worker e extensão pela página Ferramentas.
7. Executar testes controlados.
8. Retomar gradualmente.

## Novo ambiente

Use `supabase/baseline/bootstrap_full.sql` somente em projeto Supabase novo e vazio. Depois configure secrets, Edge Functions, Storage e autenticação.

## Verificações

```bash
npm ci
npm run verify:all
npm run build
```

No banco:

```sql
select public.platform_schema_health();
```


## Chat por chip

Depois da migration da Etapa 13, publique novamente `evolution-instance-sync` e `evolution-connection-webhook`. Em seguida, use **Sincronizar Evolution** no painel para incluir os eventos de mensagens, chats e contatos no webhook de cada instância. O endpoint de envio `/api/chat/send` exige `SUPABASE_SERVICE_ROLE_KEY` apenas no ambiente server-side.

## Gerenciador de Disparos desktop — provisionamento do Worker

A versão desktop v0.5.0 adiciona `POST /api/desktop/worker-provision` para preparar o Worker 3.6.0 sem pedir Service Role ao usuário na interface.

Configure no ambiente server-side do CRM:

```text
DESKTOP_WORKER_PROVISIONING_ENABLED=true
DESKTOP_WORKER_PROVISIONING_ALLOWED_EMAILS=email-google-autorizado@dominio.com
```

`SUPABASE_SERVICE_ROLE_KEY` continua exclusivamente server-side. O endpoint autentica a sessão Google, exige allowlist explícita e cifra a credencial com uma chave pública RSA temporária gerada pelo Gerenciador. O endpoint não retorna a Service Role em texto claro.

Para mais de uma conta autorizada, separe os e-mails por vírgula.
