'use client';

import { useState } from 'react';
import { setMerchantRule, setTransactionOverride } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';

export interface CategoryBadgeProps {
  transactionId: number;
  merchantKey: string;
  effectiveCategory: { id: number; name: string } | null;
  /** This transaction's own override id, independent of any merchant rule — gates the "nur diese Buchung" clear button. */
  overrideCategoryId: number | null;
  /** The merchant rule's current category for this merchant, independent of this transaction's own override. */
  merchantRuleCategoryId: number | null;
  /** The merchant rule's current purpose filter for this merchant, if applicable. */
  merchantRulePurposeContains: string | null;
  categories: { id: number; name: string }[];
}

export function CategoryBadge({
  transactionId,
  merchantKey,
  effectiveCategory,
  overrideCategoryId,
  merchantRuleCategoryId,
  merchantRulePurposeContains,
  categories,
}: CategoryBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {effectiveCategory ? effectiveCategory.name : 'Unkategorisiert'}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-3 rounded-md border border-border bg-background p-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Nur diese Buchung</p>
            <CategoryPicker
              categories={categories}
              selectedCategoryId={overrideCategoryId}
              showClear={overrideCategoryId !== null}
              clearLabel="Standard (Gegenpartei-Regel verwenden)"
              onSubmit={(target) => setTransactionOverride(transactionId, target)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {merchantRulePurposeContains !== null
                ? `Buchungen mit „${merchantRulePurposeContains}" dieser Gegenpartei`
                : 'Alle Buchungen dieser Gegenpartei'}
            </p>
            <CategoryPicker
              categories={categories}
              selectedCategoryId={merchantRuleCategoryId}
              showClear={merchantRuleCategoryId !== null}
              clearLabel={
                merchantRulePurposeContains !== null
                  ? `Regel für „${merchantRulePurposeContains}" entfernen`
                  : 'Kategorie entfernen'
              }
              onSubmit={(target) => setMerchantRule(merchantKey, merchantRulePurposeContains, target)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
