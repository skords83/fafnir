'use client';

import { useState } from 'react';
import { setMerchantRule, setTransactionOverride } from '@/app/(app)/actions/categories';
import type { MerchantTransactionRow } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';
import { formatCents, formatDayHeading } from '@/lib/format';

export function TransactionDetailRow({
  tx,
  merchantKey,
  categories,
}: {
  tx: MerchantTransactionRow;
  merchantKey: string;
  categories: { id: number; name: string }[];
}) {
  const [purposeText, setPurposeText] = useState(tx.purpose ?? '');

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{formatDayHeading(tx.bookingDate)}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatCents(tx.amountCents, tx.currency)}
        </span>
      </div>

      {tx.purpose && <p className="text-sm text-foreground">{tx.purpose}</p>}

      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {tx.effectiveCategory ? tx.effectiveCategory.name : 'Unkategorisiert'}
      </span>

      <div className="space-y-3 border-t border-border pt-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Nur diese Buchung</p>
          <CategoryPicker
            categories={categories}
            selectedCategoryId={tx.overrideCategoryId}
            showClear={tx.overrideCategoryId !== null}
            clearLabel="Standard (Gegenpartei-Regel verwenden)"
            onSubmit={(target) => setTransactionOverride(tx.id, target)}
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Verwendungszweck enthält</p>
          <input
            type="text"
            value={purposeText}
            onChange={(event) => setPurposeText(event.target.value)}
            aria-label="Verwendungszweck enthält"
            className="mb-2 w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
          <CategoryPicker
            categories={categories}
            selectedCategoryId={tx.exactPurposeRuleCategoryId}
            showClear={false}
            clearLabel="Kategorie entfernen"
            onSubmit={(target) => setMerchantRule(merchantKey, purposeText.trim(), target)}
          />
        </div>
      </div>
    </li>
  );
}
