export type ControlPlanePublicConfig = {
  crmWebUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

let runtimeConfig: ControlPlanePublicConfig | null = null;
let loading: Promise<ControlPlanePublicConfig> | null = null;

function normalize(payload: unknown): ControlPlanePublicConfig {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const publicConfig = root.public && typeof root.public === 'object' ? root.public as Record<string, unknown> : {};
  const crmWebUrl = String(publicConfig.crmWebUrl ?? '').trim().replace(/\/$/, '');
  const supabaseUrl = String(publicConfig.supabaseUrl ?? '').trim().replace(/\/$/, '');
  const supabasePublishableKey = String(publicConfig.supabasePublishableKey ?? '').trim();
  if (!crmWebUrl || !supabaseUrl || !supabasePublishableKey) throw new Error('control_plane_public_config_incomplete');
  return { crmWebUrl, supabaseUrl, supabasePublishableKey };
}

export async function loadRuntimeConfig(): Promise<ControlPlanePublicConfig> {
  if (runtimeConfig) return runtimeConfig;
  if (loading) return loading;
  loading = fetch('/api/system?route=public-config', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String((payload as Record<string, unknown>).error ?? `control_plane_http_${response.status}`));
      runtimeConfig = normalize(payload);
      return runtimeConfig;
    })
    .finally(() => { loading = null; });
  return loading;
}

export function getRuntimeConfig(): ControlPlanePublicConfig | null {
  return runtimeConfig;
}
