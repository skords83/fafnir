import { describe, expect, test } from 'vitest';
import { computeHash, normalizeRow, parseCsv, parseGermanAmountToCents, parseGermanDateToIso } from './postbank';

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



describe('parseGermanAmountToCents', () => {
  test('parses a whole-euro amount with no decimal comma', () => {
    expect(parseGermanAmountToCents('10')).toBe(1000);
  });

  test('parses a negative whole-euro amount', () => {
    expect(parseGermanAmountToCents('-554')).toBe(-55400);
  });

  test('parses an amount with a German decimal comma', () => {
    expect(parseGermanAmountToCents('12,50')).toBe(1250);
  });

  test('parses an amount with a thousands separator dot and decimal comma', () => {
    expect(parseGermanAmountToCents('1.234,56')).toBe(123456);
  });

  test('parses a negative amount with thousands separator', () => {
    expect(parseGermanAmountToCents('-1.234,56')).toBe(-123456);
  });
});

describe('parseGermanDateToIso', () => {
  test('parses a date with no leading zeros', () => {
    expect(parseGermanDateToIso('3.8.2026')).toBe('2026-08-03');
  });

  test('parses a date that already has leading zeros', () => {
    expect(parseGermanDateToIso('03.08.2026')).toBe('2026-08-03');
  });
});

describe('parseCsv', () => {
  test('extracts one row per transaction, keyed by the real header columns', () => {
    const result = parseCsv(sampleCsv());

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]['Buchungstag']).toBe('3.8.2026');
    expect(result.rows[0]['Begünstigter / Auftraggeber']).toBe('REWE Markt');
    expect(result.rows[1]['Betrag']).toBe('2500');
  });

  test('extracts the dated trailing "Kontostand" line as the balance snapshot, not as a row', () => {
    const result = parseCsv(sampleCsv());

    expect(result.balanceSnapshot).toEqual({ date: '2026-08-20', balanceCents: 245783 });
    expect(result.rows.some((r) => r['Buchungstag'] === undefined)).toBe(false);
    expect(result.rows).toHaveLength(2); // the Kontostand line must not become a 3rd row
  });

  test('ignores the undated "Letzter Kontostand" line entirely', () => {
    const result = parseCsv(sampleCsv());

    expect(result.rows.every((r) => r['Buchungstag'] !== '')).toBe(true);
  });

  test('strips a leading UTF-8 BOM before parsing', () => {
    const withBom = '﻿' + sampleCsv();
    const result = parseCsv(withBom);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]['Buchungstag']).toBe('3.8.2026');
  });
});

describe('normalizeRow', () => {
  function row(overrides: Partial<Record<string, string>> = {}) {
    return {
      'Buchungstag': '3.8.2026',
      'Wert': '3.8.2026',
      'Umsatzart': 'Lastschrift',
      'Begünstigter / Auftraggeber': 'REWE Markt',
      'Verwendungszweck': 'Einkauf',
      'Kundenreferenz': 'REF123',
      'Betrag': '-42,17',
      'Abweichender Empfänger': '',
      ...overrides,
    };
  }

  test('converts booking date, value date and amount into normalized fields', () => {
    const result = normalizeRow(row());

    expect(result.bookingDate).toBe('2026-08-03');
    expect(result.valueDate).toBe('2026-08-03');
    expect(result.amountCents).toBe(-4217);
  });

  test('uses "Begünstigter / Auftraggeber" as the counterparty', () => {
    const result = normalizeRow(row());

    expect(result.counterparty).toBe('REWE Markt');
  });
});

describe('computeHash', () => {
  function tx(overrides: Partial<ReturnType<typeof normalizeRow>> = {}) {
    return {
      bookingDate: '2026-08-03',
      valueDate: '2026-08-03',
      amountCents: -4217,
      counterparty: 'REWE Markt',
      alternateRecipient: null,
      purpose: 'Einkauf',
      kundenreferenz: 'REF123',
      ...overrides,
    };
  }

  test('ignores differing purpose text when Kundenreferenz is present (uses Kundenreferenz)', () => {
    const a = computeHash(1, tx({ purpose: 'Einkauf' }));
    const b = computeHash(1, tx({ purpose: 'Something else entirely' }));

    expect(a).toBe(b);
  });

  test('falls back to purpose when Kundenreferenz is "NOTPROVIDED"', () => {
    const a = computeHash(1, tx({ kundenreferenz: 'NOTPROVIDED', purpose: 'Dauerauftrag Miete' }));
    const b = computeHash(1, tx({ kundenreferenz: 'NOTPROVIDED', purpose: 'Dauerauftrag Strom' }));

    expect(a).not.toBe(b);
  });

  test('produces a different hash for a different account', () => {
    const a = computeHash(1, tx());
    const b = computeHash(2, tx());

    expect(a).not.toBe(b);
  });
});
