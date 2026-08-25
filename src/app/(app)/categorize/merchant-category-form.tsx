'use client';

import { useRef, useState } from 'react';
import { setMerchantRule } from '@/app/(app)/actions/categories';
import type { ActionResult } from '@/app/(app)/actions/categories';
import type { CategoryTarget } from '@/app/(app)/actions/category-mutations';
import { CategoryPicker } from '@/components/category-picker';
import type { MerchantRuleEntry } from '@/lib/category-resolution';

interface PurposeRowState {
  id: number;
  /** True when this row was seeded from an already-saved rule (`existingRules`) at mount, as
   *  opposed to a brand-new blank row added locally via "+ Regel hinzufügen". Only used to
   *  seed the row's initial persisted-state below — not read again afterward, since a
   *  brand-new row can itself become persisted the moment its first save succeeds. */
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
  // The purposeContains value actually persisted in the DB for this row's rule right now, or
  // null if nothing is persisted (a brand-new never-saved draft, or a row whose rule was just
  // cleared as part of a failed edit — see handleSubmit below). This is the single source of
  // truth for "does this row currently correspond to a real DB row" and is kept up to date
  // after every successful save/removal — unlike the row's origin (`isExisting`, seeded once
  // at mount), which would otherwise go stale the moment a brand-new row is saved for the
  // first time, or the purpose text of an existing row is edited.
  const [persistedPurposeContains, setPersistedPurposeContains] = useState<string | null>(
    isExisting ? initialPurposeContains : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleSubmit(target: CategoryTarget): Promise<ActionResult> {
    const trimmed = purposeContains.trim();
    if (trimmed === '') {
      throw new Error('Verwendungszweck darf nicht leer sein.');
    }
    setIsSubmitting(true);
    try {
      if (persistedPurposeContains !== null && persistedPurposeContains !== trimmed) {
        // The purpose text changed on a row that already has a saved rule under the OLD
        // text. applyMerchantRule's overlap check compares a new candidate purposeContains
        // against every existing rule for this merchant — including this row's own
        // not-yet-replaced one — so submitting the new text directly can throw a
        // self-referential "overlaps with itself" error. Clear the old rule first, then
        // create the new one as two sequential calls.
        const clearResult = await setMerchantRule(merchantKey, persistedPurposeContains, { type: 'clear' });
        if (!clearResult.ok) {
          return clearResult;
        }
        // The old rule is gone in the DB regardless of what happens next — reflect that
        // immediately so a stale purpose key is never reused (e.g. by a subsequent
        // "Entfernen" click, or a second edit before this one finishes).
        setPersistedPurposeContains(null);

        const setResult = await setMerchantRule(merchantKey, trimmed, target);
        if (!setResult.ok) {
          // Partial failure: don't hide that the old rule is already gone.
          return {
            ok: false,
            error: `Alte Regel „${persistedPurposeContains}" wurde entfernt, neue Regel „${trimmed}" konnte aber nicht gespeichert werden: ${setResult.error}`,
          };
        }
        setPersistedPurposeContains(trimmed);
        setRemoveError(null);
        return setResult;
      }

      const result = await setMerchantRule(merchantKey, trimmed, target);
      if (result.ok) {
        setPersistedPurposeContains(trimmed);
        setRemoveError(null);
      }
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove() {
    if (persistedPurposeContains === null) {
      // Never successfully saved (or already cleared by a prior partial-failure edit) —
      // nothing to delete server-side, just drop the local draft.
      onRemove();
      return;
    }
    setIsRemoving(true);
    setRemoveError(null);
    const result = await setMerchantRule(merchantKey, persistedPurposeContains, { type: 'clear' });
    setIsRemoving(false);
    if (!result.ok) {
      setRemoveError(result.error);
      return;
    }
    onRemove();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <fieldset disabled={isRemoving} className="contents">
        <input
          type="text"
          value={purposeContains}
          onChange={(event) => setPurposeContains(event.target.value)}
          placeholder="Verwendungszweck enthält…"
          aria-label="Verwendungszweck enthält"
          className="w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        <CategoryPicker
          categories={categories}
          selectedCategoryId={initialCategoryId}
          showClear={false}
          clearLabel="Kategorie entfernen"
          onSubmit={handleSubmit}
        />
      </fieldset>
      <button
        type="button"
        onClick={handleRemove}
        disabled={isRemoving || isSubmitting}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Entfernen
      </button>
      {removeError && <p className="text-xs text-destructive">{removeError}</p>}
    </div>
  );
}
