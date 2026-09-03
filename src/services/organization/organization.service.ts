import { getSupabaseClient } from '../../lib/supabase';
import { organizationRequestHeaders } from './organizationSession';

export type AccessLevel = 'platform_owner' | 'owner' | 'manager' | 'member' | 'none';

export type OrganizationSummary = {
  id: string;
  name: string;
  accessLevel: AccessLevel;
  memberId: string | null;
  roleName: string | null;
  active: boolean;
};

export type OrganizationContext = {
  actorUsersId: string;
  isPlatformOwner: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    legacyScopeUsersId: string;
  } | null;
  member: {
    id: string;
    accessLevel: Exclude<AccessLevel, 'platform_owner' | 'none'>;
    roleId: string | null;
    roleName: string | null;
  } | null;
  permissions: string[];
  organizations: OrganizationSummary[];
};

export type OrganizationMember = {
  id: string;
  usersId: string;
  name: string;
  email: string;
  accessLevel: 'owner' | 'manager' | 'member';
  roleId: string | null;
  roleName: string | null;
  active: boolean;
  joinedAt: string;
  deactivatedAt: string | null;
};

export type OrganizationRole = {
  id: string;
  name: string;
  key: string;
  description: string;
  systemTemplate: boolean;
  editable: boolean;
  active: boolean;
  memberCount: number;
  permissionKeys: string[];
  assignable: boolean;
};

export type PermissionOption = {
  key: string;
  name: string;
  category: string;
  description: string;
};

export type OrganizationInvitation = {
  id: string;
  email: string;
  accessLevel: 'manager' | 'member';
  roleId: string | null;
  roleName: string | null;
  status: 'pending' | 'accepted' | 'canceled' | 'expired';
  expiresAt: string;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function text(value: unknown) {
  return value == null ? '' : String(value);
}

function nullableText(value: unknown) {
  const result = text(value).trim();
  return result || null;
}

function mapContext(raw: unknown): OrganizationContext {
  const value = asRecord(raw);
  const organizationRaw = asRecord(value.organization);
  const memberRaw = asRecord(value.member);
  const organizations = asArray<Record<string, unknown>>(value.organizations).map((item) => ({
    id: text(item.id),
    name: text(item.name),
    accessLevel: (text(item.accessLevel) || 'none') as AccessLevel,
    memberId: nullableText(item.memberId),
    roleName: nullableText(item.roleName),
    active: Boolean(item.active),
  }));

  return {
    actorUsersId: text(value.actorUsersId),
    isPlatformOwner: Boolean(value.isPlatformOwner),
    organization: organizationRaw.id ? {
      id: text(organizationRaw.id),
      name: text(organizationRaw.name),
      slug: text(organizationRaw.slug),
      legacyScopeUsersId: text(organizationRaw.legacyScopeUsersId),
    } : null,
    member: memberRaw.id ? {
      id: text(memberRaw.id),
      accessLevel: (text(memberRaw.accessLevel) || 'member') as 'owner' | 'manager' | 'member',
      roleId: nullableText(memberRaw.roleId),
      roleName: nullableText(memberRaw.roleName),
    } : null,
    permissions: asArray(value.permissions).map(text).filter(Boolean),
    organizations,
  };
}

export async function acceptPendingOrganizationInvitations() {
  const { data, error } = await getSupabaseClient().rpc('accept_current_user_invitations');
  if (error) throw new Error(`Não foi possível aceitar convites da organização: ${error.message}`);
  return Number(data ?? 0);
}

export async function getOrganizationContext() {
  const { data, error } = await getSupabaseClient().rpc('get_organization_context');
  if (error) {
    const hint = /get_organization_context|function/i.test(error.message)
      ? ' Aplique APLICAR-NO-SUPABASE-v1.1.0.sql antes de publicar esta versão.'
      : '';
    throw new Error(`Não foi possível carregar o contexto da organização: ${error.message}.${hint}`);
  }
  return mapContext(data);
}

export async function switchActiveOrganization(organizationId: string) {
  const { error } = await getSupabaseClient().rpc('set_active_organization', {
    p_organizations_id: Number(organizationId),
  });
  if (error) throw new Error(`Não foi possível trocar de organização: ${error.message}`);
}

export async function updateCurrentOrganization(name: string) {
  const { error } = await getSupabaseClient().rpc('update_current_organization', { p_name: name });
  if (error) throw new Error(`Não foi possível atualizar a organização: ${error.message}`);
}

export async function createOrganization(name: string) {
  const { data, error } = await getSupabaseClient().rpc('create_organization', { p_name: name });
  if (error) throw new Error(`Não foi possível criar a organização: ${error.message}`);
  return String(data);
}

export async function listOrganizationMembers(): Promise<OrganizationMember[]> {
  const { data, error } = await getSupabaseClient().rpc('list_organization_members_admin');
  if (error) throw new Error(`Não foi possível carregar os membros: ${error.message}`);
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: text(row.member_id),
    usersId: text(row.users_id),
    name: text(row.name) || 'Membro',
    email: text(row.email),
    accessLevel: text(row.access_level) as 'owner' | 'manager' | 'member',
    roleId: nullableText(row.role_id),
    roleName: nullableText(row.role_name),
    active: Number(row.status_id) === 1,
    joinedAt: text(row.joined_at),
    deactivatedAt: nullableText(row.deactivated_at),
  }));
}

