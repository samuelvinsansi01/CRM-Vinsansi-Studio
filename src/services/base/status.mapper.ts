import { statusLabel, statusTone } from '../status/status.mapper';
import type { BaseLeadStatus } from './types';

export const baseStatusLabel: Record<BaseLeadStatus, string> = {
  sent: statusLabel('sent'),
  archived: statusLabel('archived'),
  invalid: statusLabel('invalid'),
  error: statusLabel('error'),
};

export const baseStatusTone: Record<BaseLeadStatus, 'success' | 'warning' | 'danger'> = {
  sent: 'success',
  archived: 'warning',
  invalid: statusTone('invalid') as 'danger',
  error: statusTone('error') as 'danger',
};
