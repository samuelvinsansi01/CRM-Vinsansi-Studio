import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const app = read('src/App.tsx');
const registry = read('src/pages/pageRegistry.ts');
const settingsOverview = read('src/pages/ConfigurationPages.tsx');
const importSettings = read('src/pages/ImportSettingsPage.tsx');
const importPage = read('src/pages/ImportPage.tsx');
const importService = read('src/services/import/import.service.ts');
const importHook = read('src/hooks/useImportLeads.ts');
const importValidation = read('src/services/import/importValidation.ts');
const importRepository = read('src/repositories/import/supabaseImport.repository.ts');
const legacyPage = read('src/pages/ApifyAccountsPage.tsx');
const legacyService = read('src/services/apify-import/apifyImport.service.ts');

assert(!importPage.includes("useState<'Manual' | 'Google Maps Extension'>"), 'O seletor operacional legado Maps voltou à página Importar.');
assert(importPage.includes('Panel title="Adicionar lead"') && importPage.includes('Importar backup JSON (diagnóstico)'), 'Cadastro manual ou fallback diagnóstico deixou de estar disponível.');
assert(!/apify/i.test(importPage), 'ImportPage ainda contém chamada, estado, CTA ou texto Apify.');
assert(!/apify/i.test(registry), 'A navegação ativa ainda contém Apify.');
assert(!/apify/i.test(settingsOverview), 'A visão de configurações ainda apresenta Apify como disponível.');
assert(!/apify/i.test(importSettings), 'A configuração canônica ainda comunica Apify como fonte suportada.');
assert(!app.includes('ApifyAccountsPage') && !app.includes("activePage === 'config-import-apify'"), 'App ainda monta a página legada de Apify.');
assert(app.includes("'config-import-apify': 'config-import-rules'"), 'ID legado de Apify não redireciona para uma página ativa segura.');

const activeImportRuntime = [importPage, importService, importHook].join('\n');
assert(!activeImportRuntime.includes('apifyImportService') && !activeImportRuntime.includes('useApifyAccounts'), 'Runtime ativo de importação ainda chama serviços/contas Apify.');
assert(!activeImportRuntime.includes("origin: 'apify'") && !activeImportRuntime.includes('apifyImportJobId:'), 'Fluxo principal ainda cria importação com origem/job Apify.');
assert(importPage.includes('await importJson(jsonText, { simulate: true })') && importPage.includes('await sendApprovedToInicio(result.leads)'), 'Entrada da extensão não usa a prévia e a persistência protegida existentes.');
assert(importService.includes('guardImportPersistence') && importHook.includes('importService.persistLeads'), 'Barreira central de simulação deixou de proteger a entrada ativa.');
for (const key of ['googleUrl', 'mapsUrl', 'googleMapsUrl', 'placeUrl']) {
  assert(importValidation.includes(key), `Parser atual não reconhece o campo Google Maps ${key}.`);
}

assert(importRepository.includes("? 'instagram'") && importRepository.includes("? 'agregador'") && importRepository.includes("? 'dominio_proprio'") && importRepository.includes(": 'sem_site';"), 'Resolvedor não preserva as quatro contact_sources canônicas.');
assert(!importRepository.includes(": ['whatsapp'];") && !importRepository.includes('contactSources.length === 1'), 'WhatsApp ainda é tratado como origem ou há fallback arbitrário.');
assert(importRepository.includes("destination === 'Instagram' ? 'instagram' : 'whatsapp'"), 'Channels não são resolvidos separadamente entre WhatsApp e Instagram.');

assert(legacyPage.includes('ApifyAccountsPage') && legacyService.includes('apifyImportService'), 'Código legado de compatibilidade Apify foi removido, em vez de apenas desativado.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: importação ativa mantém cadastro manual e backup Maps apenas diagnóstico; operação Maps segue independente e Apify permanece legado.');
