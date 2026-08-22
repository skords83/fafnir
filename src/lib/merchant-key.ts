import { deriveTransactionDisplay } from './transaction-display';

/**
 * The merchant identity a categorization rule attaches to: exactly the
 * normalized title the user already sees on the transaction row (the
 * counterparty, or a name recovered from a card-terminal purpose). No
 * separate normalization path — categorizing "by merchant" and displaying
 * "by merchant" use the same derived text.
 */
export function getMerchantKey(tx: { counterparty: string | null; purpose: string | null }): string {
  return deriveTransactionDisplay(tx).title;
}
