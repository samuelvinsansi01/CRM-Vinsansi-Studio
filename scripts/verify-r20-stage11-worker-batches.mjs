import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const files = [
  'PATCH - CRM v2.4.0-R20 - Observabilidade worker_batches.sql',
  'supabase/migrations/20260825023000_r20_stage11_worker_batches_status.sql',
  'PATCH-ETAPA-11-OBSERVABILIDADE-v2.0.0.sql',
  'supabase/migrations/20260823210000_stage11_observability_recovery.sql',
];
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (/\bworker_batches_status\b/.test(text)) throw new Error(`${rel}: referência legada worker_batches_status`);
}
const patch = fs.readFileSync(path.join(root, files[0]), 'utf8');
for (const required of ["status_id IN(3,4,8)", "status_id=4", 'worker_batches_heartbeat_at']) {
  if (!patch.includes(required)) throw new Error(`R20 ausente: ${required}`);
}
console.log('R20 Stage 11 worker_batches: OK');
