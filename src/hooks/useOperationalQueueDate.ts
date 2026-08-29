import { useCallback, useState } from 'react';
import { toLocalDateInputValue } from '../utils/date';

const STORAGE_KEY = 'crm.queue.operational-date';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeOperationalDate(value: string) {
  const today = toLocalDateInputValue();
  return DATE_RE.test(value) && value >= today ? value : today;
}

function readOperationalDate() {
  const today = toLocalDateInputValue();
  if (typeof window === 'undefined') return today;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? '';
    const normalized = normalizeOperationalDate(stored);
    if (normalized !== stored) window.localStorage.setItem(STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return today;
  }
}

function persistOperationalDate(value: string) {
  const normalized = normalizeOperationalDate(value);
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, normalized); } catch { /* storage pode estar indisponível */ }
  }
  return normalized;
}

/**
 * Data operacional única das filas. Home, WhatsApp e Instagram reutilizam o
 * mesmo valor para que uma fila preparada para amanhã continue apontando para
 * amanhã durante a navegação. Datas passadas voltam automaticamente para hoje.
 */
export function useOperationalQueueDate() {
  const [scheduledDate, setScheduledDateState] = useState(readOperationalDate);
  const setScheduledDate = useCallback((value: string) => {
    setScheduledDateState(persistOperationalDate(value));
  }, []);
  return [scheduledDate, setScheduledDate] as const;
}