export async function listOrganizationInvitations(): Promise<OrganizationInvitation[]> {
  const { data, error } = await getSupabaseClient().rpc('list_organization_invitations');
  if (error) throw new Error(`Não foi possível carregar os convites: ${error.message}`);
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: text(row.invitation_id),
    email: text(row.email),
    accessLevel: text(row.access_level) as 'manager' | 'member',
    roleId: nullableText(row.role_id),
    roleName: nullableText(row.role_name),
    status: text(row.status) as OrganizationInvitation['status'],
    expiresAt: text(row.expires_at),
    createdAt: text(row.created_at),
  }));
}

export async function inviteOrganizationMember(input: {
  email: string;
  accessLevel: 'manager' | 'member';
  roleId: string | null;
}) {
  const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error(sessionError?.message ?? 'Sessão necessária para convidar membro.');
  }

  const response = await fetch('/api/organization/invitations', {
    method: 'POST',
    headers: organizationRequestHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    }),
    body: JSON.stringify({
      email: input.email,
      access_level: input.accessLevel,
      role_id: input.roleId ? Number(input.roleId) : null,
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(text(payload.error) || 'Não foi possível enviar o convite.');
  return payload;
}

export async function cancelOrganizationInvitation(invitationId: string) {
  const { error } = await getSupabaseClient().rpc('cancel_organization_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(`Não foi possível cancelar o convite: ${error.message}`);
}

export async function updateOrganizationMember(input: {
  memberId: string;
  accessLevel: 'manager' | 'member';
  roleId: string | null;
}) {
  const { error } = await getSupabaseClient().rpc('update_organization_member', {
    p_member_id: Number(input.memberId),
    p_access_level: input.accessLevel,
    p_role_id: input.roleId ? Number(input.roleId) : null,
  });
  if (error) throw new Error(`Não foi possível atualizar o membro: ${error.message}`);
}

export async function setOrganizationMemberActive(input: {
  memberId: string;
  active: boolean;
  reassignToMemberId?: string | null;
}) {
  const { error } = await getSupabaseClient().rpc('set_organization_member_active', {
    p_member_id: Number(input.memberId),
    p_active: input.active,
    p_reassign_to_member_id: input.reassignToMemberId ? Number(input.reassignToMemberId) : null,
  });
  if (error) throw new Error(`Não foi possível ${input.active ? 'reativar' : 'desativar'} o membro: ${error.message}`);
}

export async function transferOrganizationOwnership(targetMemberId: string) {
  const { error } = await getSupabaseClient().rpc('transfer_organization_ownership', {
    p_target_member_id: Number(targetMemberId),
  });
  if (error) throw new Error(`Não foi possível transferir a propriedade: ${error.message}`);
}

export async function listOrganizationRoles(): Promise<OrganizationRole[]> {
  const { data, error } = await getSupabaseClient().rpc('list_organization_roles_admin');
  if (error) throw new Error(`Não foi possível carregar as funções: ${error.message}`);
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: text(row.role_id),
    name: text(row.name),
    key: text(row.role_key),
    description: text(row.description),
    systemTemplate: Boolean(row.is_system_template),
    editable: Boolean(row.is_editable),
    active: Number(row.status_id) === 1,
    memberCount: Number(row.member_count ?? 0),
    permissionKeys: asArray(row.permission_keys).map(text),
    assignable: Boolean(row.can_assign),
  }));
}

export async function listDelegablePermissions(): Promise<PermissionOption[]> {
  const { data, error } = await getSupabaseClient().rpc('list_delegable_permissions');
  if (error) throw new Error(`Não foi possível carregar as permissões: ${error.message}`);
  return asArray<Record<string, unknown>>(data).map((row) => ({
    key: text(row.permission_key),
    name: text(row.name),
    category: text(row.category),
    description: text(row.description),
  }));
}

export async function saveOrganizationRole(input: {
  id?: string | null;
  name: string;
  description: string;
  permissionKeys: string[];
}) {
  const { data, error } = await getSupabaseClient().rpc('save_organization_role', {
    p_role_id: input.id ? Number(input.id) : null,
    p_name: input.name,
    p_description: input.description,
    p_permission_keys: input.permissionKeys,
  });
  if (error) throw new Error(`Não foi possível salvar a função: ${error.message}`);
  return String(data);
}

export async function deleteOrganizationRole(roleId: string) {
  const { error } = await getSupabaseClient().rpc('delete_organization_role', {
    p_role_id: Number(roleId),
  });
  if (error) throw new Error(`Não foi possível excluir a função: ${error.message}`);
}

export type PlatformOrganization = {
  id: string;
  name: string;
  active: boolean;
  ownerMemberId: string | null;
  ownerName: string;
  ownerEmail: string;
  memberCount: number;
  createdAt: string;
};

export async function listPlatformOrganizations(): Promise<PlatformOrganization[]> {
  const { data, error } = await getSupabaseClient().rpc('list_platform_organizations_admin');
  if (error) throw new Error(`Não foi possível carregar as organizações da plataforma: ${error.message}`);
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: text(row.organization_id),
    name: text(row.name),
    active: Number(row.status_id) === 1,
    ownerMemberId: nullableText(row.owner_member_id),
    ownerName: text(row.owner_name),
    ownerEmail: text(row.owner_email),
    memberCount: Number(row.member_count ?? 0),
    createdAt: text(row.created_at),
  }));
}

export async function setPlatformOrganizationActive(organizationId: string, active: boolean) {
  const { error } = await getSupabaseClient().rpc('set_organization_active', {
    p_organization_id: Number(organizationId),
    p_active: active,
  });
  if (error) throw new Error(`Não foi possível ${active ? 'reativar' : 'desativar'} a organização: ${error.message}`);
}
