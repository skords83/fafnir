import { describe, it, expect } from 'vitest';
import { formatCents, formatDayHeading, formatPercentChange } from './format';

describe('formatCents', () => {
  it('formats cents to locale currency string', () => {
    expect(formatCents(245783, 'EUR')).toBe(
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(2457.83)
    );
  });

  it('handles negative values', () => {
    expect(formatCents(-4217, 'USD')).toBe(
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' }).format(-42.17)
    );
  });
});

describe('formatPercentChange', () => {
  it('formats a negative change with an explicit minus sign', () => {
    expect(formatPercentChange(-38.4)).toBe('-38,4 %');
  });

  it('formats a positive change with an explicit plus sign', () => {
    expect(formatPercentChange(12.2)).toBe('+12,2 %');
  });

  it('formats zero without a sign', () => {
    expect(formatPercentChange(0)).toBe('0,0 %');
  });
});

describe('formatDayHeading', () => {
  it('formats a date without the year when it matches the reference date', () => {
    expect(formatDayHeading('2026-08-20', new Date('2026-08-21T00:00:00'))).toBe('Do., 20. August');
  });

  it('includes the year when it differs from the reference date', () => {
    expect(formatDayHeading('2025-12-31', new Date('2026-08-21T00:00:00'))).toBe('Mi., 31. Dezember 2025');
  });
});
