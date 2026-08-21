import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const migration = read('supabase/migrations/20260802100000_secure_credentials_integrations.sql');
const configRepo = read('src/repositories/configuration/configuration.repository.ts');
const canonicalConfig = read('src/repositories/config/canonicalConfig.repository.ts');
const apifyService = read('src/services/apify-accounts/apifyAccounts.service.ts');
const evolutionSync = read('supabase/functions/evolution-instance-sync/index.ts');
const evolutionWebhook = read('supabase/functions/evolution-connection-webhook/index.ts');
const apifyCheck = read('supabase/functions/apify-account-check/index.ts');
const apifyStart = read('supabase/functions/apify-google-maps-start/index.ts');
const apifySync = read('supabase/functions/apify-google-maps-sync/index.ts');
const manifest = JSON.parse(read('public/tools/manifest.json'));

for (const token of [
  'CREATE TABLE IF NOT EXISTS public.instance_credentials',
  'CREATE TABLE IF NOT EXISTS public.apify_account_credentials',
  'vault.create_secret',
  'vault.update_secret',
  'instances_apikey_must_remain_null',
  'apify_token_secret_must_remain_null',
  'save_instance_secure',
  'service_get_evolution_instances',
  'service_get_apify_account_secret',
]) assert(migration.includes(token), `Migration de credenciais não contém ${token}.`);

assert(migration.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.instances'), 'Escrita direta em instances não foi revogada.');
assert(migration.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.apify_accounts'), 'Escrita direta em apify_accounts não foi revogada.');
assert(configRepo.includes("rpc('save_instance_secure'"), 'Frontend não salva instância pela RPC segura.');
assert(configRepo.includes("rpc('delete_instance_secure'"), 'Frontend não exclui instância pela RPC segura.');
assert(!configRepo.includes('instances_apikey'), 'Frontend ainda manipula instances_apikey.');
assert(!canonicalConfig.includes('instances_apikey'), 'Configuração canônica ainda lê instances_apikey.');
assert(apifyService.includes("rpc('save_apify_account'"), 'Frontend não salva Apify pela RPC segura.');
assert(!apifyService.includes('patch.token_secret') && !apifyService.includes('token_secret: token'), 'Frontend ainda grava token_secret diretamente.');

for (const [name, source] of [['check', apifyCheck], ['start', apifyStart], ['sync', apifySync]]) {
  assert(source.includes('service_get_apify_account_secret'), `Edge Function Apify ${name} não usa o segredo protegido.`);
  assert(!source.includes('.select("apify_accounts_id, token_secret")'), `Edge Function Apify ${name} ainda seleciona token público.`);
}
assert(evolutionSync.includes('service_get_evolution_instances'), 'Sincronização Evolution não usa Vault.');
assert(!evolutionSync.includes('instances_apikey'), 'Sincronização Evolution ainda seleciona API key pública.');
assert(evolutionSync.includes('"x-evolution-signature": token'), 'Webhook Evolution não é configurado com assinatura em header.');
assert(evolutionWebhook.includes('x-evolution-signature'), 'Webhook não valida assinatura no header.');
assert(!manifest.tools.some((tool) => tool.id === 'worker'), 'Worker standalone voltou a ser publicado e pode divergir do runtime do Gerenciador.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Credenciais seguras: Vault, RPCs restritas e webhook por header validados; Worker é runtime embarcado do Gerenciador.');
