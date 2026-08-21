import { headers } from 'next/headers';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db/client';
import { accounts, transactions, importBatches, balanceSnapshots } from '@/db/schema';
import { parseCsv, normalizeRow, computeHash, type NormalizedTransaction } from '@/lib/import/postbank';

export interface ImportSuccess {
  status: 'success';
  imported: number;
  duplicates: number;
}

export interface ImportError {
  status: 'error';
  message: string;
}

export type ImportState = ImportSuccess | ImportError | { status: 'idle' };

export async function runImport(params: {
  accountId?: number;
  newAccountName?: string;
  filename: string;
  csvText: string;
}): Promise<ImportState> {
  let accountId: number;

  if (params.accountId !== undefined) {
    accountId = params.accountId;
  } else if (params.newAccountName && params.newAccountName.trim() !== '') {
    const [created] = await db
      .insert(accounts)
      .values({ name: params.newAccountName.trim(), currency: 'EUR', createdAt: new Date() })
      .returning();
    accountId = created.id;
  } else {
    return { status: 'error', message: 'Bitte ein Konto auswählen oder einen neuen Kontonamen eingeben.' };
  }

  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(params.csvText);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Einlesen der CSV-Datei.';
    return { status: 'error', message: `CSV konnte nicht gelesen werden: ${message}` };
  }

  let hashedRows: { tx: NormalizedTransaction; hash: string }[];
  try {
    hashedRows = parsed.rows.map((row) => {
      const tx = normalizeRow(row);
      return { tx, hash: computeHash(accountId, tx) };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Verarbeiten der CSV-Datei.';
    return { status: 'error', message: `Fehlerhafte Zeile in der CSV-Datei: ${message}` };
  }

  const hashes = hashedRows.map((r) => r.hash);
  const existing =
    hashes.length > 0
      ? await db
          .select({ hash: transactions.externalHash })
          .from(transactions)
          .where(and(eq(transactions.accountId, accountId), inArray(transactions.externalHash, hashes)))
      : [];
  const existingHashes = new Set(existing.map((r) => r.hash));

  const newRows = hashedRows.filter((r) => !existingHashes.has(r.hash));
  const duplicateCount = hashedRows.length - newRows.length;

  try {
    db.transaction((tx) => {
      const batch = tx
        .insert(importBatches)
        .values({
          accountId,
          filename: params.filename,
          importedAt: new Date(),
          newCount: newRows.length,
          duplicateCount,
        })
        .returning()
        .get();

      for (const { tx: row, hash } of newRows) {
        tx.insert(transactions)
          .values({
            accountId,
            bookingDate: row.bookingDate,
            valueDate: row.valueDate,
            amountCents: row.amountCents,
            counterparty: row.counterparty,
            purpose: row.purpose,
            externalHash: hash,
            importBatchId: batch.id,
          })
          .run();
      }

      if (parsed.balanceSnapshot) {
        tx.insert(balanceSnapshots)
          .values({
            accountId,
            snapshotDate: parsed.balanceSnapshot.date,
            balanceCents: parsed.balanceSnapshot.balanceCents,
            source: 'csv-import',
          })
          .run();
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Speichern.';
    return { status: 'error', message: `Import fehlgeschlagen: ${message}` };
  }

  return { status: 'success', imported: newRows.length, duplicates: duplicateCount };
}

export async function importCsv(_prevState: ImportState, formData: FormData): Promise<ImportState> {
  'use server';

  const session = await auth.api.getSession({ headers: await headers() });
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
