import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const includes = (source, value, message = value) => expect(source.includes(value), message);

const migrationFile = 'supabase/migrations/20260823160000_stage6_persistent_audit_state_machine.sql';
const patchFile = 'PATCH-ETAPA-6-AUDITORIA-ESTADOS-v1.5.0.sql';
const consolidatedFile = 'APLICAR-NO-SUPABASE-v1.5.0.sql';
for (const file of [migrationFile, patchFile, consolidatedFile, 'CHANGELOG-v1.5.0.md', 'PASSO-A-PASSO-v1.5.0.md', 'TESTE-ETAPA-6-v1.5.0.sql']) {
  expect(exists(file), `${file} ausente.`);
}

const migration = read(migrationFile);
const patch = read(patchFile);
const consolidated = read(consolidatedFile);
expect(migration === patch, 'Patch incremental da Etapa 6 diverge da migration versionada.');
expect(consolidated.endsWith(migration), 'SQL consolidado v1.5.0 não termina com a migration da Etapa 6.');

for (const contract of [
  'v1.5.0_requires_v1.4.3',
  'CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()',
  'audit_events_append_only_update_trigger',
  'audit_events_append_only_delete_trigger',
  "RAISE EXCEPTION 'audit_events_append_only'",
  'CREATE OR REPLACE FUNCTION public.validate_audit_event_insert()',
  "RAISE EXCEPTION 'audit_scope_mismatch'",
  "RAISE EXCEPTION 'audit_actor_member_scope_mismatch'",
  "RAISE EXCEPTION 'audit_actor_identity_mismatch'",
  "RAISE EXCEPTION 'audit_member_actor_required'",
  "RAISE EXCEPTION 'audit_platform_owner_invalid'",
  "RAISE EXCEPTION 'audit_lead_scope_mismatch'",
  "RAISE EXCEPTION 'audit_queue_item_scope_mismatch'",
  'CREATE OR REPLACE FUNCTION public.assert_allowed_status_transition(',
  "RAISE EXCEPTION 'state_transition_not_allowed:%:%->%'",
  'audit_lead_state_change_trigger',
  'audit_queue_item_state_change_trigger',
  'audit_queue_item_delete_trigger',
  'audit_lead_delete_trigger',
  'audit_worker_batch_state_change_trigger',
  'audit_events_organization_select',
  "public.has_organization_permission('audit.view')",
  'DROP CONSTRAINT IF EXISTS audit_events_queue_item_id_fkey',
  'DROP CONSTRAINT IF EXISTS audit_events_lead_id_fkey',
  'ON DELETE RESTRICT',
]) includes(migration, contract, `Contrato Etapa 6 ausente: ${contract}`);

const repo = read('src/repositories/events/canonicalEventLog.repository.ts');
includes(repo, 'request_id?: string | null', 'Repositório de auditoria não expõe request_id.');
includes(repo, 'request_id: row.request_id', 'Mapeamento de auditoria não preserva request_id.');
includes(repo, "from('audit_events')", 'Histórico persistente não consulta audit_events.');
includes(repo, "rpc('append_audit_event'", 'Frontend não usa append_audit_event.');

const page = read('src/pages/AuditPage.tsx');
includes(page, 'Histórico persistente · append-only', 'Tela não identifica histórico append-only.');
includes(page, 'Rastro ', 'Tela não exibe rastreabilidade do request_id.');
includes(page, 'máquina de estados', 'Descrição da Etapa 6 ausente na tela de Auditoria.');

const pkg = JSON.parse(read('package.json'));
{ const [major,minor]=pkg.version.split('.').map(Number); expect(major>1 || (major===1 && minor>=5), `package.json deve preservar a Etapa 6 (v1.5.0+); recebido ${pkg.version}.`); }
expect(String(pkg.scripts?.['verify:release'] ?? '').includes('verify-stage6.mjs'), 'verify:release não inclui Etapa 6.');

if (failures.length) {
  console.error('Falhas da Etapa 6:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Etapa 6: auditoria append-only, escopo organizacional, rastreabilidade e máquina de estados aprovados.');
