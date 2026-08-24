'use client';

import { useRef, useState } from 'react';
import { setMerchantRule } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';

export function MerchantCategoryForm({
  merchantKey,
  categories,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
}) {
  const [purposeDraftIds, setPurposeDraftIds] = useState<number[]>([]);
  const nextDraftId = useRef(0);

  return (
    <div className="space-y-2">
      <CategoryPicker
        categories={categories}
        selectedCategoryId={null}
        showClear={false}
        clearLabel="Kategorie entfernen"
        onSubmit={(target) => setMerchantRule(merchantKey, null, target)}
      />

      {purposeDraftIds.map((id) => (
        <PurposeRuleRow
          key={id}
          merchantKey={merchantKey}
          categories={categories}
          onRemove={() => setPurposeDraftIds((ids) => ids.filter((draftId) => draftId !== id))}
        />
      ))}

      <button
        type="button"
        onClick={() => setPurposeDraftIds((ids) => [...ids, nextDraftId.current++])}
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
  onRemove,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
  onRemove: () => void;
}) {
  const [purposeContains, setPurposeContains] = useState('');

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
        selectedCategoryId={null}
        showClear={false}
        clearLabel="Kategorie entfernen"
        onSubmit={async (target) => {
          const trimmed = purposeContains.trim();
          if (trimmed === '') {
            throw new Error('Verwendungszweck darf nicht leer sein.');
          }
          await setMerchantRule(merchantKey, trimmed, target);
        }}
      />
      <button type="button" onClick={onRemove} className="text-xs text-muted-foreground hover:text-foreground">
        Entfernen
      </button>
    </div>
  );
}
