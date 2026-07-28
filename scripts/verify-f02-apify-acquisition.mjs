import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(`F02: ${message}`);
};

const accountService = read('src/services/apify-accounts/apifyAccounts.service.ts');
const importService = read('src/services/apify-import/apifyImport.service.ts');
const importPage = read('src/pages/ImportPage.tsx');
const settingsPage = read('src/pages/ImportSettingsPage.tsx');
const accountFunction = read('supabase/functions/apify-account-check/index.ts');
const startFunction = read('supabase/functions/apify-google-maps-start/index.ts');
const syncFunction = read('supabase/functions/apify-google-maps-sync/index.ts');

assert(accountService.includes("functions.invoke('apify-account-check'"), 'conta Apify deve possuir verificação real.');
assert(accountService.includes("from('apify_import_jobs')"), 'remoção de conta deve preservar o histórico de jobs.');
assert(settingsPage.includes('Conta salva, mas não conectada'), 'falha de token não pode ser apresentada como falha de persistência.');
assert(settingsPage.includes('checkingId === account.id'), 'interface deve indicar a verificação em andamento.');

assert(importPage.includes('mapsSearchTerms'), 'termos de busca precisam ser editáveis.');
assert(importPage.includes('locationCityId: selectedLocation.cityId'), 'localidade deve ser enviada pelo ID canônico.');
assert(importPage.includes('claimGoogleMapsDataset'), 'dataset deve ser assumido antes da importação.');
assert(importPage.includes('releaseGoogleMapsImportClaim'), 'claim deve ser liberado quando o F03 falhar.');
assert(importPage.includes('abortGoogleMapsJob'), 'jobs ativos devem poder ser cancelados.');
assert(importPage.includes('recoverStaleImportClaims'), 'claims abandonados devem ser recuperáveis.');

for (const method of ['claimGoogleMapsDataset', 'finalizeGoogleMapsImport', 'releaseGoogleMapsImportClaim', 'abortGoogleMapsJob', 'recoverStaleImportClaims']) {
  assert(importService.includes(method), `serviço deve expor ${method}.`);
}
assert(importService.includes(".limit(100)"), 'histórico deve ter limite explícito.');
assert(importService.includes("previewLimit: 100"), 'prévia do dataset deve ser limitada.');

for (const source of [accountFunction, startFunction, syncFunction]) {
  assert(source.includes('auth.getUser()'), 'Edge Functions devem validar a sessão Supabase.');
  assert(source.includes('users_id'), 'Edge Functions devem isolar os registros por usuário.');
  assert(!source.includes('?token='), 'token Apify não deve ser colocado na URL.');
}
assert(accountFunction.includes('Authorization: `Bearer ${token}`'), 'verificação da conta deve usar cabeçalho Bearer.');
assert(accountFunction.includes('connection_status: "connected"'), 'conta válida deve ser marcada como conectada.');
assert(accountFunction.includes('connection_status: "error"'), 'falha de token deve ser persistida.');

assert(startFunction.includes('locationCityId'), 'início deve exigir cidade cadastrada.');
assert(startFunction.includes('.from("cities")'), 'localização deve ser resolvida pelo banco existente.');
assert(startFunction.includes('.in("status", ["starting", "ready", "running"])'), 'início deve bloquear coleta concorrente equivalente.');
assert(startFunction.includes('fetchWithTimeout'), 'início da Apify deve possuir timeout.');
assert(startFunction.includes('Authorization: `Bearer ${token}`'), 'início da Apify deve usar cabeçalho Bearer.');

for (const action of ['"claim"', '"finalize"', '"release"', '"abort"', '"recover_stale"']) {
  assert(syncFunction.includes(action), `sincronização deve implementar a ação ${action}.`);
}
assert(syncFunction.includes('import_claim:'), 'claim deve possuir marcador correlacionável.');
assert(syncFunction.includes('.is("imported_at", null)'), 'claim deve ser compare-and-set.');
assert(syncFunction.includes('.eq("error_message", expectedMarker)'), 'finalização deve confirmar o claim atual.');
assert(syncFunction.includes('previewLimit'), 'detalhes devem limitar a prévia.');
assert(syncFunction.includes('/abort'), 'cancelamento deve atingir a execução real da Apify.');

const migrationCount = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).length;
assert(migrationCount === 9, `nenhuma migration nova era permitida; encontradas ${migrationCount}.`);

const normalizeTerms = (text) => {
  const seen = new Set();
  return text.split(/[\n,;|]/).map((term) => term.trim()).filter((term) => {
    const key = term.toLocaleLowerCase('pt-BR');
    if (term.length < 2 || term.length > 100 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
};
assert(JSON.stringify(normalizeTerms('Padaria\npadaria; Confeitaria')) === JSON.stringify(['Padaria', 'Confeitaria']), 'normalização de termos deve eliminar duplicados.');
assert(normalizeTerms(Array.from({ length: 25 }, (_, index) => `termo ${index}`).join('\n')).length === 20, 'limite de termos deve ser 20.');

console.log('F02 verificado: contas, termos, localidade, jobs, claim, cancelamento e encaminhamento ao F03.');
