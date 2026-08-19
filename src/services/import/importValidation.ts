import { importSettingsService } from '../import-settings';
import type { ImportBranchRule, ImportSettings } from '../import-settings';
import { normalizeBrazilState } from '../geo/brazilState';
import { normalizeInstagramUsername } from '../instagram/instagram.utils';
import type { ImportLeadDestination, ImportLeadInput, ImportReasonSummary, ImportRejectionCode } from './types';

export type ImportValidationContext = {
  existingLeadIds?: Set<string>;
  existingPhones?: Set<string>;
  existingSites?: Set<string>;
  existingInstagrams?: Set<string>;
  existingMapsUrls?: Set<string>;
  existingLeadIdToId?: Map<string, string>;
  existingPhoneToId?: Map<string, string>;
  existingSiteToId?: Map<string, string>;
  existingInstagramToId?: Map<string, string>;
  existingMapsUrlToId?: Map<string, string>;
  baseLeadIds?: Set<string>;
  basePhones?: Set<string>;
  baseSites?: Set<string>;
  baseInstagrams?: Set<string>;
  baseMapsUrls?: Set<string>;
};

export type NormalizedImportItem = {
  input: ImportLeadInput;
  ignored: boolean;
  reason?: string;
  code?: ImportRejectionCode | 'ignored' | 'approved';
};

export type ImportValidationResult = {
  items: NormalizedImportItem[];
  errors: string[];
  processed: number;
  duplicates: number;
  reasons: ImportReasonSummary[];
};

const AGGREGATOR_DOMAINS = ['linktr.ee', 'beacons', 'bio.site', 'taplink', 'msha.ke', 'carrd.co'];

const URL_SHORTENER_DOMAINS = [
  'tinyurl.com',
  'bit.ly',
  'goo.gl',
  't.co',
  'ow.ly',
  'is.gd',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
];

const SITE_BLOCKLIST_DOMAINS = [
  'google.com',
  'google.com.br',
  'instagram.com',
  'facebook.com',
  'fb.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'whatsapp.com',
  'wa.me',
  'maps.google.com',
  'goo.gl',
  'bit.ly',
  'tinyurl.com',
  't.co',
  'ow.ly',
  'is.gd',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'linktr.ee',
  'wix.com',
  'wordpress.com',
  'blogspot.com',
  'hotmart.com',
  'kiwify.com.br',
  'mercadolivre.com.br',
  'shopify.com',
  'ifood.com.br',
  'booking.com',
  'olx.com.br',
  'gov.br',
  'sebrae.com.br',
  'yelp.com',
  'tripadvisor.com',
  'guiamais.com.br',
  'telelistas.net',
];

const REASON_LABELS: Record<ImportRejectionCode | 'ignored' | 'approved', string> = {
  approved: 'Aprovado',
  ignored: 'Ignorado pela importacao incremental',
  missing_name: 'Nome da empresa ausente',
  missing_contact: 'Sem telefone e sem Instagram',
  rating_below_minimum: 'Nota abaixo da qualificacao',
  reviews_below_minimum: 'Reviews abaixo da qualificacao',
  category_out_of_profile: 'Fora do ramo',
  facebook_site: 'Facebook nao aceito como site proprio',
  blocked_site: 'Dominio bloqueado',
  destination_disabled: 'Destino desativado nas configuracoes',
  payload_duplicate: 'Duplicado no JSON atual',
  duplicate_phone: 'Telefone duplicado',
  duplicate_site: 'Site/dominio duplicado',
  duplicate_lead_id: 'Lead duplicado',
  already_in_base: 'Base Permanente',
  invalid_item: 'Item invalido',
};

type LeadIdentity = {
  phone: string;
  site: string;
  instagram: string;
  mapsUrl: string;
};

type WebsiteClassification = {
  type: 'none' | 'instagram' | 'wixsite' | 'aggregator' | 'facebook' | 'blocked' | 'commercial';
  site: string;
  reason: string;
};

