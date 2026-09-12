import { getSupabaseClient } from '../../lib/supabase';

export type HomologationStatus = 'pending' | 'passed' | 'failed' | 'not_applicable';

export type HomologationRun = {
  id: string;
  releaseVersion: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};

export type HomologationCheck = {
  key: string;
  section: string;
  label: string;
  required: boolean;
  status: HomologationStatus;
  evidence?: string | null;
  checkedAt?: string | null;
  checkedByMemberId?: number | null;
};

export type HomologationSnapshot = { run: HomologationRun; checks: HomologationCheck[] };

const RELEASE = '2.4.0-R60.9';
const MANAGER_TOOL_ID = 'vinsansi_whatsapp_manager';
const CORE_RUNTIME_TYPES = ['manager', 'worker', 'gateway', 'evolution'] as const;

type Row = Record<string, unknown>;

function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function check(key: string, section: string, label: string, passed: boolean, evidence: string): HomologationCheck {
  return {
    key, section, label, required: true,
    status: passed ? 'passed' : 'failed',
    evidence,
    checkedAt: new Date().toISOString(),
    checkedByMemberId: null,
  };
}

function optionalCheck(key: string, section: string, label: string, passed: boolean, evidence: string): HomologationCheck {
  return { ...check(key, section, label, passed, evidence), required: false };
}

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

function componentVersion(releaseManifest: Row, component: string) {
  return text(object(object(releaseManifest.components)[component]).version);
}

function cloudflareMetadata(metadata: unknown) {
  return object(object(metadata).cloudflare);
}

function publicHostname(value: unknown) {
  try { return new URL(text(value)).hostname.toLowerCase(); }
  catch { return ''; }
}

function hasSecretLikeKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSecretLikeKey);
  for (const [key, child] of Object.entries(value as Row)) {
    if (/(^|_)(token|secret|password|credential|api[_-]?key)($|_)/i.test(key)) return true;
    if (hasSecretLikeKey(child)) return true;
  }
  return false;
}

