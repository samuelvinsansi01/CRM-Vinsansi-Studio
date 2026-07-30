/** Tipos mínimos do banco novo usados pela camada de integração. */
export type PublicUser = {
  users_id: string;
  auth_user_id: string;
  status_id: string;
  users_name: string | null;
  users_avatar_path: string | null;
  users_created_at: string;
  users_updated_at: string;
};

export type LeadRow = {
  leads_id: string;
  users_id: string;
  branches_id: string;
  countries_id: string;
  states_id: string | null;
  cities_id: string | null;
  channels_id: string | null;
  lead_status_id: string;
  apify_import_jobs_id: string | null;
  contact_sources_id: string;
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
  leads_origin: string;
  leads_created_at: string;
  leads_updated_at: string;
};
