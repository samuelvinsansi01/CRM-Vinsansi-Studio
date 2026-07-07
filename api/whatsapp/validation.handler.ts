type ApiRequest = {
  method?: string;
  body?: unknown;
};

declare const process: {
  env: Record<string, string | undefined>;
};

export type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

export type ValidationMode = 'initial' | 'revalidation';
export type ValidationOperation = 'validate' | 'revalidate';

export type ValidationLead = {
  id?: string;
  lead_id?: string;
  company?: string;
  phone?: string;
  normalized_phone?: string;
  chip_instance?: string;
};

export type ValidationResult = {
  leadId: string;
  lead_id?: string;
  status: 'valid' | 'invalid' | 'error';
  valid: boolean;
  errorMessage?: string;
};

function env(name: string) {
  return String(process.env[name] ?? '').trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function phoneDigits(lead: ValidationLead) {
  return String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '');
}

function isProductionRuntime() {
  return env('VERCEL_ENV').toLowerCase() === 'production' || env('NODE_ENV').toLowerCase() === 'production';
}

function evolutionConfig() {
  const dryRunRequested = env('DRY_RUN').toLowerCase() === 'true';
  return {
    baseUrl: env('EVOLUTION_API_URL').replace(/\/$/, ''),
    apiKey: env('EVOLUTION_API_KEY'),
    validationDelayMs: Number(env('EVOLUTION_VALIDATION_DELAY_MS') || 0),
    validationBatchSize: Math.max(1, Number(env('EVOLUTION_VALIDATION_BATCH_SIZE') || 50)),
    dryRunRequested,
    production: isProductionRuntime(),
    dryRun: dryRunRequested && !isProductionRuntime(),
  };
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * A Evolution pode devolver a lista diretamente ou embrulhada em response/data/result.
 * Nunca usa a posição no array como fallback: cada resultado precisa carregar o número
 * correspondente para que uma resposta de outro lead não aprove o lead errado.
 */
function payloadItems(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(asObject(item)));

  const root = asObject(payload);
  if (!root) return [];

  const candidates = [root.response, root.data, root.result, root.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is Record<string, unknown> => Boolean(asObject(item)));
    const nested = asObject(candidate);
    if (nested) {
      const nestedItems = [nested.response, nested.data, nested.result, nested.results].find(Array.isArray);
      if (Array.isArray(nestedItems)) return nestedItems.filter((item): item is Record<string, unknown> => Boolean(asObject(item)));
    }
  }

  // Resposta unitária somente é considerada se trouxer um identificador de telefone.
  if (candidateDigits(root)) return [root];
  return [];
}

function booleanLike(value: unknown) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(text)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(text)) return false;
  return undefined;
}

function candidateDigits(candidate: Record<string, unknown>) {
  return String(
    candidate.number
      ?? candidate.phone
      ?? candidate.jid
      ?? candidate.remoteJid
      ?? candidate._serialized
      ?? '',
  ).replace(/\D/g, '');
}

function numbersMatch(left: string, right: string) {
  if (left.length < 10 || right.length < 10) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function matchingItem(lead: ValidationLead, items: Array<Record<string, unknown>>) {
  const number = phoneDigits(lead);
  return items.find((item) => numbersMatch(candidateDigits(item), number));
}

function leadId(lead: ValidationLead) {
  return String(lead.id || lead.lead_id || '');
}

function parseValidation(lead: ValidationLead, item?: Record<string, unknown>): ValidationResult {
  if (!item) {
    return {
      leadId: leadId(lead),
      lead_id: lead.lead_id,
      status: 'error',
      valid: false,
      errorMessage: 'Evolution nao retornou uma confirmação vinculada a este numero.',
    };
  }

  const exists = item.exists
    ?? item.valid
    ?? item.isWhatsapp
    ?? item.is_whatsapp
    ?? item.hasWhatsapp
    ?? item.has_whatsapp
    ?? item.isValid
    ?? item.is_valid
    ?? item.registered
    ?? item.isRegistered;
  const existsBool = booleanLike(exists);
  const status = String(item.status ?? item.result ?? '').toLowerCase();
  const jid = String(item.jid ?? item.remoteJid ?? item._serialized ?? '');
  const invalidStatus = ['invalid', 'not_found', 'no_whatsapp', 'not_on_whatsapp'].includes(status);
  const hasWhatsAppJid = jid.endsWith('@s.whatsapp.net');

  if (existsBool === false || invalidStatus) {
    return { leadId: leadId(lead), lead_id: lead.lead_id, status: 'invalid', valid: false };
  }

  if (existsBool === true || hasWhatsAppJid) {
    return { leadId: leadId(lead), lead_id: lead.lead_id, status: 'valid', valid: true };
  }

  return {
    leadId: leadId(lead),
    lead_id: lead.lead_id,
    status: 'error',
    valid: false,
    errorMessage: 'Evolution respondeu sem campo booleano explícito ou JID de WhatsApp.',
  };
}

function errorResult(lead: ValidationLead, message: string): ValidationResult {
  return { leadId: leadId(lead), lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: message };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function validateLeadBatch(instance: string, leads: ValidationLead[], operation: ValidationOperation, mode: ValidationMode): Promise<ValidationResult[]> {
  const config = evolutionConfig();
  if (!config.baseUrl || !config.apiKey) throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes no backend.');
  if (config.dryRunRequested && config.production) throw new Error('DRY_RUN=true está bloqueado em Production. Defina DRY_RUN=false para validar pela Evolution.');

  if (config.dryRun) {
    console.warn(JSON.stringify({ event: 'whatsapp_validation_dry_run', operation, mode, instance, total: leads.length }));
    return leads.map((lead) => ({ leadId: leadId(lead), lead_id: lead.lead_id, status: 'valid', valid: true }));
  }

  console.info(JSON.stringify({ event: 'whatsapp_validation_evolution', operation, mode, instance, total: leads.length }));
  const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ numbers: leads.map(phoneDigits) }),
  });
  const items = payloadItems(payload);

  return leads.map((lead) => parseValidation({ ...lead, id: leadId(lead) }, matchingItem(lead, items)));
}

