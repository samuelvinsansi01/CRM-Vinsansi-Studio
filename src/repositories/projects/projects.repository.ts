import { getSupabaseClient } from '../../lib/supabase';
import type { CrmProject, PaymentTerms, ProjectFilters, ProjectFinancialInput, ProjectPage, ProjectPaymentStatus, ProjectStage, ProjectSummary } from '../../services/projects/project.types';

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => String(value ?? '').trim();
const number = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };

const EMPTY_SUMMARY: ProjectSummary = { total: 0, active: 0, delivered: 0, overdue: 0, dueThisWeek: 0, totalValue: 0, received: 0, receivable: 0 };

function project(value: unknown): CrmProject {
  const row = record(value);
  const paymentTerms = text(row.paymentTerms) as PaymentTerms;
  return {
    id: text(row.id),
    leadId: text(row.leadId),
    company: text(row.company),
    alternativeName: text(row.alternativeName),
    branch: text(row.branch),
    state: text(row.state),
    city: text(row.city),
    stage: text(row.stage) as ProjectStage,
    stageStartedOn: text(row.stageStartedOn),
    stageDueOn: text(row.stageDueOn),
    projectStartDate: text(row.projectStartDate),
    projectDueDate: text(row.projectDueDate),
    closedAt: text(row.closedAt),
    deliveredOn: text(row.deliveredOn),
    totalValue: number(row.totalValue),
    paymentTerms: paymentTerms ? paymentTerms : null,
    firstPaymentDueDate: text(row.firstPaymentDueDate),
    firstPaymentReceivedOn: text(row.firstPaymentReceivedOn),
    secondPaymentDueDate: text(row.secondPaymentDueDate),
    secondPaymentReceivedOn: text(row.secondPaymentReceivedOn),
    amountReceived: number(row.amountReceived),
    amountReceivable: number(row.amountReceivable),
    paymentStatus: (text(row.paymentStatus) || 'nao_configurado') as ProjectPaymentStatus,
    updatedAt: text(row.updatedAt),
  };
}

function summary(value: unknown): ProjectSummary {
  const row = record(value);
  return {
    total: number(row.total),
    active: number(row.active),
    delivered: number(row.delivered),
    overdue: number(row.overdue),
    dueThisWeek: number(row.dueThisWeek),
    totalValue: number(row.totalValue),
    received: number(row.received),
    receivable: number(row.receivable),
  };
}

export const projectsRepository = {
  async page(filters: ProjectFilters, page: number, pageSize: number): Promise<ProjectPage> {
    const response = await getSupabaseClient().rpc('list_projects_r59', {
      p_page: page,
      p_page_size: pageSize,
      p_search: filters.search?.trim() || null,
      p_stage: filters.stage || null,
      p_status: filters.status || null,
      p_payment_status: filters.paymentStatus || null,
    });
    if (response.error) throw new Error(`Não foi possível carregar os projetos: ${response.error.message}`);
    const payload = record(response.data);
    return {
      items: Array.isArray(payload.items) ? payload.items.map(project) : [],
      total: number(payload.total),
      page: Math.max(1, number(payload.page) || page),
      pageSize: Math.max(1, number(payload.pageSize) || pageSize),
      summary: payload.summary ? summary(payload.summary) : EMPTY_SUMMARY,
    };
  },

  async updateFinancials(projectId: string, input: ProjectFinancialInput) {
    const response = await getSupabaseClient().rpc('update_project_financials_r59', {
      p_project_id: Number(projectId),
      p_total_value: input.totalValue,
      p_payment_terms: input.paymentTerms,
      p_project_start_date: input.projectStartDate,
      p_project_due_date: input.projectDueDate,
      p_first_payment_due_date: input.firstPaymentDueDate,
      p_second_payment_due_date: input.secondPaymentDueDate,
    });
    if (response.error) throw new Error(`Não foi possível salvar os dados do projeto: ${response.error.message}`);
    return record(response.data);
  },

  async setStage(projectId: string, stage: ProjectStage, startedOn: string | null, dueOn: string | null) {
    const response = await getSupabaseClient().rpc('set_project_stage_r59', {
      p_project_id: Number(projectId),
      p_stage: stage,
      p_started_on: startedOn,
      p_due_on: dueOn,
    });
    if (response.error) throw new Error(`Não foi possível atualizar a etapa do projeto: ${response.error.message}`);
    return record(response.data);
  },

  async updateStageDates(projectId: string, startedOn: string | null, dueOn: string | null) {
    const response = await getSupabaseClient().rpc('update_project_stage_dates_r59', {
      p_project_id: Number(projectId),
      p_started_on: startedOn,
      p_due_on: dueOn,
    });
    if (response.error) throw new Error(`Não foi possível atualizar as datas da etapa: ${response.error.message}`);
    return record(response.data);
  },

  async setPaymentReceived(projectId: string, installment: 1 | 2, received: boolean) {
    const response = await getSupabaseClient().rpc('set_project_payment_received_r59', {
      p_project_id: Number(projectId),
      p_installment: installment,
      p_received: received,
    });
    if (response.error) throw new Error(`Não foi possível atualizar o pagamento: ${response.error.message}`);
    return record(response.data);
  },
};
