import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDirectory = path.join(root, 'data', 'canonical-locations');
const migrationName = '20260812120000_seed_canonical_locations.sql';
const previousMigrationName = '20260812110000_restore_base_rls_policies.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sourceHashes = {
  'countries.json': '812e632702a34e47546951ae0fc46bd804a26d63d32b7e1d5e1760ef9665185f',
  'states.json': 'd366ca2472f889a5abc32a241ce3aa11a616fad8bc0d4e08eb97668c5557c9af',
  'cities.json': '2bd69d4d8ab748042ba4e0b263b5e52c843ecd1aac44701985db48d5bc98af9b',
};

for (const [fileName, expectedHash] of Object.entries(sourceHashes)) {
  const filePath = path.join(sourceDirectory, fileName);
  assert(fs.existsSync(filePath), `Fonte canônica ausente: ${fileName}.`);
  if (fs.existsSync(filePath)) {
    assert(digest(fs.readFileSync(filePath)) === expectedHash, `Fonte canônica alterada: ${fileName}.`);
  }
}

assert(fs.existsSync(migrationPath), `Migration ausente: ${migrationName}.`);

const countries = JSON.parse(read(path.join(sourceDirectory, 'countries.json')));
const states = JSON.parse(read(path.join(sourceDirectory, 'states.json')));
const cities = JSON.parse(read(path.join(sourceDirectory, 'cities.json')));
const sql = read(migrationPath);
const executableSql = sql.replace(/--.*$/gm, '');
const normalizedSql = executableSql.toLowerCase().replace(/\s+/g, ' ').trim();

const sqlUnescape = (value) => value.replaceAll("''", "'");
const block = (start, end) => {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex + start.length);
  return startIndex < 0 || endIndex < 0 ? '' : sql.slice(startIndex + start.length, endIndex);
};

const countryBlock = block(
  'INSERT INTO canonical_countries(countries_id, countries_name, countries_code) VALUES',
  'CREATE TEMP TABLE canonical_states',
);
const stateBlock = block(
  'INSERT INTO canonical_states(states_id, countries_id, states_name, states_code) VALUES',
  'CREATE TEMP TABLE canonical_cities',
);
const cityBlock = block(
  'INSERT INTO canonical_cities(cities_id, states_id, cities_name) VALUES',
  'DO $seed$',
);

const migrationCountries = [...countryBlock.matchAll(/\((\d+),\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)'\)/g)].map((match) => ({
  countries_id: Number(match[1]),
  countries_name: sqlUnescape(match[2]),
  countries_code: sqlUnescape(match[3]),
}));
const migrationStates = [...stateBlock.matchAll(/\((\d+),\s*(\d+),\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)'\)/g)].map((match) => ({
  states_id: Number(match[1]),
  countries_id: Number(match[2]),
  states_name: sqlUnescape(match[3]),
  states_code: sqlUnescape(match[4]),
}));
const migrationCities = [...cityBlock.matchAll(/\((\d+),\s*(\d+),\s*'((?:''|[^'])*)'\)/g)].map((match) => ({
  cities_id: Number(match[1]),
  states_id: Number(match[2]),
  cities_name: sqlUnescape(match[3]),
}));

assert(countries.length === 1, `countries.json deve conter 1 registro; contém ${countries.length}.`);
assert(states.length === 27, `states.json deve conter 27 registros; contém ${states.length}.`);
assert(cities.length === 5571, `cities.json deve conter 5.571 registros; contém ${cities.length}.`);
assert(JSON.stringify(migrationCountries) === JSON.stringify(countries), 'País da migration diverge de countries.json.');
assert(JSON.stringify(migrationStates) === JSON.stringify(states), 'Estados da migration divergem de states.json.');
assert(JSON.stringify(migrationCities) === JSON.stringify(cities), 'Cidades da migration divergem de cities.json.');

