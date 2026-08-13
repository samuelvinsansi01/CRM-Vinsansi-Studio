import { normalizeBrazilState } from '../geo/brazilState';
import { normalizePhone } from '../import/importValidation';
import { isValidInstagram } from '../instagram/instagram.utils';

export type LeadScoreInput = {
  id?: string;
  company?: string;
  empresa?: string;
  branch?: string;
  ramo?: string;
  category?: string;
  subcategoria?: string;
  parent_category?: string;
  phone?: string;
  whatsapp?: string;
  site?: string;
  website?: string;
  instagram?: string;
  instagram_url?: string;
  rating?: number;
  score?: number;
  reviews?: number;
  reviews_count?: number;
  priority_score?: number;
  leads_priority_score?: number;
  city?: string;
  cidade?: string;
  state?: string;
  estado?: string;
  created_at?: string;
  createdAt?: string;
  returned_from_queue?: boolean;
  returned_at?: string;
  return_reason?: string;
};

const AGGREGATOR_DOMAINS = /(^|[/.])(linktr\.ee|linktree|beacons\.ai|carrd\.co|taplink|bio\.link|lnk\.bio)([/.]|$)/i;

function text(...values: unknown[]) {
  const found = values.find((value) => String(value ?? '').trim());
  return String(found ?? '').trim();
}

function numberFrom(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function hasValidCategory(lead: LeadScoreInput) {
  return Boolean(text(lead.branch, lead.ramo, lead.parent_category, lead.category, lead.subcategoria));
}

function hasValidWhatsApp(lead: LeadScoreInput) {
  return normalizePhone(text(lead.phone, lead.whatsapp)).length >= 10;
}

function hasOwnSite(lead: LeadScoreInput) {
  const site = text(lead.site, lead.website);
  if (!site) return false;
  return !AGGREGATOR_DOMAINS.test(site);
}

function hasLocation(lead: LeadScoreInput) {
  return Boolean(text(lead.city, lead.cidade) && normalizeBrazilState(text(lead.state, lead.estado)));
}

function isReturnedFromQueue(lead: LeadScoreInput) {
  return Boolean(lead.returned_from_queue || text(lead.return_reason).trim());
}

function returnedAt(lead: LeadScoreInput) {
  const timestamp = Date.parse(text(lead.returned_at));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

/**
 * public.leads.leads_score is the original Google rating and must stay in the
 * 0..5 range. Internal commercial ordering belongs to leads_priority_score.
 */
export function normalizeGoogleRating(value: unknown) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) return 0;
  return Math.round(parsed * 100) / 100;
}

/** Backward-compatible name: now returns only the original 0..5 rating. */
export function calculateLeadScore(lead: LeadScoreInput) {
  return normalizeGoogleRating(lead.rating ?? lead.score);
}

export function calculateLeadPriorityScore(lead: LeadScoreInput) {
  let score = 0;
  if (hasValidCategory(lead)) score += 500;
  if (hasValidWhatsApp(lead)) score += 300;
  if (hasOwnSite(lead)) score += 150;
  if (isValidInstagram(text(lead.instagram_url, lead.instagram))) score += 50;
  score += normalizeGoogleRating(lead.rating ?? lead.score) * 100;
  score += Math.min(Math.max(0, numberFrom(lead.reviews, lead.reviews_count)), 200);
  if (hasLocation(lead)) score += 10;
  return Math.round(score);
}


export function calculatePersistedLeadPriorityScore(lead: Record<string, unknown>) {
  const explicit = Number(lead.leads_priority_score ?? lead.priority_score);
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);
  return calculateLeadPriorityScore({
    branch: String((lead.branches as Record<string, unknown> | null)?.branches_name ?? lead.branch ?? lead.ramo ?? ''),
    phone: String(lead.leads_whatsapp ?? lead.leads_phone ?? lead.phone ?? lead.whatsapp ?? ''),
    site: String(lead.leads_website ?? lead.site ?? lead.website ?? ''),
    instagram: String(lead.leads_instagram ?? lead.instagram ?? ''),
    rating: Number(lead.leads_score ?? lead.rating ?? lead.score ?? 0),
    reviews: Number(lead.leads_reviews_count ?? lead.reviews ?? lead.reviews_count ?? 0),
    city: String((lead.cities as Record<string, unknown> | null)?.cities_name ?? lead.city ?? lead.cidade ?? ''),
    state: String((lead.states as Record<string, unknown> | null)?.states_code ?? lead.state ?? lead.estado ?? ''),
  });
}

export function leadCreatedAt(lead: LeadScoreInput) {
  const timestamp = Date.parse(text(lead.created_at, lead.createdAt));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function priorityOf(lead: LeadScoreInput) {
  const explicit = Number(lead.leads_priority_score ?? lead.priority_score);
  return Number.isFinite(explicit) && explicit > 0 ? Math.trunc(explicit) : calculateLeadPriorityScore(lead);
}

export function compareByLeadScore<T extends LeadScoreInput>(a: T, b: T) {
  const aReturned = isReturnedFromQueue(a);
  const bReturned = isReturnedFromQueue(b);
  if (aReturned !== bReturned) return aReturned ? -1 : 1;
  if (aReturned && bReturned) {
    const returnedDiff = returnedAt(a) - returnedAt(b);
    if (returnedDiff !== 0) return returnedDiff;
  }
  const priorityDiff = priorityOf(b) - priorityOf(a);
  if (priorityDiff !== 0) return priorityDiff;
  const reviewDiff = Math.max(0, numberFrom(b.reviews, b.reviews_count)) - Math.max(0, numberFrom(a.reviews, a.reviews_count));
  if (reviewDiff !== 0) return reviewDiff;
  const ratingDiff = calculateLeadScore(b) - calculateLeadScore(a);
  if (ratingDiff !== 0) return ratingDiff;
  const createdDiff = leadCreatedAt(a) - leadCreatedAt(b);
  if (createdDiff !== 0) return createdDiff;
  return text(a.company, a.empresa, a.id).localeCompare(text(b.company, b.empresa, b.id), 'pt-BR');
}

export function sortByLeadScore<T extends LeadScoreInput>(leads: T[]) {
  return [...leads].sort(compareByLeadScore);
}
