import { describe, expect, test } from 'vitest';
import { deriveTransactionDisplay } from './transaction-display';

describe('deriveTransactionDisplay', () => {
  test('uses counterparty as the title when present, purpose as cleaned context', () => {
    const result = deriveTransactionDisplay({
      counterparty: 'Musterfirma GmbH',
      purpose: 'Rechnung 2026-057',
    });

    expect(result).toEqual({ title: 'Musterfirma GmbH', context: 'Rechnung 2026-057' });
  });

  test('recovers a merchant name from a card-terminal purpose with an address', () => {
    const result = deriveTransactionDisplay({
      counterparty: null,
      purpose: 'REWE SAGT DANKE/Musterstr. 1/Musterstadt/DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    });

    expect(result.title).toBe('REWE SAGT DANKE');
    expect(result.context).toBe('Musterstr. 1 · Musterstadt');
  });

  test('handles the double-slash shape when the street segment is empty', () => {
    const result = deriveTransactionDisplay({
      counterparty: null,
      purpose: 'Musterladen Service//Musterstadt/DE 17-08-2026T13:41:30 Folgenr. 06 Verfalld. 1228',
    });

    expect(result.title).toBe('Musterladen Service');
    expect(result.context).toBe('Musterstadt');
  });

  test('also cleans slashes and the country code out of the context when counterparty is present', () => {
    const result = deriveTransactionDisplay({
      counterparty: 'REWE Markt GmbH',
      purpose: 'REWE SAGT DANKE. 12345678/Musterstr. 1/Musterstadt /DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    });

    expect(result.title).toBe('REWE Markt GmbH');
    expect(result.context).toBe('REWE SAGT DANKE. 12345678 · Musterstr. 1 · Musterstadt');
  });

  test('drops a redundant trailing amount echo and reference codes without an address shape', () => {
    const result = deriveTransactionDisplay({
      counterparty: null,
      purpose: '123-1234567-1234567 AMZN Mktp DE ABCDEFGHIJKLMNOP',
    });

    expect(result).toEqual({ title: '123-1234567-1234567 AMZN Mktp DE ABCDEFGHIJKLMNOP', context: null });
  });

  test('never surfaces raw Folgenr./Verfalld./timestamp codes in title or context', () => {
    const result = deriveTransactionDisplay({
      counterparty: null,
      purpose: 'Musterladen/Beispielweg 5/Musterstadt/DE 15-08-2026T10:42:29 Folgenr. 006 Verfalld. 1228',
    });

    const combined = `${result.title} ${result.context ?? ''}`;
    expect(combined).not.toMatch(/Folgenr/i);
    expect(combined).not.toMatch(/Verfalld/i);
    expect(combined).not.toMatch(/\d{2}-\d{2}-\d{4}T\d{2}:\d{2}:\d{2}/);
  });

  test('falls back to a placeholder when both counterparty and purpose are missing', () => {
    expect(deriveTransactionDisplay({ counterparty: null, purpose: null })).toEqual({
      title: 'Buchung',
      context: null,
    });
  });

  test('shows a plain-text purpose as-is when it has no card-terminal shape', () => {
    const result = deriveTransactionDisplay({
      counterparty: null,
      purpose: 'Dauerauftrag für Miete für den laufenden Monat',
    });

    expect(result).toEqual({ title: 'Dauerauftrag für Miete für den laufenden Monat', context: null });
  });
});
