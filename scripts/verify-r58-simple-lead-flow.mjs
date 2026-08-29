import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fail = (message) => { console.error(`R58: ${message}`); process.exitCode = 1; };
const check = (condition, message) => { if (!condition) fail(message); };

function sourceText(dir) {
  const base = path.join(root, dir);
  const parts = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) parts.push(fs.readFileSync(full, 'utf8'));
    }
  };
  if (fs.existsSync(base)) walk(base);
  return parts.join('\n');
}

const migration = read('supabase/migrations/20260829120000_r58_simple_lead_flow.sql');
const standalone = read('SQL - CRM R58 - Fluxo simples e telas sem refresh.sql');
const supabaseStandalone = read('supabase/SQL/SQL - CRM R58 - Fluxo simples e telas sem refresh.sql');
const statuses = read('src/services/status/leadStatus.ts');
const catalog = read('src/repositories/schemaCatalog.ts');
const home = read('src/pages/HomePage.tsx');
const leadHook = read('src/hooks/useLeadCycle.ts');
const baseHook = read('src/hooks/useBaseRecords.ts');
const baseRepo = read('src/repositories/base/supabaseBase.repository.ts');
const reviewPanel = read('src/components/QueueReviewPanel.tsx');
const waHook = read('src/hooks/useWhatsAppQueue.ts');
const igHook = read('src/hooks/useInstagramQueue.ts');
const validationHandler = read('server/whatsapp/validation.handler.ts');
const mapsExtension = read('server/routes/maps/extension.ts');
const queuePreparation = read('src/services/queue-preparation/queuePreparation.service.ts');
const queueReview = read('src/services/queue-review/queueReview.service.ts');
const allRuntime = [sourceText('src'), sourceText('server'), sourceText('api')].join('\n');

check(migration === standalone && migration === supabaseStandalone, 'os três exemplares do SQL R58 não são idênticos.');
check(migration.includes("lead_status: 1 importado | 2 revisao | 3 sem_contato | 4 na_fila"), 'contrato de status não está documentado no SQL.');
check(migration.includes("channels: whatsapp | instagram | sem_destino"), 'contrato de canais não está documentado no SQL.');
check(migration.includes("SET lead_status_name='revisao'"), 'status 2 não é convertido para revisao.');
check(migration.includes("SET lead_status_name='sem_contato'"), 'status 3 não é convertido para sem_contato.');
check(migration.includes("SELECT 'sem_destino'"), 'canal sem_destino não é criado de forma idempotente.');
check(!migration.includes("INSERT INTO public.channels (\n  channels_id"), 'migration tenta forçar ID identity de channels.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.pull_queue_review_to_capacity'), 'falta RPC de puxada por capacidade.');
check(migration.includes('AND l.lead_status_id=1'), 'puxada não está limitada a Importado.');
check(migration.includes('l.channels_id IN (v_channel_id,v_sem_destino_id)'), 'puxada não aceita canal específico + Sem destino.');
check(migration.includes('SET lead_status_id=2,channels_id=v_channel_id'), 'puxada não transforma o reservado em Revisao + canal puxado.');
check(!migration.includes('p_quantity') && !migration.includes('p_requested_count'), 'puxada voltou a receber quantidade manual.');
check(migration.includes('FOR UPDATE OF l SKIP LOCKED'), 'seleção da puxada não usa lock concorrente.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.invalidate_queue_review_item'), 'falta invalidação manual da Revisão.');
check(migration.includes('SET lead_status_id=6'), 'invalidação manual não leva o lead a Inválido.');
check(migration.includes('lead_status_id=4'), 'aprovação não exige/persiste Na fila.');
check(migration.includes("'contractVersion','R58'"), 'RPCs não expõem contrato R58.');
check(!/DELETE\s+FROM\s+public\.lead_status\s+[\s\S]{0,120}lead_status_id\s*=\s*8/i.test(migration), 'status 8 está sendo apagado antes da limpeza das FKs históricas.');

check(statuses.includes('REVIEW: 2'), 'frontend não usa REVIEW=2.');
check(statuses.includes('NO_CONTACT: 3'), 'frontend não usa NO_CONTACT=3.');
check(!statuses.includes('VALIDATED:') && !statuses.includes('PRE_SEND:') && !statuses.includes('ARCHIVED:'), 'catálogo do lead ainda expõe status removidos.');
check(catalog.includes("channelId(channel: 'WhatsApp' | 'Instagram' | 'Sem destino')"), 'schemaCatalog não resolve Sem destino.');
check(catalog.includes("channelId('Sem destino')") || allRuntime.includes("channelId('Sem destino')"), 'Sem destino não é consumido no runtime.');

