import type { SupabaseClient } from '@supabase/supabase-js';

export type OrganizationAuthContext = {
  actorUsersId: number;
  organizationId: number;
  scopeUsersId: number;
  memberId: number | null;
  accessLevel: 'platform_owner' | 'owner' | 'manager' | 'member';
  isPlatformOwner: boolean;
};

type Row = Record<string, unknown>;

export const ORGANIZATION_HEADER = 'x-vinsansi-organization-id';

export function organizationHeaderFromHeaders(headers: Record<string, string | string[] | undefined> | undefined) {
  if (!headers) return '';
  const key = Object.keys(headers).find((item) => item.toLowerCase() === ORGANIZATION_HEADER);
  const raw = key ? headers[key] : undefined;
  const value = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  return /^\d+$/.test(value.trim()) ? value.trim() : '';
}

export function organizationScopedAuthHeaders(
  token: string,
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const scopedHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const organizationId = organizationHeaderFromHeaders(headers);
  if (organizationId) scopedHeaders[ORGANIZATION_HEADER] = organizationId;
  return scopedHeaders;
}

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function positiveInt(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}_invalid`);
  return parsed;
}

/**
 * Resolve o contexto ativo usando o JWT do próprio usuário. Não aceita organization_id
 * ou users_id vindos do cliente; a fonte de verdade é get_organization_context().
 */
export async function resolveOrganizationContext(client: SupabaseClient): Promise<OrganizationAuthContext> {
  const result = await client.rpc('get_organization_context');
  if (result.error) throw new Error(`organization_context_failed:${result.error.message}`);
  const payload = row(result.data);
  const organization = row(payload.organization);
  const member = row(payload.member);
  if (!organization.id || !organization.legacyScopeUsersId) throw new Error('organization_context_not_found');
  const accessLevel = String(member.accessLevel ?? (payload.isPlatformOwner ? 'platform_owner' : 'member')) as OrganizationAuthContext['accessLevel'];
  return {
    actorUsersId: positiveInt(payload.actorUsersId, 'actor_users_id'),
    organizationId: positiveInt(organization.id, 'organization_id'),
    scopeUsersId: positiveInt(organization.legacyScopeUsersId, 'scope_users_id'),
    memberId: member.id ? positiveInt(member.id, 'member_id') : null,
    accessLevel,
    isPlatformOwner: payload.isPlatformOwner === true,
  };
}
