import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../PATCH-CORRETIVO-CRM-2.4.0-R18.sql',import.meta.url),'utf8');
const must=[
  "UPDATE public.commercial_outcomes",
  "allow_reentry = false",
  "minimum_reentry_days = NULL",
  "'reason', 'permanent_record_blocks_contact'",
  "Empresa já está na Base Permanente e não pode ser contatada novamente.",
  "CREATE OR REPLACE FUNCTION public.block_permanent_record_dispatch_trigger()",
  "BEFORE UPDATE OF status_id ON public.queue_items",
  "NOT IN ('processando','processing','sending')"
];
for(const token of must){ if(!sql.includes(token)) throw new Error(`R18 missing: ${token}`); }
if(sql.includes("cooldown_completed") || sql.includes("cooldown_active")) throw new Error('R18 ainda contém cooldown de reentrada');
console.log('R18 permanent-base never-contact contract OK');
