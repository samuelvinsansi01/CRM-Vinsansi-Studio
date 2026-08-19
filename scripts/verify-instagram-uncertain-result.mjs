import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const popup = read('../../instagram-extension/popup.js');
const content = read('../../instagram-extension/content.js');
const api = read('../api/instagram/extension.ts');
const migration = read('../supabase/migrations/20260802150000_instagram_execution_progress.sql');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const count = (source, token) => source.split(token).length - 1;
const sliceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : '';
};

const sendToFlow = sliceBetween(popup, 'async function sendToInstagramTab(type, payload = {})', 'async function openOrFocusInstagram');
const uploadTransportStart = sendToFlow.indexOf("if (type === 'CRM_INSTAGRAM_UPLOAD_IMAGE')");
const genericTransportStart = sendToFlow.indexOf('try { return await chrome.tabs.sendMessage', uploadTransportStart);
const uploadTransportFlow = sendToFlow.slice(uploadTransportStart, genericTransportStart);
const retryableCommands = sliceBetween(popup, 'const RETRYABLE_READ_COMMANDS', 'function uncertainMediaTransportResult');
const transportUncertainResult = sliceBetween(popup, 'function uncertainMediaTransportResult', 'async function ensureInstagramContentAvailable');

assert(sendToFlow.length > 0 && uploadTransportStart >= 0, 'Transporte especial de upload não foi localizado.');
assert(uploadTransportFlow.includes('ensureInstagramContentAvailable(tab.id)'), 'Upload não faz a sondagem segura antes de começar.');
assert(popup.includes("chrome.tabs.sendMessage(tabId, { type: 'CRM_INSTAGRAM_PROFILE_STATE' })"), 'Sondagem pré-upload não usa um comando de leitura já suportado pelo content script.');
assert(!popup.includes('CRM_INSTAGRAM_PING') && !content.includes('CRM_INSTAGRAM_PING'), 'Sondagem não pode depender de um comando novo que permita reinjeção sobre listener antigo.');
assert(count(uploadTransportFlow, 'chrome.tabs.sendMessage(tab.id, { type, ...payload })') === 1, 'Upload pode chamar chrome.tabs.sendMessage mais de uma vez na mesma tentativa.');
assert(!uploadTransportFlow.includes('injectContent('), 'Upload tenta reinjetar o content script depois que o disparo começou.');
assert(uploadTransportFlow.includes('response || uncertainMediaTransportResult'), 'Ausência de resposta do content script não vira resultado incerto.');
assert(uploadTransportFlow.includes('catch (err)') && uploadTransportFlow.includes('uncertainMediaTransportResult'), 'Erro de transporte após o disparo não vira resultado incerto.');
assert(!retryableCommands.includes('CRM_INSTAGRAM_UPLOAD_IMAGE'), 'Upload foi incluído na política de retry automático.');
for (const mutatingCommand of ['CRM_INSTAGRAM_PASTE_TEXT', 'CRM_INSTAGRAM_FOLLOW_IF_NEEDED', 'CRM_INSTAGRAM_OPEN_DM', 'CRM_INSTAGRAM_CLOSE_DM']) {
  assert(!retryableCommands.includes(mutatingCommand), `${mutatingCommand} não pode usar a política reservada a comandos de leitura.`);
}
assert(sendToFlow.includes('if (!RETRYABLE_READ_COMMANDS.has(type)) throw err'), 'Retry após reinjeção não está restrito à lista de comandos de leitura.');
for (const flag of ['uncertain: true', 'doNotFallback: true', 'fallbackAllowed: false']) {
  assert(transportUncertainResult.includes(flag), `Resultado incerto de transporte não define ${flag}.`);
}

