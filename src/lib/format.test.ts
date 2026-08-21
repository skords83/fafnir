import { describe, it, expect } from 'vitest';
import { formatCents } from './format';

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
