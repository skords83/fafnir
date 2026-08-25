import type { CategoryBreakdownPoint } from '@/lib/dashboard-stats';

// Categorical palette, validated with the dataviz skill's validator for a pie/donut
// chart (adjacent-pairs mode — only touching slices need to be told apart, same as a
// stacked bar bent into a ring):
//   node scripts/validate_palette.js "<light hexes>" --mode light --surface "#fcfcfb"
//   node scripts/validate_palette.js "<dark hexes>" --mode dark --surface "#1a1a19"
// Both pass every gate (worst adjacent CVD ΔE 9.1 light / 8.4 dark; normal-vision floor
// 19.6 light / 19.3 dark). Light mode WARNs on contrast for 3 hues — mitigated by the
// always-visible legend labels in CategoryPieChart, which never rely on color alone.
export const CATEGORY_COLORS_LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
];
export const CATEGORY_COLORS_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

// A 9th-plus series is never a generated hue: categories beyond the palette fold into
// "Weitere Kategorien" instead, using a fixed neutral (like a status color, deliberately
// distinct from the categorical slots, never part of the rotation).
export const MAX_INDIVIDUAL_CATEGORIES = CATEGORY_COLORS_LIGHT.length - 1;
export const OTHER_LABEL = 'Weitere Kategorien';
export const OTHER_COLOR_LIGHT = '#9a9a94';
export const OTHER_COLOR_DARK = '#8a8a83';

export interface ChartSlice {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

/**
 * Maps category breakdown rows (already sorted descending by amount) onto chart
 * slices with colors. When there are more categories than color slots, the smallest
 * ones are folded into a single "Weitere Kategorien" slice so no two categories ever
 * end up sharing a color.
 */
export function buildSlices(
  data: CategoryBreakdownPoint[],
  colors: string[] = CATEGORY_COLORS_LIGHT,
  otherColor: string = OTHER_COLOR_LIGHT
): ChartSlice[] {
  if (data.length <= colors.length) {
    return data.map((item, index) => ({
      name: item.categoryName,
      value: item.amountCents / 100,
      percentage: item.percentage,
      color: colors[index],
    }));
  }

  const shown = data.slice(0, MAX_INDIVIDUAL_CATEGORIES);
  const rest = data.slice(MAX_INDIVIDUAL_CATEGORIES);

  return [
    ...shown.map((item, index) => ({
      name: item.categoryName,
      value: item.amountCents / 100,
      percentage: item.percentage,
      color: colors[index],
    })),
    {
      name: OTHER_LABEL,
      value: rest.reduce((sum, item) => sum + item.amountCents, 0) / 100,
      percentage: rest.reduce((sum, item) => sum + item.percentage, 0),
      color: otherColor,
    },
  ];
}
