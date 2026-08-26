import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const file = path.join(root, 'server/routes/whatsapp/batch.ts');
const source = fs.readFileSync(file, 'utf8');

assert.doesNotMatch(source, /worker_batch_backend_not_configured/);
assert.doesNotMatch(source, /WHATSAPP_WORKER_BATCH_URL/);
assert.doesNotMatch(source, /WHATSAPP_WORKER_BATCH_TOKEN/);
assert.doesNotMatch(source, /WHATSAPP_VALIDATION_WORKER_URL/);
assert.doesNotMatch(source, /fetch\s*\(/);
assert.match(source, /serviceClient\(\)/);
assert.match(source, /worker_start_whatsapp_batch/);
assert.match(source, /worker_set_whatsapp_batch_state/);
assert.match(source, /p_users_id:\s*auth\.publicUserId/);
assert.match(source, /batchStateFromRow/);
console.log('R32 worker batch control plane: ok');
