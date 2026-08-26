'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getMerchantTransactions } from '@/app/(app)/actions/categories';
import type { MerchantTransactionRow } from '@/app/(app)/actions/categories';
import type { MerchantRuleEntry } from '@/lib/category-resolution';
import { cn } from '@/lib/utils';
import { MerchantCategoryForm } from './merchant-category-form';
import { TransactionDetailRow } from './transaction-detail-row';

export function MerchantGroup({
  merchantKey,
  txCount,
  categories,
  existingRules,
  initiallyOpen,
  initialTransactions,
}: {
  merchantKey: string;
  txCount: number;
  categories: { id: number; name: string }[];
  existingRules?: MerchantRuleEntry[];
  initiallyOpen: boolean;
  initialTransactions: MerchantTransactionRow[] | null;
}) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [transactions, setTransactions] = useState<MerchantTransactionRow[] | null>(initialTransactions);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listItemRef = useRef<HTMLLIElement>(null);

  // On a client-side navigation (e.g. the status-badge Link from the dashboard
  // or an account page), the browser's own hash-scroll can fire before this
  // deep-linked group has mounted and the page has settled into its final
  // layout, landing short of the target. Scroll explicitly once on mount
  // instead of relying on that race.
  useEffect(() => {
    if (initiallyOpen) {
      listItemRef.current?.scrollIntoView({ block: 'start' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleToggle() {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening && transactions === null && !isLoading) {
      setIsLoading(true);
      setLoadError(null);
      getMerchantTransactions(merchantKey)
        .then((rows) => setTransactions(rows))
        .catch((err) => setLoadError(err instanceof Error ? err.message : 'Fehler beim Laden der Buchungen.'))
        .finally(() => setIsLoading(false));
    }
  }

  return (
    <li ref={listItemRef} id={`group-${encodeURIComponent(merchantKey)}`} className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={handleToggle} className="flex items-center gap-2 text-left">
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', isOpen && 'rotate-180')}
            aria-hidden="true"
          />
          <span>
            <p className="font-medium text-foreground">{merchantKey}</p>
            <p className="text-xs text-muted-foreground">
              {txCount} Buchung{txCount === 1 ? '' : 'en'}
            </p>
          </span>
        </button>
        <MerchantCategoryForm merchantKey={merchantKey} categories={categories} existingRules={existingRules} />
      </div>

      {isOpen && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {isLoading && <p className="text-sm text-muted-foreground">Lädt…</p>}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {transactions && (
            <ul className="space-y-2">
              {transactions.map((tx) => (
                <TransactionDetailRow key={tx.id} tx={tx} merchantKey={merchantKey} categories={categories} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
