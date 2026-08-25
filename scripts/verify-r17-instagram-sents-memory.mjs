import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../PATCH-CORRETIVO-CRM-2.4.0-R17.sql',import.meta.url),'utf8');
const must=[
  'refresh_permanent_record_from_sent_trigger',
  'refresh_permanent_record(NEW.leads_id, \'dispatch_changed\')',
  'INSERT INTO public.sents',
  "'channel','instagram'",
  'instagram_update_queue_progress_v2',
  "public.instagram_canonical_step(p.step)='completed'",
  'NOT EXISTS(',
  "instagram_progress_final:%"
];
for(const token of must){if(!sql.includes(token)) throw new Error(`R17 missing: ${token}`)}
if(!sql.includes("IF public.instagram_canonical_step(v_progress.step) IN('completed','error','reconciliation_required')")) throw new Error('R17 final idempotency guard missing');
console.log('R17 Instagram sents/memory contract OK');
