import type { WhatsAppGateway, WhatsAppGatewayResult } from './whatsapp.gateway';
import type { WhatsAppQueueLead } from './types';

function envFlag(value: unknown, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

function processEnvValue(key: string) {
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return processLike?.env?.[key];
}

function processEnvValueAny(...keys: string[]) {
  for (const key of keys) {
    const value = processEnvValue(key);
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

function evolutionConfig() {
  const baseUrl = processEnvValueAny('EVOLUTION_API_URL').replace(/\/$/, '');
  const apiKey = processEnvValueAny('EVOLUTION_API_KEY');
  return {
    enabled: envFlag(processEnvValueAny('USE_EVOLUTION'), false) && Boolean(baseUrl && apiKey),
    baseUrl,
    apiKey,
    instancePrefix: processEnvValueAny('EVOLUTION_INSTANCE_PREFIX'),
    delayMs: Number(processEnvValueAny('EVOLUTION_MESSAGE_DELAY_MS') || 0),
    testMode: envFlag(processEnvValueAny('WORKER_TEST_MODE'), false),
    testPhone: processEnvValueAny('TEST_PHONE').replace(/\D/g, ''),
    dryRun: envFlag(processEnvValueAny('DRY_RUN'), false),
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function phoneForEvolution(lead: WhatsAppQueueLead) {
  const config = evolutionConfig();
  const original = (lead.phone_normalized || lead.phone || '').replace(/\D/g, '');
  if (!config.testMode) return original;
  if (!config.testPhone) throw new Error('WORKER_TEST_MODE ativo sem TEST_PHONE configurado.');
  return config.testPhone;
}

function instanceForLead(lead: WhatsAppQueueLead) {
  return String(lead.chip_instance || lead.chip || '').trim();
}

async function requestEvolution(path: string, init: RequestInit = {}) {
  const config = evolutionConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.response?.message || payload?.message || payload?.error || response.statusText || 'Erro Evolution API';
    throw new Error(Array.isArray(message) ? message.flat(Infinity).join(', ') : String(message));
  }
  return payload;
}

function connectionState(payload: unknown) {
  const record = payload as { state?: string; instance?: { state?: string }; connection?: string; status?: string };
  return String(record?.state ?? record?.instance?.state ?? record?.connection ?? record?.status ?? '').toLowerCase();
}

async function assertConnected(instance: string) {
  const payload = await requestEvolution(`/instance/connectionState/${encodeURIComponent(instance)}`);
  const state = connectionState(payload);
  if (!['open', 'connected', 'connectado', 'conectado'].includes(state)) {
    throw new Error(`Instancia Evolution desconectada: ${instance}`);
  }
}

function isConnectionFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('desconect') ||
    message.includes('connectionstate') ||
    message.includes('not found') ||
    message.includes('404') ||
    message.includes('instance')
  );
}

async function sendText(instance: string, lead: WhatsAppQueueLead, text: string) {
  const number = phoneForEvolution(lead);
  if (!number) throw new Error('Lead sem telefone normalizado.');
  if (!text.trim()) return;
  const config = evolutionConfig();
  if (config.testMode && !config.dryRun && number !== config.testPhone) throw new Error('TEST_MODE bloqueou envio para numero diferente de TEST_PHONE.');
  if (config.dryRun) return;
  await requestEvolution(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ number, textMessage: { text } }),
  });
}

async function sendImage(instance: string, lead: WhatsAppQueueLead) {
  const media = lead.image_url || lead.image_id || '';
  if (!media.trim()) return;
  const number = phoneForEvolution(lead);
  if (!number) throw new Error('Lead sem telefone normalizado.');
  const config = evolutionConfig();
  if (config.testMode && !config.dryRun && number !== config.testPhone) throw new Error('TEST_MODE bloqueou envio para numero diferente de TEST_PHONE.');
  if (config.dryRun) return;
  await requestEvolution(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      mediaMessage: {
        mediatype: 'image',
        media,
        caption: lead.imageName ?? '',
      },
    }),
  });
}

export const evolutionWhatsAppGateway: WhatsAppGateway = {
  async send(leads) {
    const config = evolutionConfig();
    if (!config.enabled) throw new Error('Evolution nao configurada no worker/backend.');

    const results: WhatsAppGatewayResult[] = [];
    const stoppedInstances = new Set<string>();

    for (const lead of leads) {
      const instance = instanceForLead(lead);
      if (stoppedInstances.has(instance)) {
        results.push({ leadId: lead.id, status: 'paused', errorMessage: 'chip desconectado' });
        continue;
      }

      try {
        if (!instance) throw new Error('Chip sem instancia Evolution vinculada.');
        await assertConnected(instance);
        await sendText(instance, lead, lead.message_1 || lead.message1);
        if (config.delayMs) await delay(config.delayMs);
        await sendText(instance, lead, lead.message_2 || lead.message2);
        if (config.delayMs) await delay(config.delayMs);
        await sendImage(instance, lead);
        results.push({ leadId: lead.id, status: 'sent' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro ao enviar WhatsApp.';
        if (isConnectionFailure(error)) stoppedInstances.add(instance);
        results.push({ leadId: lead.id, status: 'error', errorMessage });
      }
    }

    return results;
  },
};
