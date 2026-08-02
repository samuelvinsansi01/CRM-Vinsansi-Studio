import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260802080000_queue_payload_snapshot.sql');
const queueSchema = read('src/repositories/queueSchema.ts');
const whatsapp = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const instagram = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
const instagramApi = read('api/instagram/extension.ts');
const manifest = JSON.parse(read('public/tools/manifest.json'));

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(migration.includes('queue_items_payload_snapshot jsonb'), 'Coluna JSONB do snapshot ausente.');
assert(migration.includes('build_queue_item_payload_snapshot'), 'Construtor confiável do snapshot ausente.');
assert(migration.includes('render_queue_snapshot_message'), 'Renderização das variáveis no banco ausente.');
assert(migration.includes('queue_items_content_snapshot_guard'), 'Trigger de criação/imutabilidade do snapshot ausente.');
assert(migration.includes('extensions.digest'), 'Hash SHA-256 do payload ausente.');
assert(migration.includes("'messages', jsonb_build_object"), 'As quatro mensagens não são congeladas no payload.');
assert(migration.includes("'variables', jsonb_build_object"), 'As variáveis usadas não são registradas no payload.');
assert(migration.includes("'media', jsonb_build_object"), 'Referência versionada da mídia ausente.');
assert(migration.includes('O conteúdo congelado do item não pode ser alterado.'), 'Imutabilidade após o enqueue não está protegida.');

assert(queueSchema.includes('queuePayloadSnapshot'), 'Frontend não possui leitor canônico do snapshot.');
assert(queueSchema.includes('queueSnapshotMessage'), 'Frontend não lê mensagens congeladas.');
assert(whatsapp.includes("queueSnapshotMessage(snapshot, 1)"), 'Fila WhatsApp não prioriza o snapshot.');
assert(instagram.includes("queueSnapshotMessage(snapshot, 1)"), 'Fila Instagram não prioriza o snapshot.');
assert(instagramApi.includes('queue_items_payload_snapshot'), 'API da extensão não lê o snapshot.');
assert(instagramApi.includes('image_sha256'), 'API da extensão não entrega a identidade opcional da mídia.');

const worker = manifest.tools.find((tool) => tool.id === 'worker');
const extension = manifest.tools.find((tool) => tool.id === 'instagram-extension');
assert(['3.2.0', '3.3.0'].includes(worker?.version), 'Manifesto não publica Worker compatível com snapshot (3.2.0+).');
assert(extension?.version === '1.4.0', 'Manifesto não publica a extensão 1.4.0.');

if (failures.length) {
  console.error(`Falhas no snapshot da fila (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: mensagens, variáveis, destinatário e referência de mídia ficam congelados no queue_item.');
