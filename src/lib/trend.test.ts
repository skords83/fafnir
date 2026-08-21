import { describe, expect, test } from 'vitest';
import { computeMonthToDateTrend } from './trend';

const today = new Date('2026-08-21T00:00:00');

describe('computeMonthToDateTrend', () => {
  test('reconstructs the start-of-month balance from this month\'s transactions', () => {
    const trend = computeMonthToDateTrend(
      61600,
      [
        { bookingDate: '2026-07-28', amountCents: -5000 }, // last month, excluded
        { bookingDate: '2026-08-01', amountCents: -20000 },
        { bookingDate: '2026-08-15', amountCents: -18400 },
      ],
      today
    );

    expect(trend.startBalanceCents).toBe(100000);
    expect(trend.changeCents).toBe(-38400);
    expect(trend.changePct).toBeCloseTo(-38.4, 5);
  });

  test('a balance increase this month yields a positive percentage', () => {
    const trend = computeMonthToDateTrend(
      120000,
      [{ bookingDate: '2026-08-10', amountCents: 20000 }],
      today
    );

    expect(trend.startBalanceCents).toBe(100000);
    expect(trend.changePct).toBeCloseTo(20, 5);
  });

  test('no transactions this month means no change', () => {
    const trend = computeMonthToDateTrend(100000, [{ bookingDate: '2026-07-15', amountCents: 5000 }], today);

    expect(trend.changeCents).toBe(0);
    expect(trend.changePct).toBe(0);
  });

  test('includes a transaction booked exactly on the first of the month', () => {
    const trend = computeMonthToDateTrend(90000, [{ bookingDate: '2026-08-01', amountCents: -10000 }], today);

    expect(trend.changeCents).toBe(-10000);
  });

  test('a zero start-of-month balance makes the percentage undefined', () => {
    const trend = computeMonthToDateTrend(5000, [{ bookingDate: '2026-08-05', amountCents: 5000 }], today);

    expect(trend.startBalanceCents).toBe(0);
    expect(trend.changePct).toBeNull();
  });
});
