import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const crmRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(crmRoot, '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.cwd(), process.argv[index + 1]) : fallback;
}

if (process.argv.includes('--help')) {
  console.log('Uso: node scripts/staging-preflight.mjs [--crm-env caminho] [--worker-env caminho]');
  console.log('O comando é somente leitura: não conecta, não cria backup e não altera ambientes remotos.');
  process.exit(0);
}

const crmEnvPath = argument('--crm-env', path.join(crmRoot, '.env.staging'));
const workerEnvPath = argument('--worker-env', path.join(workspace, 'worker', '.env.staging'));
const problems = [];

function parseEnv(filePath, label) {
  if (!fs.existsSync(filePath)) {
    problems.push(`${label}_file_missing:${path.relative(workspace, filePath)}`);
    return {};
  }
  const values = {};
  for (const [index, sourceLine] of fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      problems.push(`${label}_invalid_line:${index + 1}`);
      continue;
    }
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const crmFileEnv = parseEnv(crmEnvPath, 'crm_staging_env');
const workerFileEnv = parseEnv(workerEnvPath, 'worker_staging_env');
const from = (values, key) => String(values[key] ?? process.env[key] ?? '').trim();
const crm = (key) => from(crmFileEnv, key);
const worker = (key) => from(workerFileEnv, key);
const isPlaceholder = (value) => !value || /replace-with|example\.invalid|staging-project-ref|production-project-ref|^changeme$/i.test(value);
const masked = (value) => value ? `<set:length=${value.length}>` : '<missing>';

function requireValue(component, getter, key) {
  const value = getter(key);
  console.log(`ENV ${component}.${key}=${masked(value)}`);
  if (isPlaceholder(value)) problems.push(`${component}_required_value_missing_or_placeholder:${key}`);
  return value;
}

function requireOneOf(component, getter, keys) {
  const entries = keys.map((key) => [key, getter(key)]);
  for (const [key, value] of entries) console.log(`ENV ${component}.${key}=${masked(value)}`);
  const selected = entries.find(([, value]) => !isPlaceholder(value));
  if (!selected) problems.push(`${component}_required_one_of_missing_or_placeholder:${keys.join('|')}`);
  return selected?.[1] ?? '';
}

function urlInfo(component, key, value) {
  if (isPlaceholder(value)) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') problems.push(`${component}_url_must_use_https:${key}`);
    if (parsed.username || parsed.password) problems.push(`${component}_url_contains_credentials:${key}`);
    console.log(`HOST ${component}.${key}=${parsed.hostname.toLowerCase()}`);
    return parsed.hostname.toLowerCase();
  } catch {
    problems.push(`${component}_invalid_url:${key}`);
    return '';
  }
}

function rawHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  try { return new URL(normalized.includes('://') ? normalized : `https://${normalized}`).hostname.toLowerCase(); }
  catch { return ''; }
}

const crmEnvironment = requireValue('crm', crm, 'STAGING_ENVIRONMENT_NAME');
const workerEnvironment = requireValue('worker', worker, 'STAGING_ENVIRONMENT_NAME');
if ((crmEnvironment && crmEnvironment.toLowerCase() !== 'staging') || (workerEnvironment && workerEnvironment.toLowerCase() !== 'staging')) problems.push('environment_name_must_be_staging');

