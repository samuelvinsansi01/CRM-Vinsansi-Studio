import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260826123000_r36_whatsapp_validation_proof_hardening.sql', 'utf8');
const handler = fs.readFileSync('server/whatsapp/validation.handler.ts', 'utf8');
const validation = fs.readFileSync('src/services/whatsapp-validation/whatsappValidation.service.ts', 'utf8');
const review = fs.readFileSync('src/services/queue-review/queueReview.service.ts', 'utf8');

const checks = [
  ['tabela de prova canônica', migration.includes('CREATE TABLE IF NOT EXISTS public.whatsapp_validation_proofs')],
  ['normalização do telefone', migration.includes('normalize_whatsapp_validation_phone')],
  ['prova exige telefone atual', migration.includes('v_validated_phone=v_current_phone')],
  ['consulta de prova usa telefone atual', migration.includes('p.validated_phone=public.normalize_whatsapp_validation_phone')],
  ['backfill de validações antigas', migration.includes('lead_validation_attempts_response_metadata') && migration.includes("worker_valid")],
  ['handler registra prova antes do resultado', handler.indexOf("record_current_whatsapp_validation_proof") < handler.indexOf("record_whatsapp_validation_result")],
  ['handler bloqueia positivo sem prova', handler.includes("providerOutcome === 'valid' && !proofValid")],
  ['serviço exige proofValid para aprovado', validation.includes("providerResult.proofValid !== true")],
  ['aprovação revalida prova ausente', review.includes("missingWhatsAppProof") && review.includes("validateInitialWithChip([item.leadId], item.resourceId)")],
  ['revalidação restaura PRE_SEND antes da aprovação', review.includes('await reconcileWhatsApp(item.batchId, readyIds, retryable)') || review.includes('await reconcileWhatsApp(item.batchId, validation.approvedIds, retryable)') || (review.indexOf('await restoreWhatsAppValid(item.batchId, validation.approvedIds)') < review.indexOf('await prune(item.batchId).catch'))],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'OK' : 'FAIL'} - ${name}`);
if (failed.length) process.exit(1);
console.log(`R36: ${checks.length}/${checks.length} verificações da prova WhatsApp aprovadas.`);
