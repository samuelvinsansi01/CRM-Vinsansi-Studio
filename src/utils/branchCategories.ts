export function formatCategoriesJson(value: unknown) {
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseCategoriesJson(value: string) {
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Categorias do ramo devem conter JSON válido.');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCategoryList(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : String(value ?? '').split(/[,;\n]+/);
  const seen = new Set<string>();

  return parts.reduce<string[]>((items, part) => {
    const normalized = part.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return items;

    const identity = normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (seen.has(identity)) return items;

    seen.add(identity);
    items.push(normalized);
    return items;
  }, []);
}

export function categoriesFromValue(value: unknown): string[] {
  if (Array.isArray(value) || typeof value === 'string') return normalizeCategoryList(value);
  if (!isPlainObject(value)) return [];

  const source = value.associatedCategories
    ?? value.associated_categories
    ?? value.categories
    ?? value.categorias;
  return normalizeCategoryList(source);
}

export function mergeCategories(value: unknown, categoriesText: string) {
  const associatedCategories = normalizeCategoryList(categoriesText);
  const next: Record<string, unknown> = isPlainObject(value)
    ? { ...value }
    : { associatedCategories: categoriesFromValue(value) };

  next.associatedCategories = associatedCategories;
  if (Object.prototype.hasOwnProperty.call(next, 'associated_categories')) {
    next.associated_categories = associatedCategories;
  }

  return next;
}

export function categoriesFormValue(value: unknown) {
  const categoriesText = categoriesFromValue(value).join(', ');
  return {
    categoriesText,
    categoriesJson: formatCategoriesJson(mergeCategories(value, categoriesText)),
  };
}

export function mergeCategoriesJson(value: string, categoriesText: string) {
  return formatCategoriesJson(mergeCategories(parseCategoriesJson(value), categoriesText));
}

export function mergeBranchAcquisitionTargets(value: unknown, whatsapp: unknown, instagram: unknown) {
  const next: Record<string, unknown> = isPlainObject(value)
    ? { ...value }
    : { associatedCategories: categoriesFromValue(value) };
  const parse = (input: unknown, fallback: number) => {
    const parsed = Math.trunc(Number(input));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
  };
  next.stockTargetWhatsapp = parse(whatsapp, 1000);
  next.stockTargetInstagram = parse(instagram, 500);
  return next;
}

export function mergeBranchAcquisitionTargetsJson(value: string, whatsapp: unknown, instagram: unknown) {
  return formatCategoriesJson(mergeBranchAcquisitionTargets(parseCategoriesJson(value), whatsapp, instagram));
}
