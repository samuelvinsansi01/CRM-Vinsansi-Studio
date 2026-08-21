import { getSupabaseClient } from '../../lib/supabase';

export type ToolId = 'vinsansi_capture' | 'vinsansi_instagram' | 'vinsansi_whatsapp_manager';
export type ToolAdministrativeStatus = 'not_registered' | 'registered' | 'disabled' | 'revoked';
export type ToolPresence = 'online' | 'offline' | 'never_seen' | 'not_supported';
export type ToolCompatibility = 'compatible' | 'update_available' | 'incompatible' | 'unknown';
export type ToolInstallationStatus = 'registered' | 'disabled' | 'revoked';

export type OrganizationToolSummary = {
  toolId: ToolId;
  displayName: string;
  description: string;
  category: string;
  catalogStatus: string;
  latestVersion: string | null;
  minimumSupportedVersion: string | null;
  administrativeStatus: ToolAdministrativeStatus;
  enabled: boolean;
  installationCount: number;
  presence: ToolPresence;
  compatibility: ToolCompatibility;
  installedVersion: string | null;
  lastSeenAt: string | null;
  lastActivityAt: string | null;
  entitlements: Record<string, unknown>;
};

export type ToolInstallation = {
  id: string;
  externalInstallationId: string;
  registrationStatus: ToolInstallationStatus;
  installedVersion: string | null;
  reportedCapabilities: string[];
  presence: ToolPresence;
  compatibility: ToolCompatibility;
  registeredByMemberId: string | null;
  lastSeenAt: string | null;
  lastActivityAt: string | null;
  registeredAt: string;
  metadata: Record<string, unknown>;
};

export type OrganizationToolDetails = {
  toolId: ToolId;
  displayName: string;
  description: string;
  category: string;
  latestVersion: string | null;
  minimumSupportedVersion: string | null;
  administrativeStatus: ToolAdministrativeStatus;
  enabled: boolean;
  entitlements: Record<string, unknown>;
  installations: ToolInstallation[];
};

