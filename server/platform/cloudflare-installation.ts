import { serviceClient, text, type Row } from '../maps/shared.js';

declare const process: { env: Record<string, string | undefined> };

type CloudflareEnvelope<T> = { success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }> };
type TunnelResult = { id?: string; name?: string; status?: string; connections?: unknown[] };
type DnsRecord = { id?: string; name?: string; content?: string; type?: string };

type InstallationCloudflareMetadata = {
  provisioningVersion: number;
  tunnelId: string;
  tunnelName: string;
  evolutionPublicUrl: string;
  confirmedAt?: string;
};

function env(...keys: string[]) {
  for (const key of keys) {
    const value = text(process.env[key]);
    if (value) return value;
  }
  return '';
}

function requiredCloudflareConfig() {
  const apiToken = env('CLOUDFLARE_API_TOKEN', 'DESKTOP_CLOUDFLARE_API_TOKEN');
  const accountId = env('CLOUDFLARE_ACCOUNT_ID', 'DESKTOP_CLOUDFLARE_ACCOUNT_ID');
  const zoneId = env('CLOUDFLARE_ZONE_ID', 'DESKTOP_CLOUDFLARE_ZONE_ID');
  const baseDomain = env('DESKTOP_CLOUDFLARE_BASE_DOMAIN').replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  if (!apiToken || !accountId || !zoneId || !baseDomain) throw new Error('cloudflare_installation_provisioning_not_configured');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(baseDomain) || baseDomain.includes('..')) throw new Error('cloudflare_installation_base_domain_invalid');
  return { apiToken, accountId, zoneId, baseDomain };
}

async function cfRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { apiToken } = requiredCloudflareConfig();
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => ({})) as CloudflareEnvelope<T>;
  if (!response.ok || payload.success === false || payload.result === undefined) {
    const detail = payload.errors?.map((item) => `${item.code || 'cf'}:${item.message || 'unknown'}`).join('|') || `http_${response.status}`;
    throw new Error(`cloudflare_api_failed:${detail}`);
  }
  return payload.result;
}

function installationSuffix(organizationToolInstallationId: string) {
  const compact = organizationToolInstallationId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (compact.length < 10) throw new Error('cloudflare_installation_id_invalid');
  return compact.slice(0, 12);
}

async function tunnelExists(accountId: string, tunnelId: string) {
  if (!tunnelId) return false;
  try {
    const result = await cfRequest<TunnelResult>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`);
    return Boolean(result.id);
  } catch (error) {
    if (/1003|not found|http_404/i.test(error instanceof Error ? error.message : String(error))) return false;
    throw error;
  }
}

async function tunnelConnected(accountId: string, tunnelId: string) {
  if (!tunnelId) return false;
  const result = await cfRequest<TunnelResult>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`);
  const status = text(result.status).toLowerCase();
  return Boolean(result.id && (status === 'healthy' || status === 'degraded'));
}

async function createTunnel(accountId: string, name: string) {
  const result = await cfRequest<TunnelResult>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`, {
    method: 'POST',
    body: { name, config_src: 'cloudflare' },
  });
  const tunnelId = text(result.id);
  if (!tunnelId) throw new Error('cloudflare_tunnel_create_invalid_response');
  return { tunnelId, tunnelName: text(result.name) || name };
}

async function configureTunnel(accountId: string, tunnelId: string, input: { evolutionHostname: string }) {
  // R60 keeps a single public surface: the Gateway public listener. Evolution and Worker stay internal.
  const gatewayService = env('DESKTOP_GATEWAY_SERVICE_URL') || 'http://host.docker.internal:8090';
  await cfRequest(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`, {
    method: 'PUT',
    body: {
      config: {
        ingress: [
          { hostname: input.evolutionHostname, service: gatewayService, originRequest: {} },
          { service: 'http_status:404' },
        ],
      },
    },
  });
}

async function upsertTunnelDns(zoneId: string, hostname: string, tunnelId: string) {
  const query = new URLSearchParams({ type: 'CNAME', name: hostname });
  const records = await cfRequest<DnsRecord[]>(`/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`);
  const body = { type: 'CNAME', name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1 };
  const existing = records.find((record) => text(record.name).toLowerCase() === hostname.toLowerCase());
  if (existing?.id) {
    await cfRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existing.id)}`, { method: 'PUT', body });
  } else {
    await cfRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records`, { method: 'POST', body });
  }
}

async function deleteTunnelDns(zoneId: string, hostname: string) {
  const query = new URLSearchParams({ type: 'CNAME', name: hostname });
  const records = await cfRequest<DnsRecord[]>(`/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`);
  for (const record of records) {
    if (record.id && text(record.name).toLowerCase() === hostname.toLowerCase()) {
      await cfRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
    }
  }
}

