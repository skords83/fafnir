import { describe, expect, test } from 'vitest';
import { groupTransactionsByDay } from './transaction-grouping';

interface Row {
  id: number;
  bookingDate: string;
  amountCents: number;
}

describe('groupTransactionsByDay', () => {
  test('groups rows by date, preserving date order', () => {
    const rows: Row[] = [
      { id: 1, bookingDate: '2026-08-20', amountCents: -500 },
      { id: 2, bookingDate: '2026-08-20', amountCents: -1200 },
      { id: 3, bookingDate: '2026-08-19', amountCents: 30000 },
    ];

    const groups = groupTransactionsByDay(rows);

    expect(groups.map((g) => g.date)).toEqual(['2026-08-20', '2026-08-19']);
    expect(groups[0].featured).toHaveLength(2);
    expect(groups[0].collapsed).toBeNull();
  });

  test('leaves a day with exactly the threshold count uncollapsed', () => {
    const rows: Row[] = [
      { id: 1, bookingDate: '2026-08-20', amountCents: -100 },
      { id: 2, bookingDate: '2026-08-20', amountCents: -200 },
      { id: 3, bookingDate: '2026-08-20', amountCents: -300 },
    ];

    const [group] = groupTransactionsByDay(rows);

    expect(group.featured).toHaveLength(3);
    expect(group.collapsed).toBeNull();
  });

  test('collapses everything past the 3 largest transactions on a busy day', () => {
    const rows: Row[] = [
      { id: 1, bookingDate: '2026-08-20', amountCents: -100 },
      { id: 2, bookingDate: '2026-08-20', amountCents: -5000 },
      { id: 3, bookingDate: '2026-08-20', amountCents: -200 },
      { id: 4, bookingDate: '2026-08-20', amountCents: -50000 },
      { id: 5, bookingDate: '2026-08-20', amountCents: 30000 },
    ];

    const [group] = groupTransactionsByDay(rows);

    expect(group.featured.map((tx) => tx.id)).toEqual([4, 5, 2]);
    expect(group.collapsed).not.toBeNull();
    expect(group.collapsed!.transactions.map((tx) => tx.id)).toEqual([1, 3]);
    expect(group.collapsed!.totalCents).toBe(-300);
  });
});
