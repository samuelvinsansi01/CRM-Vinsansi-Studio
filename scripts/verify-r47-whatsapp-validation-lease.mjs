import fs from 'node:fs';
import assert from 'node:assert/strict';

const handler=fs.readFileSync(new URL('../server/whatsapp/validation.handler.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20260827003000_r47_whatsapp_validation_lease_recovery.sql',import.meta.url),'utf8');
const r52=fs.readFileSync(new URL('../supabase/migrations/20260828203000_r52_whatsapp_validation_at_most_once.sql',import.meta.url),'utf8');
// O artefato histórico R47 continua presente, mas R52 o supersede por segurança.
assert.match(migration,/claimed_at<now\(\)-interval '20 seconds'/);
assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.worker_claim_whatsapp_validation_request\(bigint,text\) TO service_role/);
assert.doesNotMatch(handler,/CONTROL_PLANE_STALE_CLAIM_MS|recoverStaleValidationClaim/);
assert.match(handler,/validationTimeoutMessage/);
assert.match(handler,/não será reclamada\/repetida automaticamente/);
assert.match(r52,/attempts=0/);
assert.match(r52,/attempts=1/);
assert.doesNotMatch(r52,/claimed_at<now\(\)-interval '20 seconds'/);
console.log('R47 histórico presente; política de lease supersedida com segurança pela R52: OK');
