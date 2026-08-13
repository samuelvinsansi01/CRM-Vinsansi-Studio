import type { LeadStatusId } from '../services/status/leadStatus';

export { LEAD_STATUS } from '../services/status/leadStatus';
export type { LeadStatusId } from '../services/status/leadStatus';

export type LeadStatusName =
  | 'importado'
  | 'validado'
  | 'pre_envio'
  | 'na_fila'
  | 'enviado'
  | 'invalido'
  | 'duplicado'
  | 'arquivado';
export type LeadOrigin = 'manual' | 'apify' | 'csv' | 'api' | 'google_maps';

export type LeadRelation<T> = T | T[] | null;

export type LeadDatabaseRow = {
  leads_id: number;
  users_id: number;
  branches_id: number;
  countries_id: number;
  states_id: number | null;
  cities_id: number | null;
  channels_id: number | null;
  lead_status_id: LeadStatusId;
  contact_sources_id: number;
  apify_import_jobs_id: number | null;
  leads_name: string;
  leads_phone: string | null;
  leads_whatsapp?: string | null;
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
  leads_street: string | null;
  leads_postal_code: string | null;
  leads_categories: string[] | null;
  leads_score: number | null;
  leads_reviews_count: number | null;
  leads_origin: LeadOrigin;
  maps_search_candidates_id?: string | null;
  leads_created_at: string;
  leads_updated_at: string | null;
  branches: LeadRelation<{ branches_id: number; branches_name: string }>;
  countries: LeadRelation<{ countries_id: number; countries_name: string; countries_code: string | null }>;
  states: LeadRelation<{ states_id: number; states_name: string; states_code: string | null }>;
  cities: LeadRelation<{ cities_id: number; cities_name: string }>;
  channels: LeadRelation<{ channels_id: number; channels_name: string }>;
  lead_status: LeadRelation<{ lead_status_id: LeadStatusId; lead_status_name: LeadStatusName }>;
  contact_sources: LeadRelation<{ contact_sources_id: number; contact_sources_name: string }>;
};
