# Lead Certo V3 — implantação e contrato operacional

Esta versão consolida a persistência no contrato canônico e bloqueia conclusões de envio sem confirmação externa.

## 1. Ordem de implantação

1. Faça backup do projeto e do banco Supabase.
2. Execute `supabase/migration_v3_canonical_contract.sql` uma única vez, tanto em instalação nova quanto em ambiente já existente. O arquivo já cria as tabelas canônicas que estiverem ausentes.
3. Use `supabase/schema.sql` somente como referência ou em uma instalação manual; não é necessário executá-lo antes da migração V3.
4. Configure as variáveis de ambiente a partir de `.env.example`.
5. Publique o frontend e as rotas `api/` no mesmo deploy.
6. Execute `npm ci` e `npm run build` antes de publicar.

A migração mantém as tabelas antigas intactas e copia registros conhecidos de `whatsapp_instances`, `message_templates`, `pre_dispatch_items`, `instagram_dispatch_items`, `contact_events` e `dispatch_message_logs` para o contrato atual quando essas tabelas existirem.

## 2. Tabelas usadas em produção

- `chips`
- `instagram_profiles`
- `branches`
- `templates`
- `leads`
- `pre_send_leads`
- `whatsapp_queue_items`
- `instagram_queue_items`
- `base_permanente`
- `sent_contacts`
- `lead_events`
- `lead_dispatch_messages`
- `app_settings`
- `import_batches`
- `lead_imports`
- `lead_registry`

Não configure as variáveis `VITE_SUPABASE_TABLE_*` para nomes legados depois de migrar os dados.

## 3. Workers de envio

O navegador não deve ter credenciais da Evolution nem de contas Instagram. Ele apenas envia IDs da fila ao backend.

### WhatsApp

Configure `VITE_WHATSAPP_WORKER_DISPATCH_ENDPOINT` para uma rota autenticada do worker. O painel envia:

```json
{ "channel": "whatsapp", "queue_item_ids": ["id-1", "id-2"] }
```

O worker precisa responder um resultado por item:

```json
{
  "results": [
    { "leadId": "id-1", "status": "sent" },
    { "leadId": "id-2", "status": "error", "errorMessage": "motivo" }
  ]
}
```

Status aceitos: `sent`, `error` e `paused`.

### Instagram

Configure `VITE_INSTAGRAM_WORKER_DISPATCH_ENDPOINT` para uma rota autenticada do worker. O formato é o mesmo, com `channel: "instagram"` e status `sent` ou `error`.

O painel não marca itens Instagram como enviados se o endpoint estiver ausente, falhar ou retornar resultados incompletos. Nesses casos, os itens entram em `error` para reprocessamento.

A rota `api/update.ts` continua sendo a API da extensão Instagram. Ela exige `INSTAGRAM_EXTENSION_SECRET` no backend e, ao receber confirmação `sent`, grava a Base Permanente, `sent_contacts`, eventos, pré-envio e importação antes de atualizar a fila.

## 4. Validação WhatsApp

A política padrão mudou para segura:

```env
VITE_WHATSAPP_INVALID_ACTION=review
```

Números inválidos, erros do provider ou respostas incompletas permanecem em `review` com metadados de tentativa e erro. Eles podem ser validados novamente.

Para manter o comportamento antigo de retornar automaticamente o lead à importação como Instagram, configure explicitamente:

```env
VITE_WHATSAPP_INVALID_ACTION=instagram
```

## 5. Garantias adicionadas

- Transições de exclusão da Base Permanente passam pela máquina de estados.
- Leads só entram na fila a partir de pré-envio `approved`.
- A Base Permanente é persistida antes de fila/pre-envio aparecerem como `sent`.
- A importação é atualizada para `sent` após confirmação real da fila.
- `source_pre_send_id` impede duplicação da mesma origem em cada fila.
- Eventos e logs de dispatch usam tabelas canônicas distintas.
- A extensão Instagram não pode concluir envio sem o segredo do backend.

## 6. Checklist de validação após publicar

1. Criar um lead e aprová-lo.
2. Enviar ao pré-envio e validar WhatsApp com número válido.
3. Simular erro de validação e confirmar que o status fica em `review`.
4. Enviar um item WhatsApp e confirmar atualização em fila, pré-envio, importação, Base e `sent_contacts`.
5. Repetir para Instagram pela extensão, usando o segredo correto.
6. Tentar inserir novamente o mesmo `source_pre_send_id` e confirmar que não cria duplicidade.
7. Testar pausa, erro e reprocessamento nas duas filas.
