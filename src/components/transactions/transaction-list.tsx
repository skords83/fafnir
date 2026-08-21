import { formatCents, formatDayHeading } from '@/lib/format';
import { deriveTransactionDisplay } from '@/lib/transaction-display';
import { groupTransactionsByDay } from '@/lib/transaction-grouping';
import { cn } from '@/lib/utils';

export interface TransactionListRow {
  id: number;
  bookingDate: string;
  counterparty: string | null;
  purpose: string | null;
  amountCents: number;
}

function amountColorClass(amountCents: number): string {
  if (amountCents < 0) return 'text-destructive';
  if (amountCents > 0) return 'text-positive';
  return 'text-foreground';
}

function TransactionRow({ tx, currency }: { tx: TransactionListRow; currency: string }) {
  const { title, context } = deriveTransactionDisplay(tx);

  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium text-foreground">{title}</span>
        <span className={cn('shrink-0 tabular-nums font-medium', amountColorClass(tx.amountCents))}>
          {formatCents(tx.amountCents, currency)}
        </span>
      </div>
      {context && <p className="mt-0.5 truncate text-xs text-muted-foreground">{context}</p>}
    </li>
  );
}

export function TransactionList({ rows, currency }: { rows: TransactionListRow[]; currency: string }) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">Keine Buchungen.</p>;
  }

  const dayGroups = groupTransactionsByDay(rows);

  return (
    <div className="space-y-6">
      {dayGroups.map((group) => (
        <section key={group.date}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {formatDayHeading(group.date)}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {group.featured.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} currency={currency} />
            ))}
            {group.collapsed && (
              <li>
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
                    <span>{group.collapsed.transactions.length} weitere Buchungen</span>
                    <span className={cn('tabular-nums', amountColorClass(group.collapsed.totalCents))}>
                      {formatCents(group.collapsed.totalCents, currency)}
                    </span>
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {group.collapsed.transactions.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} currency={currency} />
                    ))}
                  </ul>
                </details>
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
