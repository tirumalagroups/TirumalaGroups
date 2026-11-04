/**
 * Final Statement – A4 portrait print document.
 *
 * Layout (from the reference the user shared, made clearer):
 *   TIRUMALA FINANCE / Gajwel, Dist: Siddipet, Telangana
 *   Final Statement                From : dd/mm/yyyy   To : dd/mm/yyyy
 *   S.No | Account | Credit | Account | Debit      (one account per row, on its own side)
 *   Opening Cash Balance on the credit side first, then
 *   Capital | Closing Cash Balance, Total | Total.
 *
 * Only presents numbers the page already computed; no calculations of its own
 * except adding up the rows it is given.
 */

export interface FinalStatementPrintRow {
  account: string;
  amount: number;
  side: 'CREDIT' | 'DEBIT';
}

export interface FinalStatementPrintData {
  fromDate: string; // yyyy-mm-dd
  toDate: string;   // yyyy-mm-dd
  rows: FinalStatementPrintRow[]; // already in display order
  creditTotal: number;
  debitTotal: number;
  openingCash: number;
  closingCash: number;
  capital: number;
  grandCredit: number;
  grandDebit: number;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dmy = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export const buildFinalStatementHtml = (data: FinalStatementPrintData): string => {
  const body = data.rows
    .map((r, i) => {
      const credit = r.side === 'CREDIT';
      return `<tr>
        <td class="sno">${i + 1}</td>
        <td class="acc">${credit ? esc(r.account) : ''}</td>
        <td class="amt cr">${credit ? money(r.amount) : ''}</td>
        <td class="acc">${credit ? '' : esc(r.account)}</td>
        <td class="amt dr">${credit ? '' : money(r.amount)}</td>
      </tr>`;
    })
    .join('');

  const css = `
    @page { size: A4 portrait; margin: 10mm 9mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #e5e7eb; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; text-transform: uppercase; }
    .page { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; padding: 10mm 9mm;
            box-shadow: 0 1px 6px rgba(0,0,0,.25); }
    .brand { text-align: center; }
    .brand h1 { margin: 0; font-size: 18pt; letter-spacing: 1px; }
    .brand .addr { margin-top: 2px; font-size: 9.5pt; color: #333; }
    .titlebar { margin-top: 8px; display: flex; justify-content: space-between; align-items: center;
                border-top: 2px solid #111; border-bottom: 2px solid #111; padding: 5px 2px; }
    .titlebar .t { font-size: 12pt; font-weight: bold; }
    .titlebar .d { font-size: 10pt; font-weight: bold; }
    .titlebar .d span { display: inline-block; margin-left: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
    th, td { border: 1px solid #555; padding: 3px 6px; vertical-align: top; }
    th { background: #eef0f3; font-size: 9.5pt; }
    th.amt, td.amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 1%; }
    td.amt { font-weight: bold; }
    td.sno, th.sno { width: 1%; text-align: center; white-space: nowrap; color: #333; }
    td.acc { word-break: normal; overflow-wrap: normal; }
    tr.open td { background: #f7f7f7; font-weight: bold; }
    tr.sum td { font-weight: bold; background: #f3f4f6; border-top: 2px solid #111; }
    tr.grand td { font-weight: bold; font-size: 10.5pt; background: #e5e7eb; border-top: 2px solid #111; border-bottom: 2px solid #111; }
    td.lbl { text-align: right; }
    .foot { margin-top: 10px; font-size: 8pt; color: #555; text-align: right; }
    .toolbar { text-align: center; margin: 10px 0 0; }
    @media print {
      html, body { background: #fff; }
      body { zoom: 1 !important; }
      .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
      th, tr.open td, tr.sum td, tr.grand td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    }
  `;

  // Enlarge the A4 page to fill the preview window (screen only; printing uses real A4 size)
  const fitScript = `
    (function () {
      function fit() {
        var w = document.documentElement.clientWidth;
        var pagePx = 794 + 24; // 210mm at 96dpi + margins
        var z = Math.max(0.5, Math.min(2, (w - 8) / pagePx));
        document.body.style.zoom = String(z);
      }
      window.addEventListener('resize', fit);
      fit();
    })();
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Final Statement ${esc(dmy(data.fromDate))} to ${esc(dmy(data.toDate))} - Tirumala Finance</title>
  <style>${css}</style>
</head>
<body>
  <div class="page">
    <div class="brand">
      <h1>TIRUMALA FINANCE</h1>
      <div class="addr">Gajwel, Dist: Siddipet, Telangana</div>
    </div>
    <div class="titlebar">
      <div class="t">Final Statement</div>
      <div class="d"><span>From : ${esc(dmy(data.fromDate))}</span><span>To : ${esc(dmy(data.toDate))}</span></div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="sno">S.No</th>
          <th>Account</th>
          <th class="amt">Credit</th>
          <th>Account</th>
          <th class="amt">Debit</th>
        </tr>
      </thead>
      <tbody>
        <tr class="open">
          <td class="sno"></td>
          <td class="acc">Opening Cash Balance</td>
          <td class="amt">${money(data.openingCash)}</td>
          <td></td>
          <td></td>
        </tr>
        ${body}
        <tr class="sum">
          <td></td>
          <td class="lbl">Credit Total</td>
          <td class="amt">${money(data.creditTotal)}</td>
          <td class="lbl">Debit Total</td>
          <td class="amt">${money(data.debitTotal)}</td>
        </tr>
        <tr class="sum">
          <td></td>
          <td class="lbl">Capital</td>
          <td class="amt">${money(data.capital)}</td>
          <td class="lbl">Closing Cash Balance</td>
          <td class="amt">${money(data.closingCash)}</td>
        </tr>
        <tr class="grand">
          <td></td>
          <td class="lbl">Total</td>
          <td class="amt">${money(data.grandCredit)}</td>
          <td class="lbl">Total</td>
          <td class="amt">${money(data.grandDebit)}</td>
        </tr>
      </tbody>
    </table>
    <div class="foot">Printed on ${esc(new Date().toLocaleString('en-IN'))}</div>
  </div>
  <script>${fitScript}</script>
</body>
</html>`;
};
