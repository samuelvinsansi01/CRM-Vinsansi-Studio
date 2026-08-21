import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/services/config/config.service.ts'), 'utf8');
const start = source.indexOf('function normalizeChipInput(');
const end = source.indexOf('\nfunction normalizeInstagramUsername', start);
if (start < 0 || end < 0) throw new Error('normalizeChipInput nao encontrado.');
const body = source.slice(start, end);

for (const field of [
  'administrativelyActive',
  'operationalState',
  'sessionSaved',
  'socketConnected',
  'jid',
  'runtimeCheckedAt',
  'runtimeError',
]) {
  if (!new RegExp(`\\b${field}\\s*:`).test(body) && !new RegExp(`\\b${field}\\s*,`).test(body)) {
    throw new Error(`normalizeChipInput nao preenche ${field}.`);
  }
}
if (!body.includes('sameInstance')) throw new Error('Telemetria do chip nao esta protegida contra troca de instancia.');
if (!body.includes("operationalState: ChipConfigRecord['operationalState']")) throw new Error('operationalState perdeu tipagem explicita.');

console.log('Normalizacao de ChipConfigRecord: campos administrativos/runtime completos e troca de instancia protegida.');
