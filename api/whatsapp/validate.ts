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

function env(name: string) {
  return String(process.env[name] ?? '').trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function phoneDigits(lead: ValidationLead) {
  return String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '');
}

function evolutionConfig() {
  return {
    baseUrl: env('EVOLUTION_API_URL').replace(/\/$/, ''),
    apiKey: env('EVOLUTION_API_KEY'),
    validationDelayMs: Number(env('EVOLUTION_VALIDATION_DELAY_MS') || env('EVOLUTION_MESSAGE_DELAY_MS') || 1500),
    dryRun: env('DRY_RUN').toLowerCase() === 'true',
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

function parseValidation(lead: ValidationLead, payload: unknown) {
  const number = phoneDigits(lead);
  const item = payloadItems(payload).find((candidate) => {
    const candidateNumber = String(candidate.number ?? candidate.phone ?? candidate.jid ?? candidate.id ?? '').replace(/\D/g, '');
    return !candidateNumber || candidateNumber.includes(number) || number.includes(candidateNumber);
  });

  if (!item) {
    return {
      leadId: lead.id,
      lead_id: lead.lead_id,
      status: 'error',
      valid: false,
      errorMessage: 'Evolution nao retornou resultado para o numero.',
    };
  }

  const exists = item.exists ?? item.valid ?? item.isWhatsapp ?? item.is_whatsapp ?? item.hasWhatsapp ?? item.has_whatsapp;
  const jid = String(item.jid ?? item.id ?? item._serialized ?? item.remoteJid ?? '');
  const valid = exists === true || jid.includes('@s.whatsapp.net');
  const invalid = exists === false;

  if (!valid && !invalid) {
    return {
      leadId: lead.id,
      lead_id: lead.lead_id,
      status: 'error',
      valid: false,
      errorMessage: 'Evolution retornou resposta sem campo exists/valid reconhecido.',
    };
  }

  return {
    leadId: lead.id,
    lead_id: lead.lead_id,
    status: valid ? 'valid' : 'invalid',
    valid,
  };
}

async function validateLead(lead: ValidationLead) {
  const config = evolutionConfig();
  const leadId = String(lead.id || lead.lead_id || '');
  const instance = String(lead.chip_instance || '').trim();
  const number = phoneDigits(lead);

  if (!leadId) throw new Error('Lead sem id para validacao.');
  if (!instance) throw new Error(`Lead sem chip/instancia para validacao: ${lead.company || leadId}.`);
  if (!number) throw new Error(`Lead sem telefone para validacao: ${lead.company || leadId}.`);
  if (!config.baseUrl || !config.apiKey) throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes no backend.');
  if (config.dryRun) return { leadId, lead_id: lead.lead_id, status: 'valid', valid: true };

  const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({ numbers: [number] }),
  });

  return parseValidation({ ...lead, id: leadId }, payload);
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

  const config = evolutionConfig();
  const results = [];

  for (const lead of leads) {
    try {
      results.push(await validateLead(lead));
    } catch (error) {
      results.push({
        leadId: lead.id,
        lead_id: lead.lead_id,
        status: 'error',
        valid: false,
        errorMessage: error instanceof Error ? error.message : 'Erro ao validar WhatsApp.',
      });
    }

    if (config.validationDelayMs) await delay(config.validationDelayMs);
  }

  res.status(200).json({ results });
}
