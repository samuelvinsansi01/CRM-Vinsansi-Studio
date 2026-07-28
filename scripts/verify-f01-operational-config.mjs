import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
}

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function loadTsModule(file) {
  const source = read(file);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  const fn = new Function('exports', 'module', 'require', output);
  fn(module.exports, module, () => ({}));
  return module.exports;
}

const repositoriesIndex = read('src/repositories/index.ts');
assert(!repositoriesIndex.includes('mockConfigRepository'), 'F01 ainda usa mockConfigRepository.');
assert(!repositoriesIndex.includes('mockSettingsRepository'), 'F01 ainda usa mockSettingsRepository.');
assert(repositoriesIndex.includes('config: supabaseConfigRepository'), 'F01 deve usar somente o repository Supabase.');
assert(repositoriesIndex.includes('settings: supabaseSettingsRepository'), 'F01 deve usar settings somente no Supabase.');

const configRepository = read('src/repositories/config/supabaseConfig.repository.ts');
for (const scope of ["tableForKind('templates')", "tableForKind('chips')", "tableForKind('instagram')"]) {
  assert(configRepository.includes(scope), `Repository nao referencia ${scope}.`);
}
assert((configRepository.match(/\.eq\('user_id', userId\)/g) ?? []).length >= 8, 'Configuracoes do usuario nao estao suficientemente isoladas.');
assert(configRepository.includes('Nao foi possivel carregar os perfis Instagram'), 'Erro de perfil Instagram ainda pode ser ocultado.');

const settingsRepository = read('src/repositories/settings/supabaseSettings.repository.ts');
assert(!/if \(error\) return/.test(settingsRepository), 'Settings ainda converte erro do banco em fallback silencioso.');
assert(settingsRepository.includes('A configuracao nao foi encontrada apos o salvamento'), 'Settings nao confirma a persistencia.');

const settingsPage = read('src/pages/SettingsPage.tsx');
assert(settingsPage.includes('Salvar alteracoes'), 'Configuracoes de disparo precisam de salvamento explicito.');
assert(settingsPage.includes('Perfis ativos usados pelo Instagram'), 'Perfis Instagram devem vir do cadastro oficial.');

const configPage = read('src/pages/ConfigTablePage.tsx');
assert(configPage.includes("const API_KEY_MASK = '••••••••'"), 'API Key do chip nao esta mascarada.');
assert(configPage.includes("type={field.inputType}"), 'Campo sensivel nao usa tipo password.');

const rules = loadTsModule('src/services/config/operationalConfig.rules.ts');
const base = {
  status: 'Ativo', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const branch = {
  ...base, id: '1', kind: 'branches', slug: 'moveis-planejados', name: 'Moveis Planejados', category: 'Moveis',
  subcategories: ['Marcenaria'], associatedCategories: ['Loja de moveis'], order: 1, minRating: 4, minReviews: 10,
  imageName: 'moveis.jpg', imageRequired: true,
};
const template = {
  ...base, id: 't1', kind: 'templates', branchId: '1', branchName: branch.name, channel: 'WhatsApp', type: 'sem-site',
  message1: 'm1', message2: 'm2', message3: 'm3', message4: 'm4', preview: 'm1',
};
const chip = {
  ...base, id: 'c1', kind: 'chips', name: 'Principal', number: '5511999999999', level: 'estabilizado',
  url: 'https://evolution.example.com', instance: 'chip-01', apiKey: 'secret', connectionStatus: 'open', priority: 1,
  startTime: '13:00', endTime: '18:00', dailyLimit: 120, intervalSeconds: 60, blockSize: 60,
  batches: ['13:00', '15:00'], paused: false,
};
const instagram = { ...base, id: 'i1', kind: 'instagram', name: 'Perfil', username: 'perfil.teste', dailyLimit: 60 };
const records = [branch, template, chip, instagram];
for (const record of records) rules.assertOperationalConfigRecord(record, records, record.id);

let rejected = false;
try {
  rules.assertOperationalConfigRecord({ ...template, id: 'bad', message4: '' }, records);
} catch {
  rejected = true;
}
assert(rejected, 'Template incompleto deveria ser rejeitado.');

rejected = false;
try {
  rules.assertOperationalConfigRecord({ ...chip, id: 'bad', startTime: '19:00', endTime: '18:00' }, records);
} catch {
  rejected = true;
}
assert(rejected, 'Janela de chip invalida deveria ser rejeitada.');

const dispatchRules = loadTsModule('src/services/settings/dispatchSettings.rules.ts');
const validChannel = {
  startTime: '13:00', endTime: '18:00', delayMinSeconds: 60, delayMaxSeconds: 120,
  perBatch: 30, batches: 2, batchDelayMinutes: 60, dailyLimit: 60,
  activeDays: ['Segunda', 'Terca'], batchBehavior: 'Respeitar lotes e janela',
};
const validSettings = {
  whatsapp: validChannel,
  instagram: { ...validChannel, profile: 'perfil.teste', profiles: ['perfil.teste'], delayMinutes: 60 },
  chipLevels: { estabilizado: { dailyLimit: 120, batchCount: 2 } },
};
dispatchRules.normalizeDispatchSettingsStrict(validSettings, validSettings);

console.log('F01 operational configuration verification passed.');
