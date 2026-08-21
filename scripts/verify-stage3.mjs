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
expect(['1.2.0','1.3.0'].includes(pkg.version), `package.version esperado 1.2.0+; recebido ${pkg.version}`);
expect(exists('APLICAR-NO-SUPABASE-v1.2.0.sql'), 'SQL consolidado v1.2.0 ausente.');
expect(exists('PASSO-A-PASSO-v1.2.0.md'), 'Passo a passo v1.2.0 ausente.');
expect(exists('CHANGELOG-v1.2.0.md'), 'Changelog v1.2.0 ausente.');
expect(exists('PATCH-CORRETIVO-v1.2.0-RPC-RETURNS-TABLE.sql'), 'Patch corretivo dos RPCs tabulares ausente.');

const migrationPath = 'supabase/migrations/20260821190000_tools_control_plane.sql';
const migration = read(migrationPath);
const consolidated = read('APLICAR-NO-SUPABASE-v1.2.0.sql');
expect(migration === consolidated, 'SQL consolidado diverge da migration versionada da Etapa 3.');

const stage2 = read('supabase/migrations/20260821123000_organizations_members_rbac_audit.sql');
const correctivePatch = read('PATCH-CORRETIVO-v1.2.0-RPC-RETURNS-TABLE.sql');
const stage3Native = migration.split('-- Correcao retroativa dos contratos tabulares de Organizacoes da Etapa 2.')[0];
expect((stage3Native.match(/RETURNS TABLE\s*\(/g) ?? []).length === 1, 'Etapa 3 deve possuir exatamente um RPC tabular nativo.');
expect(!/RETURN QUERY\s+SELECT\s+\*/i.test(stage3Native), 'RPC tabular da Etapa 3 usa SELECT * e pode divergir silenciosamente.');
for (const rpc of [
  'list_organization_tools','get_organization_tool_details','get_organization_tool_settings',
  'save_organization_tool_settings','reset_organization_tool_settings','set_organization_tool_enabled',
  'set_tool_installation_status','get_effective_tool_config','update_platform_tool_catalog',
  'set_organization_tool_entitlements','service_register_tool_installation',
  'service_touch_tool_installation','service_set_tool_installation_status',
  'get_user_operational_settings','save_dispatch_settings','reset_dispatch_settings',
  'save_import_settings','reset_import_settings','service_get_operational_settings',
]) includes(migration, `FUNCTION public.${rpc}`, `RPC novo da Etapa 3 ausente da auditoria: ${rpc}`);

for (const rpc of [
  'list_my_organizations','list_organization_members_admin','list_organization_roles_admin',
  'list_delegable_permissions','list_organization_invitations','list_platform_organizations_admin',
]) {
  includes(stage2, `FUNCTION public.${rpc}`, `RPC tabular de Organizacoes da Etapa 2 ausente: ${rpc}`);
  includes(migration, `FUNCTION public.${rpc}`, `Correcao retroativa ausente do consolidado v1.2.0: ${rpc}`);
}
for (const sql of [stage2,migration,correctivePatch]) {
  expect(!sql.includes("'@',1)),owner_auth.email,") && !sql.includes("'@',1)),au.email,"), 'Email varchar do Supabase Auth retornado sem cast para text.');
}
includes(correctivePatch, "coalesce(owner_auth.email,'')::text", 'Patch não corrige owner_email varchar para text.');
includes(correctivePatch, "coalesce(au.email,'')::text", 'Patch não corrige email de membro varchar para text.');
includes(stage3Native, "coalesce(cap,'{}'::jsonb)::jsonb", 'RPC tabular da Etapa 3 não protege import_settings nulo.');

for (const contract of [
  'CREATE TABLE IF NOT EXISTS public.platform_tools',
  'CREATE TABLE IF NOT EXISTS public.organization_tools',
  'CREATE TABLE IF NOT EXISTS public.organization_tool_installations',
  'CREATE TABLE IF NOT EXISTS public.organization_tool_settings',
  'CREATE TABLE IF NOT EXISTS public.organization_tool_entitlements',
  "'vinsansi_capture','Vinsansi Captura'",
  "'vinsansi_instagram','Vinsansi Instagram'",
  "'vinsansi_whatsapp_manager','Gerenciador de Disparos'",
  'maxConcurrentActivitiesPerMember',
  'settings_version=settings_version+1',
  'tool_settings_version_conflict',
  "interval '180 seconds'",
  'tool_semver_compare',
  'reported_capabilities',
  'last_seen_at',
  'last_activity_at',
  'service_register_tool_installation',
  'service_touch_tool_installation',
  'get_effective_tool_config',
  'tool.settings.updated',
  'tool.settings.reset',
  'tool.entitlements.updated',
  'tool.catalog.updated',
  'ENABLE ROW LEVEL SECURITY',
  'DROP TABLE IF EXISTS public.user_operational_settings CASCADE',
  'DROP FUNCTION IF EXISTS public.save_extension_runtime_config(jsonb)',
  'service_get_operational_settings',
  'maps_extension_installations_canonical_fkey',
]) includes(migration, contract, `Contrato SQL da Etapa 3 ausente: ${contract}`);

expect(!migration.includes("VALUES('worker'") && !migration.includes("VALUES ('worker'"), 'Worker apareceu como ferramenta independente.');
expect(!migration.includes("VALUES('apify'") && !migration.includes("VALUES ('apify'"), 'Apify apareceu como ferramenta independente.');
expect(!migration.includes("VALUES('website") && !migration.includes("VALUES ('website"), 'Website apareceu como ferramenta independente.');
expect(!migration.includes('CREATE OR REPLACE FUNCTION public.save_extension_runtime_config'), 'Writer do blob runtime persistido continua ativo.');

const toolsPage = read('src/pages/ToolsPage.tsx');
const toolsService = read('src/services/tools/tools.service.ts');
for (const label of ['Central de Ferramentas','Visão geral','Instalações','Configurações','Registro','Presença','Compatibilidade','Última atividade']) {
  includes(toolsPage, label, `UI da Central sem dimensão obrigatória: ${label}`);
}
for (const rpc of ['list_organization_tools','get_organization_tool_details','get_organization_tool_settings','save_organization_tool_settings','reset_organization_tool_settings','set_organization_tool_enabled','set_tool_installation_status']) {
  includes(toolsService, rpc, `Serviço da Central sem RPC ${rpc}.`);
}
for (const permission of ['tools.manage','settings.view','capture.settings','instagram.settings','whatsapp.settings']) {
  includes(toolsPage, permission, `UI não aplica permissão ${permission}.`);
}
for (const [name,file] of [
  ['Membros','src/pages/OrganizationMembersPage.tsx'],
  ['Organizações','src/pages/PlatformOrganizationsPage.tsx'],
  ['Funções','src/pages/OrganizationRolesPage.tsx'],
  ['Central de Ferramentas','src/pages/ToolsPage.tsx'],
]) {
  const source=read(file);
  for(const component of ['DataTable','TableCard','FiltersBar'])includes(source,component,`${name} não reutiliza ${component}.`);
  expect(!source.includes('<table'),`${name} voltou a criar tabela HTML própria.`);
}
const permanentRules=read('../ESPECIFICACAO/06-REGRAS-NAO-NEGOCIAVEIS.md');
includes(permanentRules,'Nenhuma nova página CRUD pode definir estrutura visual própria','Regra permanente de consistência CRUD/UI ausente.');

const settingsRepository = read('src/repositories/settings/canonicalSettings.repository.ts');
const platformConfig = read('src/services/platform-config/platformConfig.service.ts');
expect(!settingsRepository.includes('save_extension_runtime_config'), 'Repositório ainda persiste extension_runtime_config.');
expect(!platformConfig.includes('updateExtensionRuntimeConfig'), 'Platform config ainda publica blob derivado.');
includes(platformConfig, 'buildExtensionRuntimeConfig()', 'Bridge runtime deixou de ser read-through dinâmico.');

const mapsPair = read('server/routes/maps/pair.ts');
const mapsShared = read('server/maps/shared.ts');
includes(mapsPair, "p_tool_id: 'vinsansi_capture'", 'Pairing Maps não registra instalação canônica.');
includes(mapsPair, 'organization_tool_installations_id', 'Pairing Maps não grava vínculo legado/canônico.');
includes(mapsShared, 'service_touch_tool_installation', 'Maps não toca o registro canônico atual.');

const worker = read('../Gerenciador/resources/worker/src/worker.js');
expect(worker.includes('service_get_operational_settings')||worker.includes('executor_effective_operational_settings'),'Bridge/configuração efetiva do Worker embarcado foi quebrada.');
expect(!exists('public/tools/worker-latest.zip'), 'Worker standalone voltou ao pacote.');
expect(!exists('supabase/functions/apify-account-check') && !exists('supabase/functions/apify-google-maps-start') && !exists('supabase/functions/apify-google-maps-sync'), 'Apify voltou ao release.');

expect(exists('scripts/sql/stage3-smoke-base.sql') && exists('scripts/sql/stage3-smoke-assertions.sql'), 'Smoke test SQL da Etapa 3 ausente.');

if (failures.length) {
  console.error('Falhas da Etapa 3:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Etapa 3: catálogo, settings, entitlements, instalações, presença, SemVer, RBAC/RLS, auditoria, Maps e UI aprovados.');
