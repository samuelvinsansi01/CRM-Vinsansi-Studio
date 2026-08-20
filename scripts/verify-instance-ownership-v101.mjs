import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = path.join(root, 'supabase', 'migrations', '20260820123000_instance_credential_rotation.sql');
if (!fs.existsSync(migration)) throw new Error('migration v1.0.1 ausente');
const sql = fs.readFileSync(migration, 'utf8');
for (const token of [
  'rotate_instance_credential_secure',
  'ensure_current_user()',
  'i.users_id = v_users_id',
  'vault.update_secret',
  'GRANT EXECUTE',
]) {
  if (!sql.includes(token)) throw new Error(`ownership hardening incompleto: ${token}`);
}
console.log('instance ownership / credential rotation v1.0.1: OK');
