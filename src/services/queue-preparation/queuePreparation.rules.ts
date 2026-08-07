export const QUEUE_ROLLOVER_HOUR = 22;

const WEEKDAY_KEYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toLocalDateInputValue(date);
}

function normalizeDayName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function weekdayKey(dateInput: string) {
  const [year, month, day] = dateInput.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  return WEEKDAY_KEYS[date.getDay()] ?? '';
}

export function alignToActiveDay(dateInput: string, activeDays: string[]) {
  const allowed = new Set(activeDays.map(normalizeDayName).filter(Boolean));
  if (!allowed.size) return { date: dateInput, adjusted: false };

  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = offset ? addDays(dateInput, offset) : dateInput;
    if (allowed.has(weekdayKey(candidate))) return { date: candidate, adjusted: offset > 0 };
  }

  return { date: dateInput, adjusted: false };
}

export function effectiveScheduleDate(
  requestedDate: string,
  activeDays: string[] = [],
  reference = new Date(),
) {
  const today = toLocalDateInputValue(reference);
  const safeRequested = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const notPast = safeRequested < today ? today : safeRequested;
  const cutoffApplied = reference.getHours() >= QUEUE_ROLLOVER_HOUR && notPast === today;
  const afterCutoff = cutoffApplied ? addDays(today, 1) : notPast;
  const activeDate = alignToActiveDay(afterCutoff, activeDays);
  return {
    requestedDate: safeRequested,
    effectiveDate: activeDate.date,
    cutoffApplied,
    activeDayAdjusted: activeDate.adjusted,
  };
}
