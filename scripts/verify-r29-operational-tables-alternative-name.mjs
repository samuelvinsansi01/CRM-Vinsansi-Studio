import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
const expect = (condition, message) => { checks += 1; if (!condition) throw new Error(message); };

const migration = read('supabase/migrations/20260826012000_r29_alternative_name_manual_refill_table_standardization.sql');
const home = read('src/pages/HomePage.tsx');
const queuePage = read('src/pages/QueuePage.tsx');
const review = read('src/components/QueueReviewPanel.tsx');
const finalTable = read('src/components/QueueFinalTable.tsx');
const reviewService = read('src/services/queue-review/queueReview.service.ts');
const leadService = read('src/services/lead-cycle/leadCycle.service.ts');
const waRepo = read('src/repositories/whatsapp-queue/canonicalWhatsAppQueue.repository.ts');
const igRepo = read('src/repositories/instagram-queue/canonicalInstagramQueue.repository.ts');
const leadCss = read('src/styles/lead-list.css');
const componentCss = read('src/styles/components.css');

expect(migration.includes('ADD COLUMN IF NOT EXISTS leads_alternative_name text'), 'R29 deve criar leads_alternative_name opcional');
expect(migration.includes("coalesce(nullif(btrim(v_lead.leads_alternative_name),''),v_lead.leads_name,''"), 'snapshot deve priorizar nome alternativo');
expect(migration.includes("'EMPRESA',v_company_name") && migration.includes("'NOME_EMPRESA',v_company_name"), 'templates devem receber nome efetivo');
expect(migration.includes('CREATE OR REPLACE FUNCTION public.update_lead_alternative_name'), 'RPC de nome alternativo deve existir');
expect(migration.includes("set_config('vinsansi.allow_queue_snapshot_refresh','on',true)"), 'refresh de snapshot deve ser explicitamente guardado');
expect(migration.includes("coalesce(nullif(btrim(l.leads_alternative_name),''),l.leads_name)"), 'revisão deve exibir nome efetivo');

expect(home.includes("const [instagramResourceId,setInstagramResourceId]") || home.includes("const [instagramResourceId, setInstagramResourceId]"), 'Início deve manter perfil Instagram selecionado');
expect(home.includes('instagramResourceOptions') && home.includes('placeholder="Selecione o perfil"'), 'Início deve mostrar select de perfil Instagram');
expect(home.includes("pull('Instagram')") && home.includes('!instagramResourceId'), 'Puxar Instagram deve exigir perfil específico');
expect(home.includes('displayCompany'), 'Início deve exibir o nome alternativo quando existir');
expect(home.includes('Nome alternativo (opcional)'), 'edição do lead deve expor nome alternativo opcional');
expect(!home.includes('>Atualizar</Button>'), 'Início não deve ter botão Atualizar manual');

expect(review.includes('<TableCard') && review.includes('<DataTable'), 'Revisão deve usar TableCard/DataTable canônicos');
expect(review.includes("actions={['approve','invalidate']}"), 'Revisão deve ter aprovar/invalidadar pelas actions canônicas');
expect(review.includes('RowsPerPageControl') && review.includes('useClientPagination'), 'Revisão deve ter paginação padrão');
expect(!review.includes('>Atualizar</Button>') && !review.includes('Puxar WhatsApp</Button>') && !review.includes('Puxar Instagram</Button>'), 'Revisão não deve ter controles duplicados');

expect(finalTable.includes('<TableCard') && finalTable.includes('<DataTable'), 'Fila final deve usar TableCard/DataTable canônicos');
expect(finalTable.includes("actions={['view','edit','invalidate']}"), 'Fila final deve oferecer olho, editar e invalidar');
expect(finalTable.includes('RowsPerPageControl') && finalTable.includes('useClientPagination'), 'Fila final deve ter paginação padrão');

