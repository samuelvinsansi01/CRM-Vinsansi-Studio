import { CHIP_LEVEL_LIMITS } from '../config/chipOperational';
import type { DispatchSettings } from './types';

export const DEFAULT_ACTIVE_DAYS = ['Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta'];

export const defaultWhatsAppDispatchSettings: DispatchSettings['whatsapp'] = {
  startTime: '13:00',
  endTime: '18:00',
  delayMinSeconds: 120,
  delayMaxSeconds: 120,
  perBatch: 60,
  batches: 2,
  batchDelayMinutes: 60,
  dailyLimit: 120,
  activeDays: DEFAULT_ACTIVE_DAYS,
  batchBehavior: 'Respeitar lotes e janela',
};

export const defaultInstagramDispatchSettings: DispatchSettings['instagram'] = {
  profile: 'Todos',
  profiles: ['Todos'],
  startTime: '13:00',
  endTime: '18:00',
  delayMinSeconds: 120,
  delayMaxSeconds: 120,
  perBatch: 15,
  batches: 4,
  batchDelayMinutes: 120,
  delayMinutes: 120,
  dailyLimit: 60,
  activeDays: DEFAULT_ACTIVE_DAYS,
  batchBehavior: 'Respeitar lotes e janela',
};

export const defaultDispatchSettings: DispatchSettings = {
  whatsapp: defaultWhatsAppDispatchSettings,
  instagram: defaultInstagramDispatchSettings,
  chipLevels: CHIP_LEVEL_LIMITS,
};
