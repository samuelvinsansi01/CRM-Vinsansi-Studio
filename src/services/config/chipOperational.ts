import type { ChipConfigRecord } from './types';

export type ChipLevelPreset = {
  dailyLimit: number;
  batchCount: number;
  intervalSeconds: number;
  batches: string[];
  startTime: string;
  endTime: string;
};

export type ResolvedChipLevelPreset = ChipLevelPreset & {
  blockSize: number;
};

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
    batchCount: 1,
    intervalSeconds: 180,
    batches: ['08:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  'aquecimento-inicial': {
    dailyLimit: 80,
    batchCount: 2,
    intervalSeconds: 150,
    batches: ['08:00', '12:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  estabilizado: {
    dailyLimit: 120,
    batchCount: 3,
    intervalSeconds: 120,
    batches: ['08:00', '11:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  maduro: {
    dailyLimit: 160,
    batchCount: 4,
    intervalSeconds: 90,
    batches: ['08:00', '10:00', '12:00', '14:00'],
    startTime: '08:00',
    endTime: '18:00',
  },
  operacional: {
    dailyLimit: 200,
    batchCount: 5,
    intervalSeconds: 75,
    batches: ['08:00', '09:30', '11:00', '12:30', '14:00'],
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

function computeBlockSize(preset: Pick<ChipLevelPreset, 'dailyLimit' | 'batchCount'>) {
  const batchCount = Math.max(1, Number(preset.batchCount || 1));
  return Math.max(1, Math.floor(Number(preset.dailyLimit || 1) / batchCount));
}

export function chipInstance(chip: Pick<ChipConfigRecord, 'instance' | 'name'>) {
  return String(chip.instance ?? chip.name ?? '').trim();
}

const CONNECTION_OPEN_STATES = ['open', 'opened', 'connected', 'connectado', 'conectado', 'online', 'ready'];
const CONNECTION_CLOSED_STATES = ['inativo', 'offline', 'pausado', 'paused', 'closed', 'close', 'disconnected', 'disconnect', 'error', 'erro'];

function connectionStateToken(chip: Pick<ChipConfigRecord, 'connectionStatus' | 'status'>) {
  return normalizeComparable(chip.connectionStatus || chip.status);
}

export function isChipConnectionOpen(chip: Pick<ChipConfigRecord, 'connectionStatus' | 'status' | 'active' | 'paused'>) {
  const state = connectionStateToken(chip);
  if (!state) return Boolean(chip.active && !chip.paused);
  if (CONNECTION_CLOSED_STATES.includes(state)) return false;
  if (CONNECTION_OPEN_STATES.includes(state)) return true;
  if (state === 'ativo') return Boolean(chip.active && !chip.paused);
  if (state === 'inativo') return false;
  return Boolean(chip.active && !chip.paused);
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
  const state = connectionStateToken(chip);
  if (!state) return 'Ativo';
  if (CONNECTION_CLOSED_STATES.includes(state)) return 'Offline';
  if (CONNECTION_OPEN_STATES.includes(state) || state === 'ativo') return 'Ativo';
  return 'Ativo';
}



function levelByName(level: string) {
  const normalized = normalizeComparable(level);
  return Object.entries(CHIP_LEVEL_LIMITS).find(([key]) => normalizeComparable(key) === normalized)?.[0];
}

function batchesSignature(batches: string[]) {
  return batches.map((batch) => normalizeComparable(batch)).join('|');
}

function presetMatches(
  preset: ChipLevelPreset,
  candidate: Pick<ChipLevelPreset, 'dailyLimit' | 'batchCount' | 'intervalSeconds' | 'batches' | 'startTime' | 'endTime'>,
) {
  const candidateBatches = candidate.batches ?? [];
  return (
    Number(candidate.dailyLimit ?? 0) === Number(preset.dailyLimit ?? 0) &&
    Number(candidate.batchCount ?? 0) === Number(preset.batchCount ?? 0) &&
    Number(candidate.intervalSeconds ?? 0) === Number(preset.intervalSeconds ?? 0) &&
    batchesSignature(candidateBatches) === batchesSignature(preset.batches) &&
    normalizeComparable(candidate.startTime ?? '') === normalizeComparable(preset.startTime ?? '') &&
    normalizeComparable(candidate.endTime ?? '') === normalizeComparable(preset.endTime ?? '')
  );
}

export function inferChipLevelFromConfig(
  chip: Partial<Pick<ChipLevelPreset, 'dailyLimit' | 'batchCount' | 'intervalSeconds' | 'batches' | 'startTime' | 'endTime'>> & { level?: string },
  overrides?: Record<string, Partial<ChipLevelPreset>>,
) {
  const explicit = levelByName(chip.level ?? '');
  if (explicit) {
    const explicitPreset = chipLevelDefaults(explicit, overrides);
    if (presetMatches(explicitPreset, {
      dailyLimit: chip.dailyLimit ?? explicitPreset.dailyLimit,
      batchCount: chip.batchCount ?? explicitPreset.batchCount,
      intervalSeconds: chip.intervalSeconds ?? explicitPreset.intervalSeconds,
      batches: chip.batches ?? explicitPreset.batches,
      startTime: chip.startTime ?? explicitPreset.startTime,
      endTime: chip.endTime ?? explicitPreset.endTime,
    })) {
      return explicit;
    }
  }

  for (const level of Object.keys(CHIP_LEVEL_LIMITS)) {
    const resolved = chipLevelDefaults(level, overrides);
    if (presetMatches(resolved, {
      dailyLimit: chip.dailyLimit ?? resolved.dailyLimit,
      batchCount: chip.batchCount ?? resolved.batchCount,
      intervalSeconds: chip.intervalSeconds ?? resolved.intervalSeconds,
      batches: chip.batches ?? resolved.batches,
      startTime: chip.startTime ?? resolved.startTime,
      endTime: chip.endTime ?? resolved.endTime,
    })) {
      return level;
    }
  }

  return explicit ?? 'estabilizado';
}

export function chipLevelDefaults(level: string, overrides?: Record<string, Partial<ChipLevelPreset>>): ResolvedChipLevelPreset {
  const base = CHIP_LEVEL_LIMITS[level] ?? CHIP_LEVEL_LIMITS.estabilizado;
  const override = overrides?.[level] ?? {};
  const resolved: ChipLevelPreset = {
    ...base,
    ...override,
    batchCount: Number(override.batchCount ?? base.batchCount ?? 1),
    batches: override.batches?.length ? override.batches : base.batches,
  };

  return {
    ...resolved,
    blockSize: computeBlockSize(resolved),
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
