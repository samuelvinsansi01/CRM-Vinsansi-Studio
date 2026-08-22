import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const exists=file=>fs.existsSync(path.join(root,file));
const expect=(condition,message)=>{if(!condition)throw new Error(message);};

expect(JSON.parse(read('package.json')).version==='1.4.0','CRM release must be 1.4.0');
for(const file of ['PATCH-ETAPA-5-FASE-A-CONVERSAS.sql','APLICAR-NO-SUPABASE-v1.4.0.sql','supabase/migrations/20260823120000_whatsapp_manager_conversations.sql','server/whatsapp/stage5.ts','server/routes/whatsapp/conversations.ts','server/routes/whatsapp/conversation-messages.ts','server/routes/whatsapp/conversation-action.ts','server/routes/whatsapp/conversation-presence.ts','server/routes/whatsapp/manual-message.ts','server/routes/whatsapp/conversation-media.ts','server/routes/whatsapp/queue-operations.ts'])expect(exists(file),`${file} missing`);
const sql=read('supabase/migrations/20260823120000_whatsapp_manager_conversations.sql');
for(const token of ['organizations_id,chips_id,remote_jid','conversation_version','conversation_member_states','conversation_presence','client_idempotency_key','sent_by_member_id','executed_by','reconciliation_required','conversation-media','whatsapp.assign','FOR UPDATE','service_stage5_converge_automatic_message','queue_item_requires_reconciliation'])expect(sql.includes(token),`Stage5 SQL missing ${token}`);
expect(!/RETURNS\s+TABLE/i.test(sql),'Stage5 RPCs must not introduce RETURNS TABLE positional contracts');
const patch=read('PATCH-ETAPA-5-FASE-A-CONVERSAS.sql');expect(patch===sql,'Stage5 incremental patch diverges from migration');
const consolidated=read('APLICAR-NO-SUPABASE-v1.4.0.sql');for(const token of ['CRM Vinsansi Studio v1.4.0','service_stage5_prepare_manual_message','service_stage5_reconcile_queue_item','conversation-media'])expect(consolidated.includes(token),`Consolidated v1.4.0 missing ${token}`);
const webhook=read('supabase/functions/evolution-connection-webhook/index.ts');for(const token of ['organizations_id','conversation-media','media_archive_status','payloadWithoutMediaBytes','service_ingest_evolution_message'])expect(webhook.includes(token),`Webhook missing ${token}`);
const router=read('server/routes/whatsapp/router.ts');for(const route of ['conversations','conversation-messages','conversation-action','conversation-members','conversation-presence','manual-message','conversation-media','queue-operations'])expect(router.includes(route),`WhatsApp router missing ${route}`);
const runtime=read('server/routes/tools/executor/runtime.ts');expect(runtime.includes('service_stage5_converge_automatic_message'),'Worker runtime allowlist missing Stage5 convergence');
expect(exists('src/pages/ConversationsPage.tsx'),'CRM ConversationsPage was removed before Phase B approval');
expect(read('server/routes/system/router.ts').includes("'chat/send'"),'CRM legacy chat fallback was removed before Phase B');
console.log('Etapa 5 Fase A: schema, APIs, webhook, Worker convergence and CRM fallback contracts approved.');
