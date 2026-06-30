import { isStatusGroup } from '../status/status.mapper';
import type { WhatsAppQueueLead } from './types';

function text(value: unknown) {
  return String(value ?? '').trim();
}

const LEGACY_INCOMPLETE_REASON = 'item legado incompleto sem contrato de worker';

export function missingWhatsAppWorkerFields(lead: WhatsAppQueueLead) {
  const fields: string[] = [];
  if (!text(lead.lead_id)) fields.push('lead_id');
  if (!text(lead.chip_id)) fields.push('chip_id');
  if (!text(lead.chip_instance || lead.chip)) fields.push('chip_instance');
  if (!text(lead.scheduled_date)) fields.push('scheduled_date');
  if (!text(lead.template_id)) fields.push('template_id');
  if (!text(lead.message_1 || lead.message1)) fields.push('message_1');
  if (!text(lead.message_2 || lead.message2)) fields.push('message_2');
  if (!text(lead.phone_normalized || lead.phone)) fields.push('phone');
  return fields;
}

export function hasWhatsAppWorkerContract(lead: WhatsAppQueueLead) {
  return missingWhatsAppWorkerFields(lead).length === 0;
}

export function isActiveWhatsAppQueueStatus(status: unknown) {
  return isStatusGroup(status, 'queued') || isStatusGroup(status, 'paused') || isStatusGroup(status, 'sending');
}

export function hasWhatsAppOperationalIssue(lead: WhatsAppQueueLead) {
  return isActiveWhatsAppQueueStatus(lead.status) && !hasWhatsAppWorkerContract(lead);
}

export function isSanitizedLegacyWhatsAppItem(lead: WhatsAppQueueLead) {
  const marker = `${lead.invalid_reason ?? ''} ${lead.error_message ?? ''} ${lead.notes ?? ''}`.toLowerCase();
  return marker.includes(LEGACY_INCOMPLETE_REASON);
}
