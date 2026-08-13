import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function loadTypescriptModule(file, dependencies = new Map()) {
  const source = read(file);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  const factory = vm.runInThisContext(`(function (require, module, exports) { ${output}\n})`, { filename: file });
  factory((specifier) => {
    if (dependencies.has(specifier)) return dependencies.get(specifier);
    throw new Error(`Dependência não preparada no verificador: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const fixture = JSON.parse(read('scripts/fixtures/google-maps-extension-export.json'));
const runner = readExtension('src/runner.js');
const extractor = readExtension('src/extractor.js');
const detailExtractor = readExtension('src/detail-extractor.js');
const sidepanel = readExtension('sidepanel.js');
const manifest = readExtension('manifest.json');
const importValidationSource = read('src/services/import/importValidation.ts');
const importPage = read('src/pages/ImportPage.tsx');
const importService = read('src/services/import/import.service.ts');
const importHook = read('src/hooks/useImportLeads.ts');
const importRepository = read('src/repositories/import/supabaseImport.repository.ts');

assert(fixture && !Array.isArray(fixture) && Array.isArray(fixture.items), 'Fixture não preserva o envelope metadata/items/errors/diagnostic exportado pela extensão.');
assert(fixture.metadata?.extensionVersion === '0.13.0', 'Fixture não identifica a versão real auditada da extensão.');
assert(fixture.items.length >= 4, 'Fixture não cobre WhatsApp sem site, site próprio, agregador e Instagram.');
for (const key of ['name', 'category', 'phone', 'website', 'instagram', 'googleMapsUrl', 'address', 'rating', 'reviewCount']) {
  assert(Object.hasOwn(fixture.items[0], key), `Fixture perdeu o campo real da extensão: ${key}.`);
}

assert(runner.includes('metadata: {') && runner.includes('items: runtime.items') && runner.includes('errors: runtime.errorLog') && runner.includes('diagnostic: runtime.diagnostic'), 'Contrato raiz real de getData() mudou.');
assert(sidepanel.includes('async function exportPayload()') && sidepanel.includes('JSON.stringify(data, null, 2)') && sidepanel.includes("send('GMAPS_POC_GET_DATA')"), 'Side panel deixou de preservar o resultado de getData() no export manual/operacional.');
for (const key of ['name', 'category', 'phone', 'address', 'website', 'rating', 'reviewCount', 'googleMapsUrl', 'instagram']) {
  const propertyPattern = new RegExp(`\\b${key}\\s*[:,]`);
  assert(propertyPattern.test(extractor) || propertyPattern.test(detailExtractor), `Extrator deixou de produzir o campo ${key}.`);
}
assert(manifest.includes('https://www.google.com/maps/*'), 'Extensão deixou de ficar limitada ao host do Google Maps.');

const instagramModule = loadTypescriptModule('src/services/instagram/instagram.utils.ts');
const brazilStateModule = loadTypescriptModule('src/services/geo/brazilState.ts');
const settings = {
  minRating: 4,
  minReviews: 10,
  safeMode: { simulationMode: true },
  instagramLowRating: { enabled: true, minRating: 3.7, maxRatingExclusive: 4, minReviews: 5 },
  branchRules: [{
    id: '17',
    branchId: '17',
    branchSlug: 'saude',
    branch: 'Saúde',
    subcategories: ['Dentista'],
    associatedCategories: [],
    minRating: 4,
    minReviews: 10,
    enabled: true,
  }],
  deduplication: {
    enabled: true,
    byPhone: true,
    bySite: true,
    blockBasePermanent: true,
    allowSmartReimport: false,
    incrementalImport: true,
  },
  routes: {
    whatsapp: true,
    instagram: true,
    ownSite: true,
    aggregators: true,
    blockFacebookAsSite: true,
    requireConfiguredCategory: true,
    rejectOutOfProfile: true,
  },
  logs: { enabled: true, logRejected: true, logRejectionReason: true },
};
const validationModule = loadTypescriptModule('src/services/import/importValidation.ts', new Map([
  ['../import-settings', { importSettingsService: { get: async () => settings } }],
  ['../geo/brazilState', brazilStateModule],
  ['../instagram/instagram.utils', instagramModule],
]));

const rawItems = validationModule.extractImportItems(fixture);
const parsed = await validationModule.normalizeImportItems(rawItems);
const leads = parsed.items.map((item) => item.input);

assert(rawItems.length === fixture.items.length, 'CRM não extraiu todos os items do envelope real.');
assert(leads.length === fixture.items.length && parsed.errors.length === 0, 'Fixture real não atravessou o parser integralmente.');
assert(leads.every((lead) => lead.branch_id === '17' && lead.ramo === 'Saúde'), 'category da extensão não foi associada ao branches_id canônico por regra exata.');
assert(leads.every((lead) => lead.subcategoria === 'Dentista'), 'Categoria oficial da extensão foi perdida como subramo.');
assert(leads[0]?.normalizedPhone === '551140028922' && leads[0]?.whatsapp === '(11) 4002-8922', 'Telefone candidato foi perdido ou marcado como outra coisa pelo parser.');
assert(leads[0]?.status === 'review' && leads[0]?.destino === 'WhatsApp', 'Telefone candidato foi tratado como WhatsApp já validado, em vez de pré-envio/Evolution.');
assert(leads[1]?.site === 'https://clinica-exemplo.test/' && leads[1]?.normalizedSite === 'clinica-exemplo.test', 'Site próprio foi perdido.');
assert(leads[3]?.instagram === 'https://www.instagram.com/clinica.exemplo/' && leads[3]?.normalizedInstagram === 'clinica.exemplo', 'Instagram de perfil foi perdido ou não normalizado.');
assert(leads.every((lead, index) => lead.normalizedMapsUrl === fixture.items[index].googleMapsUrl.toLowerCase()), 'URL do Maps foi perdida.');
assert(leads.every((lead) => lead.cidade === '' && lead.estado === ''), 'Endereço textual foi interpretado como cidade/UF sem campos estruturados confiáveis.');

assert(importValidationSource.includes("readFirst(lead.raw, ['categoryName', 'category'])"), 'Parser deixou de reconhecer category como categoria oficial da extensão.');
assert(importValidationSource.includes("const subcategory = readFirst(raw, ['categoryName', 'category',"), 'Parser deixou de preservar category como subramo.');
assert(importRepository.includes("? 'instagram'") && importRepository.includes("? 'agregador'") && importRepository.includes("? 'dominio_proprio'") && importRepository.includes(": 'sem_site';"), 'Contrato canônico de contact_sources divergiu.');
assert(importRepository.includes("destination === 'Instagram' ? 'instagram' : 'whatsapp'"), 'Channels deixaram de ser resolvidos separadamente do contact_source.');
assert(!importRepository.includes(": ['whatsapp'];") && !importRepository.includes('contactSources.length === 1'), 'WhatsApp voltou a ser contact_source ou reapareceu fallback arbitrário.');

assert(importPage.includes('await importJson(jsonText, { simulate: true })') && importPage.includes('await sendApprovedToInicio(result.leads)'), 'Entrada Google Maps não passa por preview e persistência central.');
assert(importService.includes('guardImportPersistence') && importHook.includes('importService.persistLeads'), 'Barreira de simulationMode deixou de proteger a mutação real.');
assert(!/apify/i.test(importPage), 'Fluxo ativo Google Maps voltou a depender de Apify na interface.');
const extensionRuntime = [manifest, readExtension('background.js'), sidepanel, ...fs.readdirSync(path.join(extensionRoot, 'src')).filter((name) => name.endsWith('.js')).map((name) => readExtension(path.join('src', name)))].join('\n');
assert(!/apify/i.test(extensionRuntime), 'Extensão Google Maps possui dependência ou fallback Apify.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: export v0.13.0 preserva backup/diagnóstico, contatos e identidade canônica sem reativar o fluxo operacional do CRM.');
