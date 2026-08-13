import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };

const templates = read('src/repositories/config/canonicalConfig.repository.ts');
for (let part = 1; part <= 4; part += 1) assert(templates.includes(`templates_message_${part}`), `Template perdeu a mensagem ${part}.`);
const whatsapp = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const instagram = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
for (const file of [whatsapp, instagram]) {
  assert(file.includes("from('queue_items')"), 'Fila nao usa queue_items.');
  assert(file.includes('templates_id'), 'Fila nao referencia templates_id.');
  assert(file.includes('leads_id'), 'Fila nao referencia leads_id.');
}
const validation = read('server/whatsapp/validation.handler.ts');
assert(validation.includes("from('channels')"), 'Validacao WhatsApp precisa conferir o canal no catalogo real.');
assert(validation.includes('whatsappChannelId'), 'Validacao WhatsApp precisa usar o canal confirmado.');
const routing = read('src/services/lead-cycle/leadRouting.rules.ts');
assert(!/targetChannel:\s*[12]\b/.test(routing), 'Roteamento ainda usa IDs fixos de canal.');
const settings = read('src/repositories/settings/canonicalSettings.repository.ts');
assert(settings.includes("rpc('get_user_operational_settings')"), 'Configurações operacionais precisam usar persistência centralizada.');
assert(settings.includes('migrateLegacyOnce'), 'Migração única do localStorage legado deve permanecer explícita.');
const events = read('src/repositories/events/canonicalEventLog.repository.ts');
assert(events.includes("from('sents')"), 'Logs de disparo precisam usar sents.');
if (failures.length) { failures.forEach((failure) => console.error(`- ${failure}`)); process.exit(1); }
console.log('Contratos de negocio principais aprovados para o schema real.');
