import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const extensionRoot = process.env.EXTENSION_F08_ROOT ? path.resolve(process.env.EXTENSION_F08_ROOT) : '';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const hasExternalExtension = Boolean(extensionRoot) && fs.existsSync(path.join(extensionRoot, 'manifest.json'));
const readExtension = (file) => fs.readFileSync(path.join(extensionRoot, file), 'utf8');
const extensionContract = JSON.parse(read('scripts/contracts/instagram-extension-v1.3.0.json'));
const requireText = (file, snippets) => {
  const source = read(file);
  for (const snippet of snippets) assert.ok(source.includes(snippet), `${file} deveria conter: ${snippet}`);
  return source;
};

const tokenSource = requireText('api/instagram/token.ts', [
  "iss: 'painel-crm'",
  "aud: 'instagram-extension'",
  "INSTAGRAM_EXTENSION_SIGNING_SECRET",
  "payload.exp <= now",
  "payload.exp - payload.iat > 12 * 60 * 60",
]);
const pairApi = requireText('api/instagram/pair.ts', [
  "client.auth.getUser(token)",
  ".from('users')",
  ".eq('auth_user_id', data.user.id)",
  ".eq('user_id', auth.publicUserId)",
  "normalizeInstagramProfile(row.profile_username) === profile",
  "issueInstagramExtensionToken",
]);
const extensionApi = requireText('api/instagram/extension.ts', [
  "SUPABASE_SERVICE_ROLE_KEY",
  "chrome-extension:\\/\\/[a-p]{32}",
  "instagram_extension_request_id_required",
  "action === 'queue'",
  "action === 'claim_next' || action === 'claim_item'",
  "action === 'transition'",
  ".eq('id', id).eq('user_id', tokenScope.userId).eq('status', 'queued')",
  "allowedTransitions",
  "lead_status_id: desired",
  ".eq('lead_status_id', 4)",
]);
assert.ok(!extensionApi.includes("Access-Control-Allow-Origin', '*'"), 'A API da extensão não deve liberar CORS global.');
assert.ok(!extensionApi.includes(".eq('profile_username', tokenScope.profile)"), 'O escopo do perfil deve normalizar @/URL em vez de depender do formato físico armazenado.');

const queueRepo = requireText('src/repositories/instagram-queue/supabaseInstagramQueue.repository.ts', [
  ".eq('user_id', userId)",
  ".eq('status', lead.status)",
  ".select('id')",
  "message_3: lead.message_3",
  "message_4: lead.message_4",
]);
assert.ok(!queueRepo.includes('async send(ids)'), 'O repository Instagram não pode marcar enviado diretamente.');
requireText('src/repositories/instagram-queue/instagramQueue.repository.ts', [
  'pause(ids: string[]): Promise<void>',
  'reprocess(ids: string[]): Promise<void>',
]);
assert.ok(!read('src/repositories/instagram-queue/instagramQueue.repository.ts').includes('send(ids'), 'A interface do repository não pode expor envio direto.');

const service = requireText('src/services/instagram-queue/instagramQueue.service.ts', [
  "hasAllTemplateMessages(candidate)",
  "assertTransition({ entity: 'instagram-queue'",
  "eventBus.emit('instagram-queue:changed'",
]);
assert.ok(!service.includes('async send('), 'O service Instagram não pode marcar enviado pelo painel.');
const stateMachine = requireText('src/services/state-machine/stateMachine.ts', [
  "O envio Instagram é exclusivo da extensão vinculada.",
  "Somente uma DM aberta pode ser finalizada como enviada.",
]);
assert.ok(stateMachine.includes("from === 'dm_opened'"), 'Somente DM aberta pode finalizar como enviada.');

requireText('src/services/instagram-extension/instagramExtension.gateway.ts', [
  "getSession()",
  "Authorization: `Bearer ${token}`",
  "fetch('/api/instagram/pair'",
]);
requireText('src/pages/QueuePage.tsx', [
  'Vincular extensão',
  'Reprocessar erros',
  'instagramExtensionGateway.pair(profile)',
  'navigator.clipboard.writeText(pairing.token)',
  'window.prompt(`Copie o token temporário',
]);