const crmUrl = requireValue('crm', crm, 'STAGING_CRM_URL');
const projectRef = requireValue('crm', crm, 'STAGING_SUPABASE_PROJECT_REF');
const productionProjectRef = requireValue('crm', crm, 'PRODUCTION_SUPABASE_PROJECT_REF_FOR_COMPARISON');
const productionSupabaseHost = requireValue('crm', crm, 'PRODUCTION_SUPABASE_HOST_FOR_COMPARISON');
const publicSupabaseUrl = requireValue('crm', crm, 'VITE_SUPABASE_URL');
const serverSupabaseUrl = requireValue('crm', crm, 'SUPABASE_URL');
requireValue('crm', crm, 'VITE_SUPABASE_PUBLISHABLE_KEY');
requireOneOf('crm', crm, ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']);
requireValue('crm', crm, 'SUPABASE_SERVICE_ROLE_KEY');
const validationWorkerUrl = requireValue('crm', crm, 'WHATSAPP_VALIDATION_WORKER_URL');
const validationWorkerToken = requireValue('crm', crm, 'WHATSAPP_VALIDATION_WORKER_TOKEN');
const batchWorkerUrl = requireValue('crm', crm, 'WHATSAPP_WORKER_BATCH_URL');
const batchWorkerToken = requireValue('crm', crm, 'WHATSAPP_WORKER_BATCH_TOKEN');
const instagramSigningSecret = requireValue('crm', crm, 'INSTAGRAM_EXTENSION_SIGNING_SECRET');
const webhookSecret = requireValue('crm', crm, 'EVOLUTION_WEBHOOK_SECRET');
const stagingEvolutionUrl = requireValue('crm', crm, 'STAGING_EVOLUTION_URL');
const productionEvolutionHost = requireValue('crm', crm, 'PRODUCTION_EVOLUTION_HOST_FOR_COMPARISON');
const productionWorkerHost = requireValue('crm', crm, 'PRODUCTION_WORKER_HOST_FOR_COMPARISON');
requireValue('crm', crm, 'STAGING_INSTAGRAM_ACCOUNT_USERNAME');
requireValue('crm', crm, 'STAGING_INSTAGRAM_RECIPIENT_USERNAME');
const testPhone = requireValue('crm', crm, 'STAGING_TEST_WHATSAPP_E164');
requireValue('crm', crm, 'STAGING_USER_A_EMAIL');
requireValue('crm', crm, 'STAGING_USER_B_EMAIL');

const workerSupabaseUrl = requireValue('worker', worker, 'SUPABASE_URL');
const workerServiceRole = requireValue('worker', worker, 'SUPABASE_SERVICE_ROLE_KEY');
const workerToken = requireValue('worker', worker, 'WORKER_HTTP_TOKEN');
requireValue('worker', worker, 'WORKER_INSTANCE_ID');
const dryRun = requireValue('worker', worker, 'DRY_RUN');
const stagingWorkerUrl = requireValue('worker', worker, 'STAGING_WORKER_URL');
const workerEvolutionUrl = requireValue('worker', worker, 'STAGING_EVOLUTION_URL');

const crmHost = urlInfo('crm', 'STAGING_CRM_URL', crmUrl);
const publicSupabaseHost = urlInfo('crm', 'VITE_SUPABASE_URL', publicSupabaseUrl);
const serverSupabaseHost = urlInfo('crm', 'SUPABASE_URL', serverSupabaseUrl);
const workerSupabaseHost = urlInfo('worker', 'SUPABASE_URL', workerSupabaseUrl);
const workerHost = urlInfo('worker', 'STAGING_WORKER_URL', stagingWorkerUrl);
const validationWorkerHost = urlInfo('crm', 'WHATSAPP_VALIDATION_WORKER_URL', validationWorkerUrl);
const batchWorkerHost = urlInfo('crm', 'WHATSAPP_WORKER_BATCH_URL', batchWorkerUrl);
const evolutionHost = urlInfo('crm', 'STAGING_EVOLUTION_URL', stagingEvolutionUrl);
const workerEvolutionHost = urlInfo('worker', 'STAGING_EVOLUTION_URL', workerEvolutionUrl);

const knownProductionHosts = new Set(['painel.samuelvinsansi.com.br']);
for (const [label, host] of [['crm', crmHost], ['supabase', publicSupabaseHost], ['worker', workerHost], ['evolution', evolutionHost]]) {
  if (knownProductionHosts.has(host)) problems.push(`${label}_uses_known_production_host:${host}`);
}
if (crmHost === 'painel.samuelvinsansi.com.br') problems.push('staging_crm_must_not_use_painel_samuelvinsansi');
if (projectRef && productionProjectRef && projectRef === productionProjectRef) problems.push('supabase_staging_project_ref_matches_production');
if (publicSupabaseHost && publicSupabaseHost === rawHost(productionSupabaseHost)) problems.push('supabase_staging_host_matches_production');
if (workerHost && workerHost === rawHost(productionWorkerHost)) problems.push('worker_staging_host_matches_production');
if (evolutionHost && evolutionHost === rawHost(productionEvolutionHost)) problems.push('evolution_staging_host_matches_production');
if (publicSupabaseHost && (publicSupabaseHost !== serverSupabaseHost || publicSupabaseHost !== workerSupabaseHost)) problems.push('supabase_hosts_do_not_match_across_staging_components');
if (workerHost && (workerHost !== validationWorkerHost || workerHost !== batchWorkerHost)) problems.push('worker_hosts_do_not_match_crm_serverless_configuration');
if (evolutionHost && evolutionHost !== workerEvolutionHost) problems.push('evolution_hosts_do_not_match_staging_metadata');
if (crm('SUPABASE_SERVICE_ROLE_KEY') && workerServiceRole && crm('SUPABASE_SERVICE_ROLE_KEY') !== workerServiceRole) problems.push('service_role_differs_between_crm_and_worker');
if (workerToken && (workerToken !== validationWorkerToken || workerToken !== batchWorkerToken)) problems.push('worker_tokens_do_not_match_serverless_tokens');
for (const [key, secret] of [['WORKER_HTTP_TOKEN', workerToken], ['INSTAGRAM_EXTENSION_SIGNING_SECRET', instagramSigningSecret], ['EVOLUTION_WEBHOOK_SECRET', webhookSecret]]) {
  if (secret && secret.length < 32) problems.push(`secret_too_short:${key}`);
}
if (testPhone && !isPlaceholder(testPhone) && !/^55\d{10,11}$/.test(testPhone)) problems.push('staging_test_whatsapp_must_be_authorized_brazilian_e164');
if (dryRun && dryRun.toLowerCase() !== 'true') problems.push('worker_dry_run_must_be_true_during_staging_preparation');

const manifest = fs.readFileSync(path.join(workspace, 'instagram-extension', 'manifest.json'), 'utf8');
const popup = fs.readFileSync(path.join(workspace, 'instagram-extension', 'popup.js'), 'utf8');
if (manifest.includes('painel.samuelvinsansi.com.br') || popup.includes('painel.samuelvinsansi.com.br')) problems.push('instagram_extension_still_references_known_production_crm');
if (crmHost && (!manifest.includes(crmHost) || !popup.includes(crmHost))) problems.push('instagram_extension_does_not_reference_staging_crm_host');

function commandExists(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'sh', process.platform === 'win32' ? [command] : ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return probe.status === 0;
}

const nodeVersion = process.versions.node.split('.').map(Number);
const nodeCompatible = nodeVersion[0] === 22 && (nodeVersion[1] > 12 || (nodeVersion[1] === 12 && nodeVersion[2] >= 0));
console.log(`TOOL node=${process.versions.node} compatible=${nodeCompatible}`);
if (!nodeCompatible) problems.push(`node_version_incompatible:${process.versions.node}`);
const hasSupabaseCli = commandExists('supabase');
const hasPsql = commandExists('psql');
const hasPgDump = commandExists('pg_dump');
const hasUnzip = commandExists('unzip');
const hasDocker = commandExists('docker');
const hasNpm = commandExists('npm');
console.log(`TOOL supabase=${hasSupabaseCli} psql=${hasPsql} pg_dump=${hasPgDump} unzip=${hasUnzip} docker=${hasDocker} npm=${hasNpm}`);
if (!hasSupabaseCli && !(hasPsql && hasPgDump)) problems.push('database_tooling_missing:install_supabase_cli_or_psql_and_pg_dump');
if (!hasUnzip) problems.push('unzip_missing');
if (!hasDocker) problems.push('docker_missing');
if (!hasNpm) problems.push('npm_missing');

console.log('MODE read_only=true remote_connections=0 remote_writes=0');
if (problems.length) {
  console.log('MISSING_OR_INVALID');
  for (const problem of [...new Set(problems)].sort()) console.log(`- ${problem}`);
  console.log('STAGING_CONFIGURATION_INCOMPLETE');
  process.exitCode = 1;
} else {
  console.log('READY_FOR_STAGING_VALIDATION');
}
