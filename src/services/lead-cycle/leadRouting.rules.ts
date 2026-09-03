import { LEAD_STATUS } from '../status/leadStatus';
import type { LeadDatabaseRow, LeadStatusId } from '../../types/lead.types';
import type { LeadRoutingCommand, LeadCycleChannel } from './types';

export type LeadRoutingDecision = {
  expectedStatus: LeadStatusId;
  targetStatus: LeadStatusId;
  targetChannel?: LeadCycleChannel;
};

const COMMAND_DECISIONS: Record<LeadRoutingCommand, LeadRoutingDecision> = {
  'invalidate-imported': { expectedStatus: LEAD_STATUS.IMPORTED, targetStatus: LEAD_STATUS.INVALID },
};

export function routingDecision(command: LeadRoutingCommand) {
  return COMMAND_DECISIONS[command];
}

export function validateRoutingCommand(row: LeadDatabaseRow, command: LeadRoutingCommand) {
  const decision = routingDecision(command);
  if (row.lead_status_id !== decision.expectedStatus) {
    return `O lead mudou de etapa e não pode mais executar esta ação. Status atual: ${row.lead_status_id}.`;
  }
  return null;
}

export function isRoutingNoop(row: LeadDatabaseRow, command: LeadRoutingCommand, targetChannelId?: number) {
  const decision = routingDecision(command);
  const sameStatus = row.lead_status_id === decision.targetStatus;
  const sameChannel = decision.targetChannel === undefined || row.channels_id === targetChannelId;
  return sameStatus && sameChannel;
}
