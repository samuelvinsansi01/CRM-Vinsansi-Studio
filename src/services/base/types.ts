export type BaseLeadStatus = 'importado' | 'validado' | 'pre_envio' | 'na_fila' | 'enviado' | 'invalido' | 'duplicado' | 'arquivado';
export type BaseLeadOrigin = 'WhatsApp' | 'Instagram';
export type BaseLeadDataOrigin = 'manual' | 'apify' | 'csv' | 'api';
export type BaseLeadDestination = 'WhatsApp' | 'Instagram' | 'Com site' | 'Agregador';

export type BaseLead = {
  id: string;
  sourceLeadId?: string;
  company: string;
  branch: string;
  branch_id?: string;
  branch_slug?: string;
  state: string;
  city: string;
  phone: string;
  site: string;
  normalizedPhone?: string;
  normalizedSite?: string;
  instagram?: string;
  normalizedInstagram?: string;
  mapsUrl?: string;
  placeId?: string;
  origin: BaseLeadOrigin;
  dataOrigin?: BaseLeadDataOrigin;
  destination: BaseLeadDestination;
  original_destination?: string;
  destination_override?: string;
  send_instagram?: boolean;
  instagram_override_reason?: string;
  override_by?: string;
  override_at?: string;
  status: BaseLeadStatus;
  sentAt: string;
  template: string;
  chipOrProfile: string;
  notes?: string;
  history: BaseLeadHistoryItem[];
};

export type CreateBaseLeadInput = Omit<BaseLead, 'id' | 'history'> & {
  history?: BaseLeadHistoryItem[];
};

export type SentContactIdentities = {
  phones: string[];
  sites: string[];
  instagrams: string[];
  mapsUrls: string[];
};

export type BaseLeadHistoryItem = {
  id: string;
  date: string;
  title: string;
  description: string;
};

export type BaseFilters = {
  search?: string;
  origin?: string;
  branch?: string;
  state?: string;
  city?: string;
  destination?: string;
  status?: string;
};

export type BaseSummary = {
  total: number;
  sent: number;
  sentWhatsApp: number;
  sentInstagram: number;
  archived: number;
  invalid: number;
  errors: number;
};

export type UpdateBaseLeadInput = Partial<
  Pick<
    BaseLead,
    | 'company'
    | 'branch'
    | 'branch_id'
    | 'branch_slug'
    | 'state'
    | 'city'
    | 'phone'
    | 'site'
    | 'normalizedPhone'
    | 'normalizedSite'
    | 'instagram'
    | 'normalizedInstagram'
    | 'mapsUrl'
    | 'placeId'
    | 'origin'
    | 'destination'
    | 'original_destination'
    | 'destination_override'
    | 'send_instagram'
    | 'instagram_override_reason'
    | 'override_by'
    | 'override_at'
    | 'status'
    | 'template'
    | 'chipOrProfile'
    | 'notes'
  >
>;
