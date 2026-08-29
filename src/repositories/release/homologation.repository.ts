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

const RELEASE = '2.4.0-R59';

function check(key: string, section: string, label: string, passed: boolean, evidence: string): HomologationCheck {
  return {
    key, section, label, required: true,
    status: passed ? 'passed' : 'failed',
    evidence,
    checkedAt: new Date().toISOString(),
    checkedByMemberId: null,
  };
}

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
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

  const reviewStatus = await client.from('leads').select('leads_id', { count: 'exact', head: true }).eq('lead_status_id', 2);
  const openReview = await client.from('queue_review_items').select('queue_review_items_id', { count: 'exact', head: true }).eq('review_status', 'open');
  const reviewReadable = !reviewStatus.error && !openReview.error;
  checks.push(check(
    'review_contract', 'Fluxo', 'Revisão e reservas operacionais legíveis', reviewReadable,
    reviewReadable ? `Leads em revisão: ${reviewStatus.count ?? 0}; itens abertos: ${openReview.count ?? 0}` : String(reviewStatus.error?.message || openReview.error?.message || 'erro'),
  ));

  const queued = await client.from('leads').select('leads_id', { count: 'exact', head: true }).eq('lead_status_id', 4);
  const queueItems = await client.from('queue_items').select('queue_items_id', { count: 'exact', head: true });
  const queueReadable = !queued.error && !queueItems.error;
  checks.push(check(
    'queue_contract', 'Fluxo', 'Fila operacional legível', queueReadable,
    queueReadable ? `Leads na fila: ${queued.count ?? 0}; queue_items: ${queueItems.count ?? 0}` : String(queued.error?.message || queueItems.error?.message || 'erro'),
  ));

  const health = await client.rpc('get_operational_health');
  checks.push(check(
    'operational_health', 'Runtime', 'Monitoramento operacional disponível', !health.error,
    health.error ? health.error.message : 'get_operational_health respondeu normalmente.',
  ));

  const passed = checks.every((item) => !item.required || item.status === 'passed');
  const now = new Date().toISOString();
  return {
    run: {
      id: 'runtime-r59', releaseVersion: RELEASE, status: passed ? 'passed' : 'failed',
      startedAt: now, completedAt: now,
      notes: 'Homologação automática e somente leitura sobre o contrato final do banco. Não usa tabelas/RPCs de homologação persistente.',
    },
    checks,
  };
}

export async function getProductionReadiness(): Promise<Record<string, unknown>> {
  const snapshot = await getHomologationSnapshot();
  const required = snapshot.checks.filter((item) => item.required);
  return {
    ok: required.every((item) => item.status === 'passed'),
    releaseVersion: RELEASE,
    passed: required.filter((item) => item.status === 'passed').length,
    total: required.length,
  };
}
