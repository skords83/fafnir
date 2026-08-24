import { describe, expect, test } from 'vitest';
import {
  calculateMonthSummary,
  calculateMonthlyTrends,
  calculateCategoryBreakdown,
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
    expect(trends[7]).toEqual({
      month: 'Aug',
      monthKey: '2026-08',
      incomeCents: 0,
      expenseCents: 5000,
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
});