assert(countries.some((country) => country.countries_id === 1 && country.countries_name === 'Brasil' && country.countries_code === 'BR'), 'Brasil (countries_id=1, BR) ausente.');
assert(states.every((state, index) => state.states_id === index + 1), 'IDs de estados não cobrem exatamente 1..27.');
assert(cities.every((city, index) => city.cities_id === index + 1), 'IDs de cidades não cobrem exatamente 1..5571.');
assert(cities[0]?.cities_id === 1 && cities[0]?.cities_name === 'Acrelândia', 'cities_id=1 deve ser Acrelândia.');
assert(cities.at(-1)?.cities_id === 5571 && cities.at(-1)?.cities_name === 'Xambioá', 'cities_id=5571 deve ser Xambioá.');

const countryIds = new Set(countries.map((country) => country.countries_id));
const stateIds = new Set(states.map((state) => state.states_id));
assert(states.every((state) => countryIds.has(state.countries_id)), 'Existe estado sem país canônico.');
assert(cities.every((city) => stateIds.has(city.states_id)), 'Existe cidade sem estado canônico.');
assert(new Set(countries.map((country) => country.countries_code)).size === countries.length, 'countries.json contém código duplicado.');
assert(new Set(states.map((state) => `${state.countries_id}|${state.states_code}`)).size === states.length, 'states.json contém código duplicado dentro do país.');
assert(new Set(cities.map((city) => `${city.states_id}|${city.cities_name}`)).size === cities.length, 'cities.json contém nome duplicado dentro do estado.');

assert(normalizedSql.startsWith('begin;') && normalizedSql.endsWith('commit;'), 'Migration deve ser transacional.');
assert(!normalizedSql.includes('on conflict'), 'Migration não deve sobrescrever divergências com ON CONFLICT.');
assert(normalizedSql.includes('existing country id differs from the canonical seed'), 'Migration não aborta país divergente pelo mesmo ID.');
assert(normalizedSql.includes('existing state id differs from the canonical seed'), 'Migration não aborta estado divergente pelo mesmo ID.');
assert(normalizedSql.includes('existing city id differs from the canonical seed'), 'Migration não aborta cidade divergente pelo mesmo ID.');
assert((normalizedSql.match(/where not exists/g) ?? []).length === 3, 'Inserções idempotentes por ID não cobrem os três catálogos.');
assert(!/\b(?:update|delete from|truncate)\s+public\./i.test(executableSql), 'Migration altera ou remove dados públicos existentes.');
assert(!/\b(?:alter table|create policy|drop policy|grant|revoke)\b/i.test(executableSql), 'Migration altera schema, RLS, policies ou grants.');

const publicWrites = [...executableSql.matchAll(/\binsert\s+into\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
assert(JSON.stringify(publicWrites.sort()) === JSON.stringify(['cities', 'countries', 'states']), 'Migration escreve fora de countries, states e cities.');
for (const table of ['countries', 'states', 'cities']) {
  assert(normalizedSql.includes(`pg_get_serial_sequence('public.${table}', '${table}_id')`), `Identity sequence de ${table} não é detectada.`);
  assert(normalizedSql.includes(`max(${table}_id)`), `Identity sequence de ${table} não é ajustada ao maior ID existente.`);
}

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
assert(migrations.indexOf(migrationName) > migrations.indexOf(previousMigrationName), `${migrationName} deve aparecer depois de ${previousMigrationName}.`);

const packageJson = JSON.parse(read(path.join(root, 'package.json')));
assert(packageJson.scripts?.['verify:canonical-locations'] === 'node scripts/verify-canonical-location-seed.mjs', 'Verificador não foi registrado no package.json.');
assert(packageJson.scripts?.['verify:all']?.includes('verify:canonical-locations'), 'verify:all não inclui o verificador de localidades.');

if (failures.length) {
  console.error(`Falhas no seed canônico de localização (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: seed canônico contém Brasil, 27 estados e 5.571 cidades com IDs e vínculos preservados.');
console.log('OK: migration é transacional, idempotente e não escreve em dados operacionais.');
