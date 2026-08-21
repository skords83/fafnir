import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let tempDir: string;

const HEADER =
  'Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;' +
  'IBAN / Kontonummer;BIC;Kundenreferenz;Mandatsreferenz;Gläubiger ID;' +
  'Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;' +
  'Anzahl der Schecks;Soll;Haben;Währung';

function sampleCsv(): string {
  return [
    'Umsätze',
    'Konto;Filial-/Kontonummer;IBAN;Währung',
    'Girokonto;1234567890;DE12345678901234567890;EUR',
    '',
    '1.8.2026 - 20.8.2026',
    'Letzter Kontostand;;;;1234,56;EUR',
    'Die dargestellten Umsätze sind vorläufig.',
    HEADER,
    '3.8.2026;3.8.2026;Lastschrift;REWE Markt;Einkauf;;;NOTPROVIDED;;;;-42,17;;1;0;;;EUR',
    '5.8.2026;4.8.2026;Gehalt;Arbeitgeber GmbH;Gehalt August;;;REF123;;;;2500;;1;0;;;EUR',
    'Kontostand;20.8.2026;;;2457,83;EUR',
    '',
  ].join('\n');
}

async function freshImports() {
  const { db } = await import('@/db/client');
  const schema = await import('@/db/schema');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './drizzle' });
  const { runImport } = await import('./import-runner');
  return { db, schema, runImport };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'fafnir-import-test-'));
  process.env.DATABASE_PATH = join(tempDir, 'test.db');
  vi.resetModules();
});

afterEach(() => {
  delete process.env.DATABASE_PATH;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('runImport', () => {
  test('fresh import creates transactions and a balance snapshot', async () => {
    const { db, schema, runImport } = await freshImports();

    const [account] = await db
      .insert(schema.accounts)
      .values({ name: 'Girokonto', currency: 'EUR', createdAt: new Date() })
      .returning();

    const result = await runImport({ accountId: account.id, filename: 'export.csv', csvText: sampleCsv() });

    expect(result).toEqual({ status: 'success', imported: 2, duplicates: 0 });

    const storedTransactions = await db.select().from(schema.transactions);
    expect(storedTransactions).toHaveLength(2);

    const storedSnapshots = await db.select().from(schema.balanceSnapshots);
    expect(storedSnapshots).toHaveLength(1);
    expect(storedSnapshots[0].balanceCents).toBe(245783);
  });

  test('re-importing the same CSV dedupes every row', async () => {
    const { db, schema, runImport } = await freshImports();

    const [account] = await db
      .insert(schema.accounts)
      .values({ name: 'Girokonto', currency: 'EUR', createdAt: new Date() })
      .returning();

    await runImport({ accountId: account.id, filename: 'export.csv', csvText: sampleCsv() });
    const second = await runImport({ accountId: account.id, filename: 'export.csv', csvText: sampleCsv() });

    expect(second).toEqual({ status: 'success', imported: 0, duplicates: 2 });

    const storedTransactions = await db.select().from(schema.transactions);
    expect(storedTransactions).toHaveLength(2);

    const storedSnapshots = await db.select().from(schema.balanceSnapshots);
    expect(storedSnapshots).toHaveLength(1);
  });

  test('two rows that hash identically within one CSV do not crash the import', async () => {
    const { db, schema, runImport } = await freshImports();

    const [account] = await db
      .insert(schema.accounts)
      .values({ name: 'Girokonto', currency: 'EUR', createdAt: new Date() })
      .returning();

    // Two same-day standing orders to the same counterparty with the same
    // purpose and Kundenreferenz=NOTPROVIDED hash identically (the hash falls
    // back to purpose when no real reference is present).
    const csv = [
      'Umsätze',
      'Konto;Filial-/Kontonummer;IBAN;Währung',
      'Girokonto;1234567890;DE12345678901234567890;EUR',
      '',
      '1.8.2026 - 20.8.2026',
      'Letzter Kontostand;;;;1234,56;EUR',
      'Die dargestellten Umsätze sind vorläufig.',
      HEADER,
      '3.8.2026;3.8.2026;Dauerauftrag;Miete Verwaltung;Miete August;;;NOTPROVIDED;;;;-500,00;;1;0;;;EUR',
      '3.8.2026;3.8.2026;Dauerauftrag;Miete Verwaltung;Miete August;;;NOTPROVIDED;;;;-500,00;;1;0;;;EUR',
      '',
    ].join('\n');

    const result = await runImport({ accountId: account.id, filename: 'dupes.csv', csvText: csv });

    expect(result).toEqual({ status: 'success', imported: 1, duplicates: 1 });

    const storedTransactions = await db.select().from(schema.transactions);
    expect(storedTransactions).toHaveLength(1);
  });

  test('a structurally broken CSV returns a graceful error instead of throwing', async () => {
    const { runImport } = await freshImports();

    const result = await runImport({ accountId: 1, filename: 'broken.csv', csvText: 'not a postbank export' });

    expect(result.status).toBe('error');
  });

  test('a mid-transaction failure rolls back completely', async () => {
    const { db, schema } = await freshImports();

    const [account] = await db
      .insert(schema.accounts)
      .values({ name: 'Girokonto', currency: 'EUR', createdAt: new Date() })
      .returning();

    expect(() => {
      db.transaction((tx) => {
        tx.insert(schema.importBatches)
          .values({ accountId: account.id, filename: 'broken.csv', importedAt: new Date(), newCount: 1, duplicateCount: 0 })
          .run();

        // Deliberately violate the accountId foreign key to force a rollback.
        tx.insert(schema.transactions)
          .values({
            accountId: 999999,
            bookingDate: '2026-08-03',
            valueDate: null,
            amountCents: -100,
            counterparty: null,
            purpose: null,
            externalHash: 'forced-failure-hash',
          })
          .run();
      });
    }).toThrow();

    const storedBatches = await db.select().from(schema.importBatches);
    expect(storedBatches).toHaveLength(0);
  });
});
