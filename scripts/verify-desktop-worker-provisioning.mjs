import fs from 'node:fs';
const source = fs.readFileSync(new URL('../api/desktop/worker-provision.ts', import.meta.url), 'utf8');
const required = [
  'DESKTOP_WORKER_PROVISIONING_ENABLED',
  'DESKTOP_WORKER_PROVISIONING_ALLOWED_EMAILS',
  'DESKTOP_CLOUDFLARE_TUNNEL_TOKEN',
  'encryptedCloudflareTunnelToken',
  'RSA-OAEP',
  'host.docker.internal:8080',
  'lead-certo-whatsapp-worker:8787',
  'cloudflare/cloudflared:2026.7.3',
];
for (const item of required) if (!source.includes(item)) throw new Error(`missing:${item}`);
if (source.includes('credentials_json') || source.includes('service_get_desktop_tunnel_credential')) throw new Error('legacy-local-tunnel-code-present');
console.log('worker provisioning v0.7.0 ok');
