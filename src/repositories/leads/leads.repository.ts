import { getSupabaseClient } from '../../lib/supabase';
import type { CommercialStage, CrmDashboardSummary, CrmLead, CrmLeadFilters, CrmLeadPage, CrmLeadPageRequest, CrmLeadSummary } from '../../services/leads/crmLead.types';

type Row = Record<string, unknown>;

const EMPTY_SUMMARY: CrmLeadSummary = {
  total: 0,
  imported: 0,
  review: 0,
  noContact: 0,
  queued: 0,
  sent: 0,
  invalid: 0,
  duplicates: 0,
  commercial: {
    aguardandoResposta: 0,
    aguardandoDesign: 0,
    designEnviado: 0,
    fechado: 0,
    recusado: 0,
  },
};

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function lead(value: unknown): CrmLead {
  const row = record(value);
  const stage = text(row.commercialStage) as CommercialStage;
  return {
    id: text(row.id),
    company: text(row.company),
    alternativeName: text(row.alternativeName),
    branchId: text(row.branchId),
    branch: text(row.branch),
    state: text(row.state),
    city: text(row.city),
    channel: (text(row.channel) || 'Sem canal') as CrmLead['channel'],
    phone: text(row.phone),
    instagram: text(row.instagram),
    website: text(row.website),
    mapsUrl: text(row.mapsUrl),
    rating: number(row.rating),
    reviews: number(row.reviews),
    origin: text(row.origin),
    statusId: number(row.statusId),
    status: text(row.status),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    lastSentAt: text(row.lastSentAt),
    commercialStage: stage ? stage : null,
    commercialUpdatedAt: text(row.commercialUpdatedAt),
    commercialUpdatedBy: text(row.commercialUpdatedBy),
    designDueDate: text(row.designDueDate),
  };
}

function summary(value: unknown): CrmLeadSummary {
  const row = record(value);
  const commercial = record(row.commercial);
  return {
    total: number(row.total),
    imported: number(row.imported),
    review: number(row.review),
    noContact: number(row.noContact),
    queued: number(row.queued),
    sent: number(row.sent),
    invalid: number(row.invalid),
    duplicates: number(row.duplicates),
    commercial: {
      aguardandoResposta: number(commercial.aguardandoResposta),
      aguardandoDesign: number(commercial.aguardandoDesign),
      designEnviado: number(commercial.designEnviado),
      fechado: number(commercial.fechado),
      recusado: number(commercial.recusado),
    },
  };
}

function dashboardSummary(value: unknown): CrmDashboardSummary {
  const row = record(value);
  const commercial = record(row.commercial);
  return {
    newLeads: number(row.newLeads),
    queued: number(row.queued),
    sent: number(row.sent),
    invalid: number(row.invalid),
    noContact: number(row.noContact),
    designsDue: number(row.designsDue),
    commercial: {
      aguardandoResposta: number(commercial.aguardandoResposta),
      aguardandoDesign: number(commercial.aguardandoDesign),
      designEnviado: number(commercial.designEnviado),
      fechado: number(commercial.fechado),
      recusado: number(commercial.recusado),
    },
  };
}

export const leadsRepository = {
  async page(filters: CrmLeadFilters, request: CrmLeadPageRequest): Promise<CrmLeadPage> {
    const response = await getSupabaseClient().rpc('list_leads_page_r59', {
      p_page: request.page,
      p_page_size: request.pageSize,
      p_search: filters.search?.trim() || null,
      p_status_id: filters.statusId || null,
      p_channel: filters.channel && filters.channel !== 'Todos' ? filters.channel : null,
      p_commercial_stage: filters.commercialStage && filters.commercialStage !== 'Todos' ? filters.commercialStage : null,
      p_branch_id: filters.branchId ? Number(filters.branchId) : null,
      p_state: filters.state && filters.state !== 'Todos' ? filters.state : null,
    });
    if (response.error) throw new Error(`Não foi possível carregar os leads: ${response.error.message}`);
    const payload = record(response.data);
    const items = Array.isArray(payload.items) ? payload.items.map(lead) : [];
    return {
      items,
      total: number(payload.total),
      page: Math.max(1, number(payload.page) || request.page),
      pageSize: Math.max(1, number(payload.pageSize) || request.pageSize),
      summary: payload.summary ? summary(payload.summary) : EMPTY_SUMMARY,
    };
  },

  async summary(): Promise<CrmLeadSummary> {
    const page = await this.page({}, { page: 1, pageSize: 10 });
    return page.summary;
  },

  async setCommercialStage(leadId: string, stage: CommercialStage) {
    const response = await getSupabaseClient().rpc('set_lead_commercial_stage_r59', {
      p_leads_id: Number(leadId),
      p_commercial_stage: stage,
    });
    if (response.error) throw new Error(`Não foi possível atualizar o estágio comercial: ${response.error.message}`);
    return record(response.data);
  },


  async setDesignDueDate(leadId: string, designDueDate: string | null) {
    const response = await getSupabaseClient().rpc('set_lead_design_due_date_r59', {
      p_leads_id: Number(leadId),
      p_design_due_date: designDueDate || null,
    });
    if (response.error) throw new Error(`Não foi possível atualizar a data do design: ${response.error.message}`);
    return record(response.data);
  },

  async dashboardSummary(fromIso: string, toExclusiveIso: string): Promise<CrmDashboardSummary> {
    const response = await getSupabaseClient().rpc('dashboard_summary_r59', {
      p_from: fromIso,
      p_to_exclusive: toExclusiveIso,
    });
    if (response.error) throw new Error(`Não foi possível carregar o Dashboard: ${response.error.message}`);
    return dashboardSummary(response.data);
  },
};
