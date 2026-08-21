import { organizationScopedAuthHeaders } from '../../organization/context.js';
import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
type RecordValue = Record<string, unknown>;
declare const process: { env: Record<string, string | undefined> };

function envAny(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return '';
}
function bodyRecord(body: unknown): RecordValue {
  if (typeof body === 'string') { try { return JSON.parse(body) as RecordValue; } catch { return {}; } }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as RecordValue : {};
}
function header(req: ApiRequest, name: string) {
  const key = Object.keys(req.headers ?? {}).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? req.headers?.[key] : undefined;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}
function bearer(req: ApiRequest) { return header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''; }
function send(res: ApiResponse, status: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(payload);
}
function safeOrigin(req: ApiRequest) {
  const configured = envAny('APP_PUBLIC_URL', 'PUBLIC_APP_URL', 'VITE_APP_PUBLIC_URL');
  if (configured) return configured.replace(/\/$/, '');
  const origin = header(req, 'origin').trim();
  return /^https?:\/\//i.test(origin) ? origin.replace(/\/$/, '') : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    const token = bearer(req);
    const supabaseUrl = envAny('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const publicKey = envAny('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
    const serviceRoleKey = envAny('SUPABASE_SERVICE_ROLE_KEY');
    if (!token) return send(res, 401, { ok: false, error: 'auth_required' });
    if (!supabaseUrl || !publicKey || !serviceRoleKey) {
      return send(res, 503, { ok: false, error: 'organization_invite_backend_not_configured' });
    }

    const body = bodyRecord(req.body);
    const email = String(body.email ?? '').trim().toLowerCase();
    const accessLevel = String(body.access_level ?? 'member').trim().toLowerCase();
    const roleId = body.role_id == null || body.role_id === '' ? null : Number(body.role_id);
    if (!email || !email.includes('@')) return send(res, 400, { ok: false, error: 'invalid_email' });
    if (!['manager', 'member'].includes(accessLevel)) return send(res, 400, { ok: false, error: 'invalid_access_level' });
    if (roleId !== null && (!Number.isSafeInteger(roleId) || roleId <= 0)) return send(res, 400, { ok: false, error: 'invalid_role_id' });

    const userClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: organizationScopedAuthHeaders(token, req.headers) },
    });
    const auth = await userClient.auth.getUser(token);
    if (auth.error || !auth.data.user) return send(res, 401, { ok: false, error: 'auth_invalid' });

    const invitation = await userClient.rpc('create_organization_invitation', {
      p_email: email,
      p_access_level: accessLevel,
      p_role_id: roleId,
    });
    if (invitation.error) {
      const status = /permission_denied|manager_cannot/i.test(invitation.error.message) ? 403 : 400;
      return send(res, status, { ok: false, error: invitation.error.message });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const origin = safeOrigin(req);
    const inviteResult = await admin.auth.admin.inviteUserByEmail(email, origin ? { redirectTo: `${origin}/` } : undefined);

    if (inviteResult.error) {
      const normalized = inviteResult.error.message.toLowerCase();
      const existingAccount = normalized.includes('already') || normalized.includes('registered') || normalized.includes('exists');
      if (existingAccount) {
        return send(res, 200, {
          ok: true,
          invitation: invitation.data,
          email_sent: false,
          existing_account: true,
          message: 'O usuário já possui conta. O convite será aceito automaticamente no próximo login.',
        });
      }
      return send(res, 502, {
        ok: false,
        error: `organization_invite_email_failed:${inviteResult.error.message}`,
        invitation: invitation.data,
      });
    }

    return send(res, 200, {
      ok: true,
      invitation: invitation.data,
      email_sent: true,
      existing_account: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'organization_invite_failed';
    return send(res, 500, { ok: false, error: message });
  }
}
