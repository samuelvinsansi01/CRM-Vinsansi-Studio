import { getSupabaseClient } from '../../lib/supabase';
import type {
  CreatePreSendLeadInput,
  PreSendChannel,
  PreSendFilters,
  PreSendLead,
  PreSendQueueFilter,
  PreSendSummary,
} from '../../services/pre-send/types';
import { getCurrentUserId } from '../supabase.helpers';
import type { PreSendRepository } from './preSend.repository';

const STATUS = {
  preEnvio: 3,
  naFila: 4,
  enviado: 5,
  invalido: 6,
  arquivado: 8,
} as const;

const CHANNEL = { WhatsApp: 1, Instagram: 2 } as const;

const LEADS_SELECT = `
  leads_id,
  users_id,
  branches_id,
  states_id,
  cities_id,
  channels_id,
  lead_status_id,
  contact_sources_id,
  leads_name,
  leads_phone,
  leads_instagram,
  leads_website,
  leads_maps,
  leads_score,
  leads_created_at,
  leads_updated_at,
  branches:branches_id ( branches_name ),
  states:states_id ( states_name, states_code ),
  cities:cities_id ( cities_name ),
  channels:channels_id ( channels_name ),
  contact_sources:contact_sources_id ( contact_sources_name )
`;

type Relation = Record<string, unknown> | Record<string, unknown>[] | null;
type LeadRow = Record<string, unknown> & {
  branches?: Relation;
  states?: Relation;
  cities?: Relation;
  channels?: Relation;
  contact_sources?: Relation;
};

function related(row: Relation | undefined, key: string) {
  const value = Array.isArray(row) ? row[0] : row;
  return String(value?.[key] ?? '');
}

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function channelFromRow(row: LeadRow): PreSendChannel {
  const channelName = normalize(related(row.channels, 'channels_name'));
  return Number(row.channels_id) === CHANNEL.Instagram || channelName === 'instagram' ? 'Instagram' : 'WhatsApp';
}

function destinationFromRow(row: LeadRow): PreSendLead['destination'] {
  if (channelFromRow(row) === 'Instagram' || Number(row.contact_sources_id) === 4) return 'Instagram';
  if (Number(row.contact_sources_id) === 2) return 'Com site';
  if (Number(row.contact_sources_id) === 3) return 'Agregadores';
  return 'WhatsApp';
}

function weekdaySlug(date = new Date()) {
  const names = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const effective = new Date(date);
  if (effective.getHours() >= 22) effective.setDate(effective.getDate() + 1);
  return names[effective.getDay()];
}

function statusFromRow(row: LeadRow): PreSendLead['status'] {
  if (Number(row.lead_status_id) === STATUS.naFila) return 'queued';
  return 'approved';
}

function rowToLead(row: LeadRow): PreSendLead {
  const channel = channelFromRow(row);
  const destination = destinationFromRow(row);
  const instagram = String(row.leads_instagram ?? '');
  return {
    id: String(row.leads_id),
    sourceImportId: String(row.leads_id),
    company: String(row.leads_name ?? ''),
    branch: related(row.branches, 'branches_name'),
    branch_id: row.branches_id ? String(row.branches_id) : undefined,
    channel,
    destination,
    original_destination: destination,
    send_instagram: channel === 'Instagram',
    instagram_url: instagram,
    profile: '',
    dayId: `${channel.toLowerCase()}-${weekdaySlug()}`,
    status: statusFromRow(row),
    phone: String(row.leads_phone ?? ''),
    instagram,
    site: String(row.leads_website ?? ''),
    mapsUrl: String(row.leads_maps ?? ''),
    city: related(row.cities, 'cities_name'),
    state: related(row.states, 'states_code') || related(row.states, 'states_name'),
    validationStatus: 'valid',
  };
}

function matchesQueueFilter(lead: PreSendLead, filter?: PreSendQueueFilter) {
  if (!filter || filter === 'Geral') return true;
  if (filter === 'WhatsApp') return lead.destination === 'WhatsApp';
  return lead.destination === 'Com site' || lead.destination === 'Agregadores';
}

async function listRows(statuses = [STATUS.preEnvio, STATUS.naFila]): Promise<LeadRow[]> {
  const userId = Number(await getCurrentUserId());
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select(LEADS_SELECT)
    .eq('users_id', userId)
    .in('lead_status_id', statuses)
    .order('leads_score', { ascending: false, nullsFirst: false })
    .order('leads_created_at', { ascending: true });
  if (error) throw new Error(`Não foi possível carregar o pré-envio: ${error.message}`);
  return (data ?? []) as unknown as LeadRow[];
}

