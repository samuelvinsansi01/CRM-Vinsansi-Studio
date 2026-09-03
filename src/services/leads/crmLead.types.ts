export const COMMERCIAL_STAGES = [
  'aguardando_resposta',
  'aguardando_previa',
  'previa_enviada',
  'fechado',
  'recusado',
] as const;

export type CommercialStage = typeof COMMERCIAL_STAGES[number];

export const COMMERCIAL_STAGE_LABELS: Record<CommercialStage, string> = {
  aguardando_resposta: 'Aguardando resposta',
  aguardando_previa: 'Aguardando prévia',
  previa_enviada: 'Prévia enviada',
  fechado: 'Fechado',
  recusado: 'Recusado',
};

export const COMMERCIAL_STAGE_TRANSITIONS: Record<CommercialStage, readonly CommercialStage[]> = {
  aguardando_resposta: ['aguardando_resposta', 'aguardando_previa', 'recusado'],
  aguardando_previa: ['aguardando_previa', 'previa_enviada', 'recusado'],
  previa_enviada: ['previa_enviada', 'fechado', 'recusado'],
  fechado: ['fechado'],
  recusado: ['recusado'],
};

export function commercialStageOptions(current: CommercialStage) {
  return COMMERCIAL_STAGE_TRANSITIONS[current].map((value) => ({ value, label: COMMERCIAL_STAGE_LABELS[value] }));
}

export function canTransitionCommercialStage(current: CommercialStage, next: CommercialStage) {
  return COMMERCIAL_STAGE_TRANSITIONS[current].includes(next);
}

export type CrmLead = {
  id: string;
  company: string;
  alternativeName: string;
  branchId: string;
  branch: string;
  state: string;
  city: string;
  channel: 'WhatsApp' | 'Instagram' | 'Sem destino' | 'Sem canal';
  phone: string;
  instagram: string;
  website: string;
  mapsUrl: string;
  rating: number;
  reviews: number;
  origin: string;
  statusId: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastSentAt: string;
  commercialStage: CommercialStage | null;
  commercialUpdatedAt: string;
  commercialUpdatedBy: string;
  previewDueDate: string;
};

export type CommercialSummary = {
  aguardandoResposta: number;
  aguardandoPrevia: number;
  previaEnviada: number;
  fechado: number;
  recusado: number;
};


export type CrmDashboardProjectSummary = {
  closed: number;
  active: number;
  deliveries: number;
  overdue: number;
  valueClosed: number;
  scheduledReceipts: number;
  pendingReceipts: number;
  received: number;
  receivableTotal: number;
};

export type CrmDashboardSummary = {
  newLeads: number;
  queued: number;
  sent: number;
  invalid: number;
  noContact: number;
  previewsDue: number;
  commercial: CommercialSummary;
  projects: CrmDashboardProjectSummary;
};

export type CrmLeadSummary = {
  total: number;
  imported: number;
  review: number;
  noContact: number;
  queued: number;
  sent: number;
  invalid: number;
  duplicates: number;
  commercial: CommercialSummary;
};

export type CrmLeadFilters = {
  search?: string;
  statusId?: number | null;
  channel?: string;
  commercialStage?: CommercialStage | 'Todos' | '';
  branchId?: string;
  state?: string;
};

export type CrmLeadPageRequest = { page: number; pageSize: number };

export type CrmLeadPage = {
  items: CrmLead[];
  total: number;
  page: number;
  pageSize: number;
  summary: CrmLeadSummary;
};
