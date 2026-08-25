function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function effectiveScheduleDate(
  requestedDate: string,
  _legacyActiveDays: string[] = [],
  reference = new Date(),
) {
  const today = toLocalDateInputValue(reference);
  const safeRequested = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const notPast = safeRequested < today ? today : safeRequested;
  return {
    requestedDate: safeRequested,
    effectiveDate: notPast,
    cutoffApplied: false,
    activeDayAdjusted: false,
  };
}
