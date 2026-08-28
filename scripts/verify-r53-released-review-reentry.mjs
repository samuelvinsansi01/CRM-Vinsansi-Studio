import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase/migrations/20260828214500_r53_released_review_reentry.sql');
const servicePath = path.join(root, 'src/services/queue-review/queueReview.service.ts');
const typesPath = path.join(root, 'src/services/queue-review/types.ts');
const homePath = path.join(root, 'src/pages/HomePage.tsx');
const queuePath = path.join(root, 'src/pages/QueuePage.tsx');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function check(ok, message) { if (!ok) { console.error(message); process.exitCode = 1; } }

const sql = read(migrationPath);
const service = read(servicePath);
const types = read(typesPath);
const home = read(homePath);
const queue = read(queuePath);

check(sql.includes("ri.review_status='open'"), 'R53: leads em revisão aberta devem continuar bloqueados.');
check(sql.includes("ri.review_status IN ('invalidated','locked')"), 'R53: invalidated/locked do mesmo lote devem continuar bloqueados.');
check(!sql.includes("ri.review_status='open' OR ri.queue_review_batches_id=p_batch_id"), 'R53: regra antiga ainda bloqueia qualquer histórico do lote.');
check(sql.includes('ORDER BY coalesce(l.leads_score,0) DESC,coalesce(l.leads_reviews_count,0) DESC,l.leads_id ASC'), 'R53: prioridade por nota/avaliações/id foi alterada.');
check(service.includes('const attemptedLeadIds = new Set<string>()'), 'R53: falta trava por ação para não revalidar o mesmo lead no mesmo clique.');
check(service.includes('.filter((id) => !attemptedLeadIds.has(id))'), 'R53: candidatos já tentados no clique não estão sendo filtrados.');
check(service.includes('if (retryable.length) technicalStop = true'), 'R53: falha técnica não interrompe o preenchimento automático.');
check(service.includes('&& !technicalStop'), 'R53: loop continua após falha técnica.');
check(types.includes('technicalStop: boolean'), 'R53: resultado não expõe parada técnica.');
check(home.includes('sem retry automático'), 'R53: Home não informa parada técnica conservadora.');
check(queue.includes('validação técnica interrompida sem retry automático'), 'R53: Fila não informa parada técnica conservadora.');

if (!process.exitCode) console.log('R53 OK: released reentra em ação futura, mantendo ordem e sem retry automático no mesmo clique.');
