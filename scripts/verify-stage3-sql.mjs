import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = `vinsansi-stage3-sql-${process.pid}`;
const run = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', ...options });

function checked(args, options = {}) {
  const result = run(args, options);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`docker ${args.join(' ')} falhou (${result.status}).`);
  }
  return result;
}

function apply(file) {
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  checked(['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'vinsansi'], { input: sql });
}

try {
  checked(['run', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=stage3', '-e', 'POSTGRES_DB=vinsansi', '-d', 'postgres:15-alpine']);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const probe = run(['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'vinsansi']);
    if (probe.status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!ready) throw new Error('PostgreSQL de smoke test não ficou pronto.');
  apply('scripts/sql/stage3-smoke-base.sql');
  apply('supabase/migrations/20260821190000_tools_control_plane.sql');
  apply('scripts/sql/stage3-smoke-assertions.sql');
  console.log('Etapa 3 SQL: migration aplicada e contratos funcionais aprovados no PostgreSQL 15.');
} finally {
  run(['stop', container]);
}
