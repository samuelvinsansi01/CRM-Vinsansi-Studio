import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const home = read('src/pages/HomePage.tsx');
const service = read('src/services/lead-cycle/leadCycle.service.ts');
const rules = read('src/services/lead-cycle/leadRouting.rules.ts');
const repository = read('src/repositories/lead-cycle/supabaseLeadCycle.repository.ts');

const commands = [
  'route-imported-to-whatsapp',
  'route-imported-to-instagram',
  'invalidate-imported',
  'archive-imported',
  'set-valid-channel-whatsapp',
  'set-valid-channel-instagram',
  'archive-valid',
];

commands.forEach((command) => {
  assert(rules.includes(`'${command}'`), `Comando ausente nas regras: ${command}`);
  assert(home.includes(`'${command}'`), `Comando não utilizado na interface: ${command}`);
});

assert(home.includes('executeRoutingCommand'), 'HomePage ainda não está conectada à API de comandos.');
assert(!home.includes('lead_status_id:'), 'HomePage não pode gravar status diretamente.');
assert(!home.includes('channels_id:'), 'HomePage não pode gravar canal diretamente.');
assert(repository.includes(".eq('users_id', userId)"), 'Repository não restringe operações ao usuário atual.');
assert(repository.includes(".eq('lead_status_id', expectedStatus)"), 'Compare-and-set não protege o status esperado.');
assert(repository.includes('.maybeSingle()'), 'Compare-and-set precisa distinguir conflito de atualização.');
assert(rules.includes('normalizePhone'), 'Validação de WhatsApp não normaliza o telefone.');
assert(rules.includes('isValidInstagram'), 'Validação de Instagram não usa a regra canônica.');
assert(service.includes('prevalidateBatch'), 'O lote não possui pré-validação.');
assert(service.includes('auditWarnings'), 'Falhas de auditoria não são reportadas separadamente.');
assert(service.includes("eventBus.emit('import:changed'"), 'Mudanças do F04 não emitem evento interno.');

const forbiddenMigration = path.join(root, 'supabase/migrations/20260728010000_canonical_lead_import.sql');
assert(!fs.existsSync(forbiddenMigration), 'A migration estrutural proibida voltou ao projeto.');

console.log('F04 routing verification: OK');
