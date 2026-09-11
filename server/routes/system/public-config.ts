import type { RoutedRequest, RoutedResponse } from '../dispatch.js';
import { loadPlatformRelease } from '../../platform/release.js';

function env(...keys: string[]) {
  for (const key of keys) {
    const value = String(process.env[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}


export default async function handler(req: RoutedRequest, res: RoutedResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const supabaseUrl = env('SUPABASE_URL');
  const supabasePublishableKey = env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');
  const crmWebUrl = env('PUBLIC_APP_URL', 'APP_PUBLIC_URL');
  if (!supabaseUrl || !supabasePublishableKey || !crmWebUrl) {
    return res.status(503).json({ ok: false, error: 'control_plane_public_config_incomplete' });
  }

  let platformRelease = null;
  try { platformRelease = await loadPlatformRelease(); }
  catch (error) { console.warn('[public-config] platform release unavailable', error instanceof Error ? error.message : String(error)); }

  return res.status(200).json({
    ok: true,
    version: 2,
    public: {
      crmWebUrl: crmWebUrl.replace(/\/$/, ''),
      supabaseUrl: supabaseUrl.replace(/\/$/, ''),
      supabasePublishableKey,
    },
    platformRelease,
  });
}