async function loadCanonicalPlatformRelease(): Promise<Row> {
  const response = await fetch('/api/system?route=public-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok || payload.ok === false) throw new Error(`Homologação: Control Plane canônico indisponível (${response.status}).`);
  const manifest = object(payload.platformRelease);
  if (Number(manifest.schemaVersion) !== 2) throw new Error('Homologação: manifesto canônico R60 schema 2 ausente.');
  return manifest;
}

export async function getHomologationSnapshot(): Promise<HomologationSnapshot> {
  const client = getSupabaseClient();
  const checks: HomologationCheck[] = [];

  const leadStatus = await client.from('lead_status').select('lead_status_id,lead_status_name').order('lead_status_id');
  if (leadStatus.error) throw new Error(`Homologação: falha ao ler lead_status: ${leadStatus.error.message}`);
  const expectedLeadStatus = ['importado','revisao','sem_contato','na_fila','enviado','invalido','duplicado'];
  const actualLeadStatus = (leadStatus.data ?? []).map((row) => normalized(row.lead_status_name));
  checks.push(check(
    'lead_status_contract', 'Banco', 'Contrato comercial de 7 status',
    actualLeadStatus.length === expectedLeadStatus.length && expectedLeadStatus.every((name, index) => actualLeadStatus[index] === name),
    `Atual: ${actualLeadStatus.join(', ') || 'vazio'}`,
  ));

  const channels = await client.from('channels').select('channels_name').order('channels_id');
  if (channels.error) throw new Error(`Homologação: falha ao ler channels: ${channels.error.message}`);
  const actualChannels = (channels.data ?? []).map((row) => normalized(row.channels_name)).sort();
  const expectedChannels = ['instagram','sem_destino','whatsapp'].sort();
  checks.push(check(
    'channels_contract', 'Banco', 'Canais WhatsApp / Instagram / Sem destino',
    actualChannels.length === 3 && expectedChannels.every((name, index) => actualChannels[index] === name),
    `Atual: ${actualChannels.join(', ') || 'vazio'}`,
  ));

  const releaseManifest = await loadCanonicalPlatformRelease();
  const platform = await client.from('platform_tools')
    .select('tool_id,catalog_status,latest_version,minimum_supported_version')
    .eq('tool_id', MANAGER_TOOL_ID).maybeSingle();
  if (platform.error) throw new Error(`Homologação: falha ao ler projeção compatível do catálogo: ${platform.error.message}`);
  const platformRow = object(platform.data);
  const releaseComponents = object(releaseManifest.components);
  const healthPolicy = object(releaseManifest.healthPolicy);
  const latestManagerVersion = text(object(releaseManifest.manager).latestVersion);
  const minimumManagerVersion = text(object(releaseManifest.manager).minimumSupportedVersion);
  const manifestVersions = {
    worker: componentVersion(releaseManifest, 'worker'),
    gateway: componentVersion(releaseManifest, 'gateway'),
    evolution: componentVersion(releaseManifest, 'evolution'),
    cloudflared: componentVersion(releaseManifest, 'cloudflared'),
  };
  const releaseReady = Boolean(latestManagerVersion)
    && Number(releaseManifest.schemaVersion) === 2
    && text(releaseManifest.releaseStage) === 'candidate'
    && releaseManifest.productionReady === false
    && releaseManifest.resumeAllowed === false
    && Object.values(manifestVersions).every(Boolean)
    && number(healthPolicy.runtimeTtlSeconds) >= 30
    && number(healthPolicy.managerHeartbeatSeconds) >= 15
    && number(healthPolicy.workerHeartbeatSeconds) >= 15;
  checks.push(check(
    'control_plane_release', 'Control Plane', 'Versão oficial e manifesto central consistentes', releaseReady,
    `Gerenciador ${latestManagerVersion || '—'}; Worker ${manifestVersions.worker || '—'}; Gateway ${manifestVersions.gateway || '—'}; Evolution ${manifestVersions.evolution || '—'}; Cloudflared ${manifestVersions.cloudflared || '—'}; TTL ${number(healthPolicy.runtimeTtlSeconds) || 0}s.`,
  ));
  const projectionAligned = !platform.data || (text(platformRow.latest_version) === latestManagerVersion && text(platformRow.minimum_supported_version) === minimumManagerVersion);
  checks.push(optionalCheck(
    'legacy_catalog_projection', 'Compatibilidade', 'platform_tools acompanha a release canônica como projeção não autoritativa', projectionAligned,
    !platform.data ? 'Nenhuma projeção legada presente; Control Plane canônico permanece autoridade.' : `Projeção ${text(platformRow.latest_version) || '—'} / mínimo ${text(platformRow.minimum_supported_version) || '—'}; autoridade ${latestManagerVersion || '—'} / mínimo ${minimumManagerVersion || '—'}.`,
  ));

  const health = await client.rpc('get_operational_health');
  if (health.error) throw new Error(`Homologação: falha ao ler saúde operacional: ${health.error.message}`);
  const healthRow = object(health.data);
  const organizationId = number(healthRow.organizationId);
  const runtimeComponents = list(healthRow.components).map(object);
  checks.push(check(
    'operational_health', 'Runtime', 'Monitoramento operacional disponível', Boolean(health.data),
    `Organização ${organizationId || '—'}; ${runtimeComponents.length} componente(s) publicado(s).`,
  ));

  const installations = await client.from('organization_tool_installations')
    .select('organization_tool_installations_id,organizations_id,tool_id,external_installation_id,registration_status,installed_version,last_seen_at,last_activity_at,registered_at,metadata,operational_slot,is_current,superseded_at,superseded_by_installation_id')
    .eq('tool_id', MANAGER_TOOL_ID)
    .order('registered_at', { ascending: false });
  if (installations.error) throw new Error(`Homologação: falha ao ler instalações: ${installations.error.message}`);
  const installationRows = (installations.data ?? []).map((row) => object(row));
  const visibleOrgIds = [...new Set(installationRows.map((row) => number(row.organizations_id)).filter(Boolean))];
  checks.push(check(
    'installation_rls_scope', 'Isolamento', 'Instalações visíveis restritas à organização ativa',
    organizationId > 0 && visibleOrgIds.every((id) => id === organizationId),
    `Organização ativa ${organizationId || '—'}; organizações visíveis: ${visibleOrgIds.join(', ') || 'nenhuma'}.`,
  ));

  const currentPrimary = installationRows.filter((row) => row.is_current === true && text(row.registration_status) === 'registered' && text(row.operational_slot) === 'primary');
  const current = currentPrimary[0] ?? null;
  checks.push(check(
    'manager_single_current_installation', 'Instalação', 'Uma única instalação raiz corrente no slot primário', currentPrimary.length === 1,
    currentPrimary.length === 1 ? `Instalação ${text(current?.external_installation_id)} registrada e corrente.` : `Encontradas ${currentPrimary.length} instalações correntes no slot primário.`,
  ));

  checks.push(check(
    'manager_official_version', 'Instalação', 'Gerenciador corrente segue a versão oficial',
    Boolean(current && latestManagerVersion && text(current.installed_version) === latestManagerVersion),
    `Instalado ${text(current?.installed_version) || '—'}; oficial ${latestManagerVersion || '—'}.`,
  ));

  const cloudflare = cloudflareMetadata(current?.metadata);
  const evolutionPublicUrl = text(cloudflare.evolutionPublicUrl);
  const evolutionHost = publicHostname(evolutionPublicUrl);
  const cloudflareReady = Number(cloudflare.provisioningVersion || 0) >= 1
    && Boolean(text(cloudflare.tunnelId))
    && Boolean(text(cloudflare.tunnelName))
    && Boolean(text(cloudflare.confirmedAt))
    && evolutionPublicUrl.startsWith('https://')
    && evolutionHost.startsWith('evolution-');
  checks.push(check(
    'cloudflare_installation_isolated', 'Instalação', 'Cloudflare Tunnel exclusivo aponta para o Gateway público e está confirmado', cloudflareReady,
    cloudflareReady ? `${text(cloudflare.tunnelName)} · ${evolutionHost} · Worker interno sem ingress público` : 'Metadata Cloudflare exclusiva ainda incompleta ou não confirmada.',
  ));

  checks.push(check(
    'installation_metadata_no_secrets', 'Segurança', 'Metadata da instalação não contém credenciais técnicas',
    Boolean(current) && !hasSecretLikeKey(current?.metadata),
    current && !hasSecretLikeKey(current.metadata) ? 'Nenhuma chave sensível detectada na metadata persistida.' : 'Foi encontrada chave com aparência de segredo ou a instalação corrente não pôde ser validada.',
  ));

  const instances = await client.from('instances').select('instances_id,organizations_id,instances_name,instances_url').order('instances_id');
  if (instances.error) throw new Error(`Homologação: falha ao ler instâncias WhatsApp: ${instances.error.message}`);
  const instanceRows = (instances.data ?? []).map((row) => object(row));
  const instancesAligned = Boolean(evolutionPublicUrl) && instanceRows.every((row) => text(row.instances_url) === evolutionPublicUrl);
  checks.push(check(
    'instances_cloudflare_origin', 'Instalação', 'Instâncias WhatsApp usam o listener público do Gateway da instalação corrente',
    instanceRows.length === 0 ? cloudflareReady : instancesAligned,
    instanceRows.length === 0 ? 'Nenhuma instância WhatsApp cadastrada nesta organização.' : `${instanceRows.filter((row) => text(row.instances_url) === evolutionPublicUrl).length}/${instanceRows.length} instância(s) apontando para ${evolutionHost || 'origem não confirmada'}.`,
  ));

  const currentInstallationId = text(current?.organization_tool_installations_id);
  const heartbeatRows = currentInstallationId ? await client.from('platform_runtime_heartbeats')
    .select('organizations_id,organization_tool_installations_id,component_type,component_key,component_version,runtime_status,last_seen_at,metadata')
    .eq('organization_tool_installations_id', currentInstallationId) : { data: [], error: null };
  if (heartbeatRows.error) throw new Error(`Homologação: falha ao ler heartbeats: ${heartbeatRows.error.message}`);
  const canonicalHeartbeats = (heartbeatRows.data ?? []).map((row) => object(row));
  const runtimePolicyTtl = Math.max(30, number(object(healthRow.runtimePolicy).ttlSeconds) || number(healthPolicy.runtimeTtlSeconds) || 180);
  const now = Date.now();
  const onlineByType = new Map<string, Row>();
  for (const row of canonicalHeartbeats) {
    const lastSeen = Date.parse(text(row.last_seen_at));
    const fresh = Number.isFinite(lastSeen) && now - lastSeen <= runtimePolicyTtl * 1000;
    if (fresh && ['online', 'degraded'].includes(text(row.runtime_status))) onlineByType.set(text(row.component_type), row);
  }
  const expectedRuntimeVersions: Record<string, string> = {
    manager: latestManagerVersion,
    worker: manifestVersions.worker,
    gateway: manifestVersions.gateway,
    evolution: manifestVersions.evolution,
  };
  const runtimeReady = CORE_RUNTIME_TYPES.every((type) => {
    const row = onlineByType.get(type);
    return Boolean(row && text(row.component_version) === expectedRuntimeVersions[type]);
  });
  checks.push(check(
    'canonical_runtime_authority', 'Runtime', 'Runtime físico publicado pela instalação corrente', runtimeReady,
    CORE_RUNTIME_TYPES.map((type) => `${type}:${text(onlineByType.get(type)?.component_version) || 'offline'}`).join(' · '),
  ));

  const operationalDateResult = await client.rpc('queue_operational_today_r59');
  const operationalDate = text(operationalDateResult.data);
  const reviewWhatsapp = operationalDate ? await client.rpc('list_queue_review_resources', {
    p_channel: 'whatsapp',
    p_scheduled_date: operationalDate,
  }) : { data: [], error: null };
  const reviewInstagram = operationalDate ? await client.rpc('list_queue_review_resources', {
    p_channel: 'instagram',
    p_scheduled_date: operationalDate,
  }) : { data: [], error: null };
  const reviewReadable = !operationalDateResult.error && Boolean(operationalDate) && !reviewWhatsapp.error && !reviewInstagram.error;
  const whatsappResources = list(reviewWhatsapp.data).map(object);
  const instagramResources = list(reviewInstagram.data).map(object);
  const whatsappOpen = whatsappResources.reduce((total, row) => total + number(row.review_open ?? row.reviewOpen), 0);
  const instagramOpen = instagramResources.reduce((total, row) => total + number(row.review_open ?? row.reviewOpen), 0);
  const reviewError = operationalDateResult.error || reviewWhatsapp.error || reviewInstagram.error;
  checks.push(check(
    'review_contract', 'Fluxo', 'Revisão e reservas operacionais legíveis', reviewReadable,
    reviewReadable
      ? `Data operacional ${operationalDate}; WhatsApp: ${whatsappResources.length} recurso(s), ${whatsappOpen} reserva(s) aberta(s); Instagram: ${instagramResources.length} recurso(s), ${instagramOpen} reserva(s) aberta(s).`
      : `Falha no contrato canônico de revisão: ${text(object(reviewError).message) || text(object(reviewError).details) || text(object(reviewError).code) || 'erro não detalhado'}`,
  ));

  const queued = await client.from('leads').select('leads_id', { count: 'exact', head: true }).eq('lead_status_id', 4);
  const queueItems = await client.from('queue_items').select('queue_items_id', { count: 'exact', head: true });
  const queueReadable = !queued.error && !queueItems.error;
  checks.push(check(
    'queue_contract', 'Fluxo', 'Fila operacional legível', queueReadable,
    queueReadable ? `Leads na fila: ${queued.count ?? 0}; queue_items: ${queueItems.count ?? 0}` : String(queued.error?.message || queueItems.error?.message || 'erro'),
  ));

  const passed = checks.every((item) => !item.required || item.status === 'passed' || item.status === 'not_applicable');
  const nowIso = new Date().toISOString();
  return {
    run: {
      id: 'runtime-r60-candidate', releaseVersion: RELEASE, status: passed ? 'passed' : 'failed',
      startedAt: nowIso, completedAt: nowIso,
      notes: 'Homologação automática e somente leitura do Candidate R60, Control Plane, instalação corrente, isolamento e runtime canônico. Não executa o Smoke SQL nem arma resume.',
    },
    checks,
  };
}

export async function getProductionReadiness(): Promise<Record<string, unknown>> {
  const snapshot = await getHomologationSnapshot();
  const required = snapshot.checks.filter((item) => item.required);
  const accepted = required.filter((item) => item.status === 'passed' || item.status === 'not_applicable');
  return {
    ok: accepted.length === required.length,
    releaseVersion: RELEASE,
    passed: required.filter((item) => item.status === 'passed').length,
    total: required.length,
  };
}
