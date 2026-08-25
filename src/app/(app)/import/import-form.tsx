'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { importCsv } from './actions';
import type { ImportState } from './import-runner';

const initialState: ImportState = { status: 'idle' };

export function ImportForm({ accounts }: { accounts: { id: number; name: string }[] }) {
  const [state, formAction, pending] = useActionState(importCsv, initialState);

  // React resets every uncontrolled field in a <form action={...}> the
  // instant it's submitted (win or lose), so a failed import used to wipe
  // the account choice along with it. Controlling these two fields keeps
  // them intact when `state.status === 'error'`; the file input can't be
  // controlled the same way (browsers won't let JS set its value), so we
  // just remember its filename to show as a reminder instead.
  const [accountId, setAccountId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === 'success') {
      setAccountId('');
      setNewAccountName('');
      setSelectedFilename(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="accountId" className="text-sm font-medium text-foreground">
          Bestehendes Konto
        </label>
        <select
          id="accountId"
          name="accountId"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">— kein bestehendes Konto —</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="newAccountName" className="text-sm font-medium text-foreground">
          Oder neues Konto anlegen
        </label>
        <input
          id="newAccountName"
          name="newAccountName"
          type="text"
          value={newAccountName}
          onChange={(e) => setNewAccountName(e.target.value)}
          placeholder="z. B. Girokonto"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="file" className="text-sm font-medium text-foreground">
          Postbank-CSV-Export
        </label>
        <input
          ref={fileInputRef}
          id="file"
          name="file"
          type="file"
          accept=".csv"
          required
          onChange={(e) => setSelectedFilename(e.target.files?.[0]?.name ?? null)}
          className="block w-full text-sm text-foreground"
        />
        {state.status === 'error' && selectedFilename && (
          <p className="text-xs text-muted-foreground">Zuletzt ausgewählt: {selectedFilename} — bitte erneut auswählen.</p>
        )}
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Importiere…' : 'Importieren'}
      </Button>
      {state.status === 'success' && (
        <p className="text-sm text-foreground">
          {state.imported} Transaktionen importiert, {state.duplicates} Duplikate übersprungen.
        </p>
      )}
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}