type NormalizedRawLead = {
  raw: Record<string, unknown>;
  empresa: string;
  category: string;
  subcategory: string;
  whatsapp: string;
  instagram: string;
  site: string;
  googleUrl: string;
  sourceLeadId: string;
  cidade: string;
  estado: string;
  rating: number;
  reviews: number;
  identity: LeadIdentity;
};

type Rejection = {
  code: ImportRejectionCode;
  reason: string;
  duplicate?: boolean;
};

export function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeComparable(value: unknown) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizePhone(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function normalizeDomain(value: unknown) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return '';

  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

export function isSharedShortenerDomain(value: unknown) {
  const domain = normalizeDomain(value);
  return URL_SHORTENER_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

export function normalizeSiteIdentity(value: unknown) {
  const domain = normalizeDomain(value);
  return isSharedShortenerDomain(domain) ? '' : domain;
}

function normalizeIdentityUrl(value: unknown) {
  return normalizeText(value).replace(/\/+$/, '').toLowerCase();
}

function normalizeInstagram(value: unknown) {
  return normalizeInstagramUsername(value);
}

function readPath(source: Record<string, unknown>, path: string) {
  const parts = path.split('.');
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function stringifyValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return String(item);
        if (item && typeof item === 'object') {
          const objectItem = item as Record<string, unknown>;
          return normalizeText(objectItem.name ?? objectItem.title ?? objectItem.label ?? objectItem.categoryName);
        }
        return '';
      })
      .filter(Boolean)
      .join(', ');
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return normalizeText(objectValue.name ?? objectValue.title ?? objectValue.label ?? objectValue.value ?? '');
  }

  return normalizeText(value);
}

export function readFirst(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const current = key.includes('.') ? readPath(source, key) : source[key];
    const text = stringifyValue(current);
    if (text) return text;
  }
  return '';
}

export function extractImportItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];

  const source = parsed as Record<string, unknown>;
  const directArrayKeys = [
    'items',
    'data',
    'results',
    'searchResults',
    'organicResults',
    'datasetItems',
    'places',
    'businesses',
    'leads',
    'rows',
    'records',
    'companies',
    'output',
  ];

  for (const key of directArrayKeys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }

  for (const value of Object.values(source)) {
    if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) return value;
  }

  return [source];
}

