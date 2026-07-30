export type WhatsAppQueueStatus = 'queued' | 'sending' | 'sent' | 'paused' | 'error' | 'invalid';

export type WhatsAppQueueLead = {
  id: string;
  lead_id: string;
  order: number;
  position: number;
  company: string;
  company_name: string;
  channel: 'whatsapp';
  phone: string;
  phone_normalized: string;
  branch: string;
  branch_id?: string;
  branch_slug?: string;
  type: 'Sem site' | 'Com site' | 'Agregador';
  original_destination?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  destination_override?: 'WhatsApp' | 'Com site' | 'Agregadores' | 'Instagram';
  send_instagram?: boolean;
  instagram_url?: string;
  instagram_username?: string;
  instagram_override_reason?: string;
  override_by?: string;
  override_at?: string;
  status: WhatsAppQueueStatus;
  batchId: string;
  batch_id: string;
  batch_number: number;
  batchLimit?: number;
  chip: string;
  chip_instance?: string;
  chip_label?: string;
  chip_id: string;
  profile_id?: string;
  scheduled_date: string;
  template_id: string;
  message1: string;
  message_1: string;
  message2: string;
  message_2: string;
  message3: string;
  message_3: string;
  message4: string;
  message_4: string;
  /** Nome do arquivo local que o Worker procura em /app/images. */
  imageName?: string;
  /** Quando true, o Worker nao envia mensagem alguma se o arquivo nao existir ou estiver invalido. */
  imageRequired?: boolean;
  image_url?: string;
  image_id?: string;
  city?: string;
  state?: string;
  site?: string;
  instagram?: string;
  mapsUrl?: string;
  retry_count: number;
  error_message?: string;
  invalid_reason?: string;
  notes?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
};

export type CreateWhatsAppQueueLeadInput = Omit<
  WhatsAppQueueLead,
  | 'id'
  | 'order'
  | 'position'
  | 'company_name'
  | 'channel'
  | 'phone_normalized'
  | 'batchId'
  | 'batch_id'
  | 'batch_number'
  | 'chip_id'
  | 'profile_id'
  | 'message_1'
  | 'message_2'
  | 'message_3'
  | 'message_4'
  | 'retry_count'
  | 'error_message'
  | 'sent_at'
  | 'created_at'
  | 'updated_at'
> & {
  chip_id?: string;
  batchLimit?: number;
  scheduled_date?: string;
  template_id?: string;
};

export type WhatsAppQueueBatch = {
  id: string;
  number: number;
  chip: string;
  limit: number;
  leads: WhatsAppQueueLead[];
};

export type WhatsAppQueueSummary = {
  total: number;
  queued: number;
  sent: number;
  finished: number;
  errors: number;
};

export type WhatsAppQueueFilters = {
  chip?: string;
  search?: string;
  scheduledDate?: string;
};

export type UpdateWhatsAppQueueLeadInput = Partial<
  Pick<WhatsAppQueueLead, 'status' | 'retry_count' | 'error_message' | 'scheduled_date' | 'position'>
>;
