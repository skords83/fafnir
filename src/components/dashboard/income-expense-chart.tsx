'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCents } from '@/lib/format';
import type { MonthlyTrendPoint } from '@/lib/dashboard-stats';

export function IncomeExpenseBarChart({
  data,
  currency,
}: {
  data: MonthlyTrendPoint[];
  currency: string;
}) {
  const chartData = data.map((d) => ({
    month: d.month,
    Einnahmen: d.incomeCents / 100,
    Ausgaben: d.expenseCents / 100,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            className="text-xs"
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            className="text-xs"
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
          />
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
          <Legend wrapperStyle={{ paddingTop: '10px' }} />
          <Bar dataKey="Einnahmen" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Ausgaben" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
