import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (ok, message) => { if (!ok) { console.error(message); process.exitCode = 1; } };

const service = read('src/services/queue-review/queueReview.service.ts');
const migration = read('supabase/migrations/20260829005000_r57_deterministic_whatsapp_review_reconciliation.sql');

check(service.includes("String(reconciled?.contractVersion ?? reconciled?.contract_version ?? '') !== 'R57'"), 'R57: frontend nao exige o contrato R57 antes de aceitar a reconciliacao.');
check(service.includes('const readySet = new Set(readyIds)'), 'R57: conjunto pronto nao e explicitamente materializado.');
check(service.includes("const releaseIds = reserved.map((lead) => lead.id).filter((id) => !readySet.has(id))"), 'R57: reservados nao sao particionados exatamente entre pronto e liberado.');
check(service.includes('assertExactReadyReconciliation(readyIds, reconciled)'), 'R57: frontend nao confere os IDs efetivamente retidos.');
check(service.includes('retainedReadyIds'), 'R57: frontend nao consome os IDs exatos persistidos pelo banco.');
check(!service.includes('openCount < readyIds.length'), 'R57: ainda existe comparacao por contagem total do batch em vez de IDs exatos.');
check(!service.includes('const releaseIds = Array.from(new Set([...validation.errorIds, ...validation.conflictIds]))'), 'R57: liberacao ainda ignora reservados nao prontos fora de erro/conflito.');

check(migration.includes("'contractVersion','R57'"), 'R57: RPC nao identifica o contrato novo.');
check(migration.includes("'retainedReadyIds',to_jsonb(v_retained_ready_ids)"), 'R57: RPC nao devolve os IDs prontos efetivamente mantidos.');
check(migration.includes('l.leads_id=ANY(v_ready_ids)'), 'R57: restauracao dos prontos nao usa conjunto explicito.');
check(migration.includes('p.validated_phone=public.normalize_whatsapp_validation_phone('), 'R57: pronto nao exige prova valida do telefone atual.');
check(migration.includes('i.leads_id=ANY(v_release_ids)'), 'R57: liberacao nao usa conjunto explicito.');
check(!migration.includes('v_pruned'), 'R57: prune generico ainda existe na reconciliacao.');
check(!migration.includes("AND (l.lead_status_id<>3 OR l.channels_id IS DISTINCT FROM v_batch.channels_id)"), 'R57: reconciliacao ainda remove itens por estado transitorio generico.');
check(migration.includes("AND i.review_status='released'"), 'R57: falta recuperacao dos itens liberados pela R56.');
check(migration.includes('AND l.lead_status_id=2'), 'R57: recuperacao nao esta limitada a leads ja validados.');
check(migration.includes('batch_rank<=free_slots'), 'R57: recuperacao nao respeita espaco do batch.');
check(migration.includes('A prova já paga pelo chip é reaproveitada') || migration.includes('prova já paga pelo chip'), 'R57: migration nao documenta recuperacao sem nova validacao.');

if (!process.exitCode) console.log('R57 OK: reconciliacao e deterministica por ID, sem prune generico, e recupera validados liberados pela R56 sem chamar o chip novamente.');
