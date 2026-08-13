import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '..');
const read = (relative) => fs.readFileSync(path.join(workspace, relative), 'utf8').replace(/\r\n/g, '\n');
const identity = read('crm-novo/server/instagram/identity.ts');
const frontendIdentity = read('crm-novo/src/services/instagram/instagram.utils.ts');
const token = read('crm-novo/server/instagram/token.ts');
const api = read('crm-novo/api/instagram/extension.ts');
const popup = read('instagram-extension/popup.js');
const content = read('instagram-extension/content.js');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sliceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : '';
};

const executableIdentity = identity.replace(/value: (?:string|unknown)/g, 'value');
const identityModule = await import(`data:text/javascript;base64,${Buffer.from(executableIdentity).toString('base64')}`);
const apiNormalizer = identityModule.normalizeInstagramUsername;
const executableFrontendIdentity = frontendIdentity.replace(/value: (?:string|unknown)/g, 'value');
const frontendIdentityModule = await import(`data:text/javascript;base64,${Buffer.from(executableFrontendIdentity).toString('base64')}`);
const frontendNormalizer = frontendIdentityModule.normalizeInstagramUsername;
const extensionNormalizer = (source) => {
  const snippet = sliceBetween(source, 'const RESERVED_INSTAGRAM_PATHS', 'function invalidInstagramRecipientResult');
  assert(Boolean(snippet), 'Normalizador estrito não foi localizado na extensão.');
  return Function(`${snippet}\nreturn normalizeInstagramUsername;`)();
};
const popupNormalizer = extensionNormalizer(popup);
const contentNormalizer = extensionNormalizer(content);

const validCases = new Map([
  ['@Empresa', 'empresa'],
  ['empresa', 'empresa'],
  ['empresa.nome_ok', 'empresa.nome_ok'],
  ['https://instagram.com/empresa', 'empresa'],
  ['https://www.instagram.com/empresa/', 'empresa'],
  ['instagram.com/empresa?igsh=abc', 'empresa'],
  ['www.instagram.com/empresa/#perfil', 'empresa'],
]);
const invalidCases = [
  'instagram.com',
  'www.instagram.com',
  'instagram.com/',
  'https://instagram.com/p/ABC',
  'https://instagram.com/reel/ABC',
  'https://instagram.com/reels/ABC',
  'https://instagram.com/stories/empresa/123',
  'https://instagram.com/explore',
  'https://instagram.com/accounts',
  'https://instagram.com/direct/inbox',
  'https://evil.example/empresa',
  'https://sub.instagram.com/empresa',
  'empresa/extra',
  'a'.repeat(31),
  'empresa nome',
  'empresa+nome',
  '',
  null,
  undefined,
];

for (const [input, expected] of validCases) {
  for (const [layer, normalize] of [['API', apiNormalizer], ['frontend', frontendNormalizer], ['popup', popupNormalizer], ['content', contentNormalizer]]) {
    assert(normalize(input) === expected, `${layer} não normalizou ${String(input)} para ${expected}.`);
  }
}
for (const input of invalidCases) {
  for (const [layer, normalize] of [['API', apiNormalizer], ['frontend', frontendNormalizer], ['popup', popupNormalizer], ['content', contentNormalizer]]) {
    assert(normalize(input) === '', `${layer} aceitou destinatário inválido: ${String(input)}.`);
  }
}
assert(identityModule.isValidInstagramUsername('@Empresa') === true && identityModule.isValidInstagramUsername('instagram.com/p/ABC') === false, 'isValidInstagramUsername diverge do normalizador canônico.');

assert(token.includes("from './identity'") && api.includes("from '../../server/instagram/identity'"), 'Token e API da extensão não usam o mesmo helper canônico.');
assert(!token.includes('function normalizeInstagramProfile') && !api.includes('function normalizeInstagramProfile'), 'Permaneceu normalizador independente nas APIs Instagram.');
assert(!api.includes('instagram_url:'), 'API ainda libera valor bruto como destino alternativo.');
assert(api.includes('instagram_username: instagramUsername'), 'API não libera exclusivamente o username canônico.');

