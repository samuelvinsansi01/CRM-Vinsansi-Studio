import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
  const validationDelayMs = Number(env.EVOLUTION_VALIDATION_DELAY_MS || env.EVOLUTION_MESSAGE_DELAY_MS || 1500);
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

  function parseValidation(lead: Record<string, unknown>, payload: unknown) {
    const number = String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '');
    const item = payloadItems(payload).find((candidate) => {
      const candidateNumber = String(candidate.number ?? candidate.phone ?? candidate.jid ?? candidate.id ?? '').replace(/\D/g, '');
      return !candidateNumber || candidateNumber.includes(number) || number.includes(candidateNumber);
    });

    if (!item) return { leadId: lead.id, lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: 'Evolution nao retornou resultado para o numero.' };
    const exists = item.exists ?? item.valid ?? item.isWhatsapp ?? item.is_whatsapp ?? item.hasWhatsapp ?? item.has_whatsapp;
    const jid = String(item.jid ?? item.id ?? item._serialized ?? item.remoteJid ?? '');
    const valid = exists === true || jid.includes('@s.whatsapp.net');
    const invalid = exists === false;
    if (!valid && !invalid) return { leadId: lead.id, lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: 'Evolution retornou resposta sem campo exists/valid reconhecido.' };
    return { leadId: lead.id, lead_id: lead.lead_id, status: valid ? 'valid' : 'invalid', valid };
  }

  async function validateLead(lead: Record<string, unknown>) {
    const instance = String(lead.chip_instance ?? '').trim();
    const number = String(lead.normalized_phone || lead.phone || '').replace(/\D/g, '');
    if (!baseUrl || !apiKey) throw new Error('EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes no .env local.');
    if (!instance) throw new Error(`Lead sem chip/instancia para validacao: ${lead.company || lead.id}.`);
    if (!number) throw new Error(`Lead sem telefone para validacao: ${lead.company || lead.id}.`);
    if (dryRun) return { leadId: lead.id, lead_id: lead.lead_id, status: 'valid', valid: true };
    const payload = await requestEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: [number] }),
    });
    return parseValidation(lead, payload);
  }

  return {
    name: 'whatsapp-validation-dev-api',
    configureServer(server) {
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

          const results = [];
          for (const lead of leads) {
            try {
              results.push(await validateLead(lead));
            } catch (error) {
              results.push({ leadId: lead.id, lead_id: lead.lead_id, status: 'error', valid: false, errorMessage: error instanceof Error ? error.message : 'Erro ao validar WhatsApp.' });
            }
            if (validationDelayMs) await delay(validationDelayMs);
          }

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

  return {
    plugins: [react(), whatsappValidationDevPlugin(env)],
    server: {
      port: 5173,
    },
  };
});
