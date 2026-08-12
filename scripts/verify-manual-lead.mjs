import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const page = read('src/pages/ImportPage.tsx');
const configRepository = read('src/repositories/config/canonicalConfig.repository.ts');
const importRepository = read('src/repositories/import/supabaseImport.repository.ts');

const start = page.indexOf('const addManualLead = async () =>');
const end = page.indexOf('const approveLeads = async () =>', start);
const flow = start >= 0 && end > start ? page.slice(start, end) : '';

assert(Boolean(flow), 'Fluxo addManualLead não foi localizado.');
assert(page.includes('branchId: string;') && page.includes('value={manualLead.branchId}'), 'Formulário manual não possui ramo controlado obrigatório.');
assert(page.includes('options={uniqueBranches.map((branch) => ({ label: branch.name, value: branch.id }))}'), 'Select manual não usa os ramos existentes carregados pela plataforma.');
assert(configRepository.includes(".from('branches')") && configRepository.includes(".eq('users_id', userId)"), 'Consulta de ramos não está vinculada ao proprietário atual.');
assert(page.includes("record.kind === 'branches' && record.active"), 'Tela manual não restringe o catálogo a ramos ativos.');
assert(flow.includes('branch_id: branch.id') && flow.includes('ramo: branch.name'), 'Cadastro manual não persiste branches_id e nome do ramo selecionado.');
assert(!flow.includes('branchRules[0]'), 'Cadastro manual ainda usa fallback para o primeiro ramo das regras de importação.');
assert(flow.includes('if (!whatsapp && !instagramInput)'), 'Barreira de pelo menos um contato está ausente.');
assert(flow.includes('normalizeInstagramUsername(instagramInput)') && flow.indexOf('normalizeInstagramUsername(instagramInput)') < flow.indexOf('await createLead({'), 'Instagram não é normalizado antes da persistência.');
assert(flow.includes("status: destination === 'Instagram' ? 'pending' : 'review'"), 'WhatsApp pode nascer validado antes da Evolution.');
assert(flow.indexOf('await createLead({') < flow.indexOf('whatsappValidationService.validateInitial([createResult.lead.id])'), 'Evolution não é chamada pelo serviço existente depois da criação.');
assert(!flow.includes('fetch(') && !flow.includes('/api/instagram') && !flow.includes('instagramValidation'), 'Cadastro manual criou chamada operacional ao Instagram.');
assert((page.match(/setManualLead\(emptyManualLeadForm\)/g) ?? []).length >= 2, 'Limpar e sucesso não restauram também o ramo.');
assert(importRepository.includes(": 'sem_site';"), 'Destino WhatsApp sem site não resolve a origem canônica sem_site.');
assert(importRepository.includes("? 'instagram'"), 'Destino Instagram não resolve a origem canônica instagram.');
assert(!importRepository.includes(": ['whatsapp'];"), 'Resolvedor ainda procura uma fonte WhatsApp em contact_sources.');
assert(!importRepository.includes('contactSources.length === 1'), 'Resolvedor ainda possui fallback arbitrário para a única fonte disponível.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: cadastro manual exige ramo/contato e resolve WhatsApp/Instagram pelas origens canônicas.');