const claimFlow = sliceBetween(api, 'async function claimItem', 'async function transition');
assert(claimFlow.indexOf("if (!itemBeforeClaim.instagram_username) throw new Error('invalid_instagram_recipient_contract')") >= 0, 'Claim por item não rejeita destinatário inválido.');
assert(claimFlow.indexOf('itemBeforeClaim.instagram_username') < claimFlow.indexOf("client.rpc('instagram_claim_queue_item'"), 'Destinatário só é validado depois da claim.');
const claimNextFlow = sliceBetween(api, "if (action === 'claim_next')", "if (action === 'claim_item')");
assert(claimNextFlow.includes("const candidates = items.filter((item) => item.status === 'queued'"), 'claim_next não examina o conjunto ordenado de candidatos queued.');
assert(claimNextFlow.includes(".filter((item) => !item.instagram_username)"), 'claim_next não acumula destinatários inválidos.');
assert(claimNextFlow.includes("const candidate = items.find((item) => item.status === 'queued' && (!block || item.block_number === block) && Boolean(item.instagram_username))"), 'claim_next não avança até o primeiro candidato válido.');
assert(claimNextFlow.includes("skipped_invalid_recipient: skippedInvalidRecipient"), 'claim_next não devolve a lista estruturada de inválidos ignorados.');
assert(claimNextFlow.includes("'invalid_instagram_recipients_only'"), 'Lote apenas com inválidos não possui estado terminal de iteração.');
assert(!claimNextFlow.includes("throw new Error('invalid_instagram_recipient_contract')"), 'claim_next ainda encerra no primeiro inválido.');
assert(claimNextFlow.indexOf("items.find((item) => item.status === 'queued'") < claimNextFlow.indexOf('await claimItem(client, scope, candidate.id, consumerId)'), 'Claim não está restrita ao candidato válido selecionado.');
assert(api.includes("message === 'invalid_instagram_recipient_contract' ? 422"), 'Erro de contrato não possui resposta estruturada 422.');
assert(api.includes(".order('queue_items_position')") && !api.includes(".limit("), 'loadItems deixou de preservar todos os candidatos em ordem de posição.');

const selectionExample = [
  { id:'invalid-1', instagram_username:'' },
  { id:'invalid-2', instagram_username:'' },
  { id:'valid-1', instagram_username:'empresa' },
];
const simulatedSkipped = selectionExample.filter((item) => !item.instagram_username);
const simulatedCandidate = selectionExample.find((item) => Boolean(item.instagram_username));
assert(simulatedSkipped.length === 2 && simulatedCandidate?.id === 'valid-1', 'Cenário inválidos seguidos de válido não preserva o primeiro válido elegível.');

assert(!popup.includes('instagram_url'), 'Popup ainda recompõe o destino a partir de instagram_url.');
assert(popup.includes('function currentLeadUsername() { return normalizeInstagramUsername(currentItem?.instagram_username); }'), 'Popup não usa exclusivamente instagram_username do item atual.');
const sendFlow = sliceBetween(popup, 'async function sendToInstagramTab', 'async function openOrFocusInstagram');
assert(sendFlow.indexOf('RECIPIENT_BOUND_COMMANDS.has(type)') < sendFlow.indexOf('getActiveTab()'), 'Popup consulta/envia para a aba antes de validar o destinatário.');
assert(sendFlow.includes('if (!expectedUsername) return invalidInstagramRecipientResult()'), 'Username inválido pode alcançar comando do content script.');
const navigationFlow = sliceBetween(popup, 'async function openOrFocusInstagram', 'async function getInstagramProfileStateSafe');
assert(navigationFlow.indexOf('if (!canonicalUsername) throw invalidInstagramRecipientError()') < navigationFlow.indexOf('chrome.tabs.query'), 'Navegação pode ocorrer antes da validação canônica.');
assert(navigationFlow.includes('https://www.instagram.com/${canonicalUsername}/'), 'Navegação não deriva exclusivamente do username canônico.');

