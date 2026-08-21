export interface TransactionDisplay {
  /** Bold primary line — the counterparty, or a name recovered from the purpose when it's blank. */
  title: string;
  /** Muted secondary line, or null when nothing beyond the title is worth showing. */
  context: string | null;
}

const TIMESTAMP_RE = /\d{2}-\d{2}-\d{4}T\d{2}:\d{2}:\d{2}/g;
const FOLGENR_RE = /Folgenr\.?\s*\d+/gi;
const VERFALLD_RE = /Verfalld\.?\s*\d+/gi;
const TRAILING_AMOUNT_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}\s?EUR\s*$/;
const TRAILING_COUNTRY_RE = /\/(DE|DEU)\s*$/;

/** Strips the card-terminal metadata (Folgenr., Verfalld., timestamp) and a redundant trailing amount echo. */
function stripTerminalNoise(text: string): string {
  return text
    .replace(TIMESTAMP_RE, ' ')
    .replace(FOLGENR_RE, ' ')
    .replace(VERFALLD_RE, ' ')
    .replace(TRAILING_AMOUNT_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Cleans a purpose (or the "/Street/City/DE" remainder of one) into a short, readable
 * context line: strips the trailing "/DE"/"/DEU" country code and turns the slash-delimited
 * address fields into a " · "-joined list instead of showing them as raw SEPA punctuation.
 */
function cleanContext(text: string): string | null {
  const cleaned = stripTerminalNoise(text).replace(TRAILING_COUNTRY_RE, '');
  const parts = cleaned
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const joined = parts.join(' · ');
  return joined !== '' ? joined : null;
}

/**
 * Derives a display title/context pair from a transaction, without adding any new data
 * source: Postbank card-terminal purposes always leave `counterparty` blank and instead
 * pack it into `purpose` as "Name[/Address]/City/DE <timestamp> Folgenr. N Verfalld. N" —
 * recognizable by the Folgenr./Verfalld. markers. When that shape is present, splitting on
 * the first "/" recovers a clean merchant name; otherwise the purpose is shown as-is, with
 * only the explicit noise patterns (Folgenr./Verfalld./timestamp) stripped.
 */
export function deriveTransactionDisplay(tx: { counterparty: string | null; purpose: string | null }): TransactionDisplay {
  const purpose = tx.purpose && tx.purpose.trim() !== '' ? tx.purpose.trim() : null;

  if (tx.counterparty && tx.counterparty.trim() !== '') {
    const title = tx.counterparty.trim();
    const context = purpose ? cleanContext(purpose) : null;
    return { title, context };
  }

  if (!purpose) {
    return { title: 'Buchung', context: null };
  }

  const isCardTerminalShape = /Folgenr\.?\s*\d+/i.test(purpose) || /Verfalld\.?\s*\d+/i.test(purpose);
  const slashIndex = purpose.indexOf('/');

  if (isCardTerminalShape && slashIndex !== -1) {
    const title = purpose.slice(0, slashIndex).trim();
    const context = cleanContext(purpose.slice(slashIndex + 1));
    return { title: title !== '' ? title : stripTerminalNoise(purpose), context };
  }

  return { title: stripTerminalNoise(purpose), context: null };
}
