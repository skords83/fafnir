'use client';

import { useState, useTransition, type FormEvent } from 'react';
import type { CategoryTarget } from '@/app/(app)/actions/category-mutations';
import type { ActionResult } from '@/app/(app)/actions/categories';

const NEW_CATEGORY_VALUE = '__new__';

export interface CategoryPickerProps {
  categories: { id: number; name: string }[];
  /** Prefills the select; null shows the disabled placeholder ("Kategorie wählen"). */
  selectedCategoryId: number | null;
  /** Whether the clear button is rendered at all — callers decide per their own semantics. */
  showClear: boolean;
  clearLabel: string;
  onSubmit: (target: CategoryTarget) => Promise<ActionResult>;
}

export function CategoryPicker({ categories, selectedCategoryId, showClear, clearLabel, onSubmit }: CategoryPickerProps) {
  const [selection, setSelection] = useState(selectedCategoryId !== null ? String(selectedCategoryId) : '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isNew = selection === NEW_CATEGORY_VALUE;
  const canSubmit = isNew ? newCategoryName.trim() !== '' : selection !== '';

  function submit(target: CategoryTarget) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await onSubmit(target);
        if (!result.ok) {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Speichern.');
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const target: CategoryTarget = isNew
      ? { type: 'newCategory', name: newCategoryName.trim() }
      : { type: 'category', categoryId: Number(selection) };
    submit(target);
  }

  function handleClear() {
    submit({ type: 'clear' });
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Kategorie"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          disabled={isPending}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="" disabled>
            Kategorie wählen
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
          <option value={NEW_CATEGORY_VALUE}>+ Neue Kategorie anlegen</option>
        </select>

        {isNew && (
          <input
            type="text"
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Name der Kategorie"
            disabled={isPending}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        )}

        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="rounded-md bg-primary px-2 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Speichern
        </button>

        {showClear && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {clearLabel}
          </button>
        )}
      </form>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
