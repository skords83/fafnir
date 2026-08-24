'use client';

import { useRef, useState } from 'react';
import { setMerchantRule } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';
import type { MerchantRuleEntry } from '@/lib/category-resolution';

interface PurposeRowState {
  id: number;
  /** True when this row was seeded from an already-saved rule (`existingRules`), as opposed
   *  to a brand-new blank row added locally via "+ Regel hinzufügen". Saved rows call the
   *  server to delete their rule on removal; unsaved drafts just vanish from local state. */
  isExisting: boolean;
  initialPurposeContains: string;
  initialCategoryId: number | null;
}

export function MerchantCategoryForm({
  merchantKey,
  categories,
  existingRules = [],
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
  existingRules?: MerchantRuleEntry[];
}) {
  const fallbackRule = existingRules.find((r) => r.purposeContains === null);
  const existingPurposeRules = existingRules.filter(
    (r): r is MerchantRuleEntry & { purposeContains: string } => r.purposeContains !== null
  );

  const [purposeRows, setPurposeRows] = useState<PurposeRowState[]>(() =>
    existingPurposeRules.map((rule, index) => ({
      id: index,
      isExisting: true,
      initialPurposeContains: rule.purposeContains,
      initialCategoryId: rule.categoryId,
    }))
  );
  const nextDraftId = useRef(existingPurposeRules.length);

  return (
    <div className="space-y-2">
      <CategoryPicker
        categories={categories}
        selectedCategoryId={fallbackRule?.categoryId ?? null}
        showClear={false}
        clearLabel="Kategorie entfernen"
        onSubmit={(target) => setMerchantRule(merchantKey, null, target)}
      />

      {purposeRows.map((row) => (
        <PurposeRuleRow
          key={row.id}
          merchantKey={merchantKey}
          categories={categories}
          isExisting={row.isExisting}
          initialPurposeContains={row.initialPurposeContains}
          initialCategoryId={row.initialCategoryId}
          onRemove={() => setPurposeRows((rows) => rows.filter((r) => r.id !== row.id))}
        />
      ))}

      <button
        type="button"
        onClick={() =>
          setPurposeRows((rows) => [
            ...rows,
            { id: nextDraftId.current++, isExisting: false, initialPurposeContains: '', initialCategoryId: null },
          ])
        }
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        + Regel für Verwendungszweck hinzufügen
      </button>
    </div>
  );
}

function PurposeRuleRow({
  merchantKey,
  categories,
  isExisting,
  initialPurposeContains = '',
  initialCategoryId = null,
  onRemove,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
  isExisting: boolean;
  initialPurposeContains?: string;
  initialCategoryId?: number | null;
  onRemove: () => void;
}) {
  const [purposeContains, setPurposeContains] = useState(initialPurposeContains);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemove() {
    if (!isExisting) {
      onRemove();
      return;
    }
    setIsRemoving(true);
    setRemoveError(null);
    const result = await setMerchantRule(merchantKey, initialPurposeContains, { type: 'clear' });
    setIsRemoving(false);
    if (!result.ok) {
      setRemoveError(result.error);
      return;
    }
    onRemove();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <input
        type="text"
        value={purposeContains}
        onChange={(event) => setPurposeContains(event.target.value)}
        placeholder="Verwendungszweck enthält…"
        aria-label="Verwendungszweck enthält"
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
      <CategoryPicker
        categories={categories}
        selectedCategoryId={initialCategoryId}
        showClear={false}
        clearLabel="Kategorie entfernen"
        onSubmit={async (target) => {
          const trimmed = purposeContains.trim();
          if (trimmed === '') {
            throw new Error('Verwendungszweck darf nicht leer sein.');
          }
          return setMerchantRule(merchantKey, trimmed, target);
        }}
      />
      <button
        type="button"
        onClick={handleRemove}
        disabled={isRemoving}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Entfernen
      </button>
      {removeError && <p className="text-xs text-destructive">{removeError}</p>}
    </div>
  );
}
