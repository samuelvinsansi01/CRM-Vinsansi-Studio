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
  /** Template sorteado/selecionado e fixado para evitar troca a cada tentativa. */
  templateId?: string;
  templateAssignedAt?: string;
  templateSelectionSource?: string;
  city?: string;
  state?: string;
  validationStatus?: 'valid' | 'invalid' | 'error' | 'pending';
  validationError?: string;
  validationAttempts?: number;
  lastValidatedAt?: string;
  /** Lead retornado do WhatsApp inválido que ainda exige confirmação manual do perfil Instagram. */
  instagramPendingLink?: boolean;
  /** Momento em que o perfil Instagram foi confirmado no drawer. */
  instagramReadyAt?: string;
  /** Motivo operacional exibido quando o lead pronto não pôde entrar na fila. */
  queueWaitReason?: string;
};

export type CreatePreSendLeadInput = Omit<PreSendLead, 'id'>;

export type PreSendCapacity = {
  channel: PreSendChannel;
  dayId: string;
  scheduledDate: string;
  profile: string;
  limit: number;
  used: number;
  available: number;
};

export type InstagramQueueFillResult = {
  queued: number;
  fromPreSend: number;
  fromImport: number;
  waitingPreSend: number;
  waitingImport: number;
  /** Retornos Instagram mantidos no Pré-Envio por bloqueio operacional, como template ausente. */
  blockedPreSend: number;
  /** Leads de Instagram direto que ficaram no Início por bloqueio operacional. */
  blockedImport: number;
  /** Mensagens curtas para feedback agregado na interface. */
  notices: string[];
  scheduledDate: string;
};

export type PreSendSummary = {
  whatsapp: number;
  instagram: number;
  total: number;
  queued: number;
  dateLabel?: string;
};

export type PreSendValidationSummary = {
  approved: number;
  /** Quantos aprovados foram conferidos novamente pelo worker/Evolution. */
  revalidated: number;
  returned: number;
  requiresReview: number;
  errors: number;
  skipped: number;
};

export type PreSendFilters = {
  channel: PreSendChannel;
  dayId?: string;
  profile?: string;
  queueFilter?: PreSendQueueFilter;
};
