import { readFileSync } from 'node:fs';
function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
function assert(value, message) { if (!value) throw new Error(message); }
const migration = read('supabase/migrations/20260802110000_centralized_operational_settings.sql');
const repository = read('src/repositories/settings/canonicalSettings.repository.ts');
const root = read('src/repositories/index.ts');
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.user_operational_settings'), 'Tabela central de configurações ausente.');
assert(migration.includes('service_get_operational_settings'), 'RPC do Worker ausente.');
assert(migration.includes('worker_defer_batch'), 'Adiamento operacional ausente.');
assert(repository.includes("rpc('save_dispatch_settings'"), 'Frontend não persiste disparos no banco.');
assert(repository.includes('migrateLegacyOnce'), 'Migração do localStorage ausente.');
assert(root.includes('canonicalSettingsRepository'), 'Repositório central não está ativo.');
console.log('Etapa 5: configurações centralizadas verificadas.');
