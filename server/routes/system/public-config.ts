import type { RoutedRequest, RoutedResponse } from '../dispatch.js';
import { bundledPlatformRelease, loadPlatformRelease } from '../../platform/release.js';

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

  const bootstrapValue = req.query?.bootstrap;
  const bootstrap = String(Array.isArray(bootstrapValue) ? bootstrapValue[0] : bootstrapValue ?? '').trim() === '1';

  let platformRelease = null;
  if (!bootstrap) {
    try { platformRelease = await loadPlatformRelease(); }
    catch (error) { console.warn('[public-config] platform release storage unavailable; serving bundled Candidate', error instanceof Error ? error.message : String(error)); platformRelease = bundledPlatformRelease(); }
  }

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
