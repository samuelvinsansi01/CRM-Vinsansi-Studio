import type { BaseLeadStatus } from './types';

const OFFICIAL_STATUSES: readonly BaseLeadStatus[] = [
  'importado',
  'validado',
  'pre_envio',
  'na_fila',
  'enviado',
  'invalido',
  'duplicado',
  'arquivado',
];

export function isOfficialLeadStatus(value: unknown): value is BaseLeadStatus {
  return OFFICIAL_STATUSES.includes(value as BaseLeadStatus);
}

export function assertOfficialLeadStatus(value: unknown): asserts value is BaseLeadStatus {
  if (!isOfficialLeadStatus(value)) {
    throw new Error(`Status de lead inválido: ${String(value ?? '')}`);
  }
}

export function assertLeadCanBeArchived(status: BaseLeadStatus) {
  assertOfficialLeadStatus(status);
  if (status === 'arquivado') {
    throw new Error('O lead já está arquivado.');
  }
}

export function assertDirectStatusChangeAllowed(from: BaseLeadStatus, to: BaseLeadStatus) {
  assertOfficialLeadStatus(from);
  assertOfficialLeadStatus(to);
  if (from !== to) {
    throw new Error('A mudança direta de status está bloqueada até a regra operacional correspondente ser migrada.');
  }
}
