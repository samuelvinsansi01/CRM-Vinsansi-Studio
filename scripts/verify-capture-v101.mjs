import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../server/routes/maps/extension.ts', import.meta.url), 'utf8');
assert.match(source, /desiredCompanies = integer\(input\.desiredCompanies \?\? 50, 1, 500\)/);
assert.match(source, /desiredCompanyCount: desiredCompanies/);
assert.match(source, /counts\.unique_count \|\| 0\) >= desiredCompanyCount/);
assert.match(source, /const EXTENSION_VERSION = '1\.0\.1'/);
console.log('CRM R5: contrato da meta de empresas da Captura 1.0.1 aprovado.');
