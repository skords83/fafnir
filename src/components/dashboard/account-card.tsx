'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents } from '@/lib/format';

export interface BalancePoint {
  date: string; // ISO yyyy-mm-dd
  balanceCents: number;
}

export interface AccountCardProps {
  accountName: string;
  currency: string;
  currentBalanceCents: number;
  history: BalancePoint[];
}

export function AccountCard({ accountName, currency, currentBalanceCents, history }: AccountCardProps) {
  const chartData = history.map((point) => ({ date: point.date, balance: point.balanceCents / 100 }));

  return (
    <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-foreground">{accountName}</h2>
        <span className="text-xl font-semibold text-foreground">
          {formatCents(currentBalanceCents, currency)}
        </span>
      </div>
      {chartData.length > 1 && (
        <div className="mt-4 h-40 text-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip formatter={(value) => formatCents(Math.round((value as number) * 100), currency)} />
              <Line type="monotone" dataKey="balance" stroke="currentColor" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
