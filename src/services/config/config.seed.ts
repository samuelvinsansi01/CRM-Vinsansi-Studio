import type { ConfigKind, ConfigRecord } from './types';

export const MOVEIS_PLANEJADOS_KEYWORDS = [
  'marcenaria',
  'marceneiro',
  'moveleiro',
  'moveis planejados',
  'moveis sob medida',
  'movelaria',
  'carpintaria',
  'armarios planejados',
  'cozinhas planejadas',
  'dormitorios planejados',
  'moveis',
];

export const DEFAULT_BRANCH_MIN_RATING = 4;
export const DEFAULT_BRANCH_MIN_REVIEWS = 10;

export const DEFAULT_CHIP_BATCHES = ['08:00', '10:00', '12:00', '14:00'];
export const DEFAULT_CHIP_DAILY_LIMIT = 120;
export const DEFAULT_CHIP_BLOCK_SIZE = 30;
export const DEFAULT_CHIP_INTERVAL_SECONDS = 120;

export const TEMPLATE_TYPES = ['sem-site', 'com-site'] as const;
export const TEMPLATE_CHANNELS = ['WhatsApp', 'Instagram', 'Geral'] as const;

export const DEFAULT_TEMPLATE_MESSAGE_1 = 'Ola, {EMPRESA}! Tudo bem?';
export const DEFAULT_TEMPLATE_MESSAGE_2 = 'Passando para conversar sobre uma oportunidade para sua empresa.';

export const configSeed: Record<ConfigKind, ConfigRecord[]> = {
  chips: [],
  instagram: [],
  branches: [],
  templates: [],
};
