import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const page = read('src/pages/PreSendPage.tsx');
const service = read('src/services/whatsapp-validation/whatsappValidation.service.ts');
const rules = read('src/services/whatsapp-validation/whatsappValidation.rules.ts');
const gateway = read('src/services/whatsapp-validation/whatsappValidation.gateway.ts');
const repository = read('src/repositories/lead-cycle/supabaseLeadCycle.repository.ts');
const handler = read('api/whatsapp/validation.handler.ts');
const validateRoute = read('api/whatsapp/validate.ts');
const revalidateRoute = read('api/whatsapp/revalidate.ts');

assert(page.includes('validateWhatsApp'), 'Pré-Envio não chama o serviço real de validação.');
assert(!page.includes('lead_status_id:'), 'Pré-Envio ainda grava status diretamente.');
assert(!page.includes('channels_id:'), 'Pré-Envio ainda grava canal diretamente.');
assert(service.includes('WhatsAppValidationUnavailableError'), 'Serviço não distingue indisponibilidade da infraestrutura.');
assert(repository.includes(".eq('lead_status_id', expectedStatus)"), 'Resultado não usa compare-and-set.');
assert(rules.includes("row.channels_id !== 1"), 'Validação não restringe WhatsApp.');
assert(rules.includes('isValidInstagram(row.leads_instagram)'), 'Fallback não confere Instagram.');
assert(gateway.includes('Authorization: `Bearer ${token}`'), 'Frontend não autentica a rota serverless.');
assert(gateway.includes('assertOneResultForEachLead'), 'Gateway não exige correspondência exata.');
assert(handler.includes("client.auth.getUser(token)"), 'Backend não valida a sessão Supabase.');
assert(handler.includes(".from('leads')"), 'Backend não confere a posse/estado dos leads.');
assert(handler.includes("/validation/whatsapp"), 'Backend não usa o endpoint real do Worker.');
assert(handler.includes("'X-Worker-Token': config.token"), 'Backend não protege a chamada ao Worker.');
assert(handler.includes('results.length !== leads.length'), 'Backend não valida cardinalidade do Worker.');
assert(validateRoute.includes("'initial'"), 'Rota inicial incorreta.');
assert(revalidateRoute.includes("'revalidation'"), 'Rota de revalidação incorreta.');

const forbiddenSql = fs.existsSync(path.join(root, 'supabase'))
  ? fs.readdirSync(path.join(root, 'supabase'), { recursive: true }).filter((name) => String(name).endsWith('.sql'))
  : [];
assert(!forbiddenSql.some((name) => /f05|whatsapp.*valid/i.test(String(name))), 'F05 não pode criar estrutura no banco.');

console.log('F05 WhatsApp validation verification: OK');
