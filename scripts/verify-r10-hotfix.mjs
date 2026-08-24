import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const files=[
  'PATCH-ETAPA-8-VINSANSI-CAPTURA-v1.7.0.sql',
  'supabase/migrations/20260823180000_stage8_vinsansi_capture.sql',
  'UPGRADE-v1.4.3-PARA-v2.4.0.sql',
  'UPGRADE-v1.6.0-PARA-v2.4.0.sql',
  'APLICAR-NO-SUPABASE-v2.4.0-RC.sql',
  'PATCH-CORRETIVO-CRM-2.4.0-R10.sql'
];
for(const file of files){
  const sql=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.doesNotMatch(sql,/coalesce\(r\.canonical_lead_id\s*,\s*r\.leads_id\)/i,`${file}: identity gate antigo`);
}
const lifecycleFiles=[
  'PATCH-ETAPA-13-ORQUESTRACAO-v2.2.0.sql',
  'supabase/migrations/20260823230000_stage13_end_to_end_orchestration.sql',
  'UPGRADE-v1.4.3-PARA-v2.4.0.sql',
  'UPGRADE-v1.6.0-PARA-v2.4.0.sql',
  'APLICAR-NO-SUPABASE-v2.4.0-RC.sql',
  'PATCH-CORRETIVO-CRM-2.4.0-R10.sql'
];
for(const file of lifecycleFiles){
  const sql=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const marker='CREATE OR REPLACE FUNCTION public.record_lead_lifecycle_event()';
  const start=sql.indexOf(marker); assert.ok(start>=0,`${file}: função lifecycle ausente`);
  const section=sql.slice(start,start+5000);
  assert.match(section,/v_entity_id text/);
  assert.match(section,/TG_TABLE_NAME,v_entity_id,to_jsonb\(NEW\)/);
  assert.doesNotMatch(section,/CASE TG_TABLE_NAME WHEN 'leads' THEN NEW\.leads_id::text WHEN 'queue_items'/);
}
const route=fs.readFileSync(new URL('../server/routes/maps/extension.ts',import.meta.url),'utf8');
assert.match(route,/const EXTENSION_VERSION = '1\.0\.7'/);
console.log('CRM 2.4.0-R10: hotfixes da homologação da Etapa 8 aprovados.');
