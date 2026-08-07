import { getSupabaseClient } from '../../lib/supabase';

export type InstagramExtensionPairing = {
  token: string;
  profile: string;
  expiresAt: string;
};

async function authHeaders() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Entre novamente no painel.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export const instagramExtensionGateway = {
  async pair(profile: string): Promise<InstagramExtensionPairing> {
    const response = await fetch('/api/instagram/pair', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ profile_username: profile }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) {
      const message = payload?.message || payload?.error || response.statusText || 'Falha ao gerar vínculo da extensão.';
      throw new Error(String(message));
    }
    return {
      token: String(payload.token),
      profile: String(payload.profile_username || profile),
      expiresAt: String(payload.expires_at || ''),
    };
  },
};
