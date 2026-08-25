import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Low-level field parsing (German date / number formats)
// ---------------------------------------------------------------------------

export function parseGermanDateToIso(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    throw new Error(`Kein gültiges Datumsformat (t.m.jjjj): "${value}"`);
  }
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function parseGermanAmountToCents(value: string): number {
  // German format: '.' as thousands separator, ',' as decimal separator.
  // Whole-euro amounts appear without any decimal part at all (e.g. "10", "-554").
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  return Math.round(Number(normalized) * 100);
}

// ---------------------------------------------------------------------------
// Structural CSV parsing
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  rows: Record<string, string>[];
  balanceSnapshot: { date: string; balanceCents: number } | null;
}

function splitCsvLine(line: string): string[] {
  return line.split(';');
}

/**
 * Splits a raw Postbank "Kontoumsaetze" export into transaction rows and the
 * trailing dated balance snapshot. Meta lines (title, account info, date
 * range, the undated "Letzter Kontostand" line, disclaimer text) are skipped
 * by locating the real column header ("Buchungstag;...") rather than by
 * assuming a fixed line count, since that header is the only structurally
 * reliable anchor in the file.
 */
export function parseCsv(csvText: string): ParsedCsv {
  const withoutBom = csvText.replace(/^﻿/, '');
  const lines = withoutBom.split(/\r?\n/).filter((line) => line.length > 0);

  const headerIndex = lines.findIndex((line) => line.startsWith('Buchungstag;'));
  if (headerIndex === -1) {
    throw new Error('Die Kopfzeile "Buchungstag" wurde in der CSV-Datei nicht gefunden.');
  }
  const columns = splitCsvLine(lines[headerIndex]);

  const rows: Record<string, string>[] = [];
  let balanceSnapshot: ParsedCsv['balanceSnapshot'] = null;

  for (const line of lines.slice(headerIndex + 1)) {
    const fields = splitCsvLine(line);

    if (line.startsWith('Kontostand;')) {
      balanceSnapshot = {
        date: parseGermanDateToIso(fields[1]),
        balanceCents: parseGermanAmountToCents(fields[4]),
      };
      continue;
    }

    const row: Record<string, string> = {};
    columns.forEach((column, i) => {
      row[column] = fields[i] ?? '';
    });
    rows.push(row);
  }

  return { rows, balanceSnapshot };
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

export interface NormalizedTransaction {
  bookingDate: string; // ISO yyyy-mm-dd
  valueDate: string | null; // ISO yyyy-mm-dd, informational only
  amountCents: number;
  counterparty: string | null;
  alternateRecipient: string | null; // 'Abweichender Empfänger', an additional rule-match candidate
  purpose: string | null;
  kundenreferenz: string | null; // raw, used for dedup hashing
}

function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() !== '' ? value : null;
}

export function normalizeRow(row: Record<string, string>): NormalizedTransaction {
  return {
    bookingDate: parseGermanDateToIso(row['Buchungstag']),
    valueDate: row['Wert'] ? parseGermanDateToIso(row['Wert']) : null,
    amountCents: parseGermanAmountToCents(row['Betrag']),
    counterparty: emptyToNull(row['Begünstigter / Auftraggeber']),
    alternateRecipient: emptyToNull(row['Abweichender Empfänger']),
    purpose: emptyToNull(row['Verwendungszweck']),
    kundenreferenz: emptyToNull(row['Kundenreferenz']),
  };
}

// ---------------------------------------------------------------------------
// Dedup hashing
// ---------------------------------------------------------------------------

/**
 * Kundenreferenz is usually unique for card payments/Lastschrift, but is
 * frequently the literal string "NOTPROVIDED" for Daueraufträge and
 * Echtzeitüberweisungen — in that case fall back to Verwendungszweck.
 */
export function computeHash(accountId: number, tx: NormalizedTransaction): string {
  const referenceValue =
    tx.kundenreferenz && tx.kundenreferenz !== 'NOTPROVIDED' ? tx.kundenreferenz : (tx.purpose ?? '');
  const raw = [accountId, tx.bookingDate, tx.amountCents, tx.counterparty ?? '', referenceValue].join('|');
  return createHash('sha256').update(raw).digest('hex');
}
