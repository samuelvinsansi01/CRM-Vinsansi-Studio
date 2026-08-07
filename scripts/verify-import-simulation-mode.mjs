import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const method = (source, name, nextName) => {
  const start = source.indexOf(`async ${name}`);
  const end = nextName ? source.indexOf(`async ${nextName}`, start + 1) : source.length;
  return start >= 0 ? source.slice(start, end >= 0 ? end : source.length) : '';
};

const app = read('src/App.tsx');
const settingsPage = read('src/pages/ImportSettingsPage.tsx');
const importPage = read('src/pages/ImportPage.tsx');
const hook = read('src/hooks/useImportLeads.ts');
const service = read('src/services/import/import.service.ts');
const guard = read('src/services/import/importPersistence.guard.ts');
const defaults = read('src/services/import-settings/importSettings.seed.ts');
const legacyPage = read('src/pages/ImportRulesPage.tsx');
const legacyRepository = read('src/repositories/configuration/configuration.repository.ts');

assert(app.includes("import { ImportSettingsPage }"), 'App não importa a configuração canônica de importação.');
assert(app.includes("activePage === 'config-import-rules' ? <ImportSettingsPage />"), 'Critérios de importação não monta ImportSettingsPage.');
assert(!app.includes("import { ImportRulesPage }") && !app.includes('<ImportRulesPage'), 'ImportRulesPage ainda está montada na navegação ativa.');
assert(app.includes("'import-settings': 'config-import-rules'"), 'Identificador legado import-settings não aponta para a configuração canônica.');

assert(settingsPage.includes('const [draft, setDraft]') && settingsPage.includes('const [dirty, setDirty]'), 'ImportSettingsPage não usa edição local com estado sujo.');
assert(settingsPage.includes('const input: UpdateImportSettingsInput') && settingsPage.includes('updateSettings(input)') && settingsPage.includes('disabled={!dirty}'), 'Salvar não persiste explicitamente o rascunho.');
assert(!settingsPage.includes('useApifyAccounts') && !settingsPage.includes('ApifyAccountsPanel'), 'Gerenciamento duplicado de contas Apify permanece na página canônica.');
assert(settingsPage.includes('safeMode.simulationMode'), 'Controle canônico de simulationMode não está visível.');

assert(defaults.includes('simulationMode: true'), 'Padrão canônico de simulação deixou de ser true.');
assert(guard.includes('importSettingsService.get()') && guard.includes('settings.safeMode.simulationMode'), 'Barreira não lê simulationMode da configuração canônica atual.');
assert(guard.includes('allowed: !simulation'), 'Barreira não restaura persistência quando a simulação é desativada.');
assert(!guard.includes('import_rules'), 'Barreira consultou import_rules.');

for (const [name, nextName] of [
  ['importFromJson', 'persistLeads'],
  ['persistLeads', 'createFromImport'],
  ['createFromImport', 'updateFromImport'],
  ['updateFromImport', 'removeFromImport'],
  ['removeFromImport', 'moveFromImport'],
  ['moveFromImport', 'moveManyFromImport'],
  ['moveManyFromImport', 'update'],
]) {
  assert(method(service, name, nextName).includes('guardImportPersistence'), `${name} não usa a barreira central.`);
}
assert(method(service, 'persistLeads', 'createFromImport').includes('created: []'), 'Persistência em lote não retorna resultado estruturado de simulação.');
assert(method(service, 'createFromImport', 'updateFromImport').includes('lead: null'), 'Cadastro direto não é bloqueado de forma estruturada.');
assert(method(service, 'updateFromImport', 'removeFromImport').includes('lead: null'), 'Atualização da tela de importação não é bloqueada de forma estruturada.');
assert(hook.includes('importService.persistLeads') && hook.includes('importService.createFromImport') && hook.includes('importService.updateFromImport'), 'Hook ativo contorna a barreira central.');
assert(hook.includes('importService.removeFromImport') && hook.includes('importService.moveFromImport') && hook.includes('importService.moveManyFromImport'), 'Mutações de leads persistidos contornam a barreira central.');
assert(importPage.includes("title: 'Ação bloqueada pela simulação'") && importPage.includes('Nenhum lead persistido foi alterado.'), 'Interface pode anunciar alteração bloqueada como sucesso.');

assert(!importPage.includes('simulate: false'), 'Apify ainda força simulate:false.');
assert(importPage.includes("origin: 'apify'") && importPage.includes('processApifyJob(pendingJob.jobId)'), 'Fluxos Apify ativo e recuperado não compartilham o processamento protegido.');
assert(importPage.includes('Modo de simulação ativo.') && importPage.includes('Os leads serão analisados, mas não serão gravados.'), 'Banner operacional de simulação está ausente.');
assert(importPage.includes('A coleta pode consumir créditos do Apify, mas nenhum lead será persistido.'), 'Aviso de créditos Apify está ausente.');
assert(importPage.includes('0 lead(s) persistido(s) por causa da simulação'), 'Resultado de simulação não informa zero persistências.');
assert(importPage.includes("title: 'Simulação concluída'") && importPage.includes("importedResult.report.simulation ? 'Coleta validada em simulação'"), 'Interface ainda pode anunciar importação durante simulação.');
assert(importPage.includes('disabled={!manualLead.empresa || simulateImport}'), 'Cadastro direto não está visualmente bloqueado em simulação.');

const activeRuntime = [app, importPage, hook, service, guard, settingsPage].join('\n');
assert(!activeRuntime.includes('import_rules'), 'Runtime ativo consulta import_rules.');
assert(legacyPage.includes('saveImportRules') && legacyRepository.includes("from('import_rules')"), 'Código/dados legados de import_rules foram removidos desta tarefa.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: modo de simulação canônico bloqueia persistência em todos os caminhos ativos de importação.');
