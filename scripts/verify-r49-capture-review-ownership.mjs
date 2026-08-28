import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const extension=fs.readFileSync(path.join(root,'server/routes/maps/extension.ts'),'utf8');
const required=[
  "const REVIEW_GATE_VERSION = 'execution_aware_v2'",
  "const REVIEW_LEASE_MIN_EXTENSION_VERSION = '1.0.31'",
  "execution:maps_search_executions_id(maps_search_executions_id,status,last_heartbeat_at,updated_at,created_at,extension_version)",
  "review_state: 'expired'",
  "termination_reason: 'stale_review_owner'",
  "orphanReviewReleased: reviewGate.orphanReviewReleased",
  "reviewGateVersion: reviewGate.reviewGateVersion",
  "new Set(['running','paused','stopped','error','completed','exhausted'])",
  "reviewLease: reviewLeaseActive",
  "maps_batch_heartbeat_failed",
];
for(const token of required){if(!extension.includes(token))throw new Error(`R49: contrato ausente: ${token}`)}
if(!extension.includes("ownerExecutionId && ownerExecutionId === text(currentExecutionId)")) throw new Error('R49: gate nao ignora ownership da propria execucao.');
if(!extension.includes("ageMs <= REVIEW_LEASE_STALE_MS")) throw new Error('R49: lease de revisao terminal sem expiracao curta.');
console.log('R49 capture review ownership guard: ok');
