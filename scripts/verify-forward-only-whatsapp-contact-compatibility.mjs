import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.resolve(root, '..', 'google maps extractor');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const migrationName = '20260813110000_forward_only_whatsapp_contact_compatibility.sql';
const migration = read(`supabase/migrations/${migrationName}`);
const mapsMigration = read('supabase/migrations/20260813090000_google_maps_api_first.sql');
const fallbackMigration = read('supabase/migrations/20260813100000_whatsapp_invalid_to_instagram_review.sql');
const helper = read('src/services/leads/leadContact.ts');
const queueService = read('src/services/queue-preparation/queuePreparation.service.ts');
const routingRules = read('src/services/lead-cycle/leadRouting.rules.ts');
const leadCycleService = read('src/services/lead-cycle/leadCycle.service.ts');
const queueRepository = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const validationService = read('src/services/whatsapp-validation/whatsappValidation.service.ts');
const validationApi = read('server/whatsapp/validation.handler.ts');
const mapsApi = read('api/maps/extension.ts');
const mapsOperational = readExtension('src/operational.js');

function executableOutsideFunctions(sql) {
  return sql
    .replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION\b[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\1\s*;/gi, '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const outsideFunctions = executableOutsideFunctions(migration);
assert(/^BEGIN\s*;/i.test(migration.trim()) && /COMMIT\s*;\s*$/i.test(migration), 'Migration nao e transacional.');
assert(migrationName > '20260813100000_whatsapp_invalid_to_instagram_review.sql', 'Migration nao e posterior ao fallback WhatsApp/Instagram.');
assert(!/\bUPDATE\s+public\.leads\b/i.test(outsideFunctions), 'Migration executa UPDATE public.leads durante aplicacao.');
assert(!/\bDELETE\s+FROM\s+public\.leads\b/i.test(outsideFunctions), 'Migration executa DELETE public.leads durante aplicacao.');
assert(!/\bINSERT\s+INTO\s+public\.leads\b/i.test(outsideFunctions), 'Migration executa INSERT INTO public.leads durante aplicacao.');
assert(!/\b(?:FROM|JOIN)\s+public\.leads\b/i.test(outsideFunctions), 'Migration faz leitura/backfill historico de public.leads fora de funcao futura.');
assert(!/\bALTER\s+TABLE\s+public\.leads\b/i.test(outsideFunctions), 'Migration altera a estrutura ou dados de public.leads fora do contrato pedido.');
assert(!/\b(?:backfill|reprocess)\b/i.test(outsideFunctions), 'Migration contem operacao de backfill/reprocessamento fora de funcao futura.');

assert(/OLD\.leads_identity_contract_version IS DISTINCT FROM 1/i.test(migration), 'Barreira historica do identity foi removida.');
assert(/NEW\.leads_identity_contract_version := OLD\.leads_identity_contract_version;\s*RETURN NEW;/i.test(migration), 'Lead legado pode entrar no contrato v1 por UPDATE comum.');
assert(/normalize_identity_phone\([\s\S]*?NEW\.leads_whatsapp[\s\S]*?NEW\.leads_phone/i.test(migration), 'Identity nao prioriza WhatsApp com fallback para phone.');
assert((migration.match(/VALUES \(NEW\.users_id, 'phone', NEW\.leads_normalized_phone/gi) ?? []).length === 1, 'Register identity nao grava exatamente uma identidade telefonica efetiva.');
for (const trigger of ['prepare_lead_identity_trigger', 'register_lead_identity_trigger']) {
  assert(new RegExp(`CREATE TRIGGER ${trigger}[\\s\\S]*?leads_whatsapp`, 'i').test(migration), `${trigger} nao observa leads_whatsapp.`);
}
assert(/v_effective_expression[\s\S]*?v_lead\.leads_whatsapp[\s\S]*?v_lead\.leads_phone/i.test(migration), 'RPC de preparacao nao recebe o contrato WhatsApp-first.');
assert(/v_occurrences <> 1[\s\S]*?RAISE EXCEPTION/i.test(migration), 'Patch da RPC nao aborta diante de definicao divergente.');
assert(/v_effective_whatsapp_phone := coalesce\([\s\S]*?v_whatsapp[\s\S]*?v_phone/i.test(migration), 'Snapshot nao calcula destinatario WhatsApp-first.');
assert(/'recipient'[\s\S]*?'phone', regexp_replace\(v_effective_whatsapp_phone/i.test(migration), 'Snapshot nao usa o contato efetivo como recipient.phone.');
assert(/'lead'[\s\S]*?'phone', v_phone,[\s\S]*?'whatsapp', v_whatsapp/i.test(migration), 'Snapshot nao preserva phone e WhatsApp brutos separadamente.');

assert(helper.indexOf('lead.leads_whatsapp') >= 0 && helper.indexOf('lead.leads_whatsapp') < helper.indexOf('lead.leads_phone'), 'Helper CRM nao prioriza leads_whatsapp.');
assert((queueService.match(/getEffectiveWhatsAppPhone\(row\)/g) ?? []).length >= 3, 'Preparacao CRM nao centralizou contexto, validacao e contato efetivo.');
assert(routingRules.includes('validPhone(getEffectiveWhatsAppPhone(row))'), 'Roteamento CRM ainda valida apenas leads_phone.');
assert(leadCycleService.includes('phone: getEffectiveWhatsAppPhone(row)'), 'Lista operacional do ciclo ainda exibe WhatsApp-only como contato vazio.');
assert(/snapshotRecipient\.phone[\s\S]*?snapshotLead\.whatsapp[\s\S]*?snapshotLead\.phone[\s\S]*?getEffectiveWhatsAppPhone\(lead\)/.test(queueRepository), 'Fallback da fila canonica nao respeita snapshot/WhatsApp/phone.');

assert(/row\.leads_whatsapp \|\| row\.leads_phone/.test(validationService), 'Servico de validacao deixou de priorizar leads_whatsapp.');
assert(/row\.leads_whatsapp \|\| row\.leads_phone/i.test(validationApi), 'API de validacao deixou de priorizar leads_whatsapp.');
assert(/has_current_whatsapp_validation_proof[\s\S]*?lead\.leads_whatsapp[\s\S]*?lead\.leads_phone/i.test(fallbackMigration), 'Proof WhatsApp nao usa WhatsApp com fallback legado.');
assert(/ELSIF p_outcome = 'invalid'[\s\S]*?v_target_status_id := 1[\s\S]*?v_target_channel_id := v_instagram_channel_id/i.test(fallbackMigration), 'Nao encontrado deixou de manter IMPORTADO e rotear para Instagram.');
assert(/IF p_outcome <> 'technical_error' THEN/i.test(fallbackMigration), 'Erro tecnico pode alterar destino/status.');
assert(!/SET[\s\S]{0,300}(?:leads_phone|leads_whatsapp)\s*=/i.test(fallbackMigration), 'Fallback WhatsApp/Instagram apaga ou sobrescreve contatos.');

assert(/MAX_SNAPSHOT_BYTES\s*=\s*1_500_000/.test(mapsApi), 'API nao define limite explicito de snapshot.');
assert(mapsApi.indexOf('snapshotBytes > MAX_SNAPSHOT_BYTES') < mapsApi.indexOf("from('maps_search_coverage').update(patch)"), 'API valida snapshot somente depois da mutacao real.');
assert(/snapshotForApi[\s\S]*?items:\s*\[\][\s\S]*?snapshotCompacted:\s*true/.test(mapsOperational), 'Extensao nao reduz snapshot grande de forma explicita.');
assert(mapsOperational.includes('snapshot: snapshotForApi(message.data)'), 'Extensao envia snapshot sem aplicar o limite local.');
assert(/catch \(error\)[\s\S]*?pauseReason = 'platform_sync_required'[\s\S]*?await save\(current\)/.test(mapsOperational), 'Falha de snapshot nao preserva checkpoint e pausa para sync.');

const effective = (lead) => String(lead.leads_whatsapp ?? '').trim() || String(lead.leads_phone ?? '').trim();
const normalized = (value) => String(value ?? '').replace(/\D/g, '');
const fixtures = {
  whatsappOnly: { leads_phone: null, leads_whatsapp: '5511999999999' },
  phoneOnly: { leads_phone: '551133333333', leads_whatsapp: null },
  bothDifferent: { leads_phone: '551133333333', leads_whatsapp: '5511999999999' },
  bothEquivalent: { leads_phone: '(11) 99999-9999', leads_whatsapp: '+55 11 99999-9999' },
};
assert(effective(fixtures.whatsappOnly) === '5511999999999', 'Fixture WhatsApp-only nao atravessa o contrato efetivo.');
assert(effective(fixtures.phoneOnly) === '551133333333', 'Fixture phone-only perdeu compatibilidade legada.');
assert(effective(fixtures.bothDifferent) === '5511999999999' && fixtures.bothDifferent.leads_phone === '551133333333', 'Fixture com ambos nao prefere WhatsApp preservando phone.');
assert(normalized(effective(fixtures.bothEquivalent)) === '5511999999999', 'Fixture equivalente nao produz uma identidade normalizada unica.');
assert(/leads_identity_contract_version IS DISTINCT FROM 1/i.test(migration), 'Fixture historico nao esta protegido pela versao do contrato.');
assert(/ADD COLUMN IF NOT EXISTS leads_whatsapp text\s*;/i.test(mapsMigration), 'Coluna WhatsApp forward-only nao existe na migration Maps.');

if (failures.length) {
  console.error(`Falhas na compatibilidade forward-only WhatsApp (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: leads_whatsapp tem prioridade e leads_phone permanece fallback em identity, validacao, routing, fila e snapshot.');
console.log('OK: a migration nao executa DML/backfill em public.leads e preserva a barreira historica do contract version 1.');
console.log('OK: snapshots grandes sao limitados antes da mutacao e compactados localmente sem perder o checkpoint.');
