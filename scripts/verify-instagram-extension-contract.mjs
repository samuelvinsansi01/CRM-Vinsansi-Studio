import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'api/instagram/extension.ts'), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(source.includes("'following'"), 'API Instagram não reconhece o estado following devolvido após o claim.');
assert(source.includes("'invalidated'"), 'API Instagram não reconhece invalidação enviada pela extensão.');
assert(source.includes("action === 'claim_item'"), 'API Instagram perdeu o claim condicional por item.');
assert(source.includes("action === 'transition'"), 'API Instagram perdeu a transição condicional.');
assert(source.includes("eq('status_id', statuses.idFor(expected))"), 'Transição Instagram deixou de proteger o status esperado.');
assert(source.includes("verifyInstagramExtensionToken"), 'API Instagram não valida o token temporário.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Contrato painel/extensão Instagram aprovado: token temporário, claim e transições semânticas.');
