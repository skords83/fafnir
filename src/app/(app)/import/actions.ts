'use server';

import { getSession } from '@/lib/session';
import { runImport, type ImportState } from './import-runner';

export async function importCsv(_prevState: ImportState, formData: FormData): Promise<ImportState> {
  const session = await getSession();
  if (!session) {
    return { status: 'error', message: 'Nicht angemeldet.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Bitte eine CSV-Datei auswählen.' };
  }

  const existingAccountId = formData.get('accountId');
  const newAccountName = formData.get('newAccountName');

  return runImport({
    accountId:
      typeof existingAccountId === 'string' && existingAccountId !== '' ? Number(existingAccountId) : undefined,
    newAccountName: typeof newAccountName === 'string' ? newAccountName : undefined,
    filename: file.name,
    csvText: await file.text(),
  });
}
