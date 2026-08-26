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

/**
 * Re-buckets an already-computed category breakdown by parent category: every point
 * whose category has a `parentCategoryId` is folded into that parent's bucket (summed,
 * percentages recomputed); everything else (ungrouped categories, the null-categoryId
 * "Unkategorisiert" bucket) passes through unchanged. Pure post-processing — never
 * queries the database itself, so it stays a cheap second view over data the caller
 * already has.
 */
export function groupBreakdownByParent(
  points: CategoryBreakdownPoint[],
  categoriesById: Map<number, { name: string; parentCategoryId?: number | null }>
): CategoryBreakdownPoint[] {
  const buckets = new Map<string, { categoryId: number | null; name: string; amount: number }>();

  for (const point of points) {
    const category = point.categoryId !== null ? categoriesById.get(point.categoryId) : undefined;
    const parentId = category?.parentCategoryId ?? null;
    const bucketCategoryId = parentId ?? point.categoryId;
    const bucketName =
      bucketCategoryId !== null ? (categoriesById.get(bucketCategoryId)?.name ?? point.categoryName) : point.categoryName;
    const mapKey = `${bucketCategoryId ?? 'null'}:${bucketName}`;

    if (!buckets.has(mapKey)) {
      buckets.set(mapKey, { categoryId: bucketCategoryId, name: bucketName, amount: 0 });
    }
    buckets.get(mapKey)!.amount += point.amountCents;
  }

  const totalExpenses = Array.from(buckets.values()).reduce((sum, b) => sum + b.amount, 0);

  const result: CategoryBreakdownPoint[] = Array.from(buckets.values()).map(({ categoryId, name, amount }) => ({
    categoryId,
    categoryName: name,
    amountCents: amount,
    percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
  }));

  result.sort((a, b) => {
    if (b.amountCents !== a.amountCents) {
      return b.amountCents - a.amountCents;
    }
    const aId = a.categoryId ?? -1;
    const bId = b.categoryId ?? -1;
    return bId - aId;
  });
  return result;
}