export type OrganizationToolSettings = {
  toolId: ToolId;
  settings: Record<string, unknown>;
  settingsVersion: number;
  settingsSchemaVersion: number;
  settingsSchema: Record<string, unknown>;
  defaultSettings: Record<string, unknown>;
  updatedAt: string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function rpcError(prefix: string, error: { message?: string } | null) {
  const message = text(error?.message);
  if (message.includes('tool_settings_version_conflict')) {
    return new Error('Conflito de edição: outra sessão atualizou esta configuração. Recarregue os dados antes de salvar novamente.');
  }
  if (message.includes('tool_settings_invalid')) {
    return new Error('A configuração não atende ao schema canônico da ferramenta. Revise os campos informados.');
  }
  return new Error(`${prefix}${message ? `: ${message}` : '.'}`);
}

function summary(value: unknown): OrganizationToolSummary {
  const row = object(value);
  return {
    toolId: text(row.toolId) as ToolId,
    displayName: text(row.displayName),
    description: text(row.description),
    category: text(row.category),
    catalogStatus: text(row.catalogStatus),
    latestVersion: nullableText(row.latestVersion),
    minimumSupportedVersion: nullableText(row.minimumSupportedVersion),
    administrativeStatus: text(row.administrativeStatus) as ToolAdministrativeStatus,
    enabled: Boolean(row.enabled),
    installationCount: Number(row.installationCount ?? 0),
    presence: text(row.presence) as ToolPresence,
    compatibility: text(row.compatibility) as ToolCompatibility,
    installedVersion: nullableText(row.installedVersion),
    lastSeenAt: nullableText(row.lastSeenAt),
    lastActivityAt: nullableText(row.lastActivityAt),
    entitlements: object(row.entitlements),
  };
}

function installation(value: unknown): ToolInstallation {
  const row = object(value);
  return {
    id: text(row.id),
    externalInstallationId: text(row.externalInstallationId),
    registrationStatus: text(row.registrationStatus) as ToolInstallationStatus,
    installedVersion: nullableText(row.installedVersion),
    reportedCapabilities: list(row.reportedCapabilities).map(text).filter(Boolean),
    presence: text(row.presence) as ToolPresence,
    compatibility: text(row.compatibility) as ToolCompatibility,
    registeredByMemberId: nullableText(row.registeredByMemberId),
    lastSeenAt: nullableText(row.lastSeenAt),
    lastActivityAt: nullableText(row.lastActivityAt),
    registeredAt: text(row.registeredAt),
    metadata: object(row.metadata),
  };
}

export const toolsService = {
  async list(): Promise<OrganizationToolSummary[]> {
    const { data, error } = await getSupabaseClient().rpc('list_organization_tools');
    if (error) throw rpcError('Não foi possível carregar a Central de Ferramentas', error);
    return list(data).map(summary);
  },

  async details(toolId: ToolId): Promise<OrganizationToolDetails> {
    const { data, error } = await getSupabaseClient().rpc('get_organization_tool_details', { p_tool_id: toolId });
    if (error) throw rpcError('Não foi possível carregar os detalhes da ferramenta', error);
    const row = object(data);
    return {
      toolId: text(row.toolId) as ToolId,
      displayName: text(row.displayName),
      description: text(row.description),
      category: text(row.category),
      latestVersion: nullableText(row.latestVersion),
      minimumSupportedVersion: nullableText(row.minimumSupportedVersion),
      administrativeStatus: text(row.administrativeStatus) as ToolAdministrativeStatus,
      enabled: Boolean(row.enabled),
      entitlements: object(row.entitlements),
      installations: list(row.installations).map(installation),
    };
  },

  async settings(toolId: ToolId): Promise<OrganizationToolSettings> {
    const { data, error } = await getSupabaseClient().rpc('get_organization_tool_settings', { p_tool_id: toolId });
    if (error) throw rpcError('Não foi possível carregar as configurações da ferramenta', error);
    const row = object(data);
    return {
      toolId: text(row.toolId) as ToolId,
      settings: object(row.settings),
      settingsVersion: Number(row.settingsVersion ?? 0),
      settingsSchemaVersion: Number(row.settingsSchemaVersion ?? 1),
      settingsSchema: object(row.settingsSchema),
      defaultSettings: object(row.defaultSettings),
      updatedAt: nullableText(row.updatedAt),
    };
  },

  async saveSettings(toolId: ToolId, settings: Record<string, unknown>, expectedSettingsVersion: number) {
    const { data, error } = await getSupabaseClient().rpc('save_organization_tool_settings', {
      p_tool_id: toolId,
      p_settings: settings,
      p_expected_settings_version: expectedSettingsVersion,
    });
    if (error) throw rpcError('Não foi possível salvar as configurações da ferramenta', error);
    return object(data);
  },

  async resetSettings(toolId: ToolId, expectedSettingsVersion: number) {
    const { data, error } = await getSupabaseClient().rpc('reset_organization_tool_settings', {
      p_tool_id: toolId,
      p_expected_settings_version: expectedSettingsVersion,
    });
    if (error) throw rpcError('Não foi possível restaurar as configurações da ferramenta', error);
    return object(data);
  },

  async setEnabled(toolId: ToolId, enabled: boolean) {
    const { error } = await getSupabaseClient().rpc('set_organization_tool_enabled', { p_tool_id: toolId, p_enabled: enabled });
    if (error) throw rpcError(`Não foi possível ${enabled ? 'habilitar' : 'desabilitar'} a ferramenta`, error);
  },

  async setInstallationStatus(installationId: string, status: 'disabled' | 'revoked') {
    const { error } = await getSupabaseClient().rpc('set_tool_installation_status', { p_installation_id: installationId, p_status: status });
    if (error) throw rpcError('Não foi possível alterar a instalação', error);
  },
};
