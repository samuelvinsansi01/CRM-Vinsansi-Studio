import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const route=fs.readFileSync(path.join(root,'server/routes/maps/extension.ts'),'utf8');
const mig=fs.readFileSync(path.join(root,'supabase/migrations/20260824182000_r11_capture_review_queue.sql'),'utf8');
const checks=[['batch 50',route.includes('items.length > 50')],['global queue',route.includes("in('review_state', ['pending','rejected','invalid'])")],['crm block',route.includes("gateDecision === 'exists_in_crm'")],['review block',route.includes("gateDecision === 'in_review'")],['clear',route.includes("action === 'review_queue_clear'")],['ttl',mig.includes("interval '24 hours'")],['index',mig.includes('maps_candidates_review_active_idx')]];
for(const [n,ok] of checks){if(!ok)throw new Error('missing:'+n)}console.log('verify-r11-capture-review: ok');
