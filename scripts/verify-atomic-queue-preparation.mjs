import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260802070000_atomic_queue_preparation.sql', import.meta.url), 'utf8');
const runtimeGuardMigration = readFileSync(new URL('../supabase/migrations/20260820211000_whatsapp_queue_runtime_guard.sql', import.meta.url), 'utf8');
const canonicalConfig = readFileSync(new URL('../src/repositories/config/canonicalConfig.repository.ts', import.meta.url), 'utf8');
const chipOperational = readFileSync(new URL('../src/services/config/chipOperational.ts', import.meta.url), 'utf8');
const preparation = readFileSync(new URL('../src/services/queue-preparation/queuePreparation.service.ts', import.meta.url), 'utf8');
const queueSchema = readFileSync(new URL('../src/repositories/queueSchema.ts', import.meta.url), 'utf8');
const whatsappRepository = readFileSync(new URL('../src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts', import.meta.url), 'utf8');
const instagramRepository = readFileSync(new URL('../src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts', import.meta.url), 'utf8');

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(migration.includes('CREATE OR REPLACE FUNCTION public.prepare_queue_items'), 'RPC transacional prepare_queue_items ausente.');
assert(migration.includes('pg_advisory_xact_lock'), 'Reserva não está serializada por recurso e data.');
assert(migration.includes('CREATE OR REPLACE FUNCTION public.guard_queue_item_capacity'), 'Guard rail de capacidade para reagendamento e reprocessamento ausente.');
assert(migration.includes('CREATE TRIGGER queue_items_capacity_guard'), 'Trigger de capacidade de queue_items ausente.');
assert(migration.includes('FOR UPDATE OF c') && migration.includes('FOR UPDATE OF so'), 'Recursos não são bloqueados durante a reserva.');
assert(migration.includes('FOR UPDATE;'), 'Leads ou fila não são bloqueados durante a transação.');
assert(migration.includes('ON CONFLICT (users_id, queues_name)'), 'Criação idempotente da fila ausente.');
assert(migration.includes('queue_items_whatsapp_resource_date_position_unique') && migration.includes('queue_items_instagram_resource_date_position_unique'), 'Posição operacional não possui índices únicos por recurso e data.');
assert(migration.includes('DROP POLICY IF EXISTS queue_items_own_insert'), 'Inserção direta de queue_items ainda está liberada.');
assert(migration.includes('DROP POLICY IF EXISTS queues_own_insert'), 'Inserção direta de queues ainda está liberada.');
assert(migration.includes('REVOKE INSERT ON public.queue_items FROM authenticated'), 'Privilégio direto de INSERT em queue_items não foi revogado.');

assert(queueSchema.includes("rpc('prepare_queue_items'"), 'Frontend não chama a RPC transacional.');
assert(preparation.includes('prepareQueueItems(channel, resource.id'), 'Serviço de preparação não delega o commit ao banco.');
assert(!preparation.includes('activeCommits'), 'Lock local ainda é tratado como garantia de integridade.');
assert(!preparation.includes('repositories.whatsappQueue.enqueue'), 'Preparação ainda insere WhatsApp pela rota antiga.');
assert(!preparation.includes('repositories.instagramQueue.enqueue'), 'Preparação ainda insere Instagram pela rota antiga.');
assert(!preparation.includes('compareAndSet'), 'Status do lead ainda é alterado separadamente da fila.');
assert(preparation.includes('const id = String(chip.id)'), 'Chip não utiliza chips_id como identificador transacional.');
assert(preparation.includes('const id = String(profile.id)'), 'Perfil não utiliza socials_id como identificador transacional.');

assert(runtimeGuardMigration.includes('public.instance_runtime_states AS runtime'), 'Fila WhatsApp não consulta o estado operacional separado da instância.');
assert(runtimeGuardMigration.includes('runtime.session_saved = true'), 'Fila WhatsApp não exige sessão persistida conhecida.');
assert(!runtimeGuardMigration.includes('runtime.socket_connected = true'), 'Fila voltou a depender do socket instantâneo em vez da sessão persistida.');
assert(canonicalConfig.includes("from('instance_runtime_states')"), 'Configuração de chips não carrega a telemetria operacional da instância.');
assert(chipOperational.includes('chip.sessionSaved'), 'Elegibilidade do chip não considera sessão persistida.');

for (const [name, repository] of [['WhatsApp', whatsappRepository], ['Instagram', instagramRepository]]) {
  assert(repository.includes('prepareQueueItems('), `${name}: repositório não usa a RPC transacional.`);
  assert(!repository.includes("from('queue_items').insert"), `${name}: ainda existe INSERT direto em queue_items.`);
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Preparação atômica de filas confirmada: locks, capacidade e sessão persistida por chip estão sob o contrato canônico.');
