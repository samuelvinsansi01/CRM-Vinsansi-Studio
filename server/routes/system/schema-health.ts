import type { ApiRequest, ApiResponse } from '../../maps/shared.js';
import { send, setCors, serviceClient } from '../../maps/shared.js';

function norm(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return send(req, res, 405, { error: 'method_not_allowed' });
  try {
    const client = serviceClient();
    const [leadStatus, channels] = await Promise.all([
      client.from('lead_status').select('lead_status_id,lead_status_name').order('lead_status_id'),
      client.from('channels').select('channels_id,channels_name').order('channels_id'),
    ]);
    if (leadStatus.error) throw new Error(leadStatus.error.message);
    if (channels.error) throw new Error(channels.error.message);
    const expectedStatuses = ['importado','revisao','sem_contato','na_fila','enviado','invalido','duplicado'];
    const actualStatuses = (leadStatus.data ?? []).map((row) => norm(row.lead_status_name));
    const expectedChannels = ['instagram','sem_destino','whatsapp'].sort();
    const actualChannels = (channels.data ?? []).map((row) => norm(row.channels_name)).sort();
    const statusOk = actualStatuses.length === expectedStatuses.length && expectedStatuses.every((value, index) => actualStatuses[index] === value);
    const channelsOk = actualChannels.length === expectedChannels.length && expectedChannels.every((value, index) => actualChannels[index] === value);
    return send(req, res, statusOk && channelsOk ? 200 : 503, {
      ok: statusOk && channelsOk,
      schema: {
        contract: 'R59',
        leadStatus: { ok: statusOk, actual: actualStatuses },
        channels: { ok: channelsOk, actual: actualChannels },
      },
      release: { release_key: 'crm-r59-final-contract', application_version: '2.4.0-R59', is_stable: true },
    });
  } catch (error) {
    return send(req, res, 503, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