function readRating(source: Record<string, unknown>) {
  const raw = readFirst(source, ['totalScore', 'rating', 'stars', 'reviewScore', 'nota', 'avaliacao', 'google_rating', 'score']).replace(',', '.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readReviewsCount(source: Record<string, unknown>) {
  const raw = readFirst(source, [
    'reviewsCount',
    'reviews',
    'reviewCount',
    'totalReviews',
    'reviewsTotal',
    'numberOfReviews',
    'quantidadeAvaliacoes',
    'avaliacoes',
    'reviews_count',
    'qtd_avaliacoes',
    'total_reviews',
    'reviews_count_total',
  ]);
  const digits = raw.replace(/\D/g, '');
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitCandidateText(value: string | string[]) {
  const values = Array.isArray(value) ? value : value.split(/[,;\n]/);
  return values.map((item) => normalizeComparable(item)).filter(Boolean);
}

function exactNormalizedMatch(a: string, b: string) {
  return Boolean(a && b && a === b);
}

function getCategoryCandidates(raw: Record<string, unknown>, lead: NormalizedRawLead) {
  const values = [
    lead.subcategory,
    readFirst(raw, ['categoryName', 'category', 'category_name', 'subcategoria', 'subcategory', 'sub_category', 'category_subtitle', 'tipo', 'categories', 'additionalCategories']),
  ];

  return values.flatMap((value) => splitCandidateText(value));
}

function matchBranch(lead: NormalizedRawLead, settings: ImportSettings) {
  // Fontes estruturadas do Google Maps entregam a categoria oficial em categoryName ou category. A entrada somente e
  // aceita quando esse valor bate exatamente (apos normalizacao tecnica) com
  // uma categoria/subramo cadastrado no banco para um ramo ativo.
  const categoryName = normalizeComparable(readFirst(lead.raw, ['categoryName', 'category']));
  if (!categoryName) return null;

  const enabledRules = settings.branchRules.filter((rule) => rule.enabled);
  const explicitBranchId = normalizeText(readFirst(lead.raw, ['branchesId', 'branches_id', 'crmContext.branchesId']));
  if (explicitBranchId) {
    const explicitRule = enabledRules.find((rule) => normalizeText(rule.branchId ?? rule.id) === explicitBranchId);
    if (!explicitRule) return null;
    const accepted = splitCandidateText([
      ...(explicitRule.associatedCategories ?? []),
      ...(explicitRule.subcategories ?? []),
    ]);
    return accepted.some((item) => exactNormalizedMatch(categoryName, item)) ? explicitRule : null;
  }
  for (const rule of enabledRules) {
    const accepted = splitCandidateText([
      ...(rule.associatedCategories ?? []),
      ...(rule.subcategories ?? []),
    ]);
    if (accepted.some((item) => exactNormalizedMatch(categoryName, item))) return rule;
  }

  return null;
}

function isAggregatorSite(site: string) {
  const domain = normalizeDomain(site);
  return AGGREGATOR_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

function isFacebookSite(site: string) {
  const domain = normalizeDomain(site);
  return domain === 'facebook.com' || domain.endsWith('.facebook.com') || domain === 'fb.com' || domain.endsWith('.fb.com');
}

function isInstagramSite(site: string) {
  const domain = normalizeDomain(site);
  return domain === 'instagram.com' || domain.endsWith('.instagram.com');
}

function isWixsite(site: string) {
  const domain = normalizeDomain(site);
  return domain === 'wixsite.com' || domain.endsWith('.wixsite.com') || domain === 'wix.com' || domain.endsWith('.wix.com');
}

function isSiteBlocklisted(site: string) {
  const domain = normalizeDomain(site);
  return SITE_BLOCKLIST_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

function classifyWebsite(site: string, settings: ImportSettings): WebsiteClassification {
  if (!site) return { type: 'none', site: '', reason: 'sem site proprio' };
  if (isInstagramSite(site)) return { type: 'instagram', site, reason: 'instagram sem site proprio' };
  if (isWixsite(site)) return { type: 'wixsite', site, reason: 'wixsite sem dominio proprio' };
  if (settings.routes.blockFacebookAsSite && isFacebookSite(site)) return { type: 'facebook', site, reason: 'facebook sem site proprio' };
  if (isAggregatorSite(site)) return { type: 'aggregator', site, reason: 'agregador sem site proprio' };
  if (isSiteBlocklisted(site)) return { type: 'blocked', site, reason: 'link externo sem site proprio' };
  return { type: 'commercial', site, reason: 'site comercial proprio' };
}

function reasonText(code: ImportRejectionCode, detail?: string) {
  const label = REASON_LABELS[code];
  return detail ? `${label}: ${detail}` : `${label}.`;
}

function reject(code: ImportRejectionCode, detail?: string, duplicate = false): Rejection {
  return { code, reason: reasonText(code, detail), duplicate };
}

function normalizeRawLead(raw: Record<string, unknown>): NormalizedRawLead {
  const empresa = readFirst(raw, ['empresa', 'name', 'title', 'nome', 'company', 'businessName', 'company_name', 'business_name', 'placeName', 'place_name', 'localizedName']);
  const category = readFirst(raw, ['ramo', 'category', 'categoria', 'segmento', 'type', 'types']);
  const subcategory = readFirst(raw, ['categoryName', 'category', 'category_name', 'subcategoria', 'subcategory', 'sub_category', 'category_subtitle', 'tipo', 'categories', 'additionalCategories']);
  const whatsapp = readFirst(raw, ['whatsapp', 'telefone', 'phone', 'phoneNumber', 'phone_number', 'internationalPhoneNumber', 'international_phone_number', 'phoneUnformatted', 'contactPhone', 'numero', 'normalized_phone']);
  const instagram = readFirst(raw, ['instagram', 'instagramUrl', 'instagram_url', 'instagramUsername', 'instagram_username', 'ig', 'social.instagram']);
  const site = readFirst(raw, ['site', 'website', 'websiteUrl', 'website_url', 'domain', 'webpage', 'link']);
  const googleUrl = readFirst(raw, ['googleUrl', 'google_url', 'mapsUrl', 'maps_url', 'googleMapsUrl', 'google_maps_url', 'placeUrl', 'place_url', 'url']);
  const sourceLeadId = readFirst(raw, ['lead_id', 'leadId', 'item_id', 'itemId', 'sourceLeadId', 'source_lead_id', 'id']);
  const cidade = readFirst(raw, ['cidade', 'city', 'address.city', 'location.city']);
  const estado = normalizeBrazilState(readFirst(raw, ['estado', 'state', 'uf', 'address.state', 'location.state']));

  return {
    raw,
    empresa,
    category,
    subcategory,
    whatsapp,
    instagram,
    site,
    googleUrl,
    sourceLeadId,
    cidade,
    estado,
    rating: readRating(raw),
    reviews: readReviewsCount(raw),
    identity: {
      phone: normalizePhone(whatsapp),
      site: normalizeSiteIdentity(site),
      instagram: normalizeInstagram(instagram),
      mapsUrl: normalizeIdentityUrl(googleUrl),
    },
  };
}

function buildDraft(lead: NormalizedRawLead, branchRule: ImportBranchRule | null): ImportLeadInput {
  const instagramUrl = lead.instagram || (isInstagramSite(lead.site) ? lead.site : '');
  const normalizedInstagram = lead.identity.instagram || normalizeInstagram(instagramUrl);

  return {
    empresa: lead.empresa,
    ramo: branchRule?.branch ?? lead.category,
    branch_id: branchRule?.branchId ?? branchRule?.id,
    branch_slug: branchRule?.branchSlug,
    subcategoria: lead.subcategory,
    destino: 'Recusado',
    original_destination: 'Recusado',
    destination: 'Recusado',
    destination_override: undefined,
    send_instagram: false,
    instagram_url: instagramUrl,
    instagram_override_reason: '',
    override_by: '',
    override_at: '',
    status: 'rejected',
    motivo: '',
    rating: lead.rating,
    reviews: lead.reviews,
    whatsapp: lead.whatsapp,
    instagram: lead.instagram || instagramUrl,
    site: lead.site,
    cidade: lead.cidade,
    estado: lead.estado,
    normalizedPhone: lead.identity.phone,
    normalizedSite: lead.identity.site,
    normalizedInstagram,
    normalizedMapsUrl: lead.identity.mapsUrl,
    sourceLeadId: lead.sourceLeadId,
  };
}

function findDuplicate(
  lead: NormalizedRawLead,
  settings: ImportSettings,
  context: Required<ImportValidationContext>,
  payload: Required<Pick<ImportValidationContext, 'existingLeadIds' | 'existingPhones' | 'existingSites' | 'existingInstagrams' | 'existingMapsUrls'>>,
): Rejection | null {
  const { phone, site, instagram, mapsUrl } = lead.identity;
  const sourceLeadId = normalizeComparable(lead.sourceLeadId);

  if (!settings.deduplication.enabled) return null;

  if (sourceLeadId) {
    if (context.existingLeadIds.has(sourceLeadId)) return reject('duplicate_lead_id', 'lead_id ja existe na importacao/base', true);
    if (payload.existingLeadIds.has(sourceLeadId)) return reject('payload_duplicate', 'lead_id duplicado no JSON atual', true);
  }

  if (settings.deduplication.blockBasePermanent) {
    if (phone && context.basePhones.has(phone)) return reject('already_in_base', 'telefone ja existe na base permanente', true);
    if (site && context.baseSites.has(site)) return reject('already_in_base', 'site ja existe na base permanente', true);
    if (instagram && context.baseInstagrams.has(instagram)) return reject('already_in_base', 'instagram ja existe na base permanente', true);
    if (mapsUrl && context.baseMapsUrls.has(mapsUrl)) return reject('already_in_base', 'maps ja existe na base permanente', true);
    if (sourceLeadId && context.baseLeadIds.has(sourceLeadId)) return reject('already_in_base', 'lead_id ja existe na base permanente', true);
  }

  const duplicateInRepository =
    Boolean(settings.deduplication.byPhone && phone && context.existingPhones.has(phone)) ||
    Boolean(settings.deduplication.bySite && site && context.existingSites.has(site)) ||
    Boolean(instagram && context.existingInstagrams.has(instagram)) ||
    Boolean(mapsUrl && context.existingMapsUrls.has(mapsUrl));

  if (duplicateInRepository && !settings.deduplication.allowSmartReimport) {
    if (settings.deduplication.byPhone && phone && context.existingPhones.has(phone)) return reject('duplicate_phone', 'telefone ja existe na importacao', true);
    if (settings.deduplication.bySite && site && context.existingSites.has(site)) return reject('duplicate_site', 'site ja existe na importacao', true);
    return reject('duplicate_site', 'identidade ja existe na importacao', true);
  }

  const duplicateInPayload =
    Boolean(settings.deduplication.byPhone && phone && payload.existingPhones.has(phone)) ||
    Boolean(settings.deduplication.bySite && site && payload.existingSites.has(site)) ||
    Boolean(instagram && payload.existingInstagrams.has(instagram)) ||
    Boolean(mapsUrl && payload.existingMapsUrls.has(mapsUrl));

  if (duplicateInPayload) return reject('payload_duplicate', 'duplicado no JSON atual', true);

  return null;
}

function setSmartReimport(draft: ImportLeadInput, lead: NormalizedRawLead, settings: ImportSettings, context: Required<ImportValidationContext>) {
  if (!settings.deduplication.allowSmartReimport) return;

  const id =
    (lead.identity.phone && context.existingPhoneToId.get(lead.identity.phone)) ||
    (lead.identity.site && context.existingSiteToId.get(lead.identity.site)) ||
    (lead.identity.instagram && context.existingInstagramToId.get(lead.identity.instagram)) ||
    (lead.identity.mapsUrl && context.existingMapsUrlToId.get(lead.identity.mapsUrl)) ||
    undefined;

  if (id) {
    draft.existingId = id;
    draft.motivo = 'Reimportacao inteligente: registro existente sera atualizado.';
  }
}

function validateBranch(lead: NormalizedRawLead, branchRule: ImportBranchRule | null, settings: ImportSettings): Rejection | null {
  if (!settings.routes.requireConfiguredCategory && !settings.routes.rejectOutOfProfile) return null;
  if (branchRule) return null;

  const detail = lead.category || lead.subcategory || 'sem categoria/subcategoria configurada';
  return reject('category_out_of_profile', detail);
}

function qualifiesForInstagramException(lead: NormalizedRawLead, branchRule: ImportBranchRule | null, settings: ImportSettings) {
  const rule = settings.instagramLowRating;
  if (!rule?.enabled || !settings.routes.instagram || !branchRule) return false;

  return lead.rating >= rule.minRating
    && lead.reviews >= rule.minReviews;
}

function routeLowRatingLeadToInstagramReview(draft: ImportLeadInput, lead: NormalizedRawLead, settings: ImportSettings) {
  const rule = settings.instagramLowRating;
  draft.status = 'pending';
  draft.destino = 'Instagram';
  draft.original_destination = 'Instagram';
  draft.destination = 'Instagram';
  draft.destination_override = 'Instagram';
  draft.send_instagram = true;
  draft.instagram = draft.instagram || lead.instagram || (isInstagramSite(lead.site) ? lead.site : '');
  draft.instagram_url = draft.instagram_url || draft.instagram;
  draft.instagram_override_reason = `Excecao de qualificacao para Instagram: nota ${lead.rating} (minimo ${rule.minRating}) e ${lead.reviews} reviews (minimo ${rule.minReviews}).`;
  draft.motivo = draft.instagram
    ? `${draft.instagram_override_reason} Revisar e aprovar no Inicio.`
    : `${draft.instagram_override_reason} Adicione o link do Instagram no Inicio para aprovar.`;
  draft.rejectionCode = undefined;
}

function validateQualification(lead: NormalizedRawLead, branchRule: ImportBranchRule | null, settings: ImportSettings): Rejection | null {
  const minRating = branchRule?.minRating ?? settings.minRating;
  const minReviews = branchRule?.minReviews ?? settings.minReviews;

  if (minRating > 0 && lead.rating < minRating) return reject('rating_below_minimum', `${lead.rating || 0} < ${minRating}`);
  if (minReviews > 0 && lead.reviews < minReviews) return reject('reviews_below_minimum', `${lead.reviews || 0} < ${minReviews}`);
  return null;
}

function classifyDestination(lead: NormalizedRawLead, website: WebsiteClassification, settings: ImportSettings): { destination?: ImportLeadDestination; rejection?: Rejection; reason: string } {
  const hasPhone = Boolean(lead.identity.phone);
  const instagram = lead.identity.instagram || (website.type === 'instagram' ? normalizeInstagram(lead.site) : '');

  if (website.type === 'blocked') {
    return { rejection: reject('blocked_site', website.reason), reason: website.reason };
  }

  if (hasPhone) {
    if (website.type === 'commercial') {
      if (!settings.routes.ownSite) return { rejection: reject('destination_disabled', 'Com site'), reason: website.reason };
      return { destination: 'Com site', reason: website.reason };
    }

    if (website.type === 'aggregator') {
      if (!settings.routes.aggregators) return { rejection: reject('destination_disabled', 'Agregadores'), reason: website.reason };
      return { destination: 'Agregadores', reason: website.reason };
    }

    if (!settings.routes.whatsapp) return { rejection: reject('destination_disabled', 'WhatsApp'), reason: website.reason };
    return { destination: 'WhatsApp', reason: website.reason };
  }

  if (instagram) {
    if (!settings.routes.instagram) return { rejection: reject('destination_disabled', 'Instagram'), reason: 'sem telefone whatsapp validado' };
    return { destination: 'Instagram', reason: 'sem telefone whatsapp validado' };
  }

  if (website.type === 'facebook') return { rejection: reject('facebook_site'), reason: website.reason };
  return { rejection: reject('missing_contact'), reason: 'sem telefone e sem instagram' };
}

function canUseSecondaryInstagramRoute(lead: NormalizedRawLead, branchRule: ImportBranchRule | null, settings: ImportSettings) {
  if (!branchRule || !settings.routes.instagram) return false;
  const instagram = lead.identity.instagram || (isInstagramSite(lead.site) ? normalizeInstagram(lead.site) : '');
  return Boolean(instagram);
}

function approveSecondaryInstagram(draft: ImportLeadInput, lead: NormalizedRawLead, reason: string) {
  draft.instagram = draft.instagram || lead.instagram || (isInstagramSite(lead.site) ? lead.site : '');
  draft.instagram_url = draft.instagram_url || draft.instagram;
  draft.send_instagram = true;
  draft.destination_override = 'Instagram';
  draft.instagram_override_reason = `Rota secundaria de Instagram: ${reason}`;
  approveDraft(draft, 'Instagram', draft.instagram_override_reason);
}

function applyRejection(draft: ImportLeadInput, rejection: Rejection, settings: ImportSettings) {
  draft.status = 'rejected';
  draft.destino = rejection.duplicate ? 'Já no banco' : 'Recusado';
  draft.original_destination = draft.original_destination ?? draft.destino;
  draft.destination = draft.destino;
  draft.destination_override = undefined;
  draft.send_instagram = false;
  draft.instagram_override_reason = '';
  draft.override_by = '';
  draft.override_at = '';
  draft.rejectionCode = rejection.code;
  draft.motivo = settings.logs.logRejectionReason ? rejection.reason : 'Recusado pelas regras de importacao.';
}

function approveDraft(draft: ImportLeadInput, destination: ImportLeadDestination, reason: string) {
  // WhatsApp aguarda a confirmação persistida da Evolution; os demais destinos
  // preservam a revisão operacional existente.
  draft.status = destination === 'WhatsApp' ? 'review' : 'pending';
  draft.destino = destination;
  draft.original_destination = draft.original_destination && draft.original_destination !== 'Recusado' ? draft.original_destination : destination;
  draft.destination = draft.send_instagram ? 'Instagram' : destination;
  draft.destination_override = draft.send_instagram ? 'Instagram' : undefined;
  if (!draft.send_instagram) {
    draft.instagram_override_reason = '';
    draft.override_by = '';
    draft.override_at = '';
  }
  draft.motivo = draft.motivo || reason;
}

function incrementReason(map: Map<string, ImportReasonSummary>, code: ImportRejectionCode | 'ignored' | 'approved') {
  const current = map.get(code);
  if (current) {
    current.count += 1;
    return;
  }
  map.set(code, { code, label: REASON_LABELS[code], count: 1 });
}

function rememberIdentity(target: Pick<ImportValidationContext, 'existingLeadIds' | 'existingPhones' | 'existingSites' | 'existingInstagrams' | 'existingMapsUrls'>, lead: NormalizedRawLead) {
  const sourceLeadId = normalizeComparable(lead.sourceLeadId);
  if (sourceLeadId) target.existingLeadIds?.add(sourceLeadId);
  if (lead.identity.phone) target.existingPhones?.add(lead.identity.phone);
  if (lead.identity.site) target.existingSites?.add(lead.identity.site);
  if (lead.identity.instagram) target.existingInstagrams?.add(lead.identity.instagram);
  if (lead.identity.mapsUrl) target.existingMapsUrls?.add(lead.identity.mapsUrl);
}

export async function normalizeImportItems(rawItems: unknown[], context: ImportValidationContext = {}): Promise<ImportValidationResult> {
  const settings = await importSettingsService.get();
  const normalizePhoneSet = (values: Iterable<unknown>) =>
    new Set(Array.from(values, (value) => normalizePhone(value)).filter(Boolean));
  const normalizedContext: Required<ImportValidationContext> = {
    existingLeadIds: new Set(context.existingLeadIds ?? []),
    existingPhones: new Set(context.existingPhones ?? []),
    existingSites: new Set(Array.from(context.existingSites ?? []).map(normalizeSiteIdentity).filter(Boolean)),
    existingInstagrams: new Set(context.existingInstagrams ?? []),
    existingMapsUrls: new Set(context.existingMapsUrls ?? []),
    existingLeadIdToId: new Map(context.existingLeadIdToId ?? []),
    existingPhoneToId: new Map(context.existingPhoneToId ?? []),
    existingSiteToId: new Map(Array.from(context.existingSiteToId ?? []).map(([site, id]) => [normalizeSiteIdentity(site), id] as const).filter(([site]) => Boolean(site))),
    existingInstagramToId: new Map(context.existingInstagramToId ?? []),
    existingMapsUrlToId: new Map(context.existingMapsUrlToId ?? []),
    baseLeadIds: new Set(context.baseLeadIds ?? []),
    basePhones: normalizePhoneSet(context.basePhones ?? []),
    baseSites: new Set(Array.from(context.baseSites ?? []).map(normalizeSiteIdentity).filter(Boolean)),
    baseInstagrams: new Set(context.baseInstagrams ?? []),
    baseMapsUrls: new Set(context.baseMapsUrls ?? []),
  };
  const payloadIdentity = {
    existingLeadIds: new Set<string>(),
    existingPhones: new Set<string>(),
    existingSites: new Set<string>(),
    existingInstagrams: new Set<string>(),
    existingMapsUrls: new Set<string>(),
  };
  const normalized: NormalizedImportItem[] = [];
  const errors: string[] = [];
  const reasons = new Map<string, ImportReasonSummary>();
  let duplicates = 0;

  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('Item ignorado por nao ser um objeto valido.');
      incrementReason(reasons, 'invalid_item');
      continue;
    }

    const lead = normalizeRawLead(item as Record<string, unknown>);
    const branchRule = matchBranch(lead, settings);
    const draft = buildDraft(lead, branchRule);

    if (!lead.empresa) {
      const rejection = reject('missing_name', 'sem nome');
      applyRejection(draft, rejection, settings);
      normalized.push({ input: draft, ignored: false, reason: rejection.reason, code: rejection.code });
      incrementReason(reasons, rejection.code);
      continue;
    }

    const duplicate = findDuplicate(lead, settings, normalizedContext, payloadIdentity);
    if (duplicate) {
      applyRejection(draft, duplicate, settings);
      duplicates += 1;
      const shouldIgnore = settings.deduplication.incrementalImport && !settings.logs.logRejected;
      normalized.push({ input: draft, ignored: shouldIgnore, reason: duplicate.reason, code: duplicate.code });
      incrementReason(reasons, shouldIgnore ? 'ignored' : duplicate.code);
      rememberIdentity(payloadIdentity, lead);
      continue;
    }

    const categoryRejection = validateBranch(lead, branchRule, settings);
    if (categoryRejection) {
      applyRejection(draft, categoryRejection, settings);
      normalized.push({ input: draft, ignored: false, reason: categoryRejection.reason, code: categoryRejection.code });
      incrementReason(reasons, categoryRejection.code);
      rememberIdentity(payloadIdentity, lead);
      continue;
    }

    const qualificationRejection = validateQualification(lead, branchRule, settings);
    if (qualificationRejection) {
      if (qualifiesForInstagramException(lead, branchRule, settings)) {
        routeLowRatingLeadToInstagramReview(draft, lead, settings);
        normalized.push({ input: draft, ignored: false, code: 'approved' });
        incrementReason(reasons, 'approved');
        rememberIdentity(payloadIdentity, lead);
        continue;
      }

      applyRejection(draft, qualificationRejection, settings);
      normalized.push({ input: draft, ignored: false, reason: qualificationRejection.reason, code: qualificationRejection.code });
      incrementReason(reasons, qualificationRejection.code);
      rememberIdentity(payloadIdentity, lead);
      continue;
    }

    setSmartReimport(draft, lead, settings, normalizedContext);

    const website = classifyWebsite(lead.site, settings);
    const classification = classifyDestination(lead, website, settings);

    if (classification.rejection) {
      if (canUseSecondaryInstagramRoute(lead, branchRule, settings)) {
        approveSecondaryInstagram(draft, lead, classification.rejection.reason);
        normalized.push({ input: draft, ignored: false, code: 'approved' });
        incrementReason(reasons, 'approved');
        rememberIdentity(payloadIdentity, lead);
        continue;
      }

      applyRejection(draft, classification.rejection, settings);
      normalized.push({ input: draft, ignored: false, reason: classification.rejection.reason, code: classification.rejection.code });
      incrementReason(reasons, classification.rejection.code);
      rememberIdentity(payloadIdentity, lead);
      continue;
    }

    approveDraft(draft, classification.destination ?? 'WhatsApp', classification.reason);
    normalized.push({ input: draft, ignored: false, code: 'approved' });
    incrementReason(reasons, 'approved');
    rememberIdentity(payloadIdentity, lead);
  }

  return {
    items: normalized,
    errors,
    processed: rawItems.length,
    duplicates,
    reasons: Array.from(reasons.values()),
  };
}
