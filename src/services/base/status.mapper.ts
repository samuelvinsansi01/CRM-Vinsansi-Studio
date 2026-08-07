import type { BaseLeadStatus } from './types';

export const baseStatusLabel: Record<BaseLeadStatus, string> = {
  importado: 'Importado',
  validado: 'Validado',
  pre_envio: 'Pré-envio',
  na_fila: 'Na fila',
  enviado: 'Enviado',
  invalido: 'Inválido',
  duplicado: 'Duplicado',
  arquivado: 'Arquivado',
};

export const baseStatusTone: Record<BaseLeadStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'primary'> = {
  importado: 'neutral',
  validado: 'success',
  pre_envio: 'warning',
  na_fila: 'primary',
  enviado: 'success',
  invalido: 'danger',
  duplicado: 'danger',
  arquivado: 'neutral',
};
