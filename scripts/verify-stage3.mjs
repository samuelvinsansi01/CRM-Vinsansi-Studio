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
expect(pkg.version === '1.2.0', `package.version esperado 1.2.0; recebido ${pkg.version}`);
expect(exists('APLICAR-NO-SUPABASE-v1.2.0.sql'), 'SQL consolidado v1.2.0 ausente.');
expect(exists('PASSO-A-PASSO-v1.2.0.md'), 'Passo a passo v1.2.0 ausente.');
expect(exists('CHANGELOG-v1.2.0.md'), 'Changelog v1.2.0 ausente.');

const migrationPath = 'supabase/migrations/20260821190000_tools_control_plane.sql';
const migration = read(migrationPath);
const consolidated = read('APLICAR-NO-SUPABASE-v1.2.0.sql');
expect(migration === consolidated, 'SQL consolidado diverge da migration versionada da Etapa 3.');

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

const settingsRepository = read('src/repositories/settings/canonicalSettings.repository.ts');
const platformConfig = read('src/services/platform-config/platformConfig.service.ts');
expect(!settingsRepository.includes('save_extension_runtime_config'), 'Repositório ainda persiste extension_runtime_config.');
expect(!platformConfig.includes('updateExtensionRuntimeConfig'), 'Platform config ainda publica blob derivado.');
includes(platformConfig, 'buildExtensionRuntimeConfig()', 'Bridge runtime deixou de ser read-through dinâmico.');

const mapsPair = read('api/maps/pair.ts');
const mapsShared = read('server/maps/shared.ts');
includes(mapsPair, "p_tool_id: 'vinsansi_capture'", 'Pairing Maps não registra instalação canônica.');
includes(mapsPair, 'organization_tool_installations_id', 'Pairing Maps não grava vínculo legado/canônico.');
includes(mapsShared, 'service_touch_tool_installation', 'Maps não toca o registro canônico atual.');

const worker = read('../Gerenciador/resources/worker/src/worker.js');
includes(worker, 'service_get_operational_settings', 'Bridge comprovado do Worker embarcado foi quebrado.');
expect(!exists('public/tools/worker-latest.zip'), 'Worker standalone voltou ao pacote.');
expect(!exists('supabase/functions/apify-account-check') && !exists('supabase/functions/apify-google-maps-start') && !exists('supabase/functions/apify-google-maps-sync'), 'Apify voltou ao release.');

expect(exists('scripts/sql/stage3-smoke-base.sql') && exists('scripts/sql/stage3-smoke-assertions.sql'), 'Smoke test SQL da Etapa 3 ausente.');

if (failures.length) {
  console.error('Falhas da Etapa 3:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Etapa 3: catálogo, settings, entitlements, instalações, presença, SemVer, RBAC/RLS, auditoria, Maps e UI aprovados.');
