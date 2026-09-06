import type { RoutedRequest, RoutedResponse } from '../dispatch.js';

function header(req: RoutedRequest, name: string) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();
}

export default async function handler(req: RoutedRequest, res: RoutedResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  if (!supabaseUrl) return res.status(503).json({ ok: false, error: 'control_plane_supabase_not_configured' });

  const instanceIdRaw = req.query?.instance_id;
  const instanceId = String(Array.isArray(instanceIdRaw) ? instanceIdRaw[0] ?? '' : instanceIdRaw ?? '').trim();
  if (!/^\d+$/.test(instanceId)) return res.status(400).json({ ok: false, error: 'instance_id_required' });

  const signature = header(req, 'x-evolution-signature');
  const headerInstanceId = header(req, 'x-evolution-instance-id');
  if (!signature || !headerInstanceId) return res.status(401).json({ ok: false, error: 'evolution_webhook_headers_required' });

  const target = new URL('/functions/v1/evolution-connection-webhook', supabaseUrl);
  target.searchParams.set('instance_id', instanceId);
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-evolution-instance-id': headerInstanceId,
      'x-evolution-signature': signature,
    },
    body: JSON.stringify(req.body ?? {}),
  });
  const raw = await response.text();
  res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
  if (!response.ok) return res.status(response.status).json({ ok: false, error: 'evolution_webhook_upstream_failed', upstreamStatus: response.status, upstream: raw.slice(0, 1000) });
  try { return res.status(response.status).json(raw ? JSON.parse(raw) : { ok: true }); }
  catch { return res.status(response.status).json({ ok: true, upstream: raw.slice(0, 1000) }); }
}
