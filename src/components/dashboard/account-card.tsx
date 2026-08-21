'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatCents, formatPercentChange } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MonthToDateTrend } from '@/lib/trend';

export interface BalancePoint {
  date: string; // ISO yyyy-mm-dd
  balanceCents: number;
}

export interface AccountCardProps {
  accountName: string;
  currency: string;
  currentBalanceCents: number;
  history: BalancePoint[];
  trend: MonthToDateTrend;
}

function TrendBadge({ trend }: { trend: MonthToDateTrend }) {
  if (trend.changePct === null || trend.changeCents === 0) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        0,0 % mtd
      </span>
    );
  }

  const isUp = trend.changeCents > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isUp ? 'bg-positive/10 text-positive' : 'bg-destructive/10 text-destructive'
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {formatPercentChange(trend.changePct)} mtd
    </span>
  );
}

export function AccountCard({ accountName, currency, currentBalanceCents, history, trend }: AccountCardProps) {
  const chartData = history.map((point) => ({ date: point.date, balance: point.balanceCents / 100 }));

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-medium text-muted-foreground">{accountName}</h2>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className="text-3xl font-semibold tabular-nums text-card-foreground">
          {formatCents(currentBalanceCents, currency)}
        </span>
        <TrendBadge trend={trend} />
      </div>
      {chartData.length > 1 && (
        <div className="mt-4 h-32 text-muted-foreground">
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