const uploadFlow = sliceBetween(content, 'async function uploadImageFileToDm', 'function getDmBlockReason');
const contentUncertainResult = sliceBetween(content, 'function uncertainImageUploadResult', 'async function uploadImageFileToDm');
const uploadCatch = uploadFlow.slice(uploadFlow.lastIndexOf('} catch (err) {'), uploadFlow.lastIndexOf('} finally {'));
const noPreviewFlow = sliceBetween(uploadFlow, 'if (!confirmedMedia)', '// Guarda extra contra duplicação');
for (const flag of ['uncertain: true', 'doNotFallback: true', 'fallbackAllowed: false']) {
  assert(contentUncertainResult.includes(flag), `Resultado incerto do content script não define ${flag}.`);
}
assert(uploadFlow.includes("let uploadPhase = 'before_effect'"), 'Upload não inicia em uma fase comprovadamente anterior a efeitos.');
assert(uploadFlow.includes("uploadPhase = 'preview_attempted';\n      box.dispatchEvent(ev);"), 'Tentativa de criar o preview não é registrada antes do evento de paste.');
assert(uploadFlow.includes("uploadPhase = 'preview_created'"), 'Criação confirmada do preview não é registrada.');
assert(uploadFlow.includes("uploadPhase = 'click_attempted'"), 'Tentativa do clique de envio não é registrada.');
assert(uploadFlow.includes("uploadPhase = 'clicked'"), 'Clique confirmado não é registrado.');
assert(uploadCatch.includes("uploadPhase === 'before_effect'") && uploadCatch.includes('fallbackAllowed:true'), 'Erro anterior a qualquer efeito não permanece como falha comum com fallback permitido.');
assert(uploadCatch.includes('return uncertainImageUploadResult(message, { uploadPhase })'), 'Erro depois do início do preview não é classificado como incerto.');
assert(uploadFlow.includes("if (!clicked) return uncertainImageUploadResult"), 'Resultado após preview sem clique confirmado não exige reconciliação.');
assert(uploadFlow.includes("uploadPhase = 'clicked'") && uploadFlow.includes('return uncertainImageUploadResult('), 'Falha depois do clique não exige reconciliação.');
assert(uploadFlow.includes("return uncertainImageUploadResult('Já existia um envio de imagem em andamento"), 'Envio concorrente sem resultado confirmado não é classificado como incerto.');
assert(noPreviewFlow.includes('uncertainImageUploadResult') && noPreviewFlow.includes('O evento de upload foi disparado, mas o preview não pôde ser confirmado.'), 'Ausência de preview depois do dispatch não exige reconciliação com mensagem explícita.');
assert(!noPreviewFlow.includes('fallbackAllowed:true'), 'Ausência de preview depois do dispatch ainda pode permitir fallback textual.');

const mediaFlowStart = popup.indexOf("if (!media?.ok || !media?.mediaConfirmed)");
const fallbackStart = popup.indexOf("showHint('A imagem não chegou a ser enviada.", mediaFlowStart);
const mediaFailureFlow = popup.slice(mediaFlowStart, fallbackStart);
const uncertainStart = mediaFailureFlow.indexOf("if (media?.uncertain === true)");
const confirmedFailureStart = mediaFailureFlow.indexOf("if (media?.doNotFallback || !media?.fallbackAllowed)");
const uncertainBlock = mediaFailureFlow.slice(uncertainStart, confirmedFailureStart);
const confirmedFailureBlock = mediaFailureFlow.slice(confirmedFailureStart);
assert(uncertainStart >= 0 && confirmedFailureStart > uncertainStart, 'Resultado incerto deve ser tratado antes da falha confirmada.');
assert(uncertainBlock.includes("progress_step:'reconciliation_required'"), 'Resultado incerto não é persistido como reconciliation_required.');
assert(uncertainBlock.includes("return { status:'reconciliation_required'"), 'Resultado incerto pode alcançar o fallback textual.');
assert(!uncertainBlock.includes("status:'error'"), 'Resultado incerto ainda pode ser persistido como error.');
assert(confirmedFailureBlock.includes("status:'error'"), 'Falha confirmada deixou de ser persistida como error.');

const sendImageFlow = sliceBetween(popup, 'async function sendCurrentRamoImage()', 'async function renderImages()');
assert(count(sendImageFlow, "sendToInstagramTab('CRM_INSTAGRAM_UPLOAD_IMAGE'") === 1, 'A função de upload pode ser chamada novamente na mesma tentativa.');
assert(sendImageFlow.includes('...(res || {})'), 'Popup não preserva a classificação devolvida pelo content script.');
assert(content.includes('ok: true, mediaConfirmed: true'), 'Content script deixou de distinguir sucesso confirmado.');

const messageLoop = popup.indexOf('for (const number of [1, 2, 3, 4])');
const mediaProgress = popup.indexOf("reportProgress('media_sending'", messageLoop);
const queuedStatusDefinition = sliceBetween(popup, 'function isQueuedStatus(status)', 'function isSentStatus(status)');
assert(messageLoop >= 0 && mediaProgress > messageLoop, 'As quatro mensagens confirmadas devem preceder o envio da mídia.');
assert(uncertainBlock.includes('confirmed_messages:4') && uncertainBlock.includes('messageSent:true'), 'Reconciliação perdeu o progresso das quatro mensagens confirmadas.');
assert(!queuedStatusDefinition.includes('reconciliation_required'), 'Popup pode recolocar reconciliation_required no processamento automático.');

const claimFunction = sliceBetween(migration, 'CREATE OR REPLACE FUNCTION public.instagram_claim_queue_item', 'CREATE OR REPLACE FUNCTION public.instagram_update_queue_progress');
const claimGuard = claimFunction.match(/IF FOUND AND v_existing\.step IN \(([^)]+)\)/)?.[1] || '';
assert(claimGuard.includes("'reconciliation_required'") && !claimGuard.includes("'error'"), 'Claim não distingue reconciliação de falha confirmada.');
assert(migration.includes("v_progress.step IN ('sent','invalid','reconciliation_required')"), 'reconciliation_required não é terminal para transições posteriores.');
assert(api.includes("candidate = items.find((item) => item.status === 'queued'") && api.includes('p_step: step'), 'API não preserva seleção queued e persistência do estado de reconciliação.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Instagram uncertain media result: OK');
