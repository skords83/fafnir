export interface MonthSummary {
  incomeCents: number;
  expenseCents: number;
}

export interface MonthlyTrendPoint {
  month: string;
  monthKey: string;
  incomeCents: number;
  expenseCents: number;
}

export interface CategoryBreakdownPoint {
  categoryId: number | null;
  categoryName: string;
  amountCents: number;
  percentage: number;
}

const GERMAN_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
];

export function calculateMonthSummary(
  transactions: Array<{ amountCents: number; bookingDate: string }>,
  yearMonth: string
): MonthSummary {
  let incomeCents = 0;
  let expenseCents = 0;

  for (const tx of transactions) {
    if (tx.bookingDate.startsWith(yearMonth)) {
      if (tx.amountCents > 0) {
        incomeCents += tx.amountCents;
      } else {
        expenseCents += Math.abs(tx.amountCents);
      }
    }
  }

  return { incomeCents, expenseCents };
}

export function calculateMonthlyTrends(
  transactions: Array<{ amountCents: number; bookingDate: string }>,
  year: number
): MonthlyTrendPoint[] {
  const result: MonthlyTrendPoint[] = [];

  for (let m = 1; m <= 12; m++) {
    const monthKey = `${year}-${String(m).padStart(2, '0')}`;
    let incomeCents = 0;
    let expenseCents = 0;

    for (const tx of transactions) {
      if (tx.bookingDate.startsWith(monthKey)) {
        if (tx.amountCents > 0) {
          incomeCents += tx.amountCents;
        } else {
          expenseCents += Math.abs(tx.amountCents);
        }
      }
    }

    result.push({
      month: GERMAN_MONTH_NAMES[m - 1],
      monthKey,
      incomeCents,
      expenseCents,
    });
  }

  return result;
}

export function calculateCategoryBreakdown(
  items: Array<{
    amountCents: number;
    categoryName: string | null;
    categoryId: number | null;
  }>
): CategoryBreakdownPoint[] {
  const categoryMap = new Map<
    string,
    { categoryId: number | null; name: string; amount: number }
  >();

  // Aggregate expenses by category (skip income/positive amounts)
  for (const item of items) {
    if (item.amountCents < 0) {
      const absolute = Math.abs(item.amountCents);
      const name = item.categoryName ?? 'Unkategorisiert';
      const mapKey = `${item.categoryId ?? 'null'}:${name}`;

      if (!categoryMap.has(mapKey)) {
        categoryMap.set(mapKey, {
          categoryId: item.categoryId,
          name,
          amount: 0,
        });
      }
      const entry = categoryMap.get(mapKey)!;
      entry.amount += absolute;
    }
  }

  // Calculate total expenses to compute percentages
  const totalExpenses = Array.from(categoryMap.values()).reduce(
    (sum, entry) => sum + entry.amount,
    0
  );

  // Convert to result array, sorted by amount descending
  const result: CategoryBreakdownPoint[] = Array.from(categoryMap).map(
    ([, { categoryId, name, amount }]) => ({
      categoryId,
      categoryName: name,
      amountCents: amount,
      percentage:
        totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    })
  );

  result.sort((a, b) => {
    if (b.amountCents !== a.amountCents) {
      return b.amountCents - a.amountCents;
    }
    // When amounts are equal, sort by categoryId descending (nulls last)
    const aId = a.categoryId ?? -1;
    const bId = b.categoryId ?? -1;
    return bId - aId;
  });
  return result;
}
