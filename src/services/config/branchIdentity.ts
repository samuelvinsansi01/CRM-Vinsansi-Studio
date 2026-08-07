export function normalizeBranchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function branchSlug(value: unknown) {
  const normalized = normalizeBranchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'ramo';
}

export function normalizeBranchId(value: unknown) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return '';
  try {
    return BigInt(text).toString();
  } catch {
    return '';
  }
}

export function branchIdOrNull(value: unknown) {
  const id = normalizeBranchId(value);
  if (!id) return null;
  const numericId = Number(id);
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
}
