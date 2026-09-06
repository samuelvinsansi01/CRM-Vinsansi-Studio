import type { RoutedRequest, RoutedResponse } from '../dispatch.js';

function env(...keys: string[]) {
  for (const key of keys) {
    const value = String(process.env[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function requestOrigin(req: RoutedRequest) {
  const headers = req.headers ?? {};
  const forwardedProto = String(headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const forwardedHost = String(headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const host = forwardedHost || String(headers.host ?? '').split(',')[0].trim();
  if (!host) return '';
  const proto = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function handler(req: RoutedRequest, res: RoutedResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const supabaseUrl = env('SUPABASE_URL');
  const supabasePublishableKey = env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');
  const crmWebUrl = env('PUBLIC_APP_URL', 'APP_PUBLIC_URL') || requestOrigin(req);
  if (!supabaseUrl || !supabasePublishableKey || !crmWebUrl) {
    return res.status(503).json({ ok: false, error: 'control_plane_public_config_incomplete' });
  }

  return res.status(200).json({
    ok: true,
    version: 1,
    public: {
      crmWebUrl: crmWebUrl.replace(/\/$/, ''),
      supabaseUrl: supabaseUrl.replace(/\/$/, ''),
      supabasePublishableKey,
    },
  });
}
