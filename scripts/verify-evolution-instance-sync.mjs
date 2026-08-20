import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const app = read('src/App.tsx');
const page = read('src/pages/CatalogCrudPage.tsx');
const repository = read('src/repositories/configuration/configuration.repository.ts');
const service = read('src/services/evolution-instances/evolutionInstances.service.ts');
const syncFunction = read('supabase/functions/evolution-instance-sync/index.ts');
const webhookFunction = read('supabase/functions/evolution-connection-webhook/index.ts');
const config = read('supabase/config.toml');

assert(app.includes('syncEvolutionInstances'), 'App não inicializa a sincronização automática da Evolution.');
assert(app.includes('60_000'), 'Reconciliação periódica de 60 segundos ausente.');
assert(page.includes('Sincronizar Evolution'), 'Botão manual de sincronização ausente.');
assert(page.includes("kind !== 'instances'"), 'Status manual ainda aparece no formulário de instâncias.');
assert(repository.includes("rpc('save_instance_secure'"), 'Instâncias não são salvas pela RPC segura.');
assert(!repository.includes('instances_apikey'), 'Repository ainda manipula API key na tabela pública.');
assert(service.includes("functions.invoke('evolution-instance-sync'"), 'Frontend não invoca a função canônica de sincronização.');
assert(syncFunction.includes('/v1/whatsapp/instances/') && syncFunction.includes('/status'), 'Consulta do status pelo Gateway Vinsansi v1 ausente.');
assert(syncFunction.includes('/v1/whatsapp/instances/') && syncFunction.includes('/webhook'), 'Configuração automática de webhook pelo Gateway Vinsansi v1 ausente.');
assert(syncFunction.includes('CONNECTION_UPDATE'), 'Evento CONNECTION_UPDATE não foi configurado.');
assert(syncFunction.includes('service_get_evolution_instances'), 'Edge Function não lê a credencial pelo RPC de service_role.');
assert(syncFunction.includes('x-evolution-signature'), 'Webhook não recebe assinatura por header.');
assert(webhookFunction.includes('EVOLUTION_WEBHOOK_SECRET'), 'Webhook não valida o secret.');
assert(webhookFunction.includes('timingSafeEqual'), 'Webhook não usa comparação segura da assinatura.');
assert(config.includes('[functions.evolution-connection-webhook]') && config.includes('verify_jwt = false'), 'Webhook público não foi configurado como verify_jwt=false.');

assert(!syncFunction.includes('/instance/connectionState/') && !syncFunction.includes('/webhook/set/'), 'Edge Function ainda depende de rotas legadas da Evolution.');
console.log('Contrato WhatsApp Vinsansi v1: OK — webhook em tempo real, polling de reconciliação e status somente leitura.');
