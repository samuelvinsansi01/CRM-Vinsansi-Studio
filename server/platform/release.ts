import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

type Row = Record<string, unknown>;

type ToolRelease = {
  toolId: string;
  latestVersion: string;
  minimumSupportedVersion: string;
};

type ComponentRelease = { version: string; image?: string };
type HealthPolicy = { runtimeTtlSeconds:number; managerHeartbeatSeconds:number; workerHeartbeatSeconds:number };

export type PlatformReleaseManifest = {
  schemaVersion: number;
  generatedAt: string;
  manager: ToolRelease;
  capture: ToolRelease;
  instagram: ToolRelease;
  healthPolicy: HealthPolicy;
  components: {
    worker: ComponentRelease;
    gateway: ComponentRelease;
    evolution: ComponentRelease;
    cloudflared: ComponentRelease;
  };
};

function text(value: unknown) { return String(value ?? '').trim(); }
function object(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function env(...keys: string[]) { for (const key of keys) { const value=text(process.env[key]); if (value) return value; } return ''; }

function serviceClient() {
  const url=env('SUPABASE_URL','VITE_SUPABASE_URL');
  const key=env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('platform_release_backend_not_configured');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function tool(row: Row | undefined, toolId: string): ToolRelease {
  const latestVersion=text(row?.latest_version);
  const minimumSupportedVersion=text(row?.minimum_supported_version);
  if (!latestVersion || !minimumSupportedVersion) throw new Error(`platform_release_tool_incomplete:${toolId}`);
  return { toolId, latestVersion, minimumSupportedVersion };
}

function healthPolicy(root: Row): HealthPolicy {
  const item=object(root.healthPolicy);
  const runtimeTtlSeconds=Number(item.runtimeTtlSeconds);
  const managerHeartbeatSeconds=Number(item.managerHeartbeatSeconds);
  const workerHeartbeatSeconds=Number(item.workerHeartbeatSeconds);
  if (!Number.isFinite(runtimeTtlSeconds) || runtimeTtlSeconds < 30 || !Number.isFinite(managerHeartbeatSeconds) || managerHeartbeatSeconds < 15 || !Number.isFinite(workerHeartbeatSeconds) || workerHeartbeatSeconds < 15) throw new Error('platform_release_health_policy_incomplete');
  return { runtimeTtlSeconds, managerHeartbeatSeconds, workerHeartbeatSeconds };
}

function component(root: Row, key: string, requireImage = false): ComponentRelease {
  const item=object(root[key]);
  const version=text(item.version);
  const image=text(item.image);
  if (!version || (requireImage && !image)) throw new Error(`platform_release_component_incomplete:${key}`);
  return { version, ...(image ? { image } : {}) };
}

export async function loadPlatformRelease(): Promise<PlatformReleaseManifest> {
  const ids=['vinsansi_whatsapp_manager','vinsansi_capture','vinsansi_instagram'];
  const result=await serviceClient().from('platform_tools')
    .select('tool_id,latest_version,minimum_supported_version,release_manifest')
    .in('tool_id',ids).eq('catalog_status','active');
  if (result.error) throw new Error(`platform_release_query_failed:${result.error.message}`);
  const rows=new Map((result.data??[]).map((row)=>[String(row.tool_id),row as Row]));
  const managerRow=rows.get('vinsansi_whatsapp_manager');
  const release=object(managerRow?.release_manifest);
  const components=object(release.components);
  const schemaVersion=Number(release.schemaVersion ?? 0);
  if (schemaVersion !== 1) throw new Error('platform_release_schema_unsupported');
  return {
    schemaVersion,
    generatedAt:new Date().toISOString(),
    manager:tool(managerRow,'vinsansi_whatsapp_manager'),
    capture:tool(rows.get('vinsansi_capture'),'vinsansi_capture'),
    instagram:tool(rows.get('vinsansi_instagram'),'vinsansi_instagram'),
    healthPolicy:healthPolicy(release),
    components:{
      worker:component(components,'worker',true),
      gateway:component(components,'gateway',true),
      evolution:component(components,'evolution',true),
      cloudflared:component(components,'cloudflared',true),
    },
  };
}
