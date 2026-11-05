/**
 * Display names for finance heads of account (names only — the stored data and every
 * calculation keep using the internal names).
 *
 *   CD / HP / STBD / TBD DISBURSEMENT (or ... PRINCIPAL, CD A/C)  ->  CD / HP / STBD / TBD PRINCIPAL AMOUNT
 *   CD LOAN RECEIVABLE A/C                                         ->  NPA PENDING
 */
const isUpper = (s: string) => s === s.toUpperCase();

export const displayHeadName = (name: string | null | undefined): string => {
  const raw = (name || '').trim();
  if (!raw) return raw;
  const upper = raw.toUpperCase();

  if (upper === 'CD LOAN RECEIVABLE A/C' || upper === 'CD LOAN RECEIVABLE' || upper === 'LOAN RECEIVABLE A/C') {
    return isUpper(raw) ? 'NPA PENDING' : 'NPA Pending';
  }

  const m = upper.match(/^(CD|HP|STBD|TBD)\s+(DISBURSEMENT|PRINCIPAL)(\s+A\/C)?$/);
  if (m) {
    return isUpper(raw) ? `${m[1]} PRINCIPAL AMOUNT` : `${m[1]} Principal Amount`;
  }
  return raw;
};

/** Replace the old names inside free text (e.g. print headings, particulars). */
export const displayHeadText = (text: string | null | undefined): string =>
  (text || '')
    .replace(/\b(CD|HP|STBD|TBD) DISBURSEMENT\b/g, '$1 PRINCIPAL AMOUNT')
    .replace(/\b(CD|HP|STBD|TBD) Disbursement\b/g, '$1 Principal Amount')
    .replace(/\bCD LOAN RECEIVABLE A\/C\b/g, 'NPA PENDING')
    .replace(/\bCD Loan Receivable A\/C\b/g, 'NPA Pending');
