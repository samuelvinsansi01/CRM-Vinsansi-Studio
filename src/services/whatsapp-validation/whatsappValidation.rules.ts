import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';
import { normalizePhone } from '../import/importValidation';
import { isValidInstagram } from '../instagram/instagram.utils';
import { LEAD_STATUS } from '../status/leadStatus';
import type { WhatsAppValidationMode } from './types';

export type WhatsAppValidationTarget = {
  statusId: LeadStatusId;
  channelId: number;
  outcome: 'approved' | 'revalidated' | 'redirected' | 'invalidated';
};

export function expectedStatusForValidation(mode: WhatsAppValidationMode): LeadStatusId {
  return mode === 'initial' ? LEAD_STATUS.PRE_SEND : LEAD_STATUS.VALIDATED;
}

export function isLikelyValidWhatsApp(value: unknown) {
  const normalized = normalizePhone(value);
  return normalized.startsWith('55') && (normalized.length === 12 || normalized.length === 13);
}

export function validationSelectionError(
  row: LeadDatabaseRow,
  mode: WhatsAppValidationMode,
  whatsappChannelId: number,
) {
  const expectedStatus = expectedStatusForValidation(mode);
  if (row.lead_status_id !== expectedStatus) {
    return `O lead mudou de etapa. Esperado status ${expectedStatus}, recebido ${row.lead_status_id}.`;
  }
  if (Number(row.channels_id) !== whatsappChannelId) return 'Somente leads do canal WhatsApp podem ser validados neste fluxo.';
  return null;
}

export function validWhatsAppTarget(
  mode: WhatsAppValidationMode,
  whatsappChannelId: number,
): WhatsAppValidationTarget {
  return {
    statusId: LEAD_STATUS.VALIDATED,
    channelId: whatsappChannelId,
    outcome: mode === 'initial' ? 'approved' : 'revalidated',
  };
}

export function invalidWhatsAppTarget(
  row: LeadDatabaseRow,
  whatsappChannelId: number,
  instagramChannelId: number,
): WhatsAppValidationTarget {
  if (isValidInstagram(row.leads_instagram)) {
    return { statusId: LEAD_STATUS.VALIDATED, channelId: instagramChannelId, outcome: 'redirected' };
  }
  return { statusId: LEAD_STATUS.INVALID, channelId: whatsappChannelId, outcome: 'invalidated' };
}
