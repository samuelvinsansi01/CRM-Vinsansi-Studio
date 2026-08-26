import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase', 'migrations', '20260826203000_r43_whatsapp_effective_recipient_pipeline.sql');
const source = fs.readFileSync(migrationPath, 'utf8');
const leadContact = fs.readFileSync(path.join(root, 'src', 'services', 'leads', 'leadContact.ts'), 'utf8');
const validationHandler = fs.readFileSync(path.join(root, 'server', 'whatsapp', 'validation.handler.ts'), 'utf8');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(source.includes('CREATE OR REPLACE FUNCTION public.effective_whatsapp_phone'), 'R43: helper canonico do telefone WhatsApp ausente.');
check(source.includes("nullif(btrim(p_whatsapp),'')"), 'R43: leads_whatsapp deve ser a primeira fonte do destinatario.');
check(source.includes("nullif(btrim(p_phone),'')"), 'R43: leads_phone deve permanecer apenas como fallback.');
check(source.includes('prepare_queue_items_rbac_inner'), 'R43: preparacao atomica precisa ser corrigida.');
check(source.includes('build_queue_item_payload_snapshot'), 'R43: snapshot do Worker precisa ser corrigido.');
check(source.includes("v_phone:=public.effective_whatsapp_phone(v_lead.leads_whatsapp,v_lead.leads_phone);"), 'R43: snapshot deve congelar o telefone WhatsApp efetivo.');
check(source.includes('current_user_whatsapp_validation_proofs'), 'R43: prova WhatsApp deve compartilhar a mesma identidade de telefone.');
check(source.includes('repair_pending_snapshots'), 'R43: snapshots pendentes antigos precisam ser reparados.');
check(source.includes('queue_items_started_at IS NULL') && source.includes('queue_items_finished_at IS NULL'), 'R43: reparacao nao pode alterar itens ja iniciados/finalizados.');
check(leadContact.includes("String(lead.leads_whatsapp ?? '').trim()") && leadContact.includes("String(lead.leads_phone ?? '').trim()"), 'R43: frontend deve manter WhatsApp -> telefone como fallback.');
check(validationHandler.includes('row.leads_whatsapp || row.leads_phone'), 'R43: validacao server-side deve usar o mesmo destinatario efetivo.');

console.log('R43: aprovacao, prova, snapshot e Worker compartilham leads_whatsapp -> leads_phone.');
