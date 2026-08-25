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

  // Reset the controlled fields the moment a submission succeeds. This adjusts
  // state during render (the pattern React docs recommend for "state derived
  // from a previous render") instead of calling setState from an effect, which
  // would cost an extra render pass; React discards the stale render here and
  // repaints once with the cleared values.
  const [handledStatus, setHandledStatus] = useState(state.status);
  if (state.status !== handledStatus) {
    setHandledStatus(state.status);
    if (state.status === 'success') {
      setAccountId('');
      setNewAccountName('');
      setSelectedFilename(null);
    }
  }

  // The file input can't be controlled the same way (browsers won't let JS
  // set its value via a prop), so clearing it stays an imperative DOM write
  // in an effect — it doesn't call setState, so it's unaffected by the rule
  // against setState-in-effects above.
  useEffect(() => {
    if (state.status === 'success' && fileInputRef.current) {
      fileInputRef.current.value = '';
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
