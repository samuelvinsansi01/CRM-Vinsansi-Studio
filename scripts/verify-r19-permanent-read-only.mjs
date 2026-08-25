import fs from 'node:fs';

const page=fs.readFileSync(new URL('../src/pages/BasePage.tsx',import.meta.url),'utf8');
const repo=fs.readFileSync(new URL('../src/repositories/base/supabaseBase.repository.ts',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../PATCH-CORRETIVO-CRM-2.4.0-R19.sql',import.meta.url),'utf8');

for (const forbidden of ['Resultado comercial','base-outcome-select','base-notes-button','updateMetadata','archiveMany','selectedRows']) {
  if (page.includes(forbidden)) throw new Error(`R19 BasePage still exposes: ${forbidden}`);
}
for (const required of ['Último envio','somente para consulta','selectable={false}']) {
  if (!page.includes(required)) throw new Error(`R19 BasePage missing: ${required}`);
}
for (const forbidden of ['commercial_outcome','operator_notes','updateMetadata','compareAndArchive']) {
  if (repo.includes(forbidden)) throw new Error(`R19 base repository still exposes commercial editor: ${forbidden}`);
}
for (const required of [
  'REVOKE ALL ON FUNCTION public.update_permanent_record_metadata(bigint,text,text)',
  'REVOKE ALL ON FUNCTION public.archive_permanent_record(bigint,bigint)',
  'FROM PUBLIC, anon, authenticated'
]) {
  if (!sql.includes(required)) throw new Error(`R19 SQL missing: ${required}`);
}
console.log('R19 permanent-base read-only contract OK');