if (hasExternalExtension) {
  const manifest = JSON.parse(readExtension('manifest.json'));
  assert.equal(manifest.manifest_version, 3, 'A extensão precisa usar Manifest V3.');
  assert.equal(manifest.version, '1.3.0', 'A extensão precisa estar na versão 1.3.0.');
  const popup = readExtension('popup.js');
  for (const forbidden of ['/api/update', 'INSTAGRAM_EXTENSION_SECRET', 'userId:', 'User ID']) {
    assert.ok(!popup.includes(forbidden), `popup.js não pode conter contrato legado: ${forbidden}`);
  }
  for (const required of [
    "chrome.storage.session.set({ [TOKEN_STORAGE_KEY]: config.pairingToken })",
    "'Authorization': `Bearer ${config.pairingToken}`",
    "crmApi('claim_next'",
    "crmApi('claim_item'",
    "crmApi('transition'",
    "await claimCurrentItem();",
    "await assertSafeDmForLead(expectedUsername);",
    "for (const number of [1, 2, 3, 4])",
    "['following', 'dm_opened'].includes",
  ]) assert.ok(popup.includes(required), `popup.js deveria conter: ${required}`);
  const processIndex = popup.indexOf('async function processLead(item)');
  const claimIndex = popup.indexOf('await claimCurrentItem();', processIndex);
  const openProfileIndex = popup.indexOf('const username = await ensureLeadProfileOpen();', processIndex);
  assert.ok(processIndex >= 0 && claimIndex > processIndex && openProfileIndex > claimIndex, 'O lead deve ser assumido antes de abrir o perfil.');
  const content = readExtension('content.js');
  assert.ok(content.includes('CRM_INSTAGRAM_SAFE_TO_SEND') && content.includes('expectedUsername'), 'O content script precisa validar o destinatário esperado.');
} else {
  assert.equal(extensionContract.manifestVersion, 3, 'Contrato da extensão deve exigir Manifest V3.');
  assert.equal(extensionContract.version, '1.3.0', 'Contrato da extensão precisa estar na versão 1.3.0.');
  for (const feature of ['temporary_pairing_token', 'claim_before_navigation', 'safe_dm_recipient', 'four_messages', 'session_storage', 'idempotent_transitions']) {
    assert.ok(extensionContract.features.includes(feature), `Contrato da extensão ausente: ${feature}.`);
  }
}

const tokenCompiled = ts.transpileModule(tokenSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
  fileName: 'api/instagram/token.ts',
});
const tokenErrors = (tokenCompiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
assert.equal(tokenErrors.length, 0, 'O módulo de token deve transpilar sem erros.');
const sandbox = {
  module: { exports: {} }, exports: {},
  process: { env: { INSTAGRAM_EXTENSION_SIGNING_SECRET: 'x'.repeat(64) } },
  crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, JSON, Date, Math,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(tokenCompiled.outputText, sandbox, { filename: 'api/instagram/token.ts' });
const issued = await sandbox.module.exports.issueInstagramExtensionToken({ userId: '42', profile: '@Perfil.Teste', ttlSeconds: 900 });
const verified = await sandbox.module.exports.verifyInstagramExtensionToken(issued.token);
assert.equal(verified.sub, '42');
assert.equal(verified.profile, 'perfil.teste');
assert.equal(verified.aud, 'instagram-extension');
await assert.rejects(() => sandbox.module.exports.verifyInstagramExtensionToken(`${issued.token}x`));

const changedTsFiles = [
  'api/instagram/token.ts', 'api/instagram/pair.ts', 'api/instagram/extension.ts',
  'src/services/instagram-extension/instagramExtension.gateway.ts',
  'src/services/instagram-extension/index.ts',
  'src/services/instagram-queue/instagramQueue.service.ts',
  'src/repositories/instagram-queue/supabaseInstagramQueue.repository.ts',
  'src/repositories/instagram-queue/instagramQueue.repository.ts',
  'src/hooks/useInstagramQueue.ts', 'src/pages/QueuePage.tsx',
];
for (const file of changedTsFiles) {
  const result = ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
    fileName: file,
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file} deve transpilar sem erro sintático.`);
}

const migrationDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir) : [];
assert.ok(!migrations.some((name) => /f08|instagram_extension|instagram_queue_claim/i.test(name)), 'F08 não pode adicionar migration estrutural.');
if (hasExternalExtension) {
  const extensionFiles = fs.readdirSync(extensionRoot);
  assert.ok(!extensionFiles.some((name) => name === '.env' || name.startsWith('.env.')), 'A extensão não pode conter arquivo de credenciais.');
}

console.log('F08 verificado: vínculo temporário, escopo por usuário/perfil, claim, transições idempotentes, quatro mensagens, destinatário seguro e ausência de alteração estrutural no banco.');
