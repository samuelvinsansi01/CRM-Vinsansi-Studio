import fs from 'node:fs';
const source = fs.readFileSync(new URL('../api/desktop/worker-provision.ts', import.meta.url), 'utf8');
const required = [
  'DESKTOP_WORKER_PROVISIONING_ENABLED',
  'DESKTOP_WORKER_PROVISIONING_ALLOWED_EMAILS',
  'DESKTOP_CLOUDFLARE_TUNNEL_TOKEN',
  'encryptedCloudflareTunnelToken',
  'RSA-OAEP',
  '42e52d34-34e7-4f2d-a626-4f550500b610',
  'vinsansi-docker',
  'host.docker.internal:8080',
  'lead-certo-whatsapp-worker:8787',
  'cloudflare/cloudflared:2026.7.3',
  'version: 5',
  'evolutionOperatorEmail: email',
];
for (const item of required) if (!source.includes(item)) throw new Error(`missing:${item}`);
if (source.includes('credentials_json') || source.includes('service_get_desktop_tunnel_credential')) throw new Error('legacy-local-tunnel-code-present');
if (source.includes('1886e172-0796-49af-8e88-ffa7fc206fbc')) throw new Error('old-tunnel-id-present');
if (source.includes('evolutionGlobalApiKey') || source.includes('evolutionPostgresPassword')) throw new Error('evolution_local_secret_leaked');
console.log('worker provisioning v1.0.0 / Evolution Go: OK');
