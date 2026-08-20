import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const sources = [
  read('api/chat/send.ts'),
  read('supabase/functions/evolution-instance-sync/index.ts'),
  read('src/services/whatsapp-queue/whatsapp.evolution.gateway.ts'),
].join('\n');
for (const token of ['/v1/whatsapp/instances/','/messages/text','/status','/webhook','/numbers/check']) {
  if (!sources.includes(token)) throw new Error(`v1_contract_missing:${token}`);
}
for (const legacy of ['/message/sendText/','/message/sendMedia/','/chat/whatsappNumbers/','/instance/connectionState/','/webhook/find/','/webhook/set/']) {
  if (sources.includes(legacy)) throw new Error(`legacy_contract_present:${legacy}`);
}
console.log('CRM patch usa o contrato estável Vinsansi Gateway v1: OK');
