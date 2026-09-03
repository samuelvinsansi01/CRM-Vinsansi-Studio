export const PROJECT_STAGES = [
  'aguardando_inicio',
  'desenvolvendo_design',
  'aguardando_aprovacao',
  'em_revisao',
  'passando_wordpress',
  'aguardando_aprovacao_final',
  'entregue',
] as const;

export type ProjectStage = typeof PROJECT_STAGES[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  aguardando_inicio: 'Aguardando início',
  desenvolvendo_design: 'Desenvolvendo design',
  aguardando_aprovacao: 'Aguardando aprovação',
  em_revisao: 'Em revisão',
  passando_wordpress: 'Passando para WordPress',
  aguardando_aprovacao_final: 'Aguardando aprovação final',
  entregue: 'Entregue',
};

export const PAYMENT_TERMS = ['100_inicio', '50_50'] as const;
export type PaymentTerms = typeof PAYMENT_TERMS[number];
export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  '100_inicio': '100% no início',
  '50_50': '50% no início / 50% na entrega',
};

export type ProjectPaymentStatus = 'nao_configurado' | 'pendente' | 'parcial' | 'pago' | 'atrasado';

export type CrmProject = {
  id: string;
  leadId: string;
  company: string;
  alternativeName: string;
  branch: string;
  state: string;
  city: string;
  stage: ProjectStage;
  stageStartedOn: string;
  stageDueOn: string;
  projectStartDate: string;
  projectDueDate: string;
  closedAt: string;
  deliveredOn: string;
  totalValue: number;
  paymentTerms: PaymentTerms | null;
  firstPaymentDueDate: string;
  firstPaymentReceivedOn: string;
  secondPaymentDueDate: string;
  secondPaymentReceivedOn: string;
  amountReceived: number;
  amountReceivable: number;
  paymentStatus: ProjectPaymentStatus;
  updatedAt: string;
};

export type ProjectSummary = {
  total: number;
  active: number;
  delivered: number;
  overdue: number;
  dueThisWeek: number;
  totalValue: number;
  received: number;
  receivable: number;
};

export type ProjectPage = {
  items: CrmProject[];
  total: number;
  page: number;
  pageSize: number;
  summary: ProjectSummary;
};

export type ProjectFilters = {
  search?: string;
  stage?: ProjectStage | '';
  status?: 'ativos' | 'entregues' | 'atrasados' | '';
};

export type ProjectFinancialInput = {
  totalValue: number | null;
  paymentTerms: PaymentTerms | null;
  projectStartDate: string | null;
  projectDueDate: string | null;
  firstPaymentDueDate: string | null;
  secondPaymentDueDate: string | null;
};