expect(!queuePage.includes('>Parar</Button>') && !queuePage.includes('Iniciar chip') && !queuePage.includes('Iniciar lotes') && !queuePage.includes('Vincular extensão'), 'filas não devem exibir Parar/Iniciar/Vincular extensão');
expect(!queuePage.includes('>Atualizar</Button>'), 'filas não devem exibir Atualizar manual');
expect((queuePage.match(/>Reprocessar<\/Button>/g) || []).length === 2, 'cada canal deve manter Reprocessar');
expect((queuePage.match(/>Puxar leads<\/Button>/g) || []).length === 2, 'cada canal deve ter Puxar leads no topo');
expect(queuePage.indexOf('>Reprocessar</Button>') < queuePage.indexOf('placeholder="Selecione um chip"') && queuePage.indexOf('placeholder="Selecione um chip"') < queuePage.indexOf('>Puxar leads</Button>'), 'WhatsApp deve ordenar Reprocessar | Chip | Puxar leads');
const instagramSection = queuePage.indexOf('function InstagramQueuePage');
const igQueue = queuePage.slice(instagramSection);
expect(igQueue.indexOf('>Reprocessar</Button>') < igQueue.indexOf('placeholder="Selecione um perfil"') && igQueue.indexOf('placeholder="Selecione um perfil"') < igQueue.indexOf('>Puxar leads</Button>'), 'Instagram deve ordenar Reprocessar | Perfil | Puxar leads');
expect(queuePage.includes('Somente este campo pode ser alterado aqui') && queuePage.includes('alternativeNameService.update'), 'edição na fila final deve alterar somente nome alternativo');

const invalidateStart = reviewService.indexOf('async function invalidate');
const invalidateEnd = reviewService.indexOf('async function lock', invalidateStart);
const invalidateBlock = reviewService.slice(invalidateStart, invalidateEnd > invalidateStart ? invalidateEnd : undefined);
expect(invalidateStart >= 0 && !invalidateBlock.includes('fillBatch') && !invalidateBlock.includes('pullToCapacity'), 'invalidar na revisão não deve repor WhatsApp nem Instagram automaticamente');
const waFinalInvalidateStart = queuePage.indexOf('const handleInvalidate=async', queuePage.indexOf('function WhatsAppQueuePage'));
const waFinalInvalidateEnd = queuePage.indexOf('return <div', waFinalInvalidateStart);
const waInvalidateBlock = queuePage.slice(waFinalInvalidateStart, waFinalInvalidateEnd);
expect(!waInvalidateBlock.includes('pullToCapacity'), 'invalidar na fila final WhatsApp não deve repor automaticamente');
const igFinalInvalidateStart = queuePage.indexOf('const handleInvalidate=async', instagramSection);
const igFinalInvalidateEnd = queuePage.indexOf('return <div', igFinalInvalidateStart);
const igInvalidateBlock = queuePage.slice(igFinalInvalidateStart, igFinalInvalidateEnd);
expect(!igInvalidateBlock.includes('pullToCapacity'), 'invalidar na fila final Instagram não deve repor automaticamente');

expect(leadService.includes('leads_alternative_name: input.alternativeName.trim() || null'), 'serviço de leads deve persistir nome alternativo');
expect(waRepo.includes('alternative_company_name') && waRepo.includes('alternativeName || originalCompany'), 'fila WhatsApp deve carregar nome alternativo/snapshot');
expect(igRepo.includes('alternative_company_name') && igRepo.includes('alternativeName || originalCompany'), 'fila Instagram deve carregar nome alternativo/snapshot');

expect(leadCss.includes('text-overflow:ellipsis') && leadCss.includes('white-space:nowrap'), 'tabelas operacionais devem truncar em uma linha');
expect(componentCss.includes('R29: todas as tabelas canônicas') && componentCss.includes('table-layout: fixed'), 'DataTable global deve padronizar uma linha com ellipsis');

console.log(`R29 nome alternativo + filas manuais + tabelas padronizadas: PASS (${checks} verificações)`);
