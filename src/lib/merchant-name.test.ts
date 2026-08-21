import { describe, expect, test } from 'vitest';
import { normalizeMerchantName } from './merchant-name';

describe('normalizeMerchantName', () => {
  test('title-cases an all-caps name', () => {
    expect(normalizeMerchantName('REWE SAGT DANKE')).toBe('Rewe Sagt Danke');
  });

  test('keeps a known legal-form suffix in its canonical casing instead of title-casing it', () => {
    expect(normalizeMerchantName('MUSTERFIRMA GMBH')).toBe('Musterfirma GmbH');
  });

  test('recognizes a punctuated legal suffix regardless of the punctuation in the source', () => {
    expect(normalizeMerchantName('AMAZON PAYMENTS EUROPE S.C.A.')).toBe('Amazon Payments Europe S.C.A.');
    expect(normalizeMerchantName('AMAZON PAYMENTS EUROPE SCA')).toBe('Amazon Payments Europe S.C.A.');
  });

  test('is idempotent on an already-correct name', () => {
    expect(normalizeMerchantName('Musterfirma GmbH')).toBe('Musterfirma GmbH');
  });

  test('handles multiple legal suffixes in one name', () => {
    expect(normalizeMerchantName('MUSTER GMBH & CO. KG')).toBe('Muster GmbH & Co. KG');
  });

  test('preserves German umlauts through title-casing', () => {
    expect(normalizeMerchantName('KÜCHENSTUDIO MÜLLER')).toBe('Küchenstudio Müller');
  });

  test('leaves a purely numeric token unchanged', () => {
    expect(normalizeMerchantName('SHOP 24 GMBH')).toBe('Shop 24 GmbH');
  });
});