export async function runStrictValidation(leads: ValidationLead[], operation: ValidationOperation, mode: ValidationMode) {
  const config = evolutionConfig();
  const results = new Map<string, ValidationResult>();
  const grouped = new Map<string, ValidationLead[]>();

  for (const lead of leads) {
    const id = leadId(lead);
    const instance = String(lead.chip_instance || '').trim();
    const number = phoneDigits(lead);
    if (!id) {
      results.set(`${Math.random()}`, errorResult(lead, 'Lead sem id para validacao.'));
      continue;
    }
    if (!instance) {
      results.set(id, errorResult(lead, `Lead sem chip/instancia para validacao: ${lead.company || id}.`));
      continue;
    }
    if (!number) {
      results.set(id, errorResult(lead, `Lead sem telefone para validacao: ${lead.company || id}.`));
      continue;
    }
    grouped.set(instance, [...(grouped.get(instance) ?? []), lead]);
  }

  for (const [instance, instanceLeads] of grouped.entries()) {
    for (const batch of chunk(instanceLeads, config.validationBatchSize)) {
      try {
        const batchResults = await validateLeadBatch(instance, batch, operation, mode);
        batchResults.forEach((result) => results.set(String(result.leadId), result));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao validar WhatsApp.';
        batch.forEach((lead) => results.set(leadId(lead), errorResult(lead, message)));
      }
      if (config.validationDelayMs) await delay(config.validationDelayMs);
    }
  }

  return leads.map((lead) => results.get(leadId(lead)) ?? errorResult(lead, 'Validacao nao retornou resultado para este lead.'));
}

function requestBodyRecord(body: unknown): { leads?: unknown; mode?: unknown; operation?: unknown } {
  if (typeof body === 'string') {
    try { return JSON.parse(body) as { leads?: unknown; mode?: unknown; operation?: unknown }; } catch { return {}; }
  }
  return body && typeof body === 'object' ? body as { leads?: unknown; mode?: unknown; operation?: unknown } : {};
}

function operationForMode(mode: ValidationMode): ValidationOperation {
  return mode === 'revalidation' ? 'revalidate' : 'validate';
}

export async function handleValidationRequest(req: ApiRequest, res: ApiResponse, expectedMode: ValidationMode) {
  const expectedOperation = operationForMode(expectedMode);
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const record = requestBodyRecord(req.body);
  const leads = Array.isArray(record.leads) ? record.leads as ValidationLead[] : [];
  const requestedMode = record.mode === 'revalidation' ? 'revalidation' : 'initial';
  const requestedOperation = String(record.operation ?? '').trim().toLowerCase();

  if (!leads.length) {
    res.status(400).json({ error: 'Nenhum lead recebido para validacao.' });
    return;
  }

  // Cada rota aceita exclusivamente sua própria operação. Isso impede que uma
  // chamada de validação inicial execute a revalidação, ou o contrário.
  if (requestedMode !== expectedMode || requestedOperation !== expectedOperation) {
    res.status(409).json({
      error: `Operacao incompatível. Esta rota aceita somente ${expectedOperation}/${expectedMode}.`,
      expected: { operation: expectedOperation, mode: expectedMode },
    });
    return;
  }

  const results = await runStrictValidation(leads, expectedOperation, expectedMode);
  const summary = results.reduce((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { valid: 0, invalid: 0, error: 0 });
  console.info(JSON.stringify({ event: 'whatsapp_validation_complete', operation: expectedOperation, mode: expectedMode, total: leads.length, ...summary }));

  res.status(200).json({
    results,
    meta: {
      provider: evolutionConfig().dryRun ? 'dry_run' : 'evolution',
      simulated: evolutionConfig().dryRun,
      operation: expectedOperation,
      mode: expectedMode,
    },
  });
}
