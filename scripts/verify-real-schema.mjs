import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'scripts/schema-real.contract.json'), 'utf8'));
const tables = new Set(Object.keys(contract.tables));
const failures = [];

function assert(condition, message) { if (!condition) failures.push(message); }
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

const requiredTables = [
  'users','status','channels','branches','templates','template_channels','template_types',
  'chips','instances','levels','socials','leads','queues','queue_items','sents',
  'apify_accounts','apify_import_jobs','countries','states','cities','contact_sources','lead_status',
  'import_rules','validation_rules','lead_validation_results','lead_validation_attempts',
];
for (const table of requiredTables) assert(tables.has(table), `Tabela obrigatoria ausente no contrato: ${table}`);

const requiredColumns = {
  users: ['users_id','auth_user_id','users_name','users_avatar_path'],
  chips: ['chips_id','users_id','instances_id','levels_id','status_id','chips_name','chips_phone'],
  instances: ['instances_id','users_id','instances_name','instances_url','instances_apikey'],
  socials: ['socials_id','users_id','levels_id','status_id','socials_name','socials_username'],
  templates: ['templates_id','users_id','branches_id','status_id','templates_message_1','templates_message_2','templates_message_3','templates_message_4','template_channels_id','template_types_id'],
  queues: ['queues_id','users_id','channels_id','status_id','queues_name'],
  queue_items: ['queue_items_id','users_id','queues_id','leads_id','chips_id','socials_id','templates_id','status_id'],
  leads: ['leads_id','users_id','branches_id','channels_id','lead_status_id','contact_sources_id'],
  sents: ['sents_id','users_id','queue_items_id','leads_id','channels_id','sents_body'],
  import_rules: ['import_rules_id','users_id','status_id'],
  validation_rules: ['validation_rules_id','users_id','validation_rules_source_id','validation_rules_channel_id','validation_rules_fallback_channel_id'],
  lead_validation_results: ['lead_validation_results_id','lead_validation_results_key','lead_validation_results_name'],
  lead_validation_attempts: ['lead_validation_attempts_id','users_id','leads_id','channels_id','status_id','lead_validation_results_id'],
};
for (const [table, columns] of Object.entries(requiredColumns)) {
  const actual = new Set(contract.tables[table]?.columns ?? []);
  for (const column of columns) assert(actual.has(column), `${table}.${column} ausente no contrato real.`);
}

const runtimeFiles = [
  ...walk(path.join(root, 'src')).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file)),
  ...walk(path.join(root, 'api')).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file)),
];
const forbiddenTables = [
  'app_settings','instagram_profiles','instagram_queue_items','whatsapp_queue_items',
  'lead_events','lead_dispatch_messages','pre_send_leads','sent_contacts','base_permanente',
];
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const table of forbiddenTables) {
    const dbRef = new RegExp(`\\.from\\(\\s*['\"]${table}['\"]`, 'i');
    assert(!dbRef.test(text), `${path.relative(root, file)} consulta tabela inexistente/legada ${table}.`);
  }
  assert(!/\.eq\(\s*['"]user_id['"]/.test(text), `${path.relative(root, file)} ainda filtra coluna user_id.`);
}

for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const regex = /\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
  for (const match of text.matchAll(regex)) {
    assert(tables.has(match[1]), `${path.relative(root, file)} consulta tabela fora do schema real: ${match[1]}`);
  }
}


const routingRules = read('src/services/lead-cycle/leadRouting.rules.ts');
assert(!/targetChannel:\s*[12]/.test(routingRules), 'Roteamento ainda presume IDs fixos de canal.');
const queuePreparation = read('src/services/queue-preparation/queuePreparation.service.ts');
assert(!/channel === ['"]WhatsApp['"] \? 1 : 2/.test(queuePreparation), 'Pre-envio ainda presume IDs fixos de canal.');
const validationRules = read('src/services/whatsapp-validation/whatsappValidation.rules.ts');
assert(!/channels_id\) !== 1|channels_id !== 1/.test(validationRules), 'Validacao ainda presume channels_id=1.');

const queueSchema = read('src/repositories/queueSchema.ts');
assert(queueSchema.includes("from('queues')"), 'Fila canonica precisa consultar queues.');
assert(queueSchema.includes("from('queue_items')"), 'Fila canonica precisa consultar queue_items.');
assert(queueSchema.includes("from('socials')") || queueSchema.includes("rowsByIds('socials'"), 'Fila Instagram precisa usar socials.');

const configRepo = read('src/repositories/config/canonicalConfig.repository.ts');
for (const token of ['templates_id','chips_id','users_id','socials_id','instances_id','levels_id']) {
  assert(configRepo.includes(token), `Configuracao canonica nao referencia ${token}.`);
}
for (const message of ['templates_message_1','templates_message_2','templates_message_3','templates_message_4']) {
  assert(configRepo.includes(message), `Configuracao de template nao usa ${message}.`);
}

const apiInstagram = read('api/instagram/extension.ts');
assert(apiInstagram.includes("from('queue_items')"), 'API da extensao precisa usar queue_items.');
assert(apiInstagram.includes("from('socials')"), 'API da extensao precisa usar socials.');
assert(!apiInstagram.includes("from('instagram_queue_items')"), 'API da extensao ainda usa fila inexistente.');

const reconciliation = read('src/repositories/reconciliation/canonicalReconciliation.repository.ts');
assert(reconciliation.includes("from('queue_items')"), 'F10 precisa usar queue_items real.');
assert(!fs.existsSync(path.join(root, 'src/repositories/reconciliation/supabaseReconciliation.repository.ts')), 'Repository legado de reconciliacao ainda existe.');

const removedFiles = [
  'src/repositories/config/supabaseConfig.repository.ts',
  'src/repositories/settings/supabaseSettings.repository.ts',
  'src/repositories/whatsapp-queue/supabaseWhatsAppQueue.repository.ts',
  'src/repositories/instagram-queue/supabaseInstagramQueue.repository.ts',
  'src/repositories/events/supabaseEventLog.repository.ts',
];
for (const file of removedFiles) assert(!fs.existsSync(path.join(root, file)), `Repository legado ainda empacotado: ${file}`);

// As policies RLS são validadas diretamente na base de produção pelo precheck.
// O pacote do frontend não carrega SQL solto nem tenta reaplicar policies automaticamente.

if (failures.length) {
  console.error(`\nFalhas do contrato real (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Contrato real aprovado: ${tables.size} tabelas inventariadas; runtime sem referencias a tabelas presumidas.`);
