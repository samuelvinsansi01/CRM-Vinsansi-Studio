export const BRAZIL_STATE_NAMES: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

function normalizeComparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const NAME_TO_STATE = new Map<string, string>(
  Object.values(BRAZIL_STATE_NAMES).map((state) => [normalizeComparable(state), state]),
);

const ALIASES: Record<string, string> = {
  ceara: 'Ceará',
  goias: 'Goiás',
  maranhao: 'Maranhão',
  para: 'Pará',
  paraiba: 'Paraíba',
  parana: 'Paraná',
  piaui: 'Piauí',
  rondonia: 'Rondônia',
  'rio grande sul': 'Rio Grande do Sul',
  'rio grande norte': 'Rio Grande do Norte',
  'mato grosso sul': 'Mato Grosso do Sul',
  'espirito santo': 'Espírito Santo',
  'sao paulo': 'São Paulo',
};

Object.entries(ALIASES).forEach(([alias, state]) => {
  NAME_TO_STATE.set(normalizeComparable(alias), state);
});

export function normalizeBrazilState(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const uf = raw.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (uf.length === 2 && BRAZIL_STATE_NAMES[uf]) return BRAZIL_STATE_NAMES[uf];

  const normalized = normalizeComparable(raw);
  return NAME_TO_STATE.get(normalized) ?? raw;
}

export const BRAZIL_STATE_OPTIONS = Object.entries(BRAZIL_STATE_NAMES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
