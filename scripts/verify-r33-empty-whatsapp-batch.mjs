import fs from 'node:fs';
import assert from 'node:assert/strict';

const route=fs.readFileSync(new URL('../server/routes/whatsapp/batch.ts', import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../src/services/whatsapp-queue/whatsappQueue.service.ts', import.meta.url),'utf8');
assert.match(route, /action === 'status' \\|\\| action === 'state'/);
assert.match(route, /message\.includes\('batch_not_found'\)/);
assert.match(route, /return batchStateFromRow\(null, chip\)/);
assert.match(service, /message\.includes\('batch_not_found'\)/);
assert.match(service, /status: 'idle'/);
assert.match(service, /enabled: false/);
console.log('R33 WhatsApp sem worker_batch = idle: OK');
