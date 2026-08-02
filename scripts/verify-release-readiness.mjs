import fs from 'node:fs';
const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
for(const file of ['README.md','docs/ARCHITECTURE.md','docs/BUSINESS_RULES.md','docs/DEPLOYMENT.md','docs/RECOVERY.md','docs/MIGRATION_ORDER.md','docs/RELEASE_CHECKLIST.md']) if(!read(file).trim()) throw new Error(`release_document_missing:${file}`);
const index=read('src/repositories/settings/index.ts'); if(index.includes('localSettings.repository')) throw new Error('obsolete_local_settings_export');
const service=read('src/services/whatsapp-queue/whatsappQueue.service.ts'); if(service.includes('única fonte canônica da Base Permanente')) throw new Error('obsolete_permanent_base_comment');
const pkg=JSON.parse(read('package.json')); if(!(/^(?:4\.(?:[6-9]|[1-9]\d)|[5-9]\.\d+)\./.test(pkg.version))) throw new Error('package_version_below_stage12');
console.log('Etapa 12: limpeza, documentação e checklist verificados.');
