import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const repoIndex = read('src/repositories/index.ts');
const config = read('src/lib/supabase/config.ts');
const env = read('.env.example');
const importService = read('src/services/import/import.service.ts');
const whatsappService = read('src/services/whatsapp-queue/whatsappQueue.service.ts');

const runtimeFiles = [
  'src/repositories/whatsapp-queue/supabaseWhatsAppQueue.repository.ts',
  'src/repositories/instagram-queue/supabaseInstagramQueue.repository.ts',
  'src/repositories/reconciliation/supabaseReconciliation.repository.ts',
  'src/services/whatsapp-queue/whatsappQueue.service.ts',
  'src/services/whatsapp-queue/types.ts',
  'src/services/instagram-queue/types.ts',
  'api/whatsapp/batch.ts',
  'api/instagram/extension.ts',
].map(read).join('\n');

assert(!repoIndex.includes('mock'), 'Repositories ainda possuem fallback mock no runtime.');
assert(!repoIndex.includes('canUseSupabase'), 'Selecao condicional de banco ainda esta ativa.');
assert(!config.includes('VITE_USE_SUPABASE'), 'Flags de banco legado ainda existem no config.');
assert(!config.includes('VITE_SUPABASE_ANON_KEY'), 'Alias frontend legado da anon key ainda existe.');
assert(!config.includes('preSendLeads'), 'Tabela paralela pre_send_leads ainda esta no contrato.');
assert(!env.includes('VITE_SUPABASE_TABLE_PRE_SEND_LEADS'), 'Env ainda referencia pre_send_leads.');
assert(!env.includes('VITE_USE_SUPABASE_'), 'Env ainda permite trocar repositories para mocks.');
assert(!env.includes('VITE_DEFAULT_USER_ID'), 'Env ainda permite usuário de fallback sem sessão.');
assert(!read('src/repositories/supabase.helpers.ts').includes('VITE_DEFAULT_USER_ID'), 'Resolver de usuário ainda possui fallback sem autenticação.');
assert(!exists('src/services/pre-send'), 'Servico legado pre-send ainda existe.');
assert(!exists('src/repositories/pre-send'), 'Repository legado pre-send ainda existe.');
assert(!exists('src/hooks/usePreSend.ts'), 'Hook legado pre-send ainda existe.');
assert(!importService.includes('preSendService'), 'Importacao ainda aciona ciclo pre-send legado.');
assert(!whatsappService.includes('preSendService'), 'Fila WhatsApp ainda sincroniza pre_send_leads.');
assert(!exists('src/repositories/import/mockImport.repository.ts'), 'Mock de importacao ainda empacotado.');
assert(!exists('src/repositories/whatsapp-queue/mockWhatsAppQueue.repository.ts'), 'Mock de fila WhatsApp ainda empacotado.');
assert(exists('src/services/status/leadStatus.ts'), 'Contrato canonico de status nao foi criado.');

assert(!runtimeFiles.includes('raw_payload'), 'Fila ainda usa o payload duplicado raw_payload.');
assert(!runtimeFiles.includes('source_pre_send_id'), 'Fila ainda usa o vínculo legado source_pre_send_id.');
assert(!runtimeFiles.includes('sourcePreSendId'), 'Tipos ainda expõem o alias legado sourcePreSendId.');
assert(!runtimeFiles.includes('current_status'), 'API ainda devolve nomenclatura genérica current_status.');
assert(read('src/services/whatsapp-queue/types.ts').includes('lead_id: string;'), 'Fila WhatsApp não exige lead_id canônico.');
assert(read('src/services/instagram-queue/types.ts').includes('lead_id: string;'), 'Fila Instagram não exige lead_id canônico.');

console.log('Final consolidation verification passed.');
