import type { WhatsAppGateway, WhatsAppGatewayResult } from './whatsapp.gateway';
import type { WhatsAppValidationGateway, WhatsAppValidationRequest, WhatsAppValidationResult } from '../whatsapp-validation/whatsappValidation.gateway';
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
    validationDelayMs: Number(processEnvValueAny('EVOLUTION_VALIDATION_DELAY_MS') || 0),
    validationBatchSize: Math.max(1, Number(processEnvValueAny('EVOLUTION_VALIDATION_BATCH_SIZE') || 50)),
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

function phoneForValidation(lead: WhatsAppValidationRequest) {
  const config = evolutionConfig();
  const original = (lead.normalizedPhone || lead.phone || '').replace(/\D/g, '');
  if (!config.testMode) return original;
  if (!config.testPhone) throw new Error('WORKER_TEST_MODE ativo sem TEST_PHONE configurado.');
  return config.testPhone;
}

function instanceForValidation(lead: WhatsAppValidationRequest) {
  return String(lead.chipInstance || '').trim();
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

function validationItems(payload: unknown): Array<Record<string, unknown>> {
  const record = payload as Record<string, unknown>;
  const value = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.response)
      ? record.response
      : Array.isArray(record?.data)
        ? record.data
        : Array.isArray(record?.result)
          ? record.result
          : [];

  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function booleanLike(value: unknown) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(text)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(text)) return false;
  return undefined;
}

function validationResultFromPayload(lead: WhatsAppValidationRequest, payload: unknown, index = 0): WhatsAppValidationResult {
  const number = phoneForValidation(lead);
  const items = validationItems(payload);
  const item = items.find((candidate) => {
    const candidateNumber = String(candidate.number ?? candidate.phone ?? candidate.jid ?? candidate.id ?? '').replace(/\D/g, '');
    return Boolean(candidateNumber) && (candidateNumber.includes(number) || number.includes(candidateNumber));
  }) ?? items[index];

  if (!item) {
    return {
      leadId: lead.id,
      status: 'error',
      valid: false,
      errorMessage: 'Evolution nao retornou resultado para o numero.',
    };
  }

  const exists = item.exists ?? item.valid ?? item.isWhatsapp ?? item.is_whatsapp ?? item.hasWhatsapp ?? item.has_whatsapp;
  const existsBool = booleanLike(exists);
  const jid = String(item.jid ?? item.id ?? item._serialized ?? item.remoteJid ?? '');
  const status = String(item.status ?? item.result ?? '').toLowerCase();
  const valid = existsBool === true || Boolean(jid.includes('@s.whatsapp.net')) || ['valid', 'exists', 'ok'].includes(status);
  const invalid = existsBool === false || ['invalid', 'not_found', 'no_whatsapp', 'not_on_whatsapp'].includes(status);

  if (!valid && !invalid) {
    return {
      leadId: lead.id,
      status: 'error',
      valid: false,
      errorMessage: 'Evolution retornou resposta sem campo exists/valid reconhecido.',
    };
  }

  return {
    leadId: lead.id,
    status: valid ? 'valid' : 'invalid',
    valid,
  };
}

function validationErrorResult(lead: WhatsAppValidationRequest, message: string): WhatsAppValidationResult {
  return {
    leadId: lead.id,
    status: 'error',
    valid: false,
    errorMessage: message,
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function validateWhatsAppBatch(instance: string, leads: WhatsAppValidationRequest[]): Promise<WhatsAppValidationResult[]> {
  const config = evolutionConfig();
  if (!config.enabled) throw new Error('Evolution nao configurada no worker/backend.');
  await assertConnected(instance);
  if (config.dryRun) return leads.map((lead) => ({ leadId: lead.id, status: 'valid', valid: true }));

  const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ numbers: leads.map(phoneForValidation) }),
  });
  return leads.map((lead, index) => validationResultFromPayload(lead, payload, index));
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

export const evolutionWhatsAppValidationGateway: WhatsAppValidationGateway = {
  async validate(leads) {
    const config = evolutionConfig();
    const results = new Map<string, WhatsAppValidationResult>();
    const grouped = new Map<string, WhatsAppValidationRequest[]>();

    for (const lead of leads) {
      try {
        const instance = instanceForValidation(lead);
        const number = phoneForValidation(lead);
        if (!instance) throw new Error(`Lead sem instancia/chip para validacao: ${lead.company}.`);
        if (!number) throw new Error(`Lead sem telefone normalizado para validacao: ${lead.company}.`);
        grouped.set(instance, [...(grouped.get(instance) ?? []), lead]);
      } catch (error) {
        results.set(lead.id, validationErrorResult(lead, error instanceof Error ? error.message : 'Erro ao validar WhatsApp.'));
      }
    }

    for (const [instance, instanceLeads] of grouped.entries()) {
      for (const batch of chunk(instanceLeads, config.validationBatchSize)) {
        try {
          const batchResults = await validateWhatsAppBatch(instance, batch);
          batchResults.forEach((result) => results.set(result.leadId, result));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Erro ao validar WhatsApp.';
          batch.forEach((lead) => results.set(lead.id, validationErrorResult(lead, message)));
        }

        if (config.validationDelayMs) await delay(config.validationDelayMs);
      }
    }

    return leads.map((lead) => results.get(lead.id) ?? validationErrorResult(lead, 'Validacao nao retornou resultado para este lead.'));
  },
};
