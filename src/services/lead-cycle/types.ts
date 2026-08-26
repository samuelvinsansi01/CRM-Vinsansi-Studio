import type { LeadStatusId, LeadStatusName } from '../../types/lead.types';

export type LeadCycleChannel = 'WhatsApp' | 'Instagram';

export type LeadCycleLead = {
  id: string;
  company: string;
  alternativeName: string;
  displayCompany: string;
  branchId: string;
  branch: string;
  state: string;
  city: string;
  phone: string;
  rawPhone: string;
  whatsapp: string;
  instagram: string;
  website: string;
  mapsUrl: string;
  channelId: number | null;
  channel: LeadCycleChannel | null;
  contactSourceId: number;
  contactSource: string;
  statusId: LeadStatusId;
  status: LeadStatusName;
  createdAt: string;
  updatedAt: string;
  rating: number;
  reviews: number;
};

export type LeadCycleDetailsInput = {
  company: string;
  alternativeName: string;
  branchId: string;
  channel?: LeadCycleChannel;
  rawPhone: string;
  whatsapp: string;
  instagram: string;
  website: string;
  mapsUrl: string;
};

export type LeadRoutingCommand =
  | 'route-imported-to-whatsapp'
  | 'route-imported-to-instagram'
  | 'invalidate-imported'
  | 'archive-imported'
  | 'set-valid-channel-whatsapp'
  | 'set-valid-channel-instagram'
  | 'archive-valid'
  | 'invalidate-valid'
  | 'return-valid-to-imported'
  | 'invalidate-pre-send'
  | 'archive-pre-send';

export type LeadRoutingFailure = {
  id: string;
  company?: string;
  reason: string;
};

export type LeadRoutingResult = {
  command: LeadRoutingCommand;
  requested: number;
  succeeded: number;
  unchanged: number;
  failed: number;
  succeededIds: string[];
  unchangedIds: string[];
  failures: LeadRoutingFailure[];
  auditWarnings: string[];
};
