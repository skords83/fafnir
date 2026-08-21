'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { importCsv, type ImportState } from './actions';

const initialState: ImportState = { status: 'idle' };

export function ImportForm({ accounts }: { accounts: { id: number; name: string }[] }) {
  const [state, formAction, pending] = useActionState(importCsv, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="accountId" className="text-sm font-medium text-foreground">
          Bestehendes Konto
        </label>
        <select
          id="accountId"
          name="accountId"
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
          placeholder="z. B. Girokonto"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="file" className="text-sm font-medium text-foreground">
          Postbank-CSV-Export
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv"
          required
          className="block w-full text-sm text-foreground"
        />
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
