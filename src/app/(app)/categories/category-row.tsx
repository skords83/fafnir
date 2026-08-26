'use client';

import { useState, useTransition, type FormEvent } from 'react';
import {
  deleteCategory,
  renameCategory,
  setCategoryParent,
} from '@/app/(app)/actions/categories';

export interface CategoryUsage {
  transactionCount: number;
  ruleCount: number;
}

export function CategoryRow({
  category,
  usage,
  parentOptions,
  hasChildren,
}: {
  category: { id: number; name: string; parent_id: number | null };
  usage: CategoryUsage;
  parentOptions: Array<{ id: number; name: string }>;
  hasChildren: boolean;
}) {
  const [name, setName] = useState(category.name);
  const [persistedName, setPersistedName] = useState(category.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(category.parent_id);
  const [parentError, setParentError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = name.trim();
  const canRename = trimmed !== '' && trimmed !== persistedName;
  const isInUse = usage.transactionCount > 0 || usage.ruleCount > 0;

  function handleRename(event: FormEvent) {
    event.preventDefault();
    setRenameError(null);
    startTransition(async () => {
      const result = await renameCategory(category.id, trimmed);
      if (result.ok) {
        setPersistedName(trimmed);
      } else {
        setRenameError(result.error);
      }
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteCategory(category.id);
      if (!result.ok) {
        setDeleteError(result.error);
      }
    });
  }

  function handleParentChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    const parentId = value === '' ? null : parseInt(value, 10);
    setSelectedParentId(parentId);
    setParentError(null);
    startTransition(async () => {
      const result = await setCategoryParent(category.id, parentId);
      if (!result.ok) {
        setParentError(result.error);
        setSelectedParentId(category.parent_id);
      }
    });
  }

  const usageParts = [
    usage.transactionCount > 0
      ? `${usage.transactionCount} Buchung${usage.transactionCount === 1 ? '' : 'en'}`
      : null,
    usage.ruleCount > 0 ? `${usage.ruleCount} Regel${usage.ruleCount === 1 ? '' : 'n'}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={handleRename}>
        <input
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setRenameError(null);
          }}
          disabled={isPending}
          aria-label={`Name von Kategorie „${persistedName}"`}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        <button
          type="submit"
          disabled={isPending || !canRename}
          className="rounded-md bg-primary px-2 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Speichern
        </button>
        {renameError && <p className="text-xs text-destructive">{renameError}</p>}
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          {usageParts.length > 0 ? usageParts.join(' · ') : 'Nicht verwendet'}
        </p>
        <select
          value={selectedParentId === null ? '' : selectedParentId}
          onChange={handleParentChange}
          disabled={isPending || hasChildren}
          aria-label="Oberkategorie"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">Keine Oberkategorie</option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending || isInUse}
          title={isInUse ? 'Kategorie ist noch in Gebrauch und kann nicht gelöscht werden.' : undefined}
          className="text-xs text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          Löschen
        </button>
        {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
        {parentError && <p className="text-xs text-destructive">{parentError}</p>}
      </div>
    </li>
  );
}
