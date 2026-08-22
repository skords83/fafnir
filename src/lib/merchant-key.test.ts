import { describe, expect, test } from 'vitest';
import { getMerchantKey } from './merchant-key';

describe('getMerchantKey', () => {
  test('uses the normalized counterparty when present', () => {
    const key = getMerchantKey({
      counterparty: 'REWE Markt GmbH',
      purpose: 'REWE SAGT DANKE. 41403508/Tonndorfer/Hamburg Tonndorf /DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    });
    expect(key).toBe('Rewe Markt GmbH');
  });

  test('recovers the merchant name from a card-terminal purpose when counterparty is blank', () => {
    const key = getMerchantKey({
      counterparty: null,
      purpose: 'REWE SAGT DANKE/Musterstr. 1/Musterstadt/DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    });
    expect(key).toBe('Rewe Sagt Danke');
  });

  test('is stable across different transactions from the same merchant', () => {
    const a = getMerchantKey({
      counterparty: 'AMAZON PAYMENTS EUROPE S.C.A.',
      purpose: '305-5775665-2150736 AMZN Mktp DE 1F69DDLVBGYT9H0N',
    });
    const b = getMerchantKey({
      counterparty: 'AMAZON PAYMENTS EUROPE S.C.A.',
      purpose: '305-5198200-2372354 AMZN Mktp DE 4L895LCURQT95Y3O',
    });
    expect(a).toBe(b);
    expect(a).toBe('Amazon Payments Europe S.C.A.');
  });
});
