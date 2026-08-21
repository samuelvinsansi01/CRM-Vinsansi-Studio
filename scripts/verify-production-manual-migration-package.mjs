import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const planPath = 'scripts/production-manual-migration-plan.sql';
const proofPath = 'supabase/migrations/20260806190000_whatsapp_validation_proof.sql';
const forwardPath = 'supabase/migrations/20260812130000_install_forward_only_identity_contract.sql';
const plan = read(planPath);
const proof = read(proofPath);
const forward = read(forwardPath);
const withoutComments = plan.replace(/--.*$/gm, '');
const withoutCommentsOrLiterals = withoutComments.replace(/'(?:''|[^'])*'/g, "''");

const blocked = [
  '20260802130000_identity_dedup_suppression.sql',
  '20260802131000_fix_instagram_identity_normalization.sql',
];
const expectedSequence = [
  '20260806110000_preserve_whatsapp_batch_cadence.sql',
  '20260806170000_contact_sources_owner_rls.sql',
  '20260806180000_sents_append_only_rls.sql',
  '20260807100000_fix_operational_health_batch_status.sql',
  '20260812130000_install_forward_only_identity_contract.sql',
  '20260806190000_whatsapp_validation_proof.sql',
  '20260820210000_instance_runtime_state.sql',
  '20260820211000_whatsapp_queue_runtime_guard.sql',
];

assert.match(withoutComments.trim(), /^WITH\s+manual_sequence\b/i, 'Plano deve ser um unico SELECT baseado em whitelist explicita.');
assert.match(withoutComments.trim(), /AS\s+production_manual_migration_plan\s*;$/i, 'Plano deve retornar uma unica celula JSONB.');
assert(!/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/i.test(withoutCommentsOrLiterals), 'Plano contem comando mutavel ou executor de migration.');
assert(!/\\(?:i|ir)\b|readdir|glob|scan/i.test(withoutCommentsOrLiterals), 'Plano nao pode incluir arquivos nem varrer a pasta automaticamente.');

const sequenceBlock = withoutComments.match(/WITH\s+manual_sequence[\s\S]*?\),\s*blocked_migrations/i)?.[0] ?? '';
const sequenceFiles = [...sequenceBlock.matchAll(/\(\s*\d+,\s*'(\d{14}_[a-z0-9_]+\.sql)'/g)].map((match) => match[1]);
assert.deepEqual(sequenceFiles, expectedSequence, 'Whitelist ou ordem manual de producao divergiu.');
assert.equal(new Set(sequenceFiles).size, sequenceFiles.length, 'Plano possui migration duplicada.');
for (const migration of blocked) {
  assert(!sequenceFiles.includes(migration), `Migration proibida entrou na sequencia: ${migration}.`);
  assert(plan.includes(`'${migration}'`), `Migration proibida nao esta documentada no bloco de bloqueio: ${migration}.`);
}

const forwardPosition = sequenceFiles.indexOf('20260812130000_install_forward_only_identity_contract.sql');
const proofPosition = sequenceFiles.indexOf('20260806190000_whatsapp_validation_proof.sql');
assert(forwardPosition >= 0 && proofPosition > forwardPosition, 'WhatsApp proof deve vir depois da identity forward-only.');
assert(plan.includes("ARRAY['20260802090000_worker_persistence_idempotency.sql']"), 'Dependencia da cadencia sobre persistencia do Worker nao esta declarada.');
assert(plan.includes("ARRAY['20260802170000_observability_recovery.sql']"), 'Dependencia de operational health nao esta declarada.');
assert(plan.includes("'public.normalize_identity_phone(text)'"), 'Dependencia funcional da prova sobre normalize_identity_phone nao esta declarada.');
assert(plan.includes("'public.normalize_identity_instagram(text)'"), 'Dependencia funcional da prova sobre normalize_identity_instagram nao esta declarada.');
assert(plan.includes("'20260812130000_install_forward_only_identity_contract.sql'"), 'Prova nao declara a migration forward-only como pre-requisito.');

assert(/INSERT INTO public\.lead_validation_results\s*\([\s\S]*?\)\s*OVERRIDING SYSTEM VALUE\s*VALUES\s*\(/i.test(proof), 'WhatsApp proof nao suporta lead_validation_results_id GENERATED ALWAYS AS IDENTITY.');
assert(proof.includes('public.normalize_identity_phone'), 'WhatsApp proof deixou de usar normalizacao de telefone.');
assert(proof.includes('public.normalize_identity_instagram'), 'WhatsApp proof deixou de usar normalizacao Instagram.');
assert(!proof.includes('lead_identity_registry') && !proof.includes('contact_suppressions'), 'WhatsApp proof nao deve depender diretamente das tabelas de identity.');

assert(!/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+public\.leads\b/i.test(forward), 'Migration forward-only passou a executar DML direto sobre leads.');
assert(!/INSERT INTO public\.lead_identity_registry[\s\S]*?FROM public\.leads/i.test(forward), 'Migration forward-only passou a fazer backfill do registry.');
assert(!/INSERT INTO public\.contact_suppressions[\s\S]*?FROM public\.leads/i.test(forward), 'Migration forward-only passou a fazer backfill de suppressions.');

console.log('OK: pacote manual possui whitelist explicita de 8 migrations e nenhum executor automatico.');
console.log('OK: migrations historicas de identity estao bloqueadas e ausentes da sequencia.');
console.log('OK: WhatsApp proof vem depois da identity forward-only e suporta GENERATED ALWAYS AS IDENTITY.');
