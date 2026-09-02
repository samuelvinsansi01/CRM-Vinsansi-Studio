export const COMMERCIAL_STAGES = [
  'aguardando_resposta',
  'aguardando_design',
  'design_enviado',
  'fechado',
  'recusado',
] as const;

export type CommercialStage = typeof COMMERCIAL_STAGES[number];

export const COMMERCIAL_STAGE_LABELS: Record<CommercialStage, string> = {
  aguardando_resposta: 'Aguardando resposta',
  aguardando_design: 'Aguardando design',
  design_enviado: 'Design enviado',
  fechado: 'Fechado',
  recusado: 'Recusado',
};

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
};

export type CommercialSummary = {
  aguardandoResposta: number;
  aguardandoDesign: number;
  designEnviado: number;
  fechado: number;
  recusado: number;
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
