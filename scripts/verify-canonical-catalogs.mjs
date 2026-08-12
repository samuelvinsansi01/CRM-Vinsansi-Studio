import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const catalog = read('src/repositories/schemaCatalog.ts');
const importRepository = read('src/repositories/import/supabaseImport.repository.ts');
assert(catalog.includes('WHATSAPP: 1'), 'Canal WhatsApp deve ser 1.');
assert(catalog.includes('INSTAGRAM: 2'), 'Canal Instagram deve ser 2.');
assert(catalog.includes('NO_SITE: 1'), 'Origem sem_site deve ser 1.');
assert(catalog.includes('OWN_DOMAIN: 2'), 'Origem dominio_proprio deve ser 2.');
assert(catalog.includes('AGGREGATOR: 3'), 'Origem agregador deve ser 3.');
assert(catalog.includes('INSTAGRAM: 4'), 'Origem instagram deve ser 4.');
assert(catalog.includes('PENDING: 3'), 'Status pendente deve ser 3.');
assert(catalog.includes('PROCESSING: 4'), 'Status processando deve ser 4.');
assert(catalog.includes('COMPLETED: 5'), 'Status concluido deve ser 5.');
assert(catalog.includes('ERROR: 6'), 'Status erro deve ser 6.');
assert(catalog.includes('CANCELED: 7'), 'Status cancelado deve ser 7.');
assert(catalog.includes('PAUSED: 8'), 'Status pausado deve ser 8.');
assert(!catalog.includes("queued: ['na fila'"), 'Fila ainda usa busca ambigua por nomes.');
assert(catalog.includes('queued: CANONICAL_CATALOG.status.PENDING'), 'queued deve mapear para pendente (3).');
assert(catalog.includes('invalid: CANONICAL_CATALOG.status.ERROR'), 'invalid deve mapear para erro (6), pois nao existe status invalido operacional.');
assert(importRepository.includes("? 'instagram'") && importRepository.includes("? 'agregador'") && importRepository.includes("? 'dominio_proprio'") && importRepository.includes(": 'sem_site';"), 'Resolvedor não cobre as quatro chaves canônicas de contact_sources.');
assert(importRepository.includes('normalizeComparable(source.contact_sources_key) === normalizedExpectedKey'), 'Resolvedor de origem não usa igualdade exata da chave normalizada.');
assert(!importRepository.includes(": ['whatsapp'];") && !importRepository.includes('contactSources.length === 1'), 'Resolvedor mantém lookup WhatsApp ou fallback arbitrário em contact_sources.');

const extension = read('api/instagram/extension.ts');
assert(!extension.includes("queued: ['na fila'"), 'Extensao ainda usa mapeamento ambiguo.');

if (failures.length) {
  console.error(`Falhas de catalogo (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Catalogos canonicos confirmados: channels, contact_sources, status e lead_status.');
