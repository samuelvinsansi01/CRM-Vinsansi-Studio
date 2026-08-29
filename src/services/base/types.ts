import type { LeadStatusId, LeadStatusName } from '../../types/lead.types';

export type BaseLeadStatus = LeadStatusName;
export type BaseFinalStatusId = Extract<LeadStatusId, 3 | 5 | 6 | 7>;
export type BaseLeadOrigin = 'WhatsApp' | 'Instagram' | 'Sem destino' | 'Sem canal';
export type BaseLeadDestination = BaseLeadOrigin | 'Com site' | 'Agregador';

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
  noContact: number;
  invalid: number;
  duplicates: number;
};
