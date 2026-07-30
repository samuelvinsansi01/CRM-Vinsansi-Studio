import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const configPage = read('src/pages/ConfigTablePage.tsx');
const configRepo = read('src/repositories/config/canonicalConfig.repository.ts');
const queuePage = read('src/pages/QueuePage.tsx');
const whatsappTypes = read('src/services/whatsapp-queue/types.ts');
const instagramTypes = read('src/services/instagram-queue/types.ts');
const importPage = read('src/pages/ImportPage.tsx');
const configService = read('src/services/config/config.service.ts');

for (const field of ['categoriesJson', 'templateChannelId', 'templateTypeId', 'instanceId', 'levelId']) {
  assert(configPage.includes(field), `Modal canônico não expõe ${field}.`);
}
assert(configPage.includes('Nome do template'), 'Modal de template não expõe templates_name.');
assert(configPage.includes('Configurações > Instâncias'), 'Modal de chip não separa o cadastro de instâncias.');
assert(!configPage.includes("key: 'apiKey'"), 'Modal de chip ainda edita API key da instância.');
assert(!configPage.includes("key: 'url'"), 'Modal de chip ainda edita URL da instância.');
assert(configPage.includes('O limite diário é herdado de levels; não é duplicado no perfil.'), 'Modal de perfil não explica que o limite pertence a levels.');
assert(!configRepo.includes('ensureLevel'), 'Configuração ainda cria/edita nível como efeito colateral.');
assert(!configRepo.includes('ensureTemplateCatalog'), 'Template ainda cria catálogo canônico como efeito colateral.');

assert(queuePage.includes('Somente posição e agendamento pertencem ao item da fila'), 'Drawer de fila não explica o contrato físico de queue_items.');
for (const legacyEdit of ["updateDraft('company'", "updateDraft('message1'", "updateDraft('imageName'", "updateDraft('invalidReason'"]) {
  assert(!queuePage.includes(legacyEdit), `Drawer de fila ainda oferece edição sem persistência: ${legacyEdit}.`);
}
for (const typesFile of [whatsappTypes, instagramTypes]) {
  assert(!typesFile.includes("| 'company'"), 'Contrato de atualização da fila ainda aceita campos do lead.');
  assert(!typesFile.includes("| 'message1'"), 'Contrato de atualização da fila ainda aceita mensagens do template.');
  assert(typesFile.includes("'scheduled_date' | 'position'"), 'Contrato de atualização da fila perdeu os campos físicos editáveis.');
}

assert(importPage.includes('campos físicos de public.leads'), 'Drawer de importação não declara a persistência canônica em leads.');
assert(importPage.includes('branchId'), 'Drawer de importação ainda não usa branches_id por seleção canônica.');
assert(importPage.includes("actions={['view', 'edit', 'archive']}"), 'Drawer de importação continua inacessível pela tabela.');
assert(!importPage.includes('Enviar Instagram?'), 'Drawer de importação ainda expõe o campo transitório send_instagram.');
assert(!importPage.includes('Motivo do override Instagram'), 'Drawer de importação ainda expõe metadata sem coluna física.');
assert(!importPage.includes("updateForm('motivo'"), 'Drawer de importação ainda oferece edição de motivo sem persistência física.');
assert(importPage.includes('lead_status_id = 8 (Arquivado)'), 'Confirmação de arquivamento do lead não informa o efeito físico real.');
assert(!importPage.includes('camada de importação'), 'Importação ainda comunica falso salvamento em camada local.');

assert(configService.includes('assertNoOpenQueueReferences'), 'Configuração não bloqueia mutação operacional com filas abertas.');
assert(configService.includes('current.active && !normalized.active'), 'Edição do status não protege a desativação de configuração.');
assert(configService.includes("record.active && !isDeletedConfig(record)"), 'Desativação em massa não está limitada a registros ativos.');
assert(configService.includes("!record.active && !isDeletedConfig(record)"), 'Ativação em massa não está limitada a registros inativos.');
assert(!configService.includes('Restaurar exige apenas registros arquivados.'), 'Serviço ainda depende do estado Arquivado inexistente no catálogo físico.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Modais canônicos aprovados: configuração, importação e filas limitadas aos campos físicos persistidos.');
