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

  const bundledRelease = bundledPlatformRelease();
  let platformRelease = bootstrap ? null : bundledRelease;
  // Candidate é autocontido: public-config nunca deve depender do PostgREST/DB para
  // liberar o Gerenciador. A autoridade publicada continua sendo este endpoint,
  // mas o manifesto Candidate é servido do bundle verificado sem I/O de banco.
  // Production continua consultando o registro promovido, com fallback fail-closed
  // para o bundle apenas se ele próprio já for Production válido.
  if (!bootstrap && bundledRelease.releaseStage === 'production') {
    try {
      platformRelease = await Promise.race([
        loadPlatformRelease(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('platform_release_storage_timeout')), 2500)),
      ]);
    } catch (error) {
      console.warn('[public-config] platform release storage unavailable; serving bundled release', error instanceof Error ? error.message : String(error));
      platformRelease = bundledRelease;
    }
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
