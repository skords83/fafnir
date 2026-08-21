export interface CollapsedDay<T> {
  transactions: T[];
  totalCents: number;
}

export interface DayGroup<T> {
  date: string;
  featured: T[];
  /** null when the day has few enough transactions that none need collapsing. */
  collapsed: CollapsedDay<T> | null;
}

const COLLAPSE_THRESHOLD = 3;
const FEATURED_COUNT = 3;

/**
 * Groups transactions by booking date, preserving the input order of the dates
 * themselves (callers pass rows already sorted newest-first). Days with more
 * than COLLAPSE_THRESHOLD transactions keep only the FEATURED_COUNT largest
 * (by absolute amount) visible; the rest are summarized for a collapsible row.
 */
export function groupTransactionsByDay<T extends { bookingDate: string; amountCents: number }>(
  rows: T[]
): DayGroup<T>[] {
  const dateOrder: string[] = [];
  const byDate = new Map<string, T[]>();

  for (const row of rows) {
    if (!byDate.has(row.bookingDate)) {
      dateOrder.push(row.bookingDate);
      byDate.set(row.bookingDate, []);
    }
    byDate.get(row.bookingDate)!.push(row);
  }

  return dateOrder.map((date) => {
    const dayTransactions = byDate.get(date)!;

    if (dayTransactions.length <= COLLAPSE_THRESHOLD) {
      return { date, featured: dayTransactions, collapsed: null };
    }

    // Featured rows are ordered by prominence (largest absolute amount first);
    // the collapsed rest keeps the original chronological order for easy review.
    const byAmountDesc = [...dayTransactions].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
    const featured = byAmountDesc.slice(0, FEATURED_COUNT);
    const featuredSet = new Set(featured);
    const rest = dayTransactions.filter((tx) => !featuredSet.has(tx));

    return {
      date,
      featured,
      collapsed: { transactions: rest, totalCents: rest.reduce((sum, tx) => sum + tx.amountCents, 0) },
    };
  });
}
