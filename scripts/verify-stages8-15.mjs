import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const expect=(value,message)=>{if(!value)throw new Error(message);};
const checks=[
 ['Etapa 8','supabase/migrations/20260823180000_stage8_vinsansi_capture.sql',['tool_browser_pairings','service_capture_identity_gate','capture_execution_events','DROP TABLE IF EXISTS public.maps_extension_installations']],
 ['Etapa 9','supabase/migrations/20260823190000_stage9_vinsansi_instagram.sql',['instagram_profile_runtime','instagram_claim_queue_item_v2','instagram_update_queue_progress_v2']],
 ['Etapa 10','supabase/migrations/20260823200000_stage10_permanent_commercial_memory.sql',['commercial_outcomes','permanent_record_events','commercial_reentry_decision']],
 ['Etapa 11','supabase/migrations/20260823210000_stage11_observability_recovery.sql',['platform_runtime_heartbeats','operational_alerts','request_operational_recovery','worker_recover_stale_whatsapp_v2','instagram_recover_stale_items_v2']],
 ['Etapa 12','supabase/migrations/20260823220000_stage12_schema_consolidation.sql',['platform_schema_contracts','platform_schema_health','DROP FUNCTION IF EXISTS public.instagram_claim_queue_item']],
 ['Etapa 13','supabase/migrations/20260823230000_stage13_end_to_end_orchestration.sql',['lead_orchestration_state','lead_lifecycle_events','service_orchestrate_ready_leads']],
 ['Etapa 14','supabase/migrations/20260824000000_stage14_install_update_backup_portability.sql',['platform_release_channels','platform_component_compatibility','platform_release_matrix']],
 ['Etapa 15','supabase/migrations/20260824010000_stage15_production_homologation_stable.sql',['production_homologation_runs','platform_production_readiness','promote_platform_stable_release',"release_channel='preview'"]],
];
for(const [label,file,tokens] of checks){const sql=read(file);expect(sql.trim().startsWith('BEGIN;'),`${label}: transação ausente`);expect(sql.trim().endsWith('COMMIT;'),`${label}: COMMIT ausente`);expect(sql.includes('$stage_preflight$'),`${label}: preflight ausente`);for(const token of tokens)expect(sql.includes(token),`${label}: contrato ausente: ${token}`);}
const instagram=read('server/routes/instagram/extension.ts');expect(instagram.includes("instagram_recover_stale_items_v2"),'Instagram ainda usa recovery legado');expect(instagram.includes('scope.organizationId'),'Instagram recovery sem tenant scope');
const maps=read('server/routes/maps/extension.ts');expect(maps.includes('candidateIds'),'Captura não retorna candidatos do batch incremental');expect(maps.includes("action === 'leads_promote'")&&maps.includes('maps_leads_promote_selection_required'),'Captura sem promoção manual explícita');
const schema=read('server/routes/system/schema-health.ts');expect(schema.includes('platform_schema_health'),'Route schema health ausente');
const hom=read('src/pages/HomologationPage.tsx');expect(hom.includes('Promover Stable'),'UI não expõe promoção Stable controlada');
const pkg=JSON.parse(read('package.json'));expect(pkg.version==='2.4.0',`CRM final deveria ser 2.4.0; recebido ${pkg.version}`);
console.log('Etapas 8–15: contratos estáticos aprovados. Stable não é promovida automaticamente.');
