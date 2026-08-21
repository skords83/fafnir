'use client';

import { useActionState } from 'react';
import type { InferSelectModel } from 'drizzle-orm';
import { accounts } from '@/db/schema';
import { importCsv, type ImportState } from './actions';

type Account = InferSelectModel<typeof accounts>;

interface ImportFormProps {
  accounts: Account[];
}

export function ImportForm({ accounts }: ImportFormProps) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(importCsv, { status: 'idle' });

  return (
    <form action={formAction} className="space-y-6">
      {/* File Input */}
      <div>
        <label htmlFor="file" className="block text-sm font-medium text-gray-700">
          CSV-Datei
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv"
          required
          disabled={pending}
          className="mt-1 block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-full file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100
            disabled:opacity-50"
        />
      </div>

      {/* Account Selection or New Account */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-gray-700">Konto</legend>

        {accounts.length > 0 && (
          <div>
            <label className="flex items-center">
              <input type="radio" name="account-choice" value="existing" defaultChecked className="mr-3" />
              <span className="text-sm">Bestehendes Konto</span>
            </label>
            <select
              name="accountId"
              defaultValue=""
              className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm
                border px-3 py-2"
            >
              <option value="">Konto auswählen...</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {accounts.length > 0 && <div className="text-center text-sm text-gray-500">oder</div>}

        <div>
          <label className="flex items-center">
            <input type="radio" name="account-choice" value="new" className="mr-3" />
            <span className="text-sm">Neues Konto erstellen</span>
          </label>
          <input
            type="text"
            name="newAccountName"
            placeholder="z.B. Sparkasse"
            className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm
              border px-3 py-2"
          />
        </div>
      </fieldset>

      {/* Status Messages */}
      {state.status === 'error' && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{state.message}</div>
      )}

      {state.status === 'success' && (
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
          Import erfolgreich! {state.imported} neue Transaktionen importiert, {state.duplicates} Duplikate
          übersprungen.
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium
          hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Import läuft...' : 'Import starten'}
      </button>
    </form>
  );
}
