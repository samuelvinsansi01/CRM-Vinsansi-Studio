import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const fail = (message) => { throw new Error(`R59:${message}`); };
const requireFile = (relative) => { if (!exists(relative)) fail(`arquivo_obrigatorio_ausente:${relative}`); return read(relative); };
const requireTokens = (name, source, tokens) => {
  for (const token of tokens) if (!source.includes(token)) fail(`${name}:${token}`);
};
const forbidTokens = (name, source, tokens) => {
  for (const token of tokens) if (source.includes(token)) fail(`${name}:${token}`);
};

const packageJson = JSON.parse(requireFile('package.json'));
if (packageJson.version !== '2.4.0-R59') fail(`release_incorreta:${packageJson.version}`);

const homologRepo = requireFile('src/repositories/release/homologation.repository.ts');
const homologPage = requireFile('src/pages/HomologationPage.tsx');
requireTokens('homologacao_final_incompleta', homologRepo, [
  "const RELEASE = '2.4.0-R59'",
  "const MANAGER_TOOL_ID = 'vinsansi_whatsapp_manager'",
  "'control_plane_release'",
  "'installation_rls_scope'",
  "'manager_single_current_installation'",
  "'manager_official_version'",
  "'cloudflare_installation_isolated'",
  "'installation_metadata_no_secrets'",
  "'instances_cloudflare_origin'",
  "'canonical_runtime_authority'",
  "get_operational_health",
  "organization_tool_installations",
  "platform_runtime_heartbeats",
  "release_manifest",
  "queue_operational_today_r59",
  "list_queue_review_resources",
]);
forbidTokens('homologacao_nao_pode_ler_reserva_diretamente', homologRepo, [
  "from('queue_review_items')",
  "from(\"queue_review_items\")",
]);
requireTokens('pagina_homologacao_incompleta', homologPage, [
  "from '../repositories/release/homologation.repository'",
  'Homologação final',
  'Readiness',
  'Control Plane',
]);

const release = requireFile('server/platform/release.ts');
requireTokens('control_plane_release_incompleto', release, [
  "vinsansi_whatsapp_manager",
  'release_manifest',
  'runtimeTtlSeconds',
  'managerHeartbeatSeconds',
  'workerHeartbeatSeconds',
]);

const cloudflare = requireFile('server/platform/cloudflare-installation.ts');
requireTokens('cloudflare_instalacao_incompleto', cloudflare, [
  'provisionInstallationCloudflare',
  'confirmInstallationCloudflare',
  'provisioningVersion',
  'evolutionPublicUrl',
  'workerPublicUrl',
  'confirmedAt',
  'cfargotunnel.com',
  "if (!(await tunnelConnected(accountId, stored.tunnelId)))",
]);
forbidTokens('cloudflare_nao_pode_persistir_segredos', cloudflare, [
  'metadata: { ...metadata, cloudflare: { ...cloudflareMetadata, token',
]);

const mobilePush = requireFile('server/mobile/push.ts');
requireTokens('mobile_push_backend_incompleto', mobilePush, [
  "from('mobile_push_devices')",
  "stage5_member_has_permission",
  "https://exp.host/--/api/v2/push/send",
  "DeviceNotRegistered",
  "channelId: 'mensagens'",
]);
const evolutionWebhook = requireFile('server/routes/whatsapp/evolution-webhook.ts');
requireTokens('mobile_push_webhook_incompleto', evolutionWebhook, [
  "notifyInboundWhatsappMessage",
  "event === 'messages.upsert'",
  "!fromMe",
  "externalMessageId",
]);

const heartbeat = requireFile('server/routes/tools/executor/heartbeat.ts');
requireTokens('runtime_manager_root_incompleto', heartbeat, [
  "vinsansi_whatsapp_manager:'manager'",
  "const MANAGER_COMPONENTS=new Set(['worker','gateway','evolution','capture','instagram','realtime'])",
  'service_runtime_heartbeat',
  'hostExternalInstallationId',
  "runtimeAuthority:scope.toolId==='vinsansi_whatsapp_manager'?'manager':'manager-root'",
]);

const managerProvision = requireFile('server/routes/system/desktop/worker-provision.ts');
requireTokens('provisionamento_desktop_incompleto', managerProvision, [
  'DESKTOP_WORKER_PROVISIONING_ENABLED',
  'cloudflareTunnelImage',
]);

const validationHandler = requireFile('server/whatsapp/validation.handler.ts');
requireTokens('validacao_whatsapp_final_incompleta', validationHandler, [
  '/numbers/check',
  'mutateReviewWithLeadRollback',
  'rollbackLeadToWhatsappReview',
]);
if (exists('server/routes/whatsapp/revalidate.ts')) fail('rota_revalidacao_legada_ainda_existe');

const pageRegistry = requireFile('src/pages/pageRegistry.ts');
requireTokens('navegacao_final_incompleta', pageRegistry, [
  "homologation: 'Homologação final'",
  "monitoring: 'Monitoramento'",
  "homologation: 'monitoring.view'",
  "'monitoring',",
  "'homologation',",
]);
const configurationPages = requireFile('src/pages/ConfigurationPages.tsx');
requireTokens('configuracoes_sem_homologacao_final', configurationPages, [
  "title: 'Monitoramento e homologação'",
  "page: 'monitoring'",
  "page: 'homologation'",
  "label: 'Homologação final'",
]);

const forbiddenRootArtifacts = fs.readdirSync(root).filter((name) => /^(APLICAR|CHECK).*\.sql$/i.test(name) || /^README/i.test(name));
if (forbiddenRootArtifacts.length) fail(`artefatos_legados_no_pacote:${forbiddenRootArtifacts.join(',')}`);

console.log('CRM R59 final-state contract + Phase 6 readiness: OK');
