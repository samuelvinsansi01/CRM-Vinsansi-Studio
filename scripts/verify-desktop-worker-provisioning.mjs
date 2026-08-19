import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'api/desktop/worker-provision.ts'), 'utf8');
const migrationPath = path.join(root, 'supabase/migrations/20260819170000_desktop_local_tunnel_credentials.sql');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
const fail = (message) => { console.error(message); process.exit(1); };

if (!source.includes('DESKTOP_WORKER_PROVISIONING_ENABLED')) fail('Provisionamento desktop nao e fail-closed.');
if (!source.includes('DESKTOP_WORKER_PROVISIONING_ALLOWED_EMAILS')) fail('Allowlist de email ausente.');
if (!source.includes('SUPABASE_SERVICE_ROLE_KEY')) fail('Credencial server-side nao e lida pelo endpoint.');
if (source.includes('DESKTOP_CLOUDFLARE_TUNNEL_TOKEN')) fail('Endpoint ainda depende de token de Tunnel remoto.');
if (!source.includes("action === 'enroll_local_tunnel'")) fail('Bootstrap do Tunnel local existente nao foi implementado.');
if (!source.includes("service_save_desktop_tunnel_credential")) fail('Endpoint nao salva a credencial local no Vault.');
if (!source.includes("service_get_desktop_tunnel_credential")) fail('Endpoint nao recupera a credencial local do Vault.');
if (!source.includes('encryptedCloudflareTunnelCredentials')) fail('Credencial do Tunnel local nao e cifrada para o desktop.');
if (!source.includes('crypto.subtle.encrypt') || !source.includes('RSA-OAEP')) fail('Cifragem RSA-OAEP ausente.');
if (!source.includes('auth.getUser(token)')) fail('Endpoint nao valida sessao do usuario.');
if (!source.includes("AccountTag") || !source.includes("TunnelSecret") || !source.includes("TunnelID")) fail('Validacao do JSON de credencial do Tunnel esta incompleta.');
if (source.includes('cert.pem')) fail('cert.pem nao deve ser provisionado ao desktop.');

const response = source.split('encryptedCloudflareTunnelCredentials')[1] ?? '';
if (/serviceRoleKey\s*[,}]/.test(response)) fail('Service Role parece retornar em texto claro.');
if (/credentialsJson\s*[,}]/.test(response)) fail('Credencial do Tunnel parece retornar em texto claro.');

if (!migration.includes('CREATE TABLE IF NOT EXISTS public.desktop_tunnel_credentials')) fail('Tabela de metadados do Tunnel local ausente.');
if (!migration.includes('vault.create_secret') || !migration.includes('vault.update_secret')) fail('Credencial do Tunnel local nao esta protegida pelo Vault.');
if (!migration.includes('service_save_desktop_tunnel_credential') || !migration.includes('service_get_desktop_tunnel_credential')) fail('RPCs service-role do Tunnel local ausentes.');
if (!migration.includes('TO service_role')) fail('RPCs do Tunnel local nao estao restritas ao service_role.');
if (/TO authenticated/.test(migration.match(/GRANT EXECUTE[\s\S]*$/)?.[0] ?? '')) fail('RPC de Tunnel local foi concedida a authenticated.');

console.log('OK: provisionamento desktop usa Tunnel local, bootstrap controlado, Vault e entrega cifrada por dispositivo.');
