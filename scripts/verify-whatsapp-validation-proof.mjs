import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const migrationName = '20260806190000_whatsapp_validation_proof.sql';
const migration = read(`supabase/migrations/${migrationName}`);
const importValidation = read('src/services/import/importValidation.ts');
const importPage = read('src/pages/ImportPage.tsx');
const canonicalLead = read('src/services/import/canonicalLead.ts');
const importRepository = read('src/repositories/import/supabaseImport.repository.ts');
const validationApi = read('api/whatsapp/validation.handler.ts');
const validationService = read('src/services/whatsapp-validation/whatsappValidation.service.ts');
const validationGateway = read('src/services/whatsapp-validation/whatsappValidation.gateway.ts');
const queueService = read('src/services/queue-preparation/queuePreparation.service.ts');
const capacityService = read('src/services/whatsapp-validation/whatsappCapacityValidation.service.ts');
const referenceCatalog = read('../reference/Banco - Novo.csv');

function sourceFiles(directory) {
  const absolute = join(root, directory);
  const files = [];
  for (const entry of readdirSync(absolute)) {
    const target = join(absolute, entry);
    if (statSync(target).isDirectory()) files.push(...sourceFiles(join(directory, entry)));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) files.push(target);
  }
  return files;
}

assert(importValidation.includes("draft.status = destination === 'WhatsApp' ? 'review' : 'pending'"), 'Importação WhatsApp ainda pode nascer como Validado.');
assert(importPage.includes("status: destination === 'Instagram' ? 'pending' : 'review'"), 'Cadastro manual WhatsApp ainda pode nascer como Validado.');
assert(importPage.indexOf('await createLead({') < importPage.indexOf('whatsappValidationService.validateInitial([createResult.lead.id])'), 'Cadastro manual não valida o WhatsApp somente depois da persistência inicial.');
assert(canonicalLead.includes('statusId !== LEAD_STATUS.PRE_SEND'), 'Persistência canônica não aceita PRE_SEND sem usar ID espalhado.');
assert(importRepository.includes("whatsappDestination && isStatusGroup(updated.status, 'approved')") && importRepository.includes("updated.status = 'review'"), 'Edição da importação ainda pode aprovar WhatsApp sem Evolution.');
assert(/status === 'approved'[\s\S]*whatsappDestination \? LEAD_STATUS\.PRE_SEND : LEAD_STATUS\.VALIDATED/.test(importRepository), 'Ação Aprovar ainda pode promover WhatsApp diretamente a Validado.');

