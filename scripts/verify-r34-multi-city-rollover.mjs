import assert from 'node:assert/strict';
import fs from 'node:fs';

const extension = fs.readFileSync(new URL('../server/routes/maps/extension.ts', import.meta.url), 'utf8');
const rollover = fs.readFileSync(new URL('../supabase/migrations/20260826033000_r34_pending_queue_rollover.sql', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/queue-rollover/queueRollover.service.ts', import.meta.url), 'utf8');
const review = fs.readFileSync(new URL('../src/services/queue-review/queueReview.service.ts', import.meta.url), 'utf8');

assert.match(extension, /citySelectionMode/);
assert.match(extension, /selectedCityIds/);
assert.match(extension, /maps_multiple_cities_limit/);
assert.match(extension, /selection\.mode === 'multiple'/);
assert.match(rollover, /rollover_pending_queue_work/);
assert.match(rollover, /review_status='open'/);
assert.match(rollover, /status_id = ANY\(v_pending_ids \|\| v_paused_ids\)/);
assert.doesNotMatch(rollover, /status_id\s*=\s*5/);
assert.match(service, /rollover_pending_queue_work/);
assert.match(review, /queueRolloverService\.run\(\)/);
console.log('R34: multi-city + pending queue rollover contracts OK');
