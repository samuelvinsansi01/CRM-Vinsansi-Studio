import { repositories } from '../../repositories';
import { supabaseLeadCycleRepository } from '../../repositories/lead-cycle';
import { channelId } from '../../repositories/schemaCatalog';
import type { LeadDatabaseRow } from '../../types/lead.types';
import { branchForBoundRecord } from '../config/branchMedia';
import type { BranchConfigRecord, ConfigRecord, TemplateConfigRecord } from '../config/types';
import { normalizePhone } from '../import/importValidation';
import { isValidInstagram } from '../instagram/instagram.utils';
import { getEffectiveWhatsAppPhone } from '../leads/leadContact';
import { LEAD_STATUS } from '../status/leadStatus';
import { templateMessageContractIssue } from '../templates/templateContract';
import { renderLeadMessages } from '../templates/templateVariables';
import { selectTemplateForLead, templateTypeForLead } from '../templates/templateSelector';
import type { QueuePreparationChannel, QueuePreparationFailure } from './types';

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isBranch(record: ConfigRecord): record is BranchConfigRecord {
  return record.kind === 'branches';
}

function isTemplate(record: ConfigRecord): record is TemplateConfigRecord {
  return record.kind === 'templates';
}

function rowBranch(row: LeadDatabaseRow) {
  return one(row.branches)?.branches_name ?? '';
}

function rowCity(row: LeadDatabaseRow) {
  return one(row.cities)?.cities_name ?? '';
}

function rowState(row: LeadDatabaseRow) {
  const state = one(row.states);
  return state?.states_code ?? state?.states_name ?? '';
}

function leadContext(row: LeadDatabaseRow, channel: QueuePreparationChannel) {
  const website = String(row.leads_website ?? '').trim();
  const destination = channel === 'Instagram' ? 'Instagram' as const : website ? 'Com site' as const : 'WhatsApp' as const;
  return {
    company: row.leads_name,
    company_name: row.leads_name,
    branch: rowBranch(row),
    branch_id: String(row.branches_id),
    city: rowCity(row),
    state: rowState(row),
    phone: getEffectiveWhatsAppPhone(row),
    instagram: row.leads_instagram ?? '',
    site: website,
    mapsUrl: row.leads_maps ?? '',
    channel,
    destination,
    original_destination: destination,
  };
}

async function loadReviewApprovalConfiguration() {
  const [branches, templates] = await Promise.all([
    repositories.config.list('branches'),
    repositories.config.list('templates'),
  ]);
  return {
    branches: branches.filter(isBranch),
    templates: templates.filter(isTemplate),
  };
}

function findBranch(row: LeadDatabaseRow, branches: BranchConfigRecord[]) {
  return branchForBoundRecord({ branch_id: String(row.branches_id), branch: rowBranch(row) }, branches);
}

function preparationReason(
  row: LeadDatabaseRow,
  channel: QueuePreparationChannel,
  expectedChannelId: number,
  branches: BranchConfigRecord[],
  templates: TemplateConfigRecord[],
) {
  if (row.lead_status_id !== LEAD_STATUS.REVIEW) return 'O lead não está mais na revisão aberta.';
  if (Number(row.channels_id) !== expectedChannelId) return 'O canal do lead foi alterado.';
  if (channel === 'WhatsApp' && normalizePhone(getEffectiveWhatsAppPhone(row)).length < 10) return 'Telefone inválido para WhatsApp.';
  if (channel === 'Instagram' && !isValidInstagram(row.leads_instagram)) return 'Instagram inválido ou ausente.';

  const context = leadContext(row, channel);
  const selection = selectTemplateForLead(context, templates);
  if (!selection) {
    const structuralSelection = selectTemplateForLead(context, templates, { requireMessages: false });
    if (!structuralSelection) return `Nenhum template ${channel} compatível com o ramo e o tipo ${templateTypeForLead(context)}.`;
    const structuralMessages = renderLeadMessages(context, structuralSelection.template);
    const messageIssue = templateMessageContractIssue(structuralMessages, channel);
    if (messageIssue) return messageIssue;
    return `O template ${channel} compatível não está pronto para uso.`;
  }
  const messages = renderLeadMessages(context, selection.template);
  const messageIssue = templateMessageContractIssue(messages, channel);
  if (messageIssue) return messageIssue;

  const branch = findBranch(row, branches);
  if (branch?.imageRequired && !String(branch.imageName ?? '').trim()) {
    return 'O ramo exige imagem, mas nenhuma mídia foi configurada.';
  }
  return '';
}

function templateIdForLead(row: LeadDatabaseRow, channel: QueuePreparationChannel, templates: TemplateConfigRecord[]) {
  const selection = selectTemplateForLead(leadContext(row, channel), templates);
  if (!selection) throw new Error(`Nenhum template ${channel} compatível com o lead.`);
  return String(selection.template.id);
}

async function buildReviewLockItems(channel: QueuePreparationChannel, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { items: [] as Array<{ leadId: string; templateId: string }>, failures: [] as QueuePreparationFailure[] };

  const config = await loadReviewApprovalConfiguration();
  const expectedChannelId = Number(await channelId(channel));
  const rows = await supabaseLeadCycleRepository.listByIds(uniqueIds);
  const byId = new Map(rows.map((row) => [String(row.leads_id), row]));
  const items: Array<{ leadId: string; templateId: string }> = [];
  const failures: QueuePreparationFailure[] = [];

  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) {
      failures.push({ id, reason: 'Lead não encontrado ou sem permissão de acesso.' });
      continue;
    }
    const reason = preparationReason(row, channel, expectedChannelId, config.branches, config.templates);
    if (reason) {
      failures.push({ id, company: row.leads_name, reason });
      continue;
    }
    items.push({ leadId: id, templateId: templateIdForLead(row, channel, config.templates) });
  }
  return { items, failures };
}

export const queuePreparationService = { buildReviewLockItems };
