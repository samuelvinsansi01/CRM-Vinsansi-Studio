import { readFileSync } from 'node:fs'; const r=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8'); const a=(v,m)=>{if(!v)throw new Error(m)};
const sql=r('supabase/migrations/20260802140000_permanent_base_consolidation.sql'),repo=r('src/repositories/base/supabaseBase.repository.ts'),page=r('src/pages/BasePage.tsx');
for(const t of ['permanent_records','permanent_record_snapshots','refresh_permanent_record','archive_permanent_record'])a(sql.includes(t),`Ausente ${t}`);
a(repo.includes("from('permanent_records')"),'Base não usa registro consolidado.'); a(page.includes('Empresas consolidadas'),'Tela não apresenta entidades consolidadas.');
console.log('Etapa 8: Base Permanente consolidada verificada.');
