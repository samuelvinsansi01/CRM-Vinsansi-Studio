import { branchSlug, normalizeBranchId, normalizeBranchText } from './branchIdentity';
import type { BranchConfigRecord } from './types';

type LooseRecord = Record<string, unknown>;

type BranchBoundRecord = {
  branch_id?: unknown;
  branch_slug?: unknown;
  branch?: unknown;
  branch_name?: unknown;
  parent_category?: unknown;
  data?: unknown;
};

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LooseRecord : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizedSlug(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw ? branchSlug(raw) : '';
}

export function branchForBoundRecord<T extends BranchBoundRecord>(record: T, branches: BranchConfigRecord[]) {
  const data = asRecord(record.data);
  const branchId = normalizeBranchId(firstText(record.branch_id, data.branch_id, data.branchId));
  const branchSlugValue = normalizedSlug(firstText(record.branch_slug, data.branch_slug, data.branchSlug));
  const branchName = normalizeBranchText(firstText(record.branch, record.branch_name, record.parent_category, data.branch, data.branch_name, data.branchName));

  if (branchId) {
    const byId = branches.find((branch) => normalizeBranchId(branch.id) === branchId);
    if (byId) return byId;
  }

  if (branchSlugValue) {
    const bySlug = branches.find((branch) => normalizedSlug(branch.slug) === branchSlugValue);
    if (bySlug) return bySlug;
  }

  if (branchName) {
    return branches.find((branch) => normalizeBranchText(branch.name) === branchName || normalizeBranchText(branch.category) === branchName);
  }

  return undefined;
}

export function applyCurrentBranchMedia<T extends { imageName?: unknown; imageRequired?: unknown; image_url?: unknown }>(lead: T, branch?: BranchConfigRecord): T {
  if (!branch) return lead;

  const imageName = String(branch.imageName ?? '').trim();
  const imageRequired = Boolean(branch.imageRequired);
  return {
    ...lead,
    imageName,
    imageRequired,
    // O campo image_url e consumido por integrações antigas. Ele só recebe o
    // nome quando a mídia está habilitada para este ramo.
    image_url: imageRequired ? imageName : '',
  } as T;
}

export function normalizeStoredBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'sim', 'yes', 'required', 'obrigatoria', 'obrigatório'].includes(normalized)) return true;
  if (['false', '0', 'nao', 'não', 'no', 'optional', 'opcional'].includes(normalized)) return false;
  return fallback;
}
