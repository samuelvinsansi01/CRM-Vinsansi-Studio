import type { StatusGroup } from '../status/status.mapper';
import type { LeadOrigin } from '../../types/lead.types';

export type ImportLeadStatus = 'pending' | 'review' | 'approved' | 'rejected' | 'queued' | 'sent';

export type ImportLeadDestination = 'WhatsApp' | 'Instagram' | 'Sem destino' | 'Com site' | 'Agregadores' | 'Recusado' | 'Já no banco';

export type ImportRejectionCode =
  | 'missing_name'
  | 'missing_contact'
  | 'rating_below_minimum'
  | 'reviews_below_minimum'
  | 'category_out_of_profile'
  | 'facebook_site'
  | 'blocked_site'
  | 'destination_disabled'
  | 'payload_duplicate'
  | 'duplicate_phone'
  | 'duplicate_site'
  | 'already_in_base'
  | 'duplicate_lead_id'
  | 'invalid_item';

export type ImportLead = {
  id: string;
  empresa: string;
  alternative_name?: string;
  ramo: string;
  sourceLeadId?: string;
  branch_id?: string;
  branch_slug?: string;
  subcategoria?: string;
  destino: ImportLeadDestination;
  original_destination?: ImportLeadDestination;
  destination?: ImportLeadDestination;
  destination_override?: ImportLeadDestination;
  send_instagram?: boolean;
  instagram_url?: string;
  instagram_override_reason?: string;
  override_by?: string;
  override_at?: string;
  status: ImportLeadStatus | string;
  motivo?: string;
  rejectionCode?: ImportRejectionCode;
  rating?: number;
  reviews?: number;
  priority_score?: number;
  whatsapp?: string;
  instagram?: string;
  site?: string;
  cidade?: string;
  estado?: string;
  existingId?: string;
  normalizedPhone?: string;
  normalizedSite?: string;
  normalizedInstagram?: string;
  normalizedMapsUrl?: string;
  returned_from_queue?: boolean;
  returned_at?: string;
  return_reason?: string;
};

export type ImportLeadInput = Omit<ImportLead, 'id'>;

export type ImportListFilters = {
  status: StatusGroup;
  search?: string;
};

export type ImportSummary = {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  whatsapp: number;
  ownSite: number;
  aggregators: number;
  instagram: number;
};

export type ImportReasonSummary = {
  code: ImportRejectionCode | 'ignored' | 'approved';
  label: string;
  count: number;
};

export type ImportReport = {
  simulation: boolean;
  processed: number;
  created: number;
  approved: number;
  rejected: number;
  ignored: number;
  duplicates: number;
  durationMs: number;
  reasons: ImportReasonSummary[];
};

export type ImportParseResult = {
  created: number;
  approved: number;
  rejected: number;
  ignored: number;
  errors: string[];
  leads: ImportLead[];
  report: ImportReport;
};

export type ImportExecutionOptions = {
  simulate?: boolean;
  origin?: LeadOrigin;
  context?: {
    existingLeadIds?: string[];
    baseLeadIds?: string[];
    basePhones?: string[];
    baseSites?: string[];
    baseInstagrams?: string[];
    baseMapsUrls?: string[];
  };
};

export type ImportPersistResult = {
  created: ImportLead[];
  duplicateClientIds: string[];
};

export type ImportPersistenceResult = ImportPersistResult & {
  simulation: boolean;
  persisted: boolean;
  eligible: number;
  reason: 'simulation_mode' | null;
};

export type ImportMutationResult = {
  simulation: boolean;
  persisted: boolean;
  lead: ImportLead | null;
  reason: 'simulation_mode' | null;
};

export type ImportActionResult = {
  simulation: boolean;
  persisted: boolean;
  reason: 'simulation_mode' | null;
};
