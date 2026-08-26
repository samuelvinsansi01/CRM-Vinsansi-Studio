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

export type HomologationSnapshot = {
  run: HomologationRun | null;
  checks: HomologationCheck[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStatus(value: unknown): HomologationStatus {
  return value === 'passed' || value === 'failed' || value === 'not_applicable' ? value : 'pending';
}

function normalizeSnapshot(value: unknown): HomologationSnapshot {
  const root = asRecord(value);
  const rawRun = root.run;
  const runRecord = rawRun ? asRecord(rawRun) : null;
  const rawChecks = Array.isArray(root.checks) ? root.checks : [];

  return {
    run: runRecord && Object.keys(runRecord).length ? {
      id: String(runRecord.id ?? ''),
      releaseVersion: String(runRecord.releaseVersion ?? '2.4.0'),
      status: String(runRecord.status ?? 'running'),
      startedAt: runRecord.startedAt == null ? null : String(runRecord.startedAt),
      completedAt: runRecord.completedAt == null ? null : String(runRecord.completedAt),
      notes: runRecord.notes == null ? null : String(runRecord.notes),
    } : null,
    checks: rawChecks.map((raw): HomologationCheck => {
      const check = asRecord(raw);
      const memberId = Number(check.checkedByMemberId);
      return {
        key: String(check.key ?? ''),
        section: String(check.section ?? 'Geral'),
        label: String(check.label ?? check.key ?? 'Verificação'),
        required: check.required !== false,
        status: asStatus(check.status),
        evidence: check.evidence == null ? null : String(check.evidence),
        checkedAt: check.checkedAt == null ? null : String(check.checkedAt),
        checkedByMemberId: Number.isFinite(memberId) ? memberId : null,
      };
    }).filter((check) => Boolean(check.key)),
  };
}

export async function getHomologationSnapshot(): Promise<HomologationSnapshot> {
  const response = await getSupabaseClient().rpc('get_production_homologation_snapshot', { p_run_id: null });
  if (response.error) throw new Error(`Não foi possível carregar a homologação: ${response.error.message}`);
  return normalizeSnapshot(response.data);
}

export async function getProductionReadiness(): Promise<Record<string, unknown>> {
  const response = await getSupabaseClient().rpc('platform_production_readiness');
  if (response.error) throw new Error(`Não foi possível consultar o readiness: ${response.error.message}`);
  return asRecord(response.data);
}

export async function startHomologation(notes = '') {
  const response = await getSupabaseClient().rpc('start_production_homologation', {
    p_notes: notes.trim() || null,
  });
  if (response.error) throw new Error(`Não foi possível iniciar a homologação: ${response.error.message}`);
  return response.data;
}

export async function setHomologationCheck(
  runId: string,
  checkKey: string,
  status: HomologationStatus,
  evidence = '',
) {
  const response = await getSupabaseClient().rpc('set_production_homologation_check', {
    p_run_id: runId,
    p_check_key: checkKey,
    p_status: status,
    p_evidence: evidence.trim() || null,
  });
  if (response.error) throw new Error(`Não foi possível atualizar a homologação: ${response.error.message}`);
  return response.data;
}

export async function promoteStableRelease() {
  const response = await getSupabaseClient().rpc('promote_platform_stable_release');
  if (response.error) throw new Error(`Não foi possível promover a release: ${response.error.message}`);
  return response.data;
}
