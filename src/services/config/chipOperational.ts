import type { ChipConfigRecord } from './types';

export type ChipLevelPreset = Pick<ChipConfigRecord, 'dailyLimit' | 'blockSize' | 'intervalSeconds' | 'batches' | 'startTime' | 'endTime'>;

export const CHIP_LEVEL_OPTIONS = [
  { label: 'Recem ativado', value: 'recem-ativado' },
  { label: 'Aquecimento inicial', value: 'aquecimento-inicial' },
  { label: 'Estabilizado', value: 'estabilizado' },
  { label: 'Maduro', value: 'maduro' },
  { label: 'Operacional', value: 'operacional' },
];

export const CHIP_LEVEL_LIMITS: Record<string, ChipLevelPreset> = {
  'recem-ativado': {
    dailyLimit: 40,
    blockSize: 10,
    intervalSeconds: 180,
    batches: ['08:00', '10:00', '12:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  'aquecimento-inicial': {
    dailyLimit: 80,
    blockSize: 20,
    intervalSeconds: 150,
    batches: ['08:00', '10:00', '12:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  estabilizado: {
    dailyLimit: 120,
    blockSize: 30,
    intervalSeconds: 120,
    batches: ['08:00', '10:00', '12:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  maduro: {
    dailyLimit: 160,
    blockSize: 40,
    intervalSeconds: 90,
    batches: ['08:00', '10:00', '12:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  operacional: {
    dailyLimit: 200,
    blockSize: 50,
    intervalSeconds: 75,
    batches: ['08:00', '10:00', '12:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
};

function normalizeComparable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function chipInstance(chip: Pick<ChipConfigRecord, 'instance' | 'name'>) {
  return String(chip.instance ?? chip.name ?? '').trim();
}

export function isChipConnectionOpen(chip: Pick<ChipConfigRecord, 'connectionStatus' | 'status'>) {
  const status = normalizeComparable(chip.connectionStatus || chip.status);
  if (!status) return false;
  if (['inativo', 'offline', 'pausado', 'paused', 'closed', 'close', 'disconnected', 'disconnect', 'error', 'erro'].includes(status)) return false;
  return ['open', 'opened', 'connected', 'conectado', 'online', 'ready'].includes(status);
}

export function isOperationalWhatsAppChip(chip: ChipConfigRecord) {
  return Boolean(
    chip.active &&
      chip.status !== 'Arquivado' &&
      chip.status !== 'deleted' &&
      !chip.paused &&
      chipInstance(chip) &&
      isChipConnectionOpen(chip),
  );
}

export function chipStatusLabel(chip: ChipConfigRecord) {
  if (chip.status === 'deleted') return 'Excluido';
  if (chip.status === 'Arquivado') return 'Arquivado';
  if (!chip.active) return 'Inativo';
  if (chip.paused) return 'Pausado';
  if (!chipInstance(chip)) return 'Sem instancia';
  if (!isChipConnectionOpen(chip)) return 'Offline';
  return 'Ativo';
}

export function chipLevelDefaults(level: string, overrides?: Record<string, Partial<ChipLevelPreset>>) {
  const base = CHIP_LEVEL_LIMITS[level] ?? CHIP_LEVEL_LIMITS.estabilizado;
  const override = overrides?.[level];
  if (!override) return base;
  return {
    ...base,
    ...override,
    batches: override.batches?.length ? override.batches : base.batches,
  };
}

export function resolveChipOperationalConfig(
  chip: Pick<ChipConfigRecord, 'instance' | 'name' | 'level' | 'dailyLimit' | 'blockSize' | 'intervalSeconds' | 'batches' | 'startTime' | 'endTime'>,
  overrides?: Record<string, Partial<ChipLevelPreset>>,
) {
  const preset = chipLevelDefaults(chip.level, overrides);
  return {
    ...chip,
    ...preset,
  };
}

