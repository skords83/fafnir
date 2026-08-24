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
  categoryId: number;
  categoryName: string;
  amountCents: number;
  percentage: number;
}

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
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
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
      month: monthNames[m - 1],
      monthKey,
      incomeCents,
      expenseCents,
    });
  }

  return result;
}

export function calculateCategoryBreakdown(
  items: Array<{ amountCents: number; categoryName: string; categoryId: number }>
): CategoryBreakdownPoint[] {
  const categoryMap = new Map<
    number,
    { name: string; amount: number }
  >();

  // Aggregate expenses by category (skip income/positive amounts)
  for (const item of items) {
    if (item.amountCents < 0) {
      const absolute = Math.abs(item.amountCents);
      if (!categoryMap.has(item.categoryId)) {
        categoryMap.set(item.categoryId, {
          name: item.categoryName,
          amount: 0,
        });
      }
      const entry = categoryMap.get(item.categoryId)!;
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
    ([categoryId, { name, amount }]) => ({
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
    return b.categoryId - a.categoryId;
  });
  return result;
}
