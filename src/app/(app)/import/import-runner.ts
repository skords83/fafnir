import { and, eq, inArray } from 'drizzle-orm';
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

  // Dedupe within the batch itself first: two rows in the same CSV can hash
  // identically (e.g. two same-day standing orders to the same counterparty
  // with the same purpose, where Kundenreferenz is NOTPROVIDED). Without this,
  // both rows would pass the "not in DB yet" filter below, both get inserted,
  // and the second violates the UNIQUE (account_id, external_hash) index,
  // rolling back the entire import.
  const seenInBatch = new Set<string>();
  const deduped: { tx: NormalizedTransaction; hash: string }[] = [];
  for (const row of hashedRows) {
    if (seenInBatch.has(row.hash)) {
      continue;
    }
    seenInBatch.add(row.hash);
    deduped.push(row);
  }

  const hashes = deduped.map((r) => r.hash);
  const existing =
    hashes.length > 0
      ? await db
          .select({ hash: transactions.externalHash })
          .from(transactions)
          .where(and(eq(transactions.accountId, accountId), inArray(transactions.externalHash, hashes)))
      : [];
  const existingHashes = new Set(existing.map((r) => r.hash));

  const newRows = deduped.filter((r) => !existingHashes.has(r.hash));
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
        // Re-uploading the same CSV must not duplicate the snapshot row: there's
        // no unique constraint on (account_id, snapshot_date), so delete any
        // existing snapshot for this date before inserting the new one.
        tx.delete(balanceSnapshots)
          .where(
            and(
              eq(balanceSnapshots.accountId, accountId),
              eq(balanceSnapshots.snapshotDate, parsed.balanceSnapshot.date)
            )
          )
          .run();

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
