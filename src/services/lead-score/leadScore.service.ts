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
  reviews?: number;
  reviews_count?: number;
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

export function calculateLeadScore(lead: LeadScoreInput) {
  let score = 0;
  if (hasValidCategory(lead)) score += 500;
  if (hasValidWhatsApp(lead)) score += 300;
  if (hasOwnSite(lead)) score += 150;
  if (isValidInstagram(text(lead.instagram_url, lead.instagram))) score += 50;
  score += numberFrom(lead.rating) * 100;
  score += Math.min(numberFrom(lead.reviews, lead.reviews_count), 200);
  if (hasLocation(lead)) score += 10;
  return Math.round(score);
}

export function leadCreatedAt(lead: LeadScoreInput) {
  const timestamp = Date.parse(text(lead.created_at, lead.createdAt));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

export function compareByLeadScore<T extends LeadScoreInput>(a: T, b: T) {
  const aReturned = isReturnedFromQueue(a);
  const bReturned = isReturnedFromQueue(b);
  if (aReturned !== bReturned) return aReturned ? -1 : 1;
  if (aReturned && bReturned) {
    const returnedDiff = returnedAt(a) - returnedAt(b);
    if (returnedDiff !== 0) return returnedDiff;
  }
  const scoreDiff = calculateLeadScore(b) - calculateLeadScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  const createdDiff = leadCreatedAt(a) - leadCreatedAt(b);
  if (createdDiff !== 0) return createdDiff;
  return text(a.company, a.empresa, a.id).localeCompare(text(b.company, b.empresa, b.id), 'pt-BR');
}

export function sortByLeadScore<T extends LeadScoreInput>(leads: T[]) {
  return [...leads].sort(compareByLeadScore);
}
