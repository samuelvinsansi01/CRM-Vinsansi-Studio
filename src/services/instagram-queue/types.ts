export type InstagramQueueStatus = 'queued' | 'following' | 'dm_opened' | 'sent' | 'paused' | 'error' | 'invalid';

export type InstagramQueueLead = {
  id: string;
  lead_id: string;
  sourcePreSendId?: string;
  order: number;
  position: number;
  company: string;
  company_name: string;
  channel: 'instagram';
  instagram: string;
  profile: string;
  profile_id: string;
  branch: string;
  branch_id?: string;
  branch_slug?: string;
  type: 'Instagram' | 'Agregador' | 'Sem WhatsApp';
  original_destination?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  destination_override?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  send_instagram?: boolean;
  instagram_url?: string;
  instagram_username: string;
  instagram_override_reason?: string;
  override_by?: string;
  override_at?: string;
  status: InstagramQueueStatus;
  batchId: string;
  batch_id: string;
  batch_number: number;
  chip_id?: string;
  scheduled_date: string;
  template_id: string;
  message1: string;
  message_1: string;
  message2: string;
  message_2: string;
  imageName?: string;
  image_url?: string;
  image_id?: string;
  city?: string;
  state?: string;
  phone?: string;
  site?: string;
  mapsUrl?: string;
  retry_count: number;
  error_message?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
  invalidReason?: string;
};

export type CreateInstagramQueueLeadInput = Omit<
  InstagramQueueLead,
  | 'id'
  | 'lead_id'
  | 'order'
  | 'position'
  | 'company_name'
  | 'channel'
  | 'profile_id'
  | 'instagram_username'
  | 'batchId'
  | 'batch_id'
  | 'batch_number'
  | 'chip_id'
  | 'message_1'
  | 'message_2'
  | 'retry_count'
  | 'error_message'
  | 'sent_at'
  | 'created_at'
  | 'updated_at'
> & {
  lead_id?: string;
  batchLimit?: number;
  scheduled_date?: string;
  template_id?: string;
};

export type InstagramQueueBatch = {
  id: string;
  number: number;
  profile: string;
  limit: number;
  leads: InstagramQueueLead[];
};

export type InstagramQueueSummary = {
  total: number;
  queued: number;
  sent: number;
  errors: number;
  invalid: number;
};

export type InstagramQueueFilters = {
  profile?: string;
  search?: string;
  scheduledDate?: string;
};

export type UpdateInstagramQueueLeadInput = Partial<
  Pick<
    InstagramQueueLead,
    | 'company'
    | 'instagram'
    | 'branch'
    | 'type'
    | 'status'
    | 'message1'
    | 'message2'
    | 'imageName'
    | 'image_url'
    | 'image_id'
    | 'invalidReason'
    | 'phone'
    | 'site'
    | 'instagram_url'
    | 'retry_count'
    | 'error_message'
    | 'scheduled_date'
    | 'batch_id'
    | 'batch_number'
    | 'position'
  >
>;
