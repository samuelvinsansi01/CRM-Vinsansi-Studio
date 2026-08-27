import fs from 'node:fs';
import assert from 'node:assert/strict';

const handler=fs.readFileSync(new URL('../server/whatsapp/validation.handler.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20260827003000_r47_whatsapp_validation_lease_recovery.sql',import.meta.url),'utf8');
assert.match(handler,/CONTROL_PLANE_STALE_CLAIM_MS = 20_000/);
assert.match(handler,/recoverStaleValidationClaim/);
assert.match(handler,/\.lte\('claimed_at', staleBefore\)/);
assert.match(handler,/validationTimeoutMessage/);
assert.match(handler,/status=pending/);
assert.match(handler,/worker=\$\{worker\}/);
assert.match(migration,/claimed_at<now\(\)-interval '20 seconds'/);
assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.worker_claim_whatsapp_validation_request\(bigint,text\) TO service_role/);
console.log('R47 WhatsApp validation lease recovery: OK');
