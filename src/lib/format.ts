export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
}

/** Formats a percentage change with an explicit sign, e.g. -38.4 -> "-38,4 %". */
export function formatPercentChange(percent: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(percent / 100);
}

/**
 * Formats an ISO date (yyyy-mm-dd) as a day-group heading, e.g. "Do., 20. August".
 * The year is only shown when it differs from the reference date's year, since
 * transaction lists are dominated by recent, same-year bookings.
 */
export function formatDayHeading(isoDate: string, referenceDate = new Date()): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const sameYear = date.getFullYear() === referenceDate.getFullYear();
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}
