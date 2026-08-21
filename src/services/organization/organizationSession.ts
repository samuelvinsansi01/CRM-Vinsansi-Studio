export const ORGANIZATION_HEADER = 'X-Vinsansi-Organization-Id';
export const ORGANIZATION_STORAGE_KEY = 'vinsansi:active-organization-id';

function storage() {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

export function getActiveOrganizationSessionId() {
  const value = storage()?.getItem(ORGANIZATION_STORAGE_KEY)?.trim() ?? '';
  return /^\d+$/.test(value) ? value : '';
}

export function setActiveOrganizationSessionId(organizationId: string | number | null | undefined) {
  const target = storage();
  if (!target) return;
  const value = String(organizationId ?? '').trim();
  if (/^\d+$/.test(value)) target.setItem(ORGANIZATION_STORAGE_KEY, value);
  else target.removeItem(ORGANIZATION_STORAGE_KEY);
}

export function clearActiveOrganizationSessionId() {
  storage()?.removeItem(ORGANIZATION_STORAGE_KEY);
}

export function organizationRequestHeaders(base: Record<string, string> = {}) {
  const organizationId = getActiveOrganizationSessionId();
  return organizationId ? { ...base, [ORGANIZATION_HEADER]: organizationId } : base;
}
