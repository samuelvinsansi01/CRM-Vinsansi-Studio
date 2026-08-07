import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const worker = read('../../worker/src/worker.js');
const dispatchApi = read('../api/whatsapp/dispatch.ts');
const batchApi = read('../api/whatsapp/batch.ts');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : '';
}

const scheduler = sliceBetween(worker, 'async function schedulerTick()', 'async function sendWorkerHeartbeat');
const httpHandler = sliceBetween(worker, 'const server = createServer', 'server.listen');
const directWorkerRoute = sliceBetween(httpHandler, "req.url === '/dispatch/whatsapp'", "req.url === '/batch/whatsapp/start'");

assert(directWorkerRoute.length > 0, 'Rota direta do Worker não foi localizada.');
assert(directWorkerRoute.includes('reply(res, 410'), 'Rota direta do Worker não retorna HTTP 410 Gone.');
assert(directWorkerRoute.includes('batch/scheduler') && directWorkerRoute.includes('/batch/whatsapp/start'), 'Rota direta do Worker não orienta usar batch/scheduler.');
assert(!directWorkerRoute.includes('dispatchOne('), 'Rota direta do Worker ainda chama dispatchOne().');
assert(!httpHandler.includes('dispatchOne('), 'Um handler HTTP do Worker ainda chama dispatchOne() diretamente.');
assert(scheduler.includes('dispatchOne('), 'schedulerTick deixou de chamar dispatchOne().');

assert(dispatchApi.includes('await auth(req)') && dispatchApi.indexOf('await auth(req)') < dispatchApi.indexOf('send(res,410'), 'API descontinuada não autentica antes de responder.');
assert(dispatchApi.includes('send(res,410'), 'API Vercel direta não retorna HTTP 410 Gone.');
assert(dispatchApi.includes('/api/whatsapp/batch'), 'API Vercel direta não orienta usar /api/whatsapp/batch.');
assert(!dispatchApi.includes('callWorker') && !dispatchApi.includes('WHATSAPP_WORKER_DISPATCH_URL') && !dispatchApi.includes('fetch('), 'API Vercel direta ainda encaminha requisições ao Worker.');

for (const endpoint of ['start', 'pause', 'resume', 'stop']) {
  assert(httpHandler.includes(`'/batch/whatsapp/${endpoint}'`), `Endpoint persistente ${endpoint} foi removido do Worker.`);
  assert(batchApi.includes(`'${endpoint}'`), `API de batch deixou de aceitar ${endpoint}.`);
}
assert(httpHandler.includes("'/batch/whatsapp/status'") && httpHandler.includes("'/batch/whatsapp/state'"), 'Endpoints persistentes de status/state foram removidos do Worker.');
assert(batchApi.includes("'state','status'"), 'API de batch deixou de aceitar status/state.');

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('WhatsApp direct dispatch disabled: OK');
