import { useCallback, useState } from 'react';
import { toLocalDateInputValue } from '../utils/date';

const STORAGE_KEY = 'crm.queue.browse-date';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBrowseDate(value: string) {
  return DATE_RE.test(value) ? value : toLocalDateInputValue();
}

function readBrowseDate() {
  const fallback = toLocalDateInputValue();
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? '';
    const normalized = normalizeBrowseDate(stored);
    if (normalized !== stored) window.localStorage.setItem(STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return fallback;
  }
}

function persistBrowseDate(value: string) {
  const normalized = normalizeBrowseDate(value);
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, normalized); } catch { /* storage pode estar indisponível */ }
  }
  return normalized;
}

/**
 * Data de consulta da Fila. Diferente da data operacional usada para preparar
 * novos lotes, esta data aceita histórico e nunca move/reagenda itens.
 */
export function useQueueBrowseDate() {
  const [date, setDateState] = useState(readBrowseDate);
  const setDate = useCallback((value: string) => setDateState(persistBrowseDate(value)), []);
  return [date, setDate] as const;
}
