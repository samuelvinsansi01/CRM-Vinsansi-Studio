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

function envBoolean(name: string, fallback = false) {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  return ['true', '1', 'yes', 'sim', 'on'].includes(value);
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

/**
 * Porta de segurança antes da validação. Quando habilitada, a Vercel consulta
 * o Worker Docker, que confirma estar de pé e também confere a conexão da
 * instância Evolution antes que qualquer número seja enviado ao provider.
 *
 * Em indisponibilidade, a validação inteira falha fechada: nenhum lead recebe
 * status inválido, revisão, retorno para Instagram ou alteração de capacidade.
 */
function workerHealthConfig() {
  const healthUrl = env('WHATSAPP_VALIDATION_WORKER_HEALTH_URL').replace(/\/$/, '');
  return {
    healthUrl,
    token: env('WHATSAPP_VALIDATION_WORKER_HEALTH_TOKEN'),
    required: envBoolean('WHATSAPP_VALIDATION_REQUIRE_WORKER_HEALTH', false),
    timeoutMs: Math.max(1_000, Number(env('WHATSAPP_VALIDATION_HEALTH_TIMEOUT_MS') || 8_000)),
  };
}

function preflightValidationInstances(leads: ValidationLead[]) {
  return Array.from(new Set(leads.map((lead) => String(lead.chip_instance || '').trim()).filter(Boolean)));
}

function safeProviderMessage(payload: unknown, fallback: string) {
  const record = asObject(payload);
  const message = record?.message ?? record?.error ?? record?.detail ?? record?.details;
  return String(message ?? fallback).trim() || fallback;
}

async function assertValidationInfrastructure(leads: ValidationLead[]) {
  const config = workerHealthConfig();
  if (!config.required) return;

  if (!config.healthUrl) {
    throw new Error('Validação bloqueada por segurança: WHATSAPP_VALIDATION_WORKER_HEALTH_URL não foi configurada. Nenhum lead foi alterado.');
  }

  const instances = preflightValidationInstances(leads);
  if (!instances.length) {
    throw new Error('Validação bloqueada por segurança: nenhum chip/instância foi informado. Nenhum lead foi alterado.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.healthUrl}/preflight/validation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { 'X-Worker-Token': config.token } : {}),
      },
      body: JSON.stringify({ instances }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || asObject(payload)?.ok !== true) {
      throw new Error(safeProviderMessage(payload, `Worker/Evolution indisponível (HTTP ${response.status}). Nenhum lead foi alterado.`));
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Worker WhatsApp não respondeu ao preflight dentro do prazo. Nenhum lead foi alterado.');
    }
    const message = error instanceof Error ? error.message : 'Worker WhatsApp indisponível.';
    throw new Error(`Validação indisponível: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
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
      // Algumas versões retornam um único resultado em `data`/`response`.
      if (candidateDigits(nested)) return [nested];
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
  const raw = String(
    candidate.number
      ?? candidate.phone
      ?? candidate.jid
      ?? candidate.remoteJid
      ?? candidate._serialized
      ?? '',
  );
  // JIDs podem conter um sufixo de dispositivo, como :1@s.whatsapp.net.
  // O sufixo não faz parte do número e não pode participar da comparação.
  return raw.split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * A validação usa sempre números normalizados no formato E.164 (ex.: 5511999999999).
 * Não há comparação por "final do número": qualquer divergência deixa o lead em revisão.
 */
function numbersMatch(left: string, right: string) {
  return left.length >= 12 && right.length >= 12 && left === right;
}

function matchingItems(lead: ValidationLead, items: Array<Record<string, unknown>>) {
  const number = phoneDigits(lead);
  return items.filter((item) => numbersMatch(candidateDigits(item), number));
}

function leadId(lead: ValidationLead) {
  return String(lead.id || lead.lead_id || '');
}

function parseValidation(lead: ValidationLead, matching: Array<Record<string, unknown>>): ValidationResult {
  if (matching.length !== 1) {
    return {
      leadId: leadId(lead),
      lead_id: lead.lead_id,
      status: 'error',
      valid: false,
      errorMessage: matching.length
        ? 'Evolution retornou mais de uma confirmação para este número. O lead foi enviado para revisão.'
        : 'Evolution não retornou confirmação exatamente vinculada a este número.',
    };
  }

  const item = matching[0];
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


async function validateOneLead(instance: string, lead: ValidationLead, operation: ValidationOperation, mode: ValidationMode): Promise<ValidationResult> {
  const config = evolutionConfig();
  if (!config.baseUrl || !config.apiKey) throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes no backend.');
  if (config.dryRunRequested && config.production) throw new Error('DRY_RUN=true está bloqueado em Production. Defina DRY_RUN=false para validar pela Evolution.');

  if (config.dryRun) {
    console.warn(JSON.stringify({ event: 'whatsapp_validation_dry_run', operation, mode, instance, leadId: leadId(lead) }));
    return { leadId: leadId(lead), lead_id: lead.lead_id, status: 'valid', valid: true };
  }

  // Uma consulta por lead elimina qualquer possibilidade de um resultado em lote
  // ser aplicado a outro número. A Evolution ainda recebe o formato oficial `numbers`.
  console.info(JSON.stringify({ event: 'whatsapp_validation_evolution_single', operation, mode, instance, leadId: leadId(lead) }));
  const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ numbers: [phoneDigits(lead)] }),
  });
  const items = payloadItems(payload);
  const result = parseValidation({ ...lead, id: leadId(lead) }, matchingItems(lead, items));

  console.info(JSON.stringify({
    event: 'whatsapp_validation_evolution_single_result',
    operation,
    mode,
    instance,
    leadId: leadId(lead),
    status: result.status,
    providerItems: items.length,
    exactMatches: matchingItems(lead, items).length,
  }));
  return result;
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
    for (const lead of instanceLeads) {
      try {
        const result = await validateOneLead(instance, lead, operation, mode);
        results.set(String(result.leadId), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao validar WhatsApp.';
        results.set(leadId(lead), errorResult(lead, message));
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

  try {
    await assertValidationInfrastructure(leads);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validação indisponível.';
    console.warn(JSON.stringify({
      event: 'whatsapp_validation_preflight_failed',
      operation: expectedOperation,
      mode: expectedMode,
      total: leads.length,
      message,
    }));
    res.status(503).json({
      code: 'validation_unavailable',
      error: message,
      message,
      unchanged: true,
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
