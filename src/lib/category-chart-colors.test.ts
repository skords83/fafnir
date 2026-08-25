import { describe, it, expect } from 'vitest';
import {
  buildSlices,
  CATEGORY_COLORS_LIGHT,
  MAX_INDIVIDUAL_CATEGORIES,
  OTHER_LABEL,
  OTHER_COLOR_LIGHT,
} from './category-chart-colors';
import type { CategoryBreakdownPoint } from './dashboard-stats';

function point(categoryName: string, amountCents: number, percentage: number): CategoryBreakdownPoint {
  return { categoryId: null, categoryName, amountCents, percentage };
}

describe('buildSlices', () => {
  it('assigns one distinct color per category when categories fit the palette', () => {
    const data = [point('Lebensmittel', 10000, 50), point('Mobilität', 10000, 50)];

    const slices = buildSlices(data, CATEGORY_COLORS_LIGHT, OTHER_COLOR_LIGHT);

    expect(slices).toEqual([
      { name: 'Lebensmittel', value: 100, percentage: 50, color: CATEGORY_COLORS_LIGHT[0] },
      { name: 'Mobilität', value: 100, percentage: 50, color: CATEGORY_COLORS_LIGHT[1] },
    ]);
  });

  it('assigns every color exactly once when categories exactly fill the palette', () => {
    const data = CATEGORY_COLORS_LIGHT.map((_, i) => point(`Kategorie ${i}`, 100, 1));

    const slices = buildSlices(data, CATEGORY_COLORS_LIGHT, OTHER_COLOR_LIGHT);

    expect(slices).toHaveLength(CATEGORY_COLORS_LIGHT.length);
    expect(slices.map((s) => s.color)).toEqual(CATEGORY_COLORS_LIGHT);
  });

  it('folds categories beyond the palette into a single "Weitere Kategorien" slice', () => {
    const data = Array.from({ length: MAX_INDIVIDUAL_CATEGORIES + 3 }, (_, i) =>
      point(`Kategorie ${i}`, 1000 - i, 10)
    );

    const slices = buildSlices(data, CATEGORY_COLORS_LIGHT, OTHER_COLOR_LIGHT);

    // MAX_INDIVIDUAL_CATEGORIES real categories, plus exactly one "Weitere Kategorien" slice.
    expect(slices).toHaveLength(MAX_INDIVIDUAL_CATEGORIES + 1);
    expect(slices.slice(0, MAX_INDIVIDUAL_CATEGORIES).map((s) => s.color)).toEqual(
      CATEGORY_COLORS_LIGHT.slice(0, MAX_INDIVIDUAL_CATEGORIES)
    );

    const other = slices[slices.length - 1];
    expect(other.name).toBe(OTHER_LABEL);
    expect(other.color).toBe(OTHER_COLOR_LIGHT);
    // 3 folded categories, each amountCents = 1000 - index for the last 3 entries.
    const foldedAmountCents =
      (1000 - MAX_INDIVIDUAL_CATEGORIES) +
      (1000 - (MAX_INDIVIDUAL_CATEGORIES + 1)) +
      (1000 - (MAX_INDIVIDUAL_CATEGORIES + 2));
    expect(other.value).toBe(foldedAmountCents / 100);
    expect(other.percentage).toBe(30);
  });

  it('never reuses a color across two categories, however many are folded', () => {
    const data = Array.from({ length: 13 }, (_, i) => point(`Kategorie ${i}`, 1000 - i, 5));

    const slices = buildSlices(data, CATEGORY_COLORS_LIGHT, OTHER_COLOR_LIGHT);

    const colors = slices.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
