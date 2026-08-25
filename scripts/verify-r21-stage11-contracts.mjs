import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = dirname(root);
const read = (path) => readFileSync(join(root, path), 'utf8');
const outer = JSON.parse(readFileSync(join(workspace, 'Banco - Atual.txt'), 'utf8'));
const schema = JSON.parse(outer[0].database_schema_snapshot);
const migration = read('supabase/migrations/20260825170000_r21_stage11_observability_recovery_hardening.sql');
const monitoring = read('src/pages/MonitoringPage.tsx');
const repository = read('src/repositories/monitoring/operationalHealth.repository.ts');
const instagramRoute = read('server/routes/instagram/extension.ts');
const runtimeRoute = read('server/routes/tools/executor/runtime.ts');
const instagramPopup = readFileSync(join(workspace, 'CRM - Instagram/popup.js'), 'utf8');
const worker = readFileSync(join(workspace, 'CRM - Worker/src/worker.js'), 'utf8');

let checks = 0;
function ok(value, message) { checks += 1; assert.ok(value, message); }
function hasColumn(table, column) { return schema.columns.some((item) => item.table === table && item.column === column); }
function fn(name) { return schema.functions.find((item) => item.name === name); }

ok(schema.generated_at === '2026-08-25T14:53:03.038263+00:00', 'snapshot canônico inesperado');
for (const [table, column] of [
  ['worker_batches','status_id'],['worker_batches','worker_batches_heartbeat_at'],
  ['queue_items','queue_items_id'],['queue_items','organizations_id'],
  ['instagram_queue_progress','canonical_step'],['instagram_queue_progress','metadata'],
  ['sents','sents_idempotency_key'],['operational_alerts','organizations_id'],
]) ok(hasColumn(table,column), `schema sem ${table}.${column}`);
ok(!hasColumn('worker_batches','worker_batches_status'), 'coluna legada apareceu no schema atual');

for (const name of [
  'get_operational_health','refresh_operational_alerts','worker_recover_stale_whatsapp_v2',
  'instagram_recover_stale_items_v2','instagram_claim_queue_item_v2','instagram_update_queue_progress_v2',
  'service_worker_heartbeat','service_claim_recovery_request','service_complete_recovery_request',
]) ok(Boolean(fn(name)), `RPC ausente no schema: ${name}`);
ok(fn('service_worker_heartbeat').identity_arguments.startsWith('p_organizations_id bigint'), 'assinatura tenant-aware do heartbeat divergente');
ok(fn('worker_recover_stale_whatsapp_v2').identity_arguments.includes('p_organizations_id bigint'), 'recovery WhatsApp sem tenant');
ok(fn('instagram_recover_stale_items_v2').identity_arguments.includes('p_organizations_id bigint'), 'recovery Instagram sem tenant');

const tenantTables = ['platform_runtime_heartbeats','operational_alerts','recovery_requests','queue_items','worker_batches','worker_batch_items','instagram_queue_progress','instagram_dispatch_events','instagram_profile_runtime','sents'];
for (const table of tenantTables) {
  ok(schema.tables.find((item) => item.table === table)?.rls_enabled === true, `RLS desativado em ${table}`);
  ok(schema.policies.some((policy) => policy.table === table && policy.command === 'SELECT' && String(policy.using).includes('current_organization_id()')), `policy SELECT sem tenant em ${table}`);
}

ok(fn('get_operational_health').definition.includes('worker_batches_status'), 'evidência do bug R20 não encontrada no snapshot fonte');
ok(fn('worker_recover_stale_whatsapp_v2').definition.includes('worker_batches_status'), 'segunda evidência do bug R20 não encontrada');
ok(!migration.includes('worker_batches_status'), 'migration R21 ainda usa worker_batches_status');
ok(migration.includes('b.status_id IN(3,4,8)'), 'health não usa status_id canônico');
ok(migration.includes('coalesce(b.worker_batches_heartbeat_at'), 'batch sem heartbeat não é detectado');
ok(migration.includes("p.claim_token IS NOT NULL"), 'recovery Instagram não está idempotente');
ok(migration.includes("v_next:=r.step"), 'recovery Instagram apaga checkpoint seguro');
ok(migration.includes('instagram_step_regression'), 'regressão de checkpoint não é bloqueada');
ok(migration.includes("format('instagram:queue-item:%s'"), 'sent Instagram não usa chave idempotente');
ok(migration.includes("IF v_progress.step=p_step"), 'retry do mesmo checkpoint ainda duplica evento');
ok(migration.includes("CASE WHEN v_first_claim THEN 1 ELSE 0 END"), 'reclaim ainda duplica claimed_count');
ok(migration.includes("v_scope NOT IN('all','whatsapp','instagram')"), 'scope de recovery diverge da constraint atual');
ok(migration.includes('refresh_operational_alerts_for_org'), 'health não materializa alertas offline');
ok(migration.includes("a.alert_key='worker_heartbeat_missing'"), 'resolução do alerta de Worker ausente');
ok(migration.includes("'category','infrastructure'"), 'erros de infraestrutura não são classificados');
ok(migration.includes("'category','executor'"), 'erros de executor não são classificados');
ok(migration.includes("'category','queue_item'"), 'erros de item de fila não são classificados');

ok(monitoring.indexOf('await getOperationalHealth()') < monitoring.indexOf('await listOperationalAlerts()'), 'UI lê alertas antes de materializar health');
ok(repository.includes("rpc('get_operational_health')"), 'CRM não consulta health RPC');
ok(instagramRoute.includes('progress_metadata: bodyRecord(progress.metadata)'), 'API não entrega metadata do checkpoint');
ok(instagramRoute.includes("resume_step: text(progress.step) || 'claimed'"), 'API não entrega resume_step');
ok(instagramPopup.includes('confirmed_message_numbers'), 'extensão não persiste mensagens confirmadas');
ok(instagramPopup.includes('Seguir já concluído — checkpoint preservado'), 'extensão repete follow após reclaim');
ok(runtimeRoute.includes("args.p_organizations_id=scope.organizationId"), 'proxy do Worker não fixa tenant');
for (const rpc of ['service_worker_heartbeat','refresh_operational_alerts','worker_recover_stale_whatsapp_v2','instagram_recover_stale_items_v2']) {
  ok(runtimeRoute.includes(`'${rpc}'`), `proxy não permite RPC ${rpc}`);
}
ok(!runtimeRoute.includes("'worker_defer_batch'"), 'proxy ainda permite deferimento por janela operacional');
for (const forbidden of ['outside_operational_window','decideWhatsAppOperationalWindow','worker_defer_batch']) {
  ok(!worker.includes(forbidden), `janela operacional residual no Worker: ${forbidden}`);
}

console.log(`Etapa 11 R21 contratos: PASS (${checks} verificações)`);