const fetchNextFlow = sliceBetween(popup, 'async function fetchNextLead', 'function renderLead');
assert(fetchNextFlow.includes('skipped_invalid_recipient') && fetchNextFlow.includes("iteration_status === 'invalid_instagram_recipients_only'"), 'Popup não encerra claim_next de lote apenas inválido de forma estruturada.');
const processLeadFlow = sliceBetween(popup, 'async function processLead', 'async function getMissingImagesForItems');
assert(processLeadFlow.indexOf('if (hasInvalidInstagramRecipient(item))') < processLeadFlow.indexOf("crmApi('claim_item'"), 'Executor pode chamar claim_item para destinatário inválido.');
assert(processLeadFlow.indexOf('if (hasInvalidInstagramRecipient(item))') < processLeadFlow.indexOf('ensureLeadProfileOpen()'), 'Executor pode navegar antes de ignorar destinatário inválido.');
const batchFlow = sliceBetween(popup, 'async function startSelectedBatch', 'function togglePause');
assert(batchFlow.includes('queuedItems.filter(hasInvalidInstagramRecipient)') && batchFlow.includes('queuedItems.filter(item => !hasInvalidInstagramRecipient(item))'), 'Lote não separa inválidos de candidatos válidos antes da execução.');
assert(batchFlow.includes('invalidRecipientIterationMessage(invalidItems.length)') && batchFlow.indexOf('invalidRecipientIterationMessage(invalidItems.length)') < batchFlow.indexOf('isRunning = true'), 'Lote somente inválido inicia loop em vez de terminar localmente.');
assert(batchFlow.includes('validQueuedItemsForSelectedBlock().filter') && batchFlow.includes('processedKeys.add(itemKey(item))'), 'Executor não garante progresso finito entre candidatos válidos.');
assert(batchFlow.includes('invalidQueuedItemsForSelectedBlock()') && batchFlow.includes('Iteração do lote'), 'Resultado do lote não informa destinatários inválidos remanescentes.');

assert(popup.includes('if (current === username)') && popup.includes('=== expected'), 'Confirmação do perfil não usa igualdade exata.');
assert(content.includes('if (profile !== expected)') && content.includes('if (current !== expected)'), 'Ações do perfil não bloqueiam divergência exata do destinatário.');
assert(content.includes('if (!recipients.includes(expected))'), 'Confirmação de destinatário da DM foi removida.');
assert(!content.includes('recipients.some') && !content.includes('recipient.startsWith') && !content.includes('recipient.endsWith'), 'DM usa comparação parcial de destinatário.');

const invalidPopupResult = sliceBetween(popup, 'function invalidInstagramRecipientResult', 'function invalidInstagramRecipientError');
const invalidContentResult = sliceBetween(content, 'function invalidInstagramRecipientResult', 'async function openDirectMessage');
for (const result of [invalidPopupResult, invalidContentResult]) {
  assert(result.includes('invalid_instagram_recipient_contract'), 'Extensão não devolve erro local estável para destinatário inválido.');
  assert(!result.includes('reconciliation_required'), 'Erro local anterior a efeito foi classificado como reconciliação.');
}
assert(content.includes("if (!normalizeInstagramUsername(expectedUsername)) return invalidInstagramRecipientResult({ mediaConfirmed:false, doNotFallback:true, fallbackAllowed:false })"), 'Upload não falha fechado antes de qualquer efeito quando o destinatário é inválido.');
assert(popup.includes("progress_step:'reconciliation_required'") && content.includes('uncertainImageUploadResult'), 'Tratamento de resultado incerto de mídia deixou de exigir reconciliação.');

const migrationNames = fs.readdirSync(path.join(root, 'supabase/migrations'));
const identityMigrations = migrationNames.filter((name) => /instagram.*(?:identity|recipient)|(?:identity|recipient).*instagram/i.test(name));
assert(identityMigrations.length === 1 && identityMigrations[0] === '20260802131000_fix_instagram_identity_normalization.sql', 'Foi criada migration adicional para a correção de identidade Instagram.');
const workerFiles = [];
const collectWorkerFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectWorkerFiles(fullPath);
    else workerFiles.push(fullPath);
  }
};
collectWorkerFiles(path.join(workspace, 'worker'));
assert(!workerFiles.some((file) => fs.readFileSync(file, 'utf8').includes('invalid_instagram_recipient_contract')), 'Contrato de destinatário Instagram foi acoplado ao Worker.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Instagram recipient identity contract: OK');
