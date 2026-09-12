import type { DispatchChannelSettings, DispatchSettings } from './types';

function integer(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeChannel(input: Partial<DispatchChannelSettings> | undefined, fallback: DispatchChannelSettings): DispatchChannelSettings {
  const dailyLimit = integer(input?.dailyLimit, fallback.dailyLimit);
  const batches = integer(input?.batches, fallback.batches);
  const perBatch = integer(input?.perBatch, Math.max(1, Math.floor(dailyLimit / Math.max(1, batches))));

  return {
    ...fallback,
    ...input,
    delayMinSeconds: integer(input?.delayMinSeconds, fallback.delayMinSeconds),
    delayMaxSeconds: integer(input?.delayMaxSeconds, fallback.delayMaxSeconds),
    perBatch,
    batches,
    batchDelayMinutes: integer(input?.batchDelayMinutes, fallback.batchDelayMinutes),
    dailyLimit,
    batchBehavior: String(input?.batchBehavior ?? fallback.batchBehavior).trim() || fallback.batchBehavior,
  };
}

function assertChannel(label: string, channel: DispatchChannelSettings) {
  if (channel.delayMinSeconds < 10 || channel.delayMaxSeconds < channel.delayMinSeconds) {
    throw new Error(`${label}: o delay maximo deve ser maior ou igual ao minimo, e ambos devem ser de pelo menos 10 segundos.`);
  }
  if (channel.dailyLimit < 1 || channel.dailyLimit > 10000) throw new Error(`${label}: o limite diario deve estar entre 1 e 10000.`);
  if (channel.batches < 1 || channel.batches > 100) throw new Error(`${label}: a quantidade de lotes deve estar entre 1 e 100.`);
  if (channel.perBatch < 1 || channel.perBatch > channel.dailyLimit) throw new Error(`${label}: o tamanho do lote e invalido.`);
  if (channel.batchDelayMinutes < 0 || channel.batchDelayMinutes > 1440) throw new Error(`${label}: a espera entre lotes e invalida.`);
}

export function normalizeDispatchSettingsStrict(input: DispatchSettings, fallback: DispatchSettings): DispatchSettings {
  const whatsapp = normalizeChannel(input.whatsapp, fallback.whatsapp);
  const instagramBase = normalizeChannel(input.instagram, fallback.instagram);
  const profiles = [...new Set((input.instagram.profiles ?? fallback.instagram.profiles).map((item) => String(item).replace(/^@/, '').trim()).filter(Boolean))];
  const instagram = {
    ...instagramBase,
    profile: String(input.instagram.profile ?? profiles[0] ?? fallback.instagram.profile).replace(/^@/, '').trim(),
    profiles,
    delayMinutes: integer(input.instagram.delayMinutes, fallback.instagram.delayMinutes),
  };

  const chipLevels = Object.fromEntries(Object.entries(input.chipLevels ?? {}).map(([level, preset]) => {
    const dailyLimit = integer(preset.dailyLimit, 1);
    const batchCount = integer(preset.batchCount, 1);
    if (dailyLimit < 1 || dailyLimit > 10000) throw new Error(`Nivel ${level}: limite diario invalido.`);
    if (batchCount < 1 || batchCount > 100) throw new Error(`Nivel ${level}: quantidade de lotes invalida.`);
    return [level, { dailyLimit, batchCount }];
  }));

  const normalized = { whatsapp, instagram, chipLevels };
  assertChannel('WhatsApp', normalized.whatsapp);
  assertChannel('Instagram', normalized.instagram);
  if (normalized.instagram.delayMinutes < 0 || normalized.instagram.delayMinutes > 1440) {
    throw new Error('Instagram: o intervalo operacional em minutos e invalido.');
  }
  return normalized;
}
