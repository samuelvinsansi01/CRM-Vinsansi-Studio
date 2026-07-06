import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import updateHandler from './api/update';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function readJsonBody(req: { on: (event: string, callback: (chunk?: string) => void) => void; setEncoding?: (encoding: string) => void }) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    req.setEncoding?.('utf8');
    req.on('data', (chunk = '') => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', () => reject(new Error('Erro ao ler corpo da requisicao.')));
  });
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

function whatsappValidationDevPlugin(env: Record<string, string>): Plugin {
  const baseUrl = String(env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
  const apiKey = String(env.EVOLUTION_API_KEY ?? '');
  const validationDelayMs = Number(env.EVOLUTION_VALIDATION_DELAY_MS || 0);
  const validationBatchSize = Math.max(1, Number(env.EVOLUTION_VALIDATION_BATCH_SIZE || 50));
  const dryRun = String(env.DRY_RUN ?? '').toLowerCase() === 'true';

  async function requestEvolution(path: string, init: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
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

  function booleanLike(value: unknown) {
    if (value === true || value === false) return value;
    const text = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(text)) return true;
    if (['false', '0', 'no', 'nao', 'não'].includes(text)) return false;
    return undefined;
  }

  function parseValidation(lead: Record<string, unknown>, payload: unknown, index = 0) {
    const number = String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '');
    const items = payloadItems(payload);
    const item = items.find((candidate) => {
      const candidateNumber = String(candidate.number ?? candidate.phone ?? candidate.jid ?? candidate.id ?? '').replace(/\D/g, '');
      return Boolean(candidateNumber) && (candidateNumber.includes(number) || number.includes(candidateNumber));
    }) ?? items[index];

    if (!item) return { leadId: lead.id, lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: 'Evolution nao retornou resultado para o numero.' };
    const exists = item.exists ?? item.valid ?? item.isWhatsapp ?? item.is_whatsapp ?? item.hasWhatsapp ?? item.has_whatsapp;
    const existsBool = booleanLike(exists);
    const jid = String(item.jid ?? item.id ?? item._serialized ?? item.remoteJid ?? '');
    const status = String(item.status ?? item.result ?? '').toLowerCase();
    const valid = existsBool === true || jid.includes('@s.whatsapp.net') || ['valid', 'exists', 'ok'].includes(status);
    const invalid = existsBool === false || ['invalid', 'not_found', 'no_whatsapp', 'not_on_whatsapp'].includes(status);
    if (!valid && !invalid) return { leadId: lead.id, lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: 'Evolution retornou resposta sem campo exists/valid reconhecido.' };
    return { leadId: lead.id, lead_id: lead.lead_id, status: valid ? 'valid' : 'invalid', valid };
  }

  function leadId(lead: Record<string, unknown>) {
    return String(lead.id || lead.lead_id || '');
  }

  function errorResult(lead: Record<string, unknown>, message: string) {
    return { leadId: leadId(lead), lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: message };
  }

  function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  async function validateLeadBatch(instance: string, leads: Record<string, unknown>[]) {
    if (!baseUrl || !apiKey) throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes no .env local.');
    if (dryRun) return leads.map((lead) => ({ leadId: leadId(lead), lead_id: lead.lead_id, status: 'valid', valid: true }));
    const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: leads.map((lead) => String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '')) }),
    });
    return leads.map((lead, index) => parseValidation(lead, payload, index));
  }

  async function validateLeads(leads: Record<string, unknown>[]) {
    const results = new Map<string, ReturnType<typeof errorResult>>();
    const grouped = new Map<string, Record<string, unknown>[]>();

    for (const lead of leads) {
      const id = leadId(lead);
      const instance = String(lead.chip_instance ?? '').trim();
      const number = String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '');

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
      for (const batch of chunk(instanceLeads, validationBatchSize)) {
        try {
          const batchResults = await validateLeadBatch(instance, batch);
          batchResults.forEach((result) => results.set(String(result.leadId), result));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Erro ao validar WhatsApp.';
          batch.forEach((lead) => results.set(leadId(lead), errorResult(lead, message)));
        }

        if (validationDelayMs) await delay(validationDelayMs);
      }
    }

    return leads.map((lead) => results.get(leadId(lead)) ?? errorResult(lead, 'Validacao nao retornou resultado para este lead.'));
  }

  return {
    name: 'whatsapp-validation-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/update', async (req, res) => {
        const apiRes = {
          status(code: number) {
            res.statusCode = code;
            return apiRes;
          },
          json(body: unknown) {
            res.end(JSON.stringify(body));
          },
          setHeader(name: string, value: string) {
            res.setHeader(name, value);
          },
          end() {
            res.end();
          },
        };

        try {
          const body = req.method === 'POST' ? await readJsonBody(req) : {};
          await updateHandler({ method: req.method, body, headers: req.headers as Record<string, string | string[] | undefined> }, apiRes);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro na API local da extensao Instagram.' }));
        }
      });

      server.middlewares.use('/api/whatsapp/validate', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        try {
          const body = await readJsonBody(req);
          const leads = Array.isArray(body.leads) ? body.leads.filter((lead): lead is Record<string, unknown> => Boolean(lead) && typeof lead === 'object') : [];
          if (!leads.length) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Nenhum lead recebido para validacao.' }));
            return;
          }

          const results = await validateLeads(leads);
          res.end(JSON.stringify({ results }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro ao validar WhatsApp.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
    plugins: [react(), whatsappValidationDevPlugin(env)],
    server: {
      port: 5173,
    },
  };
});