async function updateStatus(ids: string[], statusId: number) {
  if (!ids.length) return;
  const userId = Number(await getCurrentUserId());
  const numericIds = ids.map(Number).filter(Number.isFinite);
  const { error } = await getSupabaseClient()
    .from('leads')
    .update({ lead_status_id: statusId, leads_updated_at: new Date().toISOString() })
    .eq('users_id', userId)
    .in('leads_id', numericIds);
  if (error) throw new Error(error.message);
}

export const supabasePreSendRepository: PreSendRepository = {
  async listDayCards() {
    return [];
  },

  async summary(): Promise<PreSendSummary> {
    const leads = (await listRows()).map(rowToLead);
    return {
      whatsapp: leads.filter((lead) => lead.channel === 'WhatsApp' && lead.status === 'approved').length,
      instagram: leads.filter((lead) => lead.channel === 'Instagram' && lead.status === 'approved').length,
      queued: leads.filter((lead) => lead.status === 'queued').length,
      total: leads.length,
    };
  },

  async listProfiles() {
    // Perfis/chips pertencem aos módulos operacionais. O serviço de pré-envio
    // já os carrega das configurações e não da tabela leads.
    return [];
  },

  async listLeads(filters: PreSendFilters) {
    return (await listRows()).map(rowToLead).filter((lead) =>
      lead.channel === filters.channel && matchesQueueFilter(lead, filters.queueFilter),
    );
  },

  async addLeads(inputLeads: CreatePreSendLeadInput[]) {
    const ids = Array.from(new Set(inputLeads.map((lead) => Number(lead.sourceImportId)).filter(Number.isFinite)));
    if (!ids.length) return [];

    const userId = Number(await getCurrentUserId());
    const inputById = new Map(inputLeads.map((lead) => [Number(lead.sourceImportId), lead]));

    // Pré-envio não duplica o lead. Ele apenas muda o estado do registro oficial
    // e ajusta o canal quando a regra já foi definida pelo fluxo de importação.
    for (const id of ids) {
      const input = inputById.get(id);
      const payload: Record<string, unknown> = {
        lead_status_id: STATUS.preEnvio,
        leads_updated_at: new Date().toISOString(),
      };
      if (input?.channel) payload.channels_id = CHANNEL[input.channel];

      const { error } = await getSupabaseClient()
        .from('leads')
        .update(payload)
        .eq('users_id', userId)
        .eq('leads_id', id);
      if (error) throw new Error(`Não foi possível mover o lead ${id} para o pré-envio: ${error.message}`);
    }

    const { data, error } = await getSupabaseClient()
      .from('leads')
      .select(LEADS_SELECT)
      .eq('users_id', userId)
      .in('leads_id', ids);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as LeadRow[]).map(rowToLead);
  },

  async moveToQueue(ids: string[]) {
    await updateStatus(ids, STATUS.naFila);
  },

  async markSent(ids: string[]) {
    await updateStatus(ids, STATUS.enviado);
  },

  async validateLead(id: string) {
    // Estar no pré-envio já representa um lead validado e preparado no banco novo.
    await updateStatus([id], STATUS.preEnvio);
  },

  async archiveLead(id: string) {
    await updateStatus([id], STATUS.arquivado);
  },

  async updateLead(id: string, input: Partial<PreSendLead>) {
    const userId = Number(await getCurrentUserId());
    const payload: Record<string, unknown> = { leads_updated_at: new Date().toISOString() };

    if (input.company !== undefined) payload.leads_name = input.company.trim();
    if (input.phone !== undefined) payload.leads_phone = input.phone.trim() || null;
    if (input.instagram !== undefined || input.instagram_url !== undefined) {
      payload.leads_instagram = String(input.instagram_url ?? input.instagram ?? '').trim() || null;
    }
    if (input.site !== undefined) payload.leads_website = input.site.trim() || null;
    if (input.mapsUrl !== undefined) payload.leads_maps = input.mapsUrl.trim() || null;
    if (input.channel !== undefined) payload.channels_id = CHANNEL[input.channel];

    if (input.status !== undefined) {
      const statusMap: Partial<Record<PreSendLead['status'], number>> = {
        approved: STATUS.preEnvio,
        review: STATUS.preEnvio,
        queued: STATUS.naFila,
        sent: STATUS.enviado,
        invalid: STATUS.invalido,
        archived: STATUS.arquivado,
      };
      const nextStatus = statusMap[input.status];
      if (nextStatus) payload.lead_status_id = nextStatus;
    }

    const { error } = await getSupabaseClient()
      .from('leads')
      .update(payload)
      .eq('users_id', userId)
      .eq('leads_id', Number(id));
    if (error) throw new Error(`Não foi possível atualizar o lead no pré-envio: ${error.message}`);
  },
};
