import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import { normalizePhone, normalizeSiteIdentity } from './importValidation';
import { isValidInstagram } from '../instagram/instagram.utils';
import { normalizeInstagramUsername } from '../instagram/instagram.utils';
import { assertTransition } from '../state-machine';
import { isStatusGroup, normalizeStatusGroup } from '../status/status.mapper';
import type { ImportExecutionOptions, ImportLead, ImportLeadInput, ImportListFilters } from './types';

type BulkImportAction = 'approve' | 'reject' | 'unapprove' | 'invalidate' | 'archive';

function compactStrings(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

async function listOperationalLeads() {
  const statuses: ImportListFilters['status'][] = ['pending', 'approved', 'rejected', 'invalid', 'archived'];
  const groups = await Promise.all(statuses.map((status) => repositories.import.list({ status })));
  const byId = new Map<string, ImportLead>();
  groups.flat().forEach((lead) => byId.set(lead.id, lead));
  return Array.from(byId.values());
}

type BulkTarget = {
  status: string;
  transition: 'approve' | 'reject' | 'unapprove' | 'invalidate' | 'archive';
  input: Partial<ImportLeadInput>;
};

function bulkTarget(action: BulkImportAction): BulkTarget {
  if (action === 'approve') return { status: 'approved' as const, transition: 'approve' as const, input: { status: 'approved' } };
  if (action === 'reject') return { status: 'rejected' as const, transition: 'reject' as const, input: { status: 'rejected', destino: 'Recusado', destination: 'Recusado', motivo: 'Movido manualmente para recusados.' } };
  if (action === 'unapprove') return { status: 'pending' as const, transition: 'unapprove' as const, input: { status: 'pending' } };
  if (action === 'invalidate') return { status: 'invalid' as const, transition: 'invalidate' as const, input: { status: 'invalid', motivo: 'Outros' } };
  return { status: 'archived' as const, transition: 'archive' as const, input: { status: 'archived' } };
}

function channelFromImport(lead: ImportLead): 'instagram' | 'whatsapp' {
  return (lead.send_instagram || (lead.destination ?? lead.destino) === 'Instagram') ? 'instagram' : 'whatsapp';
}

async function bulkUpdate(ids: string[], action: BulkImportAction) {
  if (!ids.length) throw new Error('Selecione pelo menos um lead.');
  const uniqueIds = Array.from(new Set(ids));
  const leads = await listOperationalLeads();
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const selected = uniqueIds.map((id) => byId.get(id));
  const missingIndex = selected.findIndex((lead) => !lead);
  if (missingIndex >= 0) throw new Error('Um ou mais leads nao foram encontrados.');

  const target = bulkTarget(action);
  const selectedLeads = selected as ImportLead[];
  selectedLeads.forEach((lead) => {
    if (action === 'approve' && isStatusGroup(lead.status, 'approved')) throw new Error('Aprovar exige apenas leads em aguarde, recusados ou invalidos.');
    if (action === 'reject' && isStatusGroup(lead.status, 'rejected')) throw new Error('Recusar exige apenas leads ainda nao recusados.');
    if (action === 'unapprove' && !isStatusGroup(lead.status, 'approved')) throw new Error('Desaprovar exige apenas leads aprovados.');
    if (action === 'invalidate' && isStatusGroup(lead.status, 'invalid')) throw new Error('Invalidar exige apenas leads ainda nao invalidados.');
    assertTransition({ entity: 'import', fromStatus: lead.status, toStatus: target.status, action: target.transition });
  });

  const updated = await Promise.all(selectedLeads.map((lead) => repositories.import.update(lead.id, target.input)));
  eventBus.emit('import:changed', { source: 'update' });
  return updated;
}

export const importService = {
  async list(filters: ImportListFilters) {
    return repositories.import.list(filters);
  },

  async listHomeOperationalLeads() {
    // Início é exclusivamente o começo do ciclo: lead_status_id = 1
    // (importado / em aguarde). Leads validados pertencem à tela de validados,
    // e nunca devem continuar aparecendo aqui.
    const pending = await repositories.import.list({ status: 'pending' });
    return pending.filter((lead) => isStatusGroup(lead.status, 'pending'));
  },


  async listValidatedLeads() {
    // A tela fixa Válidos exibe exclusivamente lead_status_id = 2.
    const approved = await repositories.import.list({ status: 'approved' });
    return approved.filter((lead) => isStatusGroup(lead.status, 'approved'));
  },

  async summary() {
    return repositories.import.summary();
  },

  async importFromJson(jsonText: string, options?: ImportExecutionOptions) {
    const finalIdentities = await repositories.base.listFinalIdentities();
    const result = await repositories.import.importFromJson(jsonText, {
      ...options,
      context: {
        ...(options?.context ?? {}),
        baseLeadIds: [],
        basePhones: compactStrings(finalIdentities.phones.map((phone) => normalizePhone(phone))),
        baseSites: compactStrings(finalIdentities.sites.map((site) => normalizeSiteIdentity(site))),
        baseInstagrams: compactStrings(finalIdentities.instagrams),
        baseMapsUrls: compactStrings(finalIdentities.mapsUrls),
      },
    });
    eventBus.emit('import:changed', { source: 'json' });
    return result;
  },

  async persistLeads(leads: ImportLead[], options?: ImportExecutionOptions) {
    const result = await repositories.import.persist(leads, options);
    if (result.created.length) eventBus.emit('import:changed', { source: 'json' });
    return result;
  },

  async create(input: ImportLeadInput) {
    const lead = await repositories.import.create(input);
    eventBus.emit('import:changed', { source: 'manual' });
    return lead;
  },

  async update(id: string, input: Partial<ImportLeadInput>) {
    const current = (await repositories.import.list({ status: 'approved' })).find((lead) => lead.id === id)
      ?? (await repositories.import.list({ status: 'pending' })).find((lead) => lead.id === id)
      ?? (await repositories.import.list({ status: 'rejected' })).find((lead) => lead.id === id);
    if (current) {
      assertTransition({ entity: 'import', fromStatus: current.status, action: 'edit' });
      if (input.status && normalizeStatusGroup(input.status) !== normalizeStatusGroup(current.status)) {
        const targetGroup = normalizeStatusGroup(input.status);
        const action =
          targetGroup === 'approved'
            ? 'approve'
            : targetGroup === 'pending'
              ? 'unapprove'
              : targetGroup === 'invalid'
                ? 'invalidate'
                : targetGroup === 'archived'
                  ? 'archive'
                  : 'reject';
        assertTransition({ entity: 'import', fromStatus: current.status, toStatus: input.status, action });
      }
      if (Object.prototype.hasOwnProperty.call(input, 'send_instagram')) {
        assertTransition({ entity: 'import', fromStatus: current.status, action: 'instagram_override' });
        if (input.send_instagram && !isValidInstagram(input.instagram_url ?? input.instagram ?? current.instagram_url ?? current.instagram)) {
          throw new Error('Lead sem Instagram valido');
        }
      }
    }
    const lead = await repositories.import.update(id, input);
    eventBus.emit('import:changed', { source: 'update' });
    return lead;
  },

  async remove(id: string) {
    await repositories.import.remove(id);
    eventBus.emit('import:changed', { source: 'remove' });
  },

  async move(id: string, status: 'approved' | 'rejected') {
    const current = (await repositories.import.list({ status: status === 'approved' ? 'rejected' : 'approved' })).find((lead) => lead.id === id);
    if (current) assertTransition({ entity: 'import', fromStatus: current.status, toStatus: status, action: status === 'approved' ? 'approve' : 'reject' });
    const lead = await repositories.import.move(id, status);
    eventBus.emit('import:changed', { source: 'move' });
    return lead;
  },


  async approveMany(ids: string[]) {
    return bulkUpdate(ids, 'approve');
  },

  async rejectMany(ids: string[]) {
    return bulkUpdate(ids, 'reject');
  },

  async unapproveMany(ids: string[]) {
    return bulkUpdate(ids, 'unapprove');
  },

  async invalidateMany(ids: string[]) {
    return bulkUpdate(ids, 'invalidate');
  },

  async archiveMany(ids: string[]) {
    return bulkUpdate(ids, 'archive');
  },

  async markAlreadySent(ids: string[], reason = 'Marcado manualmente como ja enviado no Inicio.') {
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) throw new Error('Selecione pelo menos um lead.');
    const leads = await listOperationalLeads();
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    const selected = uniqueIds.map((id) => byId.get(id));
    if (selected.some((lead) => !lead)) throw new Error('Um ou mais leads nao foram encontrados.');

    const sentAt = new Date().toISOString();
    const selectedLeads = selected as ImportLead[];

    for (const lead of selectedLeads) {
      if (isStatusGroup(lead.status, 'sent')) continue;
      assertTransition({ entity: 'import', fromStatus: lead.status, toStatus: 'sent', action: 'mark_sent' });
      await repositories.import.update(lead.id, {
        status: 'sent',
        motivo: reason,
      });
      await repositories.events.append({
        source: 'import',
        action: 'manual_mark_sent',
        channel: channelFromImport(lead),
        leadId: lead.id,
        status: 'sent',
        message: reason,
        metadata: {
          company_name: lead.empresa,
          normalized_phone: normalizePhone(lead.whatsapp),
          instagram_url: lead.instagram_url ?? lead.instagram,
          website: lead.site,
          maps_url: lead.normalizedMapsUrl,
          destination: lead.destination ?? lead.destino,
          manual: true,
          sent_at: sentAt,
        },
      });
    }

    eventBus.emit('base:changed', { action: 'update' });
    eventBus.emit('import:changed', { source: 'mark-sent' });
    return selectedLeads.length;
  },
};
