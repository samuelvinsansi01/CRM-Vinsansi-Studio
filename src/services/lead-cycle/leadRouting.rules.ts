import { normalizeInstagramUsername, isValidInstagram } from '../instagram/instagram.utils';
import { normalizePhone } from '../import/importValidation';
import { LEAD_STATUS } from '../status/leadStatus';
import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';
import type { LeadRoutingCommand, LeadCycleChannel } from './types';
import { getEffectiveWhatsAppPhone } from '../leads/leadContact';

export type LeadRoutingDecision = {
  expectedStatus: LeadStatusId;
  targetStatus: LeadStatusId;
  targetChannel?: LeadCycleChannel;
};

const COMMAND_DECISIONS: Record<LeadRoutingCommand, LeadRoutingDecision> = {
  'route-imported-to-whatsapp': { expectedStatus: LEAD_STATUS.IMPORTED, targetStatus: LEAD_STATUS.PRE_SEND, targetChannel: 'WhatsApp' },
  'route-imported-to-instagram': { expectedStatus: LEAD_STATUS.IMPORTED, targetStatus: LEAD_STATUS.VALIDATED, targetChannel: 'Instagram' },
  'invalidate-imported': { expectedStatus: LEAD_STATUS.IMPORTED, targetStatus: LEAD_STATUS.INVALID },
  'archive-imported': { expectedStatus: LEAD_STATUS.IMPORTED, targetStatus: LEAD_STATUS.ARCHIVED },
  'set-valid-channel-whatsapp': { expectedStatus: LEAD_STATUS.VALIDATED, targetStatus: LEAD_STATUS.VALIDATED, targetChannel: 'WhatsApp' },
  'set-valid-channel-instagram': { expectedStatus: LEAD_STATUS.VALIDATED, targetStatus: LEAD_STATUS.VALIDATED, targetChannel: 'Instagram' },
  'archive-valid': { expectedStatus: LEAD_STATUS.VALIDATED, targetStatus: LEAD_STATUS.ARCHIVED },
  'invalidate-pre-send': { expectedStatus: LEAD_STATUS.PRE_SEND, targetStatus: LEAD_STATUS.INVALID },
  'archive-pre-send': { expectedStatus: LEAD_STATUS.PRE_SEND, targetStatus: LEAD_STATUS.ARCHIVED },
};

export function routingDecision(command: LeadRoutingCommand) {
  return COMMAND_DECISIONS[command];
}

function validPhone(value: unknown) {
  return normalizePhone(value).length >= 10;
}

function contactValidationError(row: LeadDatabaseRow, command: LeadRoutingCommand) {
  if (command === 'route-imported-to-whatsapp' || command === 'set-valid-channel-whatsapp') {
    if (!validPhone(getEffectiveWhatsAppPhone(row))) return 'O lead não possui telefone válido para o canal WhatsApp.';
  }

  if (command === 'route-imported-to-instagram' || command === 'set-valid-channel-instagram') {
    const username = normalizeInstagramUsername(row.leads_instagram);
    if (!username || !isValidInstagram(username)) {
      return 'O lead não possui um Instagram válido para esse roteamento.';
    }
  }

  return null;
}

export function validateRoutingCommand(row: LeadDatabaseRow, command: LeadRoutingCommand) {
  const decision = routingDecision(command);
  if (row.lead_status_id !== decision.expectedStatus) {
    return `O lead mudou de etapa e não pode mais executar esta ação. Status atual: ${row.lead_status_id}.`;
  }
  return contactValidationError(row, command);
}

export function isRoutingNoop(row: LeadDatabaseRow, command: LeadRoutingCommand, targetChannelId?: number) {
  const decision = routingDecision(command);
  const sameStatus = row.lead_status_id === decision.targetStatus;
  const sameChannel = decision.targetChannel === undefined || row.channels_id === targetChannelId;
  return sameStatus && sameChannel;
}
