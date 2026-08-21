export interface MonthToDateTrend {
  changeCents: number;
  /** null when the reconstructed start-of-month balance was 0 — a percentage can't be expressed. */
  changePct: number | null;
  startBalanceCents: number;
}

/**
 * Reconstructs the balance at the start of the current month by walking the
 * current balance backward through this month's transactions, then derives
 * the month-to-date percentage change. No separate balance history is
 * needed: the sum of this month's transaction amounts *is* the change since
 * month start, so subtracting it from the current balance recovers the
 * start-of-month balance directly.
 */
export function computeMonthToDateTrend(
  currentBalanceCents: number,
  transactions: { bookingDate: string; amountCents: number }[],
  today: Date = new Date()
): MonthToDateTrend {
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

  const changeCents = transactions
    .filter((tx) => tx.bookingDate >= monthStart)
    .reduce((sum, tx) => sum + tx.amountCents, 0);

  const startBalanceCents = currentBalanceCents - changeCents;
  const changePct = startBalanceCents !== 0 ? (changeCents / Math.abs(startBalanceCents)) * 100 : null;

  return { changeCents, changePct, startBalanceCents };
}
