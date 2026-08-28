import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/evolution-instance-sync/index.ts'), 'utf8');
const requiredHeader = 'authorization, x-client-info, apikey, content-type, x-vinsansi-organization-id';
if (!source.includes(`\"Access-Control-Allow-Headers\": \"${requiredHeader}\"`)) {
  throw new Error('R51: evolution-instance-sync nao permite x-vinsansi-organization-id no CORS.');
}
if (!source.includes('request.headers.get(\"x-vinsansi-organization-id\")')) {
  throw new Error('R51: evolution-instance-sync deixou de consumir o contexto de organizacao.');
}
console.log('R51 evolution-instance-sync organization CORS guard: ok');
