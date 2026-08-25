import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = readFileSync(join(root, 'tests/stage11-r21-fixture.sql'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260825170000_r21_stage11_observability_recovery_hardening.sql'), 'utf8');
const integration = readFileSync(join(root, 'tests/stage11-r21-integration.sql'), 'utf8');
const name = `codex-stage11-r21-${process.pid}`;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

function psql(sql) {
  return docker(['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'stage11'], { input: sql });
}

try {
  docker(['run', '--name', name, '-e', 'POSTGRES_PASSWORD=stage11', '-e', 'POSTGRES_DB=stage11', '-d', 'postgres:15-alpine']);
  let ready = false;
  let consecutiveReady = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // A imagem oficial sobe um servidor temporário e o reinicia durante initdb.
    // Exigimos duas consultas SQL consecutivas para não confundir esse servidor
    // transitório com a instância final.
    const probe = spawnSync('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'stage11', '-Atqc', 'select 1'], { encoding: 'utf8' });
    consecutiveReady = probe.status === 0 && probe.stdout.trim() === '1' ? consecutiveReady + 1 : 0;
    if (consecutiveReady >= 2) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  assert.equal(ready, true, 'PostgreSQL de teste não ficou pronto.');
  psql(fixture);
  psql(migration);
  const output = psql(integration);
  assert.match(output, /stage11_r21_integration_pass/);
  console.log('Etapa 11 R21 PostgreSQL integration: PASS');
} finally {
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
}