async function tunnelToken(accountId: string, tunnelId: string) {
  const token = await cfRequest<string>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`);
  const normalized = text(token);
  if (!normalized) throw new Error('cloudflare_tunnel_token_missing');
  return normalized;
}

function storedCloudflare(metadata: Row): Partial<InstallationCloudflareMetadata> {
  const item = metadata.cloudflare;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
  const row = item as Row;
  return {
    provisioningVersion: Number(row.provisioningVersion || 0),
    tunnelId: text(row.tunnelId),
    tunnelName: text(row.tunnelName),
    evolutionPublicUrl: text(row.evolutionPublicUrl),
    confirmedAt: text(row.confirmedAt),
  };
}

export async function provisionInstallationCloudflare(input: {
  organizationId: number;
  organizationToolInstallationId: string;
  externalInstallationId: string;
}) {
  const { accountId, zoneId, baseDomain } = requiredCloudflareConfig();
  const client = serviceClient();
  const row = await client.from('organization_tool_installations')
    .select('organization_tool_installations_id,organizations_id,external_installation_id,metadata')
    .eq('organization_tool_installations_id', input.organizationToolInstallationId)
    .eq('organizations_id', input.organizationId)
    .eq('external_installation_id', input.externalInstallationId)
    .single();
  if (row.error || !row.data) throw new Error(`cloudflare_installation_query_failed:${row.error?.message || 'not_found'}`);

  const metadata = (row.data.metadata && typeof row.data.metadata === 'object' && !Array.isArray(row.data.metadata) ? row.data.metadata : {}) as Row;
  const stored = storedCloudflare(metadata);
  const suffix = installationSuffix(input.organizationToolInstallationId);
  const desiredName = `vinsansi-o${input.organizationId}-${suffix}`;
  let tunnelId = text(stored.tunnelId);
  let tunnelName = text(stored.tunnelName) || desiredName;

  if (!tunnelId || !(await tunnelExists(accountId, tunnelId))) {
    const created = await createTunnel(accountId, desiredName);
    tunnelId = created.tunnelId;
    tunnelName = created.tunnelName;
  }

  const evolutionHostname = `evolution-${suffix}.${baseDomain}`;
  const legacyWorkerHostname = `worker-${suffix}.${baseDomain}`;
  const cloudflareMetadata: InstallationCloudflareMetadata = {
    provisioningVersion: 1,
    tunnelId,
    tunnelName,
    evolutionPublicUrl: `https://${evolutionHostname}`, 
  };

  // Persista a identidade do túnel antes das etapas remotas seguintes. Se DNS ou
  // configuração falharem temporariamente, o próximo Reparar reutiliza o mesmo
  // Tunnel em vez de criar outro recurso órfão na conta Cloudflare.
  const preparedAt = new Date().toISOString();
  const prepared = await client.from('organization_tool_installations').update({
    metadata: { ...metadata, cloudflare: cloudflareMetadata },
    updated_at: preparedAt,
  }).eq('organization_tool_installations_id', input.organizationToolInstallationId);
  if (prepared.error) throw new Error(`cloudflare_installation_metadata_update_failed:${prepared.error.message}`);

  await configureTunnel(accountId, tunnelId, { evolutionHostname });
  await upsertTunnelDns(zoneId, evolutionHostname, tunnelId);
  await deleteTunnelDns(zoneId, legacyWorkerHostname);
  const token = await tunnelToken(accountId, tunnelId);

  // A troca da origem pública é deliberadamente bifásica. Provisionar o novo
  // túnel não altera instances_url: a instalação local precisa primeiro conectar
  // e validar o novo túnel. O Gerenciador chama confirmInstallationCloudflare
  // somente depois do healthcheck; assim uma falha/interrupção no reparo não
  // desvia o tráfego para uma origem que ainda não está disponível.
  return { ...cloudflareMetadata, token };
}

export async function confirmInstallationCloudflare(input: {
  organizationId: number;
  organizationToolInstallationId: string;
  externalInstallationId: string;
}) {
  const client = serviceClient();
  const row = await client.from('organization_tool_installations')
    .select('organization_tool_installations_id,organizations_id,external_installation_id,metadata,is_current')
    .eq('organization_tool_installations_id', input.organizationToolInstallationId)
    .eq('organizations_id', input.organizationId)
    .eq('external_installation_id', input.externalInstallationId)
    .single();
  if (row.error || !row.data) throw new Error(`cloudflare_installation_query_failed:${row.error?.message || 'not_found'}`);
  if (row.data.is_current === false) throw new Error('installation_superseded');

  const metadata = (row.data.metadata && typeof row.data.metadata === 'object' && !Array.isArray(row.data.metadata) ? row.data.metadata : {}) as Row;
  const stored = storedCloudflare(metadata);
  if (!stored.tunnelId || !stored.evolutionPublicUrl || Number(stored.provisioningVersion || 0) < 1) {
    throw new Error('cloudflare_installation_not_provisioned');
  }
  const { accountId } = requiredCloudflareConfig();
  if (!(await tunnelConnected(accountId, stored.tunnelId))) throw new Error('cloudflare_installation_tunnel_not_ready');

  const confirmedAt = new Date().toISOString();
  const cloudflareMetadata: InstallationCloudflareMetadata = {
    provisioningVersion: Number(stored.provisioningVersion || 1),
    tunnelId: stored.tunnelId,
    tunnelName: stored.tunnelName || '',
    evolutionPublicUrl: stored.evolutionPublicUrl,
    confirmedAt,
  };

  // O Gerenciador WhatsApp ocupa o slot operacional primário da organização.
  // Só depois da confirmação local todas as instâncias passam para a nova origem.
  const instances = await client.from('instances').update({
    instances_url: cloudflareMetadata.evolutionPublicUrl,
    instances_updated_at: confirmedAt,
  }).eq('organizations_id', input.organizationId);
  if (instances.error) throw new Error(`cloudflare_installation_instances_update_failed:${instances.error.message}`);

  const updated = await client.from('organization_tool_installations').update({
    metadata: { ...metadata, cloudflare: cloudflareMetadata },
    updated_at: confirmedAt,
  }).eq('organization_tool_installations_id', input.organizationToolInstallationId);
  if (updated.error) throw new Error(`cloudflare_installation_metadata_update_failed:${updated.error.message}`);

  return cloudflareMetadata;
}
