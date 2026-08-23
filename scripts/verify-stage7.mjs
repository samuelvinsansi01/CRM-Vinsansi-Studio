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

const migrationFile = 'supabase/migrations/20260823170000_stage7_identity_dedup_suppression_org.sql';
const patchFile = 'PATCH-ETAPA-7-IDENTIDADE-DEDUP-SUPRESSAO-v1.6.0.sql';
const consolidatedFile = 'APLICAR-NO-SUPABASE-v1.6.0.sql';
for (const file of [migrationFile, patchFile, consolidatedFile, 'CHANGELOG-v1.6.0.md', 'PASSO-A-PASSO-v1.6.0.md', 'TESTE-ETAPA-7-v1.6.0.sql']) {
  expect(exists(file), `${file} ausente.`);
}

const migration = read(migrationFile);
const patch = read(patchFile);
const consolidated = read(consolidatedFile);
expect(migration === patch, 'Patch incremental da Etapa 7 diverge da migration versionada.');
expect(consolidated.endsWith(migration), 'SQL consolidado v1.6.0 não termina com a migration da Etapa 7.');

for (const contract of [
  'v1.6.0_requires_v1.5.0',
  'stage7_existing_lead_scope_mismatch',
  'stage7_existing_canonical_cross_organization',
  'stage7_existing_registry_scope_mismatch',
  'stage7_existing_suppression_scope_mismatch',
  'lead_identity_registry_org_identity_unique',
  'contact_suppressions_org_identity_unique',
  "'about','accounts','api','challenge'",
  "position('/' in v_path)>0",
  'CREATE OR REPLACE FUNCTION public.validate_lead_canonical_scope()',
  "RAISE EXCEPTION 'lead_identity_tenant_immutable'",
  "RAISE EXCEPTION 'canonical_lead_cross_organization'",
  'CREATE OR REPLACE FUNCTION public.validate_identity_registry_scope()',
  "RAISE EXCEPTION 'identity_registry_canonical_cross_organization'",
  'CREATE OR REPLACE FUNCTION public.validate_contact_suppression_scope()',
  "RAISE EXCEPTION 'contact_suppression_lead_cross_organization'",
  "RAISE EXCEPTION 'contact_suppression_sent_cross_organization'",
  "('lead',7,1,'duplicate_identity_cleared',true)",
  'CREATE OR REPLACE FUNCTION public.prepare_lead_identity()',
  'r.organizations_id=NEW.organizations_id',
  'CREATE OR REPLACE FUNCTION public.register_lead_identity()',
  "'lead_deduplicated'",
  'CREATE OR REPLACE FUNCTION public.suppress_lead_identities(',
  "'contact_suppressed'",
  'CREATE OR REPLACE FUNCTION public.suppress_after_lead_finalized()',
  'NEW.lead_status_id IN (5,8)',
  'CREATE OR REPLACE FUNCTION public.check_lead_identity(',
  'v_org:=public.current_organization_id()',
  "public.has_organization_permission('leads.view')",
  'lead_identity_registry_org_select',
  'contact_suppressions_org_select',
]) includes(migration, contract, `Contrato Etapa 7 ausente: ${contract}`);

expect(!migration.includes('ON CONFLICT(users_id,identity_type,identity_value)'), 'Etapa 7 ainda usa users_id como chave de conflito da identidade.');
expect(!/WHERE\s+r\.users_id\s*=\s*NEW\.users_id/i.test(migration), 'prepare_lead_identity ainda deduplica pelo users_id legado.');

const importService = read('src/services/import/import.service.ts');
includes(importService, 'repositories.base.listFinalIdentities()', 'Importação não consulta supressão persistente.');
includes(importService, 'basePhones:', 'Importação não injeta telefones suprimidos no contexto de deduplicação.');
includes(importService, 'baseSites:', 'Importação não injeta domínios suprimidos no contexto de deduplicação.');
includes(importService, 'baseInstagrams:', 'Importação não injeta Instagram suprimido no contexto de deduplicação.');
includes(importService, 'baseMapsUrls:', 'Importação não injeta Maps suprimido no contexto de deduplicação.');

const baseRepo = read('src/repositories/base/supabaseBase.repository.ts');
includes(baseRepo, "from('contact_suppressions')", 'Base final não lê contact_suppressions.');
includes(baseRepo, ".eq('is_active',true)", 'Base final não limita supressões ativas.');

const normalizer = read('src/services/import/importValidation.ts');
for (const token of ["digits.startsWith('00')", "digits.startsWith('55')", 'digits.length === 10 || digits.length === 11']) {
  includes(normalizer, token, `Normalização de telefone do import perdeu contrato: ${token}`);
}

const pkg = JSON.parse(read('package.json'));
{ const [major,minor]=pkg.version.split('.').map(Number); expect(major>1 || (major===1 && minor>=6), `package.json deve preservar a Etapa 7 (v1.6.0+); recebido ${pkg.version}.`); }
expect(String(pkg.scripts?.['verify:release'] ?? '').includes('verify-stage7.mjs'), 'verify:release não inclui Etapa 7.');

if (failures.length) {
  console.error('Falhas da Etapa 7:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Etapa 7: identidade canônica organizacional, deduplicação transversal e supressão de contato aprovadas.');
