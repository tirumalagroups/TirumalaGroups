/**
 * Helpers for the CD Ledger payment receipt (A4 portrait print).
 */

export interface CDReceiptRow {
  id: string;
  date: string;
  receiptNo: string;
  eventType: string;
  principalPaid: number;
  interestPaid: number;
  penaltyPaid: number;
  docCharges: number;
  totalPaid: number;
  outstandingPrincipal: number;
  operator: string;
  remarks?: string;
}

/** Statement rows that have a real receipt number (Loan Issue rows have none). */
export const receiptRowsFromStatement = (rows: any[]): CDReceiptRow[] =>
  (rows || [])
    .filter(r => r && r.eventType !== 'Loan Issue' && r.receiptNo && r.receiptNo !== '—' && r.receiptNo !== '-')
    .map(r => ({
      id: String(r.id),
      date: r.date,
      receiptNo: String(r.receiptNo),
      eventType: r.eventType || 'Payment',
      principalPaid: Number(r.principalPaid || 0),
      interestPaid: Number(r.interestPaid || 0),
      penaltyPaid: Number(r.penaltyPaid || 0),
      docCharges: Number(r.docCharges || 0),
      totalPaid: Number(r.totalPaid || 0),
      outstandingPrincipal: Number(r.outstandingPrincipal || 0),
      operator: r.operator || '',
      remarks: r.remarks || ''
    }));

/** Indian currency format with 2 decimals: 1,23,456.00 */
export const formatReceiptAmount = (v: number): string =>
  (Number.isFinite(v) ? v : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigits = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const threeDigits = (n: number): string => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
};

/** Rupees in words, Indian system (Crore / Lakh / Thousand): "Rupees Twenty One Thousand Seven Hundred Fifty Only" */
export const amountInWords = (amount: number): string => {
  const value = Math.abs(Number.isFinite(amount) ? amount : 0);
  let rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));

  let words = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
};
