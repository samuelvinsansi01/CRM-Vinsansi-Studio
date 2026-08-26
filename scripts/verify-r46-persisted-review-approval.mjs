import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (condition, message) => { if (!condition) throw new Error(message); };

const migration = read('supabase/migrations/20260826234000_r46_verified_queue_review_approval.sql');
const service = read('src/services/queue-review/queueReview.service.ts');
const panel = read('src/components/QueueReviewPanel.tsx');

check(migration.includes('CREATE OR REPLACE FUNCTION public.approve_queue_review_item('), 'R46: função de aprovação não foi reinstalada.');
check(migration.includes("'contractVersion','R46'"), 'R46: aprovação precisa retornar marcador de contrato.');
check(migration.includes("'persisted',true"), 'R46: aprovação precisa confirmar persistência explicitamente.');
check(migration.includes("review_status='locked'"), 'R46: pós-condição de revisão locked ausente.');
check(migration.includes('queue_review_queue_item_not_persisted'), 'R46: pós-condição do queue_item ausente.');
check(migration.includes('queue_review_snapshot_whatsapp_recipient_mismatch'), 'R46: destinatário WhatsApp congelado não está sendo verificado.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.queue_review_approval_state'), 'R46: RPC de diagnóstico do estado da aprovação ausente.');

check(service.includes("approval.contractVersion !== 'R46'"), 'R46: frontend ainda aceita resposta antiga como sucesso.');
check(service.includes('approval.persisted !== true'), 'R46: frontend não exige confirmação persisted=true.');
check(service.includes("rpc('queue_review_approval_state'"), 'R46: fallback de diagnóstico pós-aprovação ausente.');
check(service.includes('Aplique o SQL R46 no Supabase'), 'R46: divergência de banco precisa ser informada explicitamente.');

check(panel.includes("const [actionNotice, setActionNotice]"), 'R46: painel precisa manter feedback visível da ação.');
check(panel.includes("title: 'Aprovando lead…'"), 'R46: estado de aprovação pendente não está visível.');
check(panel.includes("title: 'Aprovação não persistida'"), 'R46: erro persistente não está visível na própria tela.');
check(panel.includes('queue-action-notice'), 'R46: aviso persistente não foi renderizado.');

console.log('R46: aprovação só conclui com confirmação transacional; banco divergente e falhas ficam visíveis no painel.');
