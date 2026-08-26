import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase', 'migrations', '20260826210000_r44_whatsapp_validation_result_permissions.sql');
const source = fs.readFileSync(migrationPath, 'utf8');
const handler = fs.readFileSync(path.join(root, 'server', 'whatsapp', 'validation.handler.ts'), 'utf8');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(source.includes("p.proname = 'record_whatsapp_validation_result'"), 'R44: RPC de persistencia WhatsApp nao esta sendo localizada.');
check(source.includes('pg_get_function_identity_arguments'), 'R44: grant deve respeitar a assinatura real da RPC legada.');
check(source.includes('REVOKE ALL ON FUNCTION') && source.includes('FROM PUBLIC, anon'), 'R44: PUBLIC/anon precisam continuar bloqueados.');
check(source.includes('GRANT EXECUTE ON FUNCTION') && source.includes('TO authenticated, service_role'), 'R44: authenticated/service_role precisam receber EXECUTE.');
check(source.includes("has_function_privilege('authenticated'"), 'R44: migration precisa validar o grant de authenticated.');
check(source.includes("has_function_privilege('service_role'"), 'R44: migration precisa validar o grant de service_role.');
check(source.includes("has_function_privilege('anon'"), 'R44: migration precisa validar que anon continua bloqueado.');
check(handler.includes("client.rpc('record_whatsapp_validation_result'"), 'R44: handler deve continuar persistindo pelo contrato canonico existente.');

console.log('R44: persistencia WhatsApp liberada apenas para authenticated/service_role; anon permanece bloqueado.');
