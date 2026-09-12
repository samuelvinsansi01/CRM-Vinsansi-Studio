import { CHIP_LEVEL_LIMITS } from '../config/chipOperational';
import type { DispatchSettings } from './types';

export const defaultWhatsAppDispatchSettings: DispatchSettings['whatsapp'] = {
  delayMinSeconds: 120,
  delayMaxSeconds: 120,
  perBatch: 60,
  batches: 2,
  batchDelayMinutes: 60,
  dailyLimit: 120,
  batchBehavior: 'Respeitar lotes e limites',
};

export const defaultInstagramDispatchSettings: DispatchSettings['instagram'] = {
  profile: 'Todos',
  profiles: ['Todos'],
  delayMinSeconds: 120,
  delayMaxSeconds: 120,
  perBatch: 15,
  batches: 4,
  batchDelayMinutes: 120,
  delayMinutes: 120,
  dailyLimit: 60,
  batchBehavior: 'Respeitar lotes e limites',
};

export const defaultDispatchSettings: DispatchSettings = {
  whatsapp: defaultWhatsAppDispatchSettings,
  instagram: defaultInstagramDispatchSettings,
  chipLevels: CHIP_LEVEL_LIMITS,
};