check(validationHandler.includes('const expectedStatus = 2'), 'validação WhatsApp não exige Revisão.');
check(validationHandler.includes("? { lead_status_id: 2, channels_id: channels.whatsapp }"), 'WhatsApp válido não permanece Revisão + WhatsApp.');
check(validationHandler.includes("? { lead_status_id: 1, channels_id: channels.instagram }"), 'WhatsApp inválido com Instagram não retorna para Importado + Instagram.');
check(validationHandler.includes("{ lead_status_id: 3, channels_id: null"), 'WhatsApp inválido sem Instagram não vira Sem contato.');
check(mapsExtension.includes("const noDestinationChannelId = channelByName.get('sem destino')") && mapsExtension.includes('phoneWhatsapp && instagram') && mapsExtension.includes('? noDestinationChannelId'), 'captura não atribui Sem destino quando há dois contatos.');
check(queuePreparation.includes('LEAD_STATUS.REVIEW'), 'preparação da fila não parte de Revisão.');
check(queueReview.includes("!== 'R58'"), 'frontend não exige contrato R58 na reconciliação.');

check(!allRuntime.includes('LEAD_STATUS.VALIDATED'), 'runtime ainda usa LEAD_STATUS.VALIDATED.');
check(!allRuntime.includes('LEAD_STATUS.PRE_SEND'), 'runtime ainda usa LEAD_STATUS.PRE_SEND.');
check(!allRuntime.includes('LEAD_STATUS.ARCHIVED'), 'runtime ainda usa LEAD_STATUS.ARCHIVED.');
check(!allRuntime.includes("from('permanent_records')") && !allRuntime.includes("from(\"permanent_records\")"), 'runtime ainda lê permanent_records.');
check(!allRuntime.includes("from('permanent_record_events')") && !allRuntime.includes("from('permanent_record_snapshots')"), 'runtime ainda depende das tabelas permanent_record_*.');
check(baseRepo.includes("const FINAL_STATUS_IDS: BaseFinalStatusId[] = [3, 5, 6, 7]"), 'Base Permanente não usa apenas Sem contato/Enviado/Inválido/Duplicado.');
check(baseRepo.includes(".from('leads')"), 'Base Permanente não lê diretamente de leads.');

// Sem piscada: carregamento visual somente na primeira consulta; depois preserva a tabela.
check(leadHook.includes('if (!loadedRef.current) setLoading(true)'), 'Início não preserva tabela em refresh silencioso.');
check(leadHook.includes('removeLocally') && leadHook.includes('patchChannelLocally'), 'Início não aplica deltas locais após ações.');
check(home.includes('imported.removeLocally(result.movedLeadIds)'), 'Puxar não remove localmente os leads que saíram do Início.');
check(home.includes("imported.patchChannelLocally(result.redirectedLeadIds, 'Instagram')"), 'WhatsApp inválido redirecionado não é atualizado localmente no Início.');
check(baseHook.includes('setLoading(!hasLoadedRef.current)'), 'Base Permanente não preserva tabela em refresh/filtro subsequente.');
check(reviewPanel.includes('const scopeChanged = scopeRef.current !== scopeKey'), 'Revisão não distingue troca de escopo de refresh interno.');
check(reviewPanel.includes('removeItemLocally(item.reviewItemId);'), 'Revisão não remove linha imediatamente após ação.');
check(reviewPanel.includes('restoreItemLocally(item, sourceBatch);'), 'Revisão não restaura linha localmente quando a ação falha.');
check(waHook.includes('else setRefreshing(true)') && waHook.includes('if (isInitialLoad) {\n          setChips([]);\n          setBatches([]);'), 'Fila WhatsApp não preserva dados em refresh subsequente.');
check(igHook.includes('else setRefreshing(true)') && igHook.includes('if (isInitialLoad) {\n          setProfiles([]);\n          setBatches([]);'), 'Fila Instagram não preserva dados em refresh subsequente.');
check(waHook.includes('patchLeadLocally') && waHook.includes('leads.filter((candidate) => candidate.id !== lead.id)'), 'Fila WhatsApp não aplica edição/invalidação local.');
check(igHook.includes('patchLeadLocally') && igHook.includes('leads.filter((candidate) => candidate.id !== lead.id)'), 'Fila Instagram não aplica edição/invalidação local.');

if (!process.exitCode) {
  console.log('R58 OK: fluxo simples por leads/status/canal, Base Permanente em leads e tabelas operacionais sem refresh visual após ações.');
}
