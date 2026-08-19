import fs from 'node:fs';
import path from 'node:path';

const crmRoot = process.cwd();
const workspaceRoot = path.resolve(crmRoot, '..');
const workerRoot = path.join(workspaceRoot, 'worker');
const extensionRoot = path.join(workspaceRoot, 'instagram-extension');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sliceBetween = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
};

const checklist = read(crmRoot, 'scripts/production-deploy-checklist.md');
const smoke = read(crmRoot, 'scripts/production-smoke-test-plan.md');
const packageJson = JSON.parse(read(crmRoot, 'package.json'));
const envExample = read(crmRoot, '.env.example');
const app = read(crmRoot, 'src/App.tsx');
const importPage = read(crmRoot, 'src/pages/ImportPage.tsx');
const registry = read(crmRoot, 'src/pages/pageRegistry.ts');
const settingsOverview = read(crmRoot, 'src/pages/ConfigurationPages.tsx');
const importSettings = read(crmRoot, 'src/pages/ImportSettingsPage.tsx');
const importService = read(crmRoot, 'src/services/import/import.service.ts');
const importRepository = read(crmRoot, 'src/repositories/import/supabaseImport.repository.ts');
const dispatchApi = read(crmRoot, 'api/whatsapp/dispatch.ts');
const batchApi = read(crmRoot, 'api/whatsapp/batch.ts');
const validationApi = read(crmRoot, 'server/whatsapp/validation.handler.ts');
const apiSources = fs.readdirSync(path.join(crmRoot, 'api'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => read(crmRoot, path.relative(crmRoot, path.join(entry.parentPath ?? entry.path, entry.name))))
  .concat(fs.readdirSync(path.join(crmRoot, 'server'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => read(crmRoot, path.relative(crmRoot, path.join(entry.parentPath ?? entry.path, entry.name)))))
  .join('\n');
const migrationPlan = read(crmRoot, 'scripts/production-manual-migration-plan.sql');
const forwardIdentity = read(crmRoot, 'supabase/migrations/20260812130000_install_forward_only_identity_contract.sql');

const worker = read(workerRoot, 'src/worker.js');
const operationalWindow = read(workerRoot, 'src/operational-window.js');
const workerDockerfile = read(workerRoot, 'Dockerfile');
const workerEnv = read(workerRoot, '.env.example');
const scheduler = sliceBetween(worker, 'async function schedulerTick()', 'async function sendWorkerHeartbeat');
const workerHttp = sliceBetween(worker, 'const server = createServer', 'server.listen');

const manifest = JSON.parse(read(extensionRoot, 'manifest.json'));
const popup = read(extensionRoot, 'popup.js');
const content = read(extensionRoot, 'content.js');

const headings = ['## A. Worker', '## B. APIs/Vercel', '## C. CRM', '## D. Extensão Instagram', '## E. Smoke test'];
let previousHeading = -1;
for (const heading of headings) {
  const index = checklist.indexOf(heading);
  assert(index > previousHeading, `Checklist ausente ou fora de ordem: ${heading}.`);
  previousHeading = index;
}
for (const section of headings) {
  const start = checklist.indexOf(section);
  const next = headings.find((heading) => checklist.indexOf(heading) > start);
  const body = checklist.slice(start, next ? checklist.indexOf(next) : checklist.length);
  for (const required of ['### Pré-requisito', '### Ação manual', '### Verificação pós-deploy', '### GO', '### STOP / rollback']) {
    assert(body.includes(required), `${section} não contém ${required}.`);
  }
}
assert(checklist.includes('não reverta migrations') || checklist.includes('Não reverter migrations'), 'Rollback tenta incluir migrations.');
assert(!/\b(?:supabase\s+db\s+push|supabase\s+migration\s+up|psql\s+-|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(checklist + smoke), 'Runbook contém comando remoto ou DDL proibido.');

assert(workerDockerfile.includes('FROM node:22-alpine'), 'Docker do Worker não fixa Node 22.');
for (const variable of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WORKER_HTTP_TOKEN']) {
  assert(workerEnv.includes(`${variable}=`) && checklist.includes(variable), `Variável obrigatória do Worker ausente: ${variable}.`);
}
assert(scheduler.includes('dispatchOne('), 'schedulerTick deixou de chamar dispatchOne.');
assert((worker.match(/dispatchOne\(/g) ?? []).length === 2, 'dispatchOne possui chamador adicional além do scheduler.');
assert(!workerHttp.includes('dispatchOne('), 'Handler HTTP do Worker chama dispatchOne diretamente.');
assert(workerHttp.includes("req.url === '/dispatch/whatsapp'") && workerHttp.includes('reply(res, 410'), 'Worker não mantém dispatch direto em 410.');
assert(worker.includes('service_worker_heartbeat') && worker.includes('worker_recover_stale_whatsapp'), 'Heartbeat ou recovery do Worker ausente.');
assert(worker.includes("'/batch/whatsapp/start'") && worker.includes("'/batch/whatsapp/pause'") && worker.includes("'/batch/whatsapp/resume'") && worker.includes("'/batch/whatsapp/stop'"), 'Endpoints persistentes do batch incompletos.');
assert(operationalWindow.includes('DEFAULT_CUTOFF_MINUTES = 22 * 60'), 'Cutoff padrão deixou de ser 22:00.');
assert(!/apify/i.test(worker + workerEnv), 'Worker contém dependência ativa Apify.');
assert(!worker.includes('20260802130000_identity_dedup_suppression') && !worker.includes('20260802131000_fix_instagram_identity_normalization'), 'Worker depende de migration identity bloqueada.');

assert(!/apify/i.test(apiSources), 'API Vercel ativa contém dependência Apify.');
assert(dispatchApi.includes('send(res,410') && !dispatchApi.includes('fetch('), 'API direta WhatsApp não está fail-closed em 410.');
assert(batchApi.includes('WHATSAPP_WORKER_BATCH_URL') && batchApi.includes('WHATSAPP_WORKER_BATCH_TOKEN'), 'API batch perdeu URL/token server-side.');
assert(validationApi.includes("rpc('record_whatsapp_validation_result'") && !validationApi.includes(".update({ lead_status_id"), 'API WhatsApp não persiste a prova exclusivamente pela RPC controlada.');
assert(validationApi.includes('SUPABASE_SERVICE_ROLE_KEY') && !importPage.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Service role não está restrita ao server-side.');
assert(!apiSources.includes('leads_identity_contract_version'), 'API tenta forçar identity contract no histórico.');
assert(!apiSources.includes('20260802130000_identity_dedup_suppression') && !apiSources.includes('20260802131000_fix_instagram_identity_normalization'), 'API depende de migration identity bloqueada.');
assert(!/APIFY_[A-Z0-9_]+/i.test(envExample + workerEnv), 'Pacote exige variável Apify.');
for (const variable of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WHATSAPP_VALIDATION_WORKER_URL', 'WHATSAPP_VALIDATION_WORKER_TOKEN', 'WHATSAPP_WORKER_BATCH_URL', 'WHATSAPP_WORKER_BATCH_TOKEN', 'INSTAGRAM_EXTENSION_SIGNING_SECRET']) {
  assert(checklist.includes(variable), `Inventário Vercel não documenta ${variable}.`);
}

const activeImport = [importPage, registry, settingsOverview, importSettings].join('\n');
assert(!importPage.includes("useState<'Manual' | 'Google Maps Extension'>") && importPage.includes('Importar backup JSON (diagnóstico)'), 'Importação divergiu do contrato API-first: Maps independente e JSON apenas diagnóstico.');
assert(!/apify/i.test(activeImport), 'Apify reapareceu no UX ativo.');
assert(!app.includes('ApifyAccountsPage') && app.includes("'config-import-apify': 'config-import-rules'"), 'Página Apify está montada ou ID legado não redireciona.');
assert(importService.includes('guardImportPersistence') && importPage.includes('await sendApprovedToInicio(result.leads)'), 'Simulation/persistência não protege o fluxo Google Maps JSON.');
assert(importRepository.includes("? 'instagram'") && importRepository.includes(": 'sem_site';"), 'Contact sources canônicas não estão preservadas.');
assert(!importRepository.includes(": ['whatsapp'];") && !importRepository.includes('contactSources.length === 1'), 'WhatsApp voltou a ser origem ou o fallback arbitrário reapareceu.');

const blocked = ['20260802130000_identity_dedup_suppression.sql', '20260802131000_fix_instagram_identity_normalization.sql'];
const manualSequence = migrationPlan.slice(0, migrationPlan.indexOf('blocked_migrations'));
for (const migration of blocked) {
  assert(!manualSequence.includes(migration), `Migration bloqueada entrou na sequência manual: ${migration}.`);
  assert(migrationPlan.includes(migration), `Migration bloqueada deixou de estar explicitamente identificada: ${migration}.`);
}
assert(!/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+public\.leads\b/i.test(forwardIdentity.replace(/--.*$/gm, '')), 'Identity forward-only contém DML histórico em public.leads.');
const runtimeCode = [app, importPage, importService, apiSources, worker, popup, content].join('\n');
assert(!runtimeCode.includes('leads_identity_contract_version'), 'Runtime força leads_identity_contract_version.');

assert(manifest.manifest_version === 3 && manifest.version === '1.6.1', 'Manifest Instagram inválido ou versão inesperada.');
assert(manifest.host_permissions?.includes('https://crm-vinsansi-studio.vercel.app/*'), 'Extensão não autoriza a API operacional atual.');
assert(popup.includes("const CRM_API_BASE = 'https://crm-vinsansi-studio.vercel.app/api'"), 'Extensão não aponta para a API operacional atual.');
assert(popup.includes('chrome.storage.session.set') && popup.includes('delete persisted.extensionToken'), 'Token temporário não está restrito à sessão.');
assert(popup.includes('skipped_invalid_recipient') && popup.includes('uncertainMediaTransportResult'), 'Extensão perdeu tratamento de inválidos ou transporte incerto.');
assert(content.includes('uncertainImageUploadResult') && content.includes('O evento de upload foi disparado, mas o preview não pôde ser confirmado.'), 'Upload incerto não exige reconciliação.');
assert(!/(?:SUPABASE_SERVICE_ROLE_KEY|eyJ[a-zA-Z0-9_-]{20,}|sk_(?:live|test)_)/.test(popup + content + read(extensionRoot, 'background.js')), 'Possível segredo permanente embutido na extensão.');

for (let step = 1; step <= 17; step += 1) {
  assert(new RegExp(`^${step}\\.`, 'm').test(smoke), `Smoke test não contém o passo ${step}.`);
}
assert(smoke.includes('Manual') && smoke.includes('Google Maps Extension') && smoke.includes('HTTP 410'), 'Smoke test não cobre fontes ativas ou dispatch 410.');

assert(packageJson.scripts?.['verify:production-deploy-package'] === 'node scripts/verify-production-deploy-package.mjs', 'Verificador não está registrado no package.json.');
assert(packageJson.scripts?.['verify:all']?.includes('npm run verify:production-deploy-package'), 'verify:all não inclui o pacote de deploy.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: pacote de deploy manual preserva ordem Worker → APIs/Vercel → CRM → Instagram → smoke test.');
console.log('OK: Apify, dispatch direto, migrations identity bloqueadas, backfill e mutação de banco permanecem fora do pacote.');
