type ApiRequest = {
  method?: string;
  body?: unknown;
};

declare const process: {
  env: Record<string, string | undefined>;
};

type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

type ValidationLead = {
  id?: string;
  lead_id?: string;
  company?: string;
  phone?: string;
  normalized_phone?: string;
  chip_instance?: string;
};

type ValidationResult = {
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

function payloadItems(payload: unknown): Array<Record<string, unknown>> {
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

function parseValidation(lead: ValidationLead, payload: unknown, index = 0): ValidationResult {
  const number = phoneDigits(lead);
  const items = payloadItems(payload);
  const item = items.find((candidate) => {
    const candidateNumber = String(candidate.number ?? candidate.phone ?? candidate.jid ?? candidate.id ?? '').replace(/\D/g, '');
    return Boolean(candidateNumber) && (candidateNumber.includes(number) || number.includes(candidateNumber));
  }) ?? items[index];

  if (!item) {
    return {
      leadId: leadId(lead),
      lead_id: lead.lead_id,
      status: 'error',
      valid: false,
      errorMessage: 'Evolution nao retornou resultado para o numero.',
    };
  }

  const exists = item.exists ?? item.valid ?? item.isWhatsapp ?? item.is_whatsapp ?? item.hasWhatsapp ?? item.has_whatsapp;
  const existsBool = booleanLike(exists);
  const jid = String(item.jid ?? item.id ?? item._serialized ?? item.remoteJid ?? '');
  const status = String(item.status ?? item.result ?? '').toLowerCase();
  const hasWhatsAppJid = jid.includes('@s.whatsapp.net');
  const validStatus = ['valid', 'exists'].includes(status);
  const invalidStatus = ['invalid', 'not_found', 'no_whatsapp', 'not_on_whatsapp'].includes(status);

  // A negativa explícita da Evolution sempre prevalece. "ok" pode representar
  // somente que a requisição foi processada e não é prova de que há WhatsApp.
  if (existsBool === false || invalidStatus) {
    return {
      leadId: leadId(lead),
      lead_id: lead.lead_id,
      status: 'invalid',
      valid: false,
    };
  }

  if (existsBool === true || hasWhatsAppJid || validStatus) {
    return {
      leadId: leadId(lead),
      lead_id: lead.lead_id,
      status: 'valid',
      valid: true,
    };
  }

  return {
    leadId: leadId(lead),
    lead_id: lead.lead_id,
    status: 'error',
    valid: false,
    errorMessage: 'Evolution retornou resposta sem confirmação explícita de WhatsApp.',
  };
}

function leadId(lead: ValidationLead) {
  return String(lead.id || lead.lead_id || '');
}

function errorResult(lead: ValidationLead, message: string): ValidationResult {
  return {
    leadId: leadId(lead),
    lead_id: lead.lead_id,
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

async function validateLeadBatch(instance: string, leads: ValidationLead[]): Promise<ValidationResult[]> {
  const config = evolutionConfig();
  if (!config.baseUrl || !config.apiKey) throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes no backend.');
  if (config.dryRunRequested && config.production) {
    throw new Error('DRY_RUN=true está bloqueado em Production. Defina DRY_RUN=false para validar pela Evolution.');
  }
  if (config.dryRun) {
    console.warn(JSON.stringify({ event: 'whatsapp_validation_dry_run', instance, total: leads.length }));
    return leads.map((lead) => ({ leadId: leadId(lead), lead_id: lead.lead_id, status: 'valid', valid: true }));
  }

  console.info(JSON.stringify({ event: 'whatsapp_validation_evolution', instance, total: leads.length }));
  const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ numbers: leads.map(phoneDigits) }),
  });

  return leads.map((lead, index) => parseValidation({ ...lead, id: leadId(lead) }, payload, index));
}

async function validateLeads(leads: ValidationLead[]) {
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
        const batchResults = await validateLeadBatch(instance, batch);
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

function requestBodyRecord(body: unknown): { leads?: unknown } {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as { leads?: unknown };
    } catch {
      return {};
    }
  }

  if (body && typeof body === 'object') return body as { leads?: unknown };
  return {};
}

function readLeads(body: unknown): ValidationLead[] {
  const record = requestBodyRecord(body);
  return Array.isArray(record?.leads) ? record.leads as ValidationLead[] : [];
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const leads = readLeads(req.body);
  if (!leads.length) {
    res.status(400).json({ error: 'Nenhum lead recebido para validacao.' });
    return;
  }

  const results = await validateLeads(leads);
  const summary = results.reduce((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { valid: 0, invalid: 0, error: 0 });
  console.info(JSON.stringify({ event: 'whatsapp_validation_complete', total: leads.length, ...summary }));

  res.status(200).json({
    results,
    meta: {
      provider: evolutionConfig().dryRun ? 'dry_run' : 'evolution',
      simulated: evolutionConfig().dryRun,
    },
  });
}
