'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCents } from '@/lib/format';
import type { CategoryBreakdownPoint } from '@/lib/dashboard-stats';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#f43f5e'];

export function CategoryPieChart({ data }: { data: CategoryBreakdownPoint[] }) {
  const chartData = data.map((d) => ({
    categoryName: d.categoryName,
    value: d.amountCents / 100,
    amountCents: d.amountCents,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={(entry: any) => `${entry.categoryName} (${entry.value.toFixed(0)}€)`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => {
            if (typeof value === 'number') {
              return formatCents(Math.round(value * 100), 'EUR');
            }
            return value;
          }} />
          <Legend wrapperStyle={{ paddingTop: '10px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
