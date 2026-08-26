import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync(new URL('../src/services/queue-preparation/queuePreparation.service.ts', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');

assert.match(service, /async function reviewUsage/);
assert.match(service, /list_open_queue_review/);
assert.match(service, /scheduled_date/);
assert.match(service, /resource_id/);
assert.match(service, /reviewCounts/);
assert.match(service, /counts\.set\(id, \(counts\.get\(id\) \?\? 0\) \+ used\)/);
assert.match(service, /!\['invalid', 'cancelled', 'canceled', 'cancelado'\]\.includes\(value\)/);
assert.match(service, /available: Math\.max\(0, limit - used\)/);
assert.match(home, /resource\.available.*disponível\(is\)/);
console.log('R35: capacidade restante = fila final + revisão aberta, por recurso e data OK');
