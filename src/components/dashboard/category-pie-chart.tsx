'use client';

import { useState, useSyncExternalStore } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents } from '@/lib/format';
import type { CategoryBreakdownPoint } from '@/lib/dashboard-stats';
import { THEME_CHANGE_EVENT, getEffectiveTheme } from '@/lib/theme';
import {
  CATEGORY_COLORS_LIGHT,
  CATEGORY_COLORS_DARK,
  OTHER_COLOR_LIGHT,
  OTHER_COLOR_DARK,
  buildSlices,
} from '@/lib/category-chart-colors';

function subscribeToTheme(callback: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', callback);
  document.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    query.removeEventListener('change', callback);
    document.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getIsDarkSnapshot() {
  return getEffectiveTheme() === 'dark';
}

function getIsDarkServerSnapshot() {
  return false;
}

// useSyncExternalStore (rather than an effect that calls setState) is the
// React-recommended way to read a browser API: it avoids the extra render
// pass an effect-driven setState would trigger, and stays consistent
// between SSR and the client. Subscribing to both the system media query
// and the manual theme toggle's change event keeps the chart's colors in
// sync with whichever one currently governs the page (see ThemeToggle).
function usePrefersDarkMode() {
  return useSyncExternalStore(subscribeToTheme, getIsDarkSnapshot, getIsDarkServerSnapshot);
}

export function CategoryPieChart({ data, currency }: { data: CategoryBreakdownPoint[]; currency: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const prefersDark = usePrefersDarkMode();

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Keine Ausgaben in diesem Zeitraum
      </div>
    );
  }

  const colors = prefersDark ? CATEGORY_COLORS_DARK : CATEGORY_COLORS_LIGHT;
  const otherColor = prefersDark ? OTHER_COLOR_DARK : OTHER_COLOR_LIGHT;
  const surfaceColor = prefersDark ? '#1a1a19' : '#fcfcfb';
  const slices = buildSlices(data, colors, otherColor);

  return (
    <div className="w-full">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              dataKey="value"
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {slices.map((slice, index) => (
                <Cell
                  key={slice.name}
                  fill={slice.color}
                  stroke={surfaceColor}
                  strokeWidth={activeIndex === index ? 3 : 2}
                  fillOpacity={activeIndex === null || activeIndex === index ? 1 : 0.35}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => {
                if (typeof value === 'number') {
                  return formatCents(Math.round(value * 100), currency);
                }
                return value;
              }}
              contentStyle={{
                backgroundColor: 'var(--color-popover)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-popover-foreground)',
                borderRadius: '0.5rem',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-1 gap-y-1 px-2">
        {slices.map((slice, index) => (
          <li key={slice.name}>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
              style={{
                backgroundColor: activeIndex === index ? 'var(--color-muted)' : 'transparent',
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-foreground">{slice.name}</span>
              <span className="text-muted-foreground">{slice.percentage}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
