import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260826223000_r45_optional_sequential_queue_snapshot_messages.sql');
const r29Path = path.join(root, 'supabase', 'migrations', '20260826012000_r29_alternative_name_manual_refill_table_standardization.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const r29 = fs.readFileSync(r29Path, 'utf8');
const check = (condition, message) => { if (!condition) throw new Error(message); };

check(r29.includes("FOR v_message_number IN 1..4 LOOP"), 'R45: fixture R29 deixou de representar a regressao original.');
check(migration.includes('CREATE OR REPLACE FUNCTION public.apply_queue_item_payload_snapshot()'), 'R45: trigger function nao foi redefinida.');
check(migration.includes("IF v_message_1='' THEN"), 'R45: message_1 precisa continuar obrigatoria.');
check(migration.includes("IF v_message_2='' AND (v_message_3<>'' OR v_message_4<>'') THEN"), 'R45: lacuna apos message_1 nao esta bloqueada.');
check(migration.includes("IF v_message_3='' AND v_message_4<>'' THEN"), 'R45: lacuna antes de message_4 nao esta bloqueada.');
check(!migration.includes('FOR v_message_number IN 1..4 LOOP'), 'R45: requisito legado de quatro mensagens ainda existe.');
check(migration.includes('build_queue_item_payload_snapshot'), 'R45: snapshot canonico deixou de ser construido antes da validacao.');
console.log('R45: queue_item aceita 1-4 mensagens sequenciais; message_1 obrigatoria e lacunas bloqueadas.');
