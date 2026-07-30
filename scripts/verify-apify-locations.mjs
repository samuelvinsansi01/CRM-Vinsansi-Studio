import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const service = fs.readFileSync(path.join(root, 'src/services/apify-import/apifyImport.service.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/ImportPage.tsx'), 'utf8');
const failures = [];

if (!service.includes(".from('cities')") || !service.includes('.range(offset, offset + pageSize - 1)')) {
  failures.push('Catálogo de localidades não é carregado por páginas.');
}
if (!service.includes(".order('cities_id', { ascending: true })")) {
  failures.push('Paginação de localidades não possui ordenação determinística por ID.');
}
if (page.includes('availableLocationOptions') || page.includes('previouslySearchedLocationOptions')) {
  failures.push('Localidades pesquisadas ainda são removidas do seletor principal.');
}
if (!page.includes('locationSelectOptions') || !page.includes('já pesquisada neste ramo')) {
  failures.push('Seletor não mantém todas as localidades visíveis com indicação do histórico.');
}
if (!page.includes("String(location.cityId) === selectedLocationId")) {
  failures.push('Seleção da localidade não usa o ID canônico da cidade.');
}
if (!page.includes("locationOptions.length.toLocaleString('pt-BR')")) {
  failures.push('Interface não informa quantas localidades foram carregadas.');
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log('Localidades Apify: catálogo paginado, IDs canônicos e histórico não destrutivo verificados.');
