export const LEAD_STATUS = {
  importado: 1,
  validado: 2,
  pre_envio: 3,
  na_fila: 4,
  enviado: 5,
  invalido: 6,
  duplicado: 7,
  arquivado: 8,
} as const;

export type LeadStatusName = keyof typeof LEAD_STATUS;
export type LeadStatusId = (typeof LEAD_STATUS)[LeadStatusName];
export type LeadOrigin = 'manual' | 'apify' | 'csv' | 'api';

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
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
  leads_street: string | null;
  leads_postal_code: string | null;
  leads_categories: string[] | null;
  leads_score: number | null;
  leads_reviews_count: number | null;
  leads_origin: LeadOrigin;
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