assert(migration.includes('CREATE OR REPLACE FUNCTION public.record_whatsapp_validation_result'), 'RPC controlada de persistência ausente.');
assert(/INSERT INTO public\.lead_validation_results\s*\([\s\S]*?\)\s*OVERRIDING SYSTEM VALUE\s*VALUES\s*\(/i.test(migration), 'Catálogo de resultados não é compatível com PK GENERATED ALWAYS AS IDENTITY.');
assert(validationApi.includes("client.rpc('record_whatsapp_validation_result'"), 'API confiável não persiste o resultado por RPC.');
assert(validationApi.includes("env('SUPABASE_SERVICE_ROLE_KEY')"), 'API não exige credencial service_role para persistir a prova.');
assert(/REVOKE ALL ON FUNCTION public\.record_whatsapp_validation_result[\s\S]*FROM PUBLIC, anon, authenticated;/.test(migration), 'RPC ainda é executável por papel não confiável.');
assert(/GRANT EXECUTE ON FUNCTION public\.record_whatsapp_validation_result[\s\S]*TO service_role;/.test(migration), 'RPC não foi concedida exclusivamente ao service_role.');
assert(/REVOKE ALL PRIVILEGES ON TABLE public\.lead_validation_attempts\s+FROM PUBLIC, anon, authenticated, service_role;/.test(migration), 'Privilégios residuais do ledger de tentativas não são removidos deterministicamente.');
assert(/REVOKE ALL PRIVILEGES ON TABLE public\.lead_validation_results\s+FROM PUBLIC, anon, authenticated, service_role;/.test(migration), 'Privilégios residuais do catálogo de resultados não são removidos deterministicamente.');
assert(migration.includes('GRANT SELECT ON TABLE public.lead_validation_attempts TO authenticated;'), 'authenticated não ficou limitado à leitura owner-only das tentativas.');
assert(migration.includes('GRANT SELECT ON TABLE public.lead_validation_results TO authenticated;'), 'authenticated não ficou limitado à leitura do catálogo.');
assert(migration.includes('GRANT SELECT, INSERT ON TABLE public.lead_validation_attempts TO service_role;'), 'service_role não ficou limitado a SELECT e INSERT no ledger append-only.');
assert(migration.includes('GRANT SELECT ON TABLE public.lead_validation_results TO service_role;'), 'service_role não ficou limitado a SELECT no catálogo imutável.');
assert(!/GRANT[^;]*(?:UPDATE|DELETE|TRUNCATE)[^;]*lead_validation_(?:attempts|results)/i.test(migration), 'A migration concede mutação incompatível com ledger append-only.');
assert(!/RLS POLICY,public,lead_validation_(?:attempts|results),[^\r\n]*FOR (?:INSERT|UPDATE|DELETE|ALL) TO authenticated/i.test(referenceCatalog), 'Existe policy autenticada de DML no ledger local inventariado.');

for (const signature of [
  'has_current_whatsapp_validation_proof\\(bigint, bigint\\)',
  'current_user_whatsapp_validation_proofs\\(bigint\\[\\]\\)',
  'record_whatsapp_validation_result\\(bigint, bigint, text, text, text, text, text, integer, text, text, jsonb\\)',
  'prepare_queue_items_without_whatsapp_validation_proof\\(text, bigint, date, jsonb\\)',
  'prepare_queue_items\\(text, bigint, date, jsonb\\)',
]) {
  assert(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]{0,120}FROM PUBLIC`, 'i').test(migration), `PUBLIC ainda pode herdar EXECUTE em ${signature}.`);
}

assert(migration.includes('latest_definitive.result_key = \'valido\''), 'Prova não exige sucesso definitivo válido.');
assert(migration.includes('latest_definitive.validated_phone = public.normalize_identity_phone(lead.leads_phone)'), 'Prova não está vinculada ao telefone atual.');
assert(migration.includes("lower(trim(coalesce(attempt.lead_validation_attempts_provider, ''))) = 'evolution'"), 'Prova não exige provider Evolution.');
assert(migration.includes("result.lead_validation_results_key IN ('valido', 'nao_encontrado')"), 'Resultado inválido posterior não substitui a prova anterior.');
assert(migration.includes("v_result_key := 'nao_encontrado'"), 'Resultado inválido não é persistido como definitivo.');
assert(migration.includes("v_result_key := 'erro_tecnico'") && migration.includes("IF p_outcome <> 'technical_error' THEN"), 'Erro técnico pode estar criando prova ou alterando o estado do lead.');

assert(migration.includes('public.has_current_whatsapp_validation_proof(v_users_id, v_lead_id)'), 'prepare_queue_items não consulta a prova atual.');
assert(/ORDER BY lead\.leads_id[\s\S]*FOR UPDATE OF lead;[\s\S]*has_current_whatsapp_validation_proof/.test(migration), 'A fila não bloqueia o lead em ordem determinística durante a decisão sobre a prova atual.');
assert(migration.includes("reason := 'whatsapp_validation_required'"), 'Fila não retorna motivo estruturado para prova ausente.');
assert(!/lead_status_id\s*=\s*2[\s\S]{0,120}has_current_whatsapp_validation_proof/.test(migration), 'Status Validado foi tratado como substituto da prova.');
assert(/IF v_channel_name <> 'whatsapp' THEN[\s\S]*prepare_queue_items_without_whatsapp_validation_proof/.test(migration), 'Instagram deixou de preservar o fluxo sem Evolution.');

assert(queueService.includes('requiresWhatsAppValidation'), 'Interface não classifica lead legado sem prova.');
assert(capacityService.includes('revalidateApprovedWithChip'), 'Capacidade não devolve lead legado sem prova ao fluxo de revalidação.');
assert(!validationService.includes('compareAndSet('), 'Frontend ainda altera diretamente o lead com base na resposta do navegador.');
assert(validationService.includes('providerResult.persisted !== true'), 'Frontend aceita sucesso sem confirmação de persistência.');
assert(validationGateway.includes("'/api/whatsapp/validate'") && validationGateway.includes("'/api/whatsapp/revalidate'"), 'Frontend não usa exclusivamente as APIs intermediárias.');
assert(!validationGateway.includes('/validation/whatsapp'), 'Frontend chama o Worker diretamente.');

const activeQueueSources = [
  ...sourceFiles('src'),
  ...sourceFiles('api'),
  ...sourceFiles('../worker/src'),
  ...sourceFiles('../instagram-extension'),
].map((path) => ({ path, content: readFileSync(path, 'utf8') }));
for (const source of activeQueueSources) {
  assert(!/\.from\(\s*['"](?:queue_items|queues)['"]\s*\)[\s\S]{0,160}?\.(?:insert|upsert)\s*\(/i.test(source.content), `Criação direta de fila contorna prepare_queue_items em ${source.path}.`);
}

const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
assert(migrations.includes(migrationName), 'Migration da prova não existe.');
assert(migrations.indexOf(migrationName) > migrations.indexOf('20260806180000_sents_append_only_rls.sql'), 'Migration da prova não é posterior às migrations aprovadas.');
const atomicQueueHash = createHash('sha256').update(read('supabase/migrations/20260802070000_atomic_queue_preparation.sql')).digest('hex');
assert.equal(atomicQueueHash, '5699af3b204b19ffa7e843297942e1756e8826c02510c1845574608c7336b614', 'A migration antiga de fila atômica foi alterada.');

console.log('✓ Prova persistida WhatsApp, importação PRE_SEND e barreira de fila verificadas.');
