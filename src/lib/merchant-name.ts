/**
 * Legal-form suffixes that must keep their own canonical casing instead of
 * being title-cased word by word (e.g. "GMBH" -> "GmbH", not "Gmbh").
 * Keyed by the suffix with all punctuation stripped and lower-cased, so
 * "S.C.A.", "SCA" and "sca" all resolve to the same canonical form.
 */
const LEGAL_SUFFIXES: Record<string, string> = {
  gmbh: 'GmbH',
  mbh: 'mbH',
  ag: 'AG',
  kgaa: 'KGaA',
  kg: 'KG',
  ohg: 'OHG',
  gbr: 'GbR',
  eg: 'eG',
  ug: 'UG',
  se: 'SE',
  ev: 'e.V.',
  co: 'Co.',
  ltd: 'Ltd.',
  llc: 'LLC',
  inc: 'Inc.',
  plc: 'plc',
  sa: 'S.A.',
  sca: 'S.C.A.',
  bv: 'B.V.',
  nv: 'N.V.',
};

function titleCaseWord(word: string): string {
  const lower = word.toLocaleLowerCase('de-DE');
  const firstLetterIndex = lower.search(/\p{L}/u);
  if (firstLetterIndex === -1) return lower;
  return (
    lower.slice(0, firstLetterIndex) +
    lower[firstLetterIndex].toLocaleUpperCase('de-DE') +
    lower.slice(firstLetterIndex + 1)
  );
}

/**
 * Normalizes a raw merchant/counterparty name (often ALL CAPS in bank
 * exports) into Title Case for display, except for known legal-form suffixes
 * (GmbH, AG, S.C.A., ...), which keep their canonical casing rather than
 * being title-cased letter by letter. Purely a display transform: the raw
 * value in the database is never touched.
 */
export function normalizeMerchantName(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => {
      if (word === '') return word;
      const key = word.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]/gu, '');
      return LEGAL_SUFFIXES[key] ?? titleCaseWord(word);
    })
    .join(' ');
}
