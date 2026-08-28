import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260828223000_r54_fast_scheduled_queue_pull.sql', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');

// R54 consolidou a antiga soma feita no frontend em uma leitura set-based no banco.
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_queue_review_resources/);
assert.match(migration, /final_usage AS/);
assert.match(migration, /review_usage AS/);
assert.match(migration, /i\.review_status='open'/);
assert.match(migration, /b\.resource_id AS rid/);
assert.match(migration, /b\.scheduled_date=v_date/);
assert.match(migration, /greatest\(0,coalesce\(l\.levels_daily_limit,0\)-coalesce\(fu\.qty,0\)-coalesce\(ru\.qty,0\)\)/);
assert.match(migration, /'missingCount',greatest\(0,coalesce\(v_capacity\.available,0\)-coalesce\(v_review_open,0\)\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.queue_review_resource_capacity/);
assert.match(home, /resource\.available.*disponível\(is\)/);
console.log('R35: capacidade restante = fila final + revisão aberta, por recurso e data, calculada no banco OK');
