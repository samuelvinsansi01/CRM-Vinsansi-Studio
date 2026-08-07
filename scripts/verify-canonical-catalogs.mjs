import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const catalog = read('src/repositories/schemaCatalog.ts');
assert(catalog.includes('WHATSAPP: 1'), 'Canal WhatsApp deve ser 1.');
assert(catalog.includes('INSTAGRAM: 2'), 'Canal Instagram deve ser 2.');
assert(catalog.includes('PENDING: 3'), 'Status pendente deve ser 3.');
assert(catalog.includes('PROCESSING: 4'), 'Status processando deve ser 4.');
assert(catalog.includes('COMPLETED: 5'), 'Status concluido deve ser 5.');
assert(catalog.includes('ERROR: 6'), 'Status erro deve ser 6.');
assert(catalog.includes('CANCELED: 7'), 'Status cancelado deve ser 7.');
assert(catalog.includes('PAUSED: 8'), 'Status pausado deve ser 8.');
assert(!catalog.includes("queued: ['na fila'"), 'Fila ainda usa busca ambigua por nomes.');
assert(catalog.includes('queued: CANONICAL_CATALOG.status.PENDING'), 'queued deve mapear para pendente (3).');
assert(catalog.includes('invalid: CANONICAL_CATALOG.status.ERROR'), 'invalid deve mapear para erro (6), pois nao existe status invalido operacional.');

const extension = read('api/instagram/extension.ts');
assert(!extension.includes("queued: ['na fila'"), 'Extensao ainda usa mapeamento ambiguo.');

if (failures.length) {
  console.error(`Falhas de catalogo (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Catalogos canonicos confirmados: channels 1/2, status 1-8 e lead_status 1-8.');
