import type { LeadStatusId, LeadStatusName } from '../../types/lead.types';

export type LeadCycleChannel = 'WhatsApp' | 'Instagram';

export type LeadCycleLead = {
  id: string;
  company: string;
  branch: string;
  state: string;
  city: string;
  phone: string;
  instagram: string;
  website: string;
  mapsUrl: string;
  channelId: 1 | 2;
  channel: LeadCycleChannel;
  contactSourceId: number;
  contactSource: string;
  statusId: LeadStatusId;
  status: LeadStatusName;
  createdAt: string;
  updatedAt: string;
};

export type LeadCycleUpdate = Partial<{
  leads_name: string;
  leads_phone: string | null;
  leads_instagram: string | null;
  leads_website: string | null;
  leads_maps: string | null;
  channels_id: 1 | 2;
  lead_status_id: LeadStatusId;
}>;
