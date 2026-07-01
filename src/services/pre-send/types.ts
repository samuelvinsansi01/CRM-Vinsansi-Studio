export type PreSendChannel = 'WhatsApp' | 'Instagram';
export type PreSendStatus = 'review' | 'approved' | 'queued' | 'rejected' | 'invalid' | 'archived' | 'sent' | 'deleted';
export type PreSendQueueFilter = 'Geral' | 'WhatsApp' | 'Com site + Agregadores';

export type PreSendDayCard = {
  id: string;
  channel: PreSendChannel;
  label: string;
  queued: number;
  limit: number;
  isToday?: boolean;
};

export type PreSendLead = {
  id: string;
  sourceImportId?: string;
  company: string;
  branch: string;
  branch_id?: string;
  branch_slug?: string;
  channel: PreSendChannel;
  destination: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  original_destination?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  destination_override?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  send_instagram?: boolean;
  instagram_url?: string;
  instagram_override_reason?: string;
  override_by?: string;
  override_at?: string;
  profile: string;
  dayId: string;
  status: PreSendStatus;
  phone?: string;
  instagram?: string;
  site?: string;
  mapsUrl?: string;
  templateId?: string;
  city?: string;
  state?: string;
};

export type CreatePreSendLeadInput = Omit<PreSendLead, 'id'>;

export type PreSendSummary = {
  whatsapp: number;
  instagram: number;
  total: number;
  queued: number;
};

export type PreSendFilters = {
  channel: PreSendChannel;
  dayId?: string;
  profile?: string;
  queueFilter?: PreSendQueueFilter;
};
