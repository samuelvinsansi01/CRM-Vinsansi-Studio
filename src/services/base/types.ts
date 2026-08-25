import type { LeadStatusId, LeadStatusName } from '../../types/lead.types';

export type BaseLeadStatus = LeadStatusName;
export type BaseFinalStatusId = Extract<LeadStatusId, 5 | 6 | 7 | 8>;
export type BaseLeadOrigin = 'WhatsApp' | 'Instagram';
export type BaseLeadDestination = 'WhatsApp' | 'Instagram' | 'Com site' | 'Agregador';

export type BaseLead = {
  id: string;
  canonicalId?: string;
  company: string;
  branch: string;
  branch_id?: string;
  state: string;
  city: string;
  phone: string;
  site: string;
  normalizedPhone?: string;
  normalizedSite?: string;
  instagram?: string;
  normalizedInstagram?: string;
  mapsUrl?: string;
  origin: BaseLeadOrigin;
  destination: BaseLeadDestination;
  status: BaseLeadStatus;
  statusId: BaseFinalStatusId;
  finalizedAt: string;
  totalLeads?: number;
  totalDispatches?: number;
  lastSentAt?: string;
  suppressed?: boolean;
};

export type FinalLeadIdentities = {
  phones: string[];
  sites: string[];
  instagrams: string[];
  mapsUrls: string[];
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
  duplicates: number;
};
