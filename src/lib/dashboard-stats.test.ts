import { describe, expect, test } from 'vitest';
import {
  calculateMonthSummary,
  calculateMonthlyTrends,
  calculateCategoryBreakdown,
  groupBreakdownByParent,
} from './dashboard-stats';

describe('calculateMonthSummary', () => {
  test('correctly sums income and expenses for a given month', () => {
    const txs = [
      { amountCents: 250000, bookingDate: '2026-08-01' },
      { amountCents: -4217, bookingDate: '2026-08-03' },
      { amountCents: -1500, bookingDate: '2026-08-10' },
      { amountCents: -5000, bookingDate: '2026-07-28' }, // Other month
    ];

    const result = calculateMonthSummary(txs, '2026-08');
    expect(result).toEqual({
      incomeCents: 250000,
      expenseCents: 5717, // positive absolute value for expenses
    });
  });
});

describe('calculateMonthlyTrends', () => {
  test('groups transactions by month over a 12-month period', () => {
    const txs = [
      { amountCents: 10000, bookingDate: '2026-01-15' },
      { amountCents: -3000, bookingDate: '2026-01-20' },
      { amountCents: -5000, bookingDate: '2026-08-05' },
    ];

    const trends = calculateMonthlyTrends(txs, 2026);
    expect(trends).toHaveLength(12);
    expect(trends[0]).toEqual({
      month: 'Jan',
      monthKey: '2026-01',
      incomeCents: 10000,
      expenseCents: 3000,
    });
    expect(trends[2]).toEqual({
      month: 'Mär',
      monthKey: '2026-03',
      incomeCents: 0,
      expenseCents: 0,
    });
    expect(trends[7]).toEqual({
      month: 'Aug',
      monthKey: '2026-08',
      incomeCents: 0,
      expenseCents: 5000,
    });
    expect(trends[11]).toEqual({
      month: 'Dez',
      monthKey: '2026-12',
      incomeCents: 0,
      expenseCents: 0,
    });
  });
});

describe('calculateCategoryBreakdown', () => {
  test('aggregates expense transactions by resolved category', () => {
    const items = [
      { amountCents: -4000, categoryName: 'Lebensmittel', categoryId: 1 },
      { amountCents: -1000, categoryName: 'Lebensmittel', categoryId: 1 },
      { amountCents: -5000, categoryName: 'Freizeit', categoryId: 2 },
      { amountCents: 200000, categoryName: 'Gehalt', categoryId: 3 }, // Income (ignored)
    ];

    const breakdown = calculateCategoryBreakdown(items);
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]).toEqual({
      categoryId: 2,
      categoryName: 'Freizeit',
      amountCents: 5000,
      percentage: 50,
    });
    expect(breakdown[1]).toEqual({
      categoryId: 1,
      categoryName: 'Lebensmittel',
      amountCents: 5000,
      percentage: 50,
    });
  });

  test('handles null categoryId and categoryName with Unkategorisiert fallback', () => {
    const items = [
      { amountCents: -3000, categoryName: null, categoryId: null },
      { amountCents: -2000, categoryName: 'Essen', categoryId: 1 },
      { amountCents: -1000, categoryName: null, categoryId: null },
    ];

    const breakdown = calculateCategoryBreakdown(items);
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]).toEqual({
      categoryId: null,
      categoryName: 'Unkategorisiert',
      amountCents: 4000,
      percentage: 67,
    });
    expect(breakdown[1]).toEqual({
      categoryId: 1,
      categoryName: 'Essen',
      amountCents: 2000,
      percentage: 33,
    });
  });
});

describe('groupBreakdownByParent', () => {
  test('re-buckets child categories by their parent category', () => {
    const points = [
      { categoryId: 1, categoryName: 'Apples', amountCents: 1000, percentage: 50 },
      { categoryId: 2, categoryName: 'Oranges', amountCents: 1000, percentage: 50 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Fruit', parentCategoryId: 3 }],
      [2, { name: 'Citrus', parentCategoryId: 3 }],
      [3, { name: 'Food', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual({
      categoryId: 3,
      categoryName: 'Food',
      amountCents: 2000,
      percentage: 100,
    });
  });

  test('handles multiple parent categories correctly', () => {
    const points = [
      { categoryId: 1, categoryName: 'Apples', amountCents: 500, percentage: 17 },
      { categoryId: 2, categoryName: 'Oranges', amountCents: 500, percentage: 16 },
      { categoryId: 3, categoryName: 'Gas', amountCents: 2000, percentage: 67 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Fruit', parentCategoryId: 4 }],
      [2, { name: 'Citrus', parentCategoryId: 4 }],
      [3, { name: 'Fuel', parentCategoryId: 5 }],
      [4, { name: 'Food', parentCategoryId: null }],
      [5, { name: 'Transport', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toEqual({
      categoryId: 5,
      categoryName: 'Transport',
      amountCents: 2000,
      percentage: 67,
    });
    expect(grouped[1]).toEqual({
      categoryId: 4,
      categoryName: 'Food',
      amountCents: 1000,
      percentage: 33,
    });
  });

  test('handles null parentCategoryId by using the category itself', () => {
    const points = [
      { categoryId: 1, categoryName: 'Apples', amountCents: 1000, percentage: 50 },
      { categoryId: 2, categoryName: 'Gas', amountCents: 1000, percentage: 50 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Fruit', parentCategoryId: 3 }],
      [2, { name: 'Fuel', parentCategoryId: null }],
      [3, { name: 'Food', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toEqual({
      categoryId: 3,
      categoryName: 'Food',
      amountCents: 1000,
      percentage: 50,
    });
    expect(grouped[1]).toEqual({
      categoryId: 2,
      categoryName: 'Fuel',
      amountCents: 1000,
      percentage: 50,
    });
  });

  test('ensures percentage totals remain 100', () => {
    const points = [
      { categoryId: 1, categoryName: 'Apples', amountCents: 5000, percentage: 33 },
      { categoryId: 2, categoryName: 'Oranges', amountCents: 5000, percentage: 33 },
      { categoryId: 3, categoryName: 'Bananas', amountCents: 5000, percentage: 34 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Fruit', parentCategoryId: 4 }],
      [2, { name: 'Citrus', parentCategoryId: 4 }],
      [3, { name: 'Tropical', parentCategoryId: 4 }],
      [4, { name: 'Food', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);
    expect(grouped).toHaveLength(1);
    const total = grouped.reduce((sum, p) => sum + p.percentage, 0);
    expect(total).toBe(100);
  });
});
