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

const pkg = JSON.parse(read('package.json'));
expect(pkg.version === '1.1.0', `package.version esperado 1.1.0; recebido ${pkg.version}`);
expect(exists('APLICAR-NO-SUPABASE-v1.1.0.sql'), 'SQL consolidado v1.1.0 ausente.');
expect(exists('PASSO-A-PASSO-v1.1.0.md'), 'Passo a passo v1.1.0 ausente.');

const migration = read('APLICAR-NO-SUPABASE-v1.1.0.sql');
for (const contract of [
  "v1.1.0_requires_v1.0.2",
  'CREATE TABLE IF NOT EXISTS public.organizations',
  'CREATE TABLE IF NOT EXISTS public.organization_members',
  'CREATE TABLE IF NOT EXISTS public.organization_roles',
  'CREATE TABLE IF NOT EXISTS public.organization_role_permissions',
  'CREATE TABLE IF NOT EXISTS public.organization_invitations',
  'CREATE TABLE IF NOT EXISTS public.platform_owners',
  "access_level IN ('owner','manager','member')",
  "'Gestor','gestor'",
  "'SDR','sdr'",
  'CREATE OR REPLACE FUNCTION public.has_organization_permission',
  'CREATE OR REPLACE FUNCTION public.can_assign_organization_role',
  'manager_cannot_assign_role_with_higher_permissions',
  'CREATE OR REPLACE FUNCTION public.auth_user_has_organization_permission',
  'CREATE OR REPLACE FUNCTION public.set_organization_member_active',
  'CREATE OR REPLACE FUNCTION public.transfer_organization_ownership',
  'CREATE OR REPLACE FUNCTION public.append_audit_event',
  'CREATE OR REPLACE FUNCTION public.validate_member_attribution_scope',
  "require_organization_permission('queues.prepare')",
  "require_organization_permission('whatsapp.instances.manage')",
  "require_organization_permission('monitoring.manage')",
  "require_organization_permission('whatsapp.reply')",
  'COMMIT;',
]) includes(migration, contract, `Contrato SQL ausente: ${contract}`);

const config = read('src/services/config/config.service.ts');
for (const field of ['administrativelyActive','operationalState','sessionSaved','socketConnected','jid','runtimeCheckedAt','runtimeError']) {
  includes(config, field, `Regressão ChipConfigRecord: ${field} ausente.`);
}

const provider = read('src/providers/OrganizationProvider.tsx');
const client = read('src/lib/supabase/client.ts');
const organizationContext = read('server/organization/context.ts');
const header = read('src/design-system/layouts/Header.tsx');
const registry = read('src/pages/pageRegistry.ts');
const members = read('src/pages/OrganizationMembersPage.tsx');
const roles = read('src/pages/OrganizationRolesPage.tsx');
includes(provider, 'switchOrganization', 'Provider sem troca de organização.');
includes(provider, 'hasPermission', 'Provider sem permission resolver.');
includes(client, 'ORGANIZATION_HEADER', 'Cliente Supabase sem header organizacional.');
includes(organizationContext, '): Record<string, string>', 'Headers organizacionais não possuem retorno Record<string,string>.');
includes(organizationContext, 'const scopedHeaders: Record<string, string>', 'Headers organizacionais ainda permitem valor undefined.');
expect(!exists('supabase/functions/apify-account-check') && !exists('supabase/functions/apify-google-maps-start') && !exists('supabase/functions/apify-google-maps-sync'), 'Functions Apify obsoletas voltaram ao release.');
includes(header, 'organization-switcher', 'Header sem seletor de organização.');
includes(registry, "'organization-members': 'members.view'", 'Gate de membros ausente.');
includes(registry, "'platform-organizations': 'platform.organizations.manage'", 'Gate de Platform Owner ausente.');
includes(members, 'setOrganizationMemberActive', 'Soft-disable de membro ausente.');
includes(members, 'transferOrganizationOwnership', 'Transferência de propriedade ausente.');
includes(roles, 'saveOrganizationRole', 'Edição de funções ausente.');

for (const [file, permission] of [
  ['supabase/functions/evolution-instance-sync/index.ts', 'whatsapp.instances.manage'],
]) {
  const source = read(file);
  includes(source, 'auth_user_has_organization_permission', `${file} não revalida RBAC sob service_role.`);
  includes(source, `p_permission_key: "${permission}"`, `${file} não usa a permissão esperada ${permission}.`);
}

expect(!exists('public/tools/worker-latest.zip'), 'Worker standalone voltou ao pacote.');

if (failures.length) {
  console.error('Falhas na release v1.1.0:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Release v1.1.0: contratos de Organizações/RBAC, autoria, segurança e ChipConfigRecord aprovados.');
