import fs from 'node:fs';
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const app = read('src/App.tsx');
const css = read('src/styles/components.css');
const repo = read('src/repositories/configuration/configuration.repository.ts');
const catalogPage = read('src/pages/CatalogCrudPage.tsx');
const importRules = read('src/pages/ImportRulesPage.tsx');
const validationRules = read('src/pages/ValidationRulesSettingsPage.tsx');

assert(!css.includes('var(--space-18)'), 'Menu ainda usa token inexistente --space-18.');
assert(css.includes('.nav-link {') && css.includes('gap: var(--space-20)'), 'Espaçamento visível do menu não foi fixado.');
for (const route of ['message-variables','config-contact-sources','config-import-rules','config-validation-rules','config-channels','config-levels','config-instances','config-template-channels','config-template-types']) {
  assert(app.includes(`activePage === '${route}'`), `Rota funcional ausente: ${route}`);
}
assert(!app.includes('ConfigurationPlaceholderPage'), 'App ainda renderiza páginas placeholder.');
for (const table of ['contact_sources','levels','instances','template_channels','template_types','template_variables','import_rules','validation_rules']) {
  assert(repo.includes(`from('${table}')`) || repo.includes('from(kind)'), `Repository não cobre ${table}.`);
}
assert(!repo.includes("select('instances_id,status_id,instances_name,instances_url,instances_apikey"), 'Listagem de instâncias expõe API key.');
assert(catalogPage.includes('create(form)') && catalogPage.includes('update(editing.id, form)') && catalogPage.includes('remove(deleting.id)'), 'CRUD de catálogos incompleto.');
assert(importRules.includes('saveImportRules'), 'Formulário import_rules não salva.');
assert(validationRules.includes('saveValidationRules'), 'Formulário validation_rules não salva.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Configurações funcionais aprovadas: menu espaçado, 9 rotas reais, CRUDs e formulários globais.');
