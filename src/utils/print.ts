import { format } from 'date-fns';

export interface PrintOptions {
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  paperSize?: 'A4' | 'Letter' | 'Legal';
  margins?: {
    top: string;
    right: string;
    bottom: string;
    left: string;
  };
  includeHeader?: boolean;
  includeFooter?: boolean;
  headerText?: string;
  footerText?: string;
  openingBalance?: number;
  closingBalance?: number;
  companyBalances?: Array<{companyName: string, openingBalance: number, closingBalance: number}>;
  isPrintMode?: boolean;
}

export interface SharedPrintStyleOptions {
  isLandscape?: boolean;
  /** Table text size in points. Defaults to 8pt (portrait) / 9pt (landscape). */
  fontSizePt?: number;
}

// Words that stay in capitals when ALL-CAPS data is shown in normal case.
const KEEP_UPPERCASE = new Set([
  'P&L', 'GST', 'TDS', 'ITR', 'PAN', 'HDFC', 'SBI', 'ICICI', 'IDBI', 'KVB', 'PNB', 'BOB', 'IOB', 'UCO',
  'LIC', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'ATM', 'EMI', 'PF', 'ESI', 'OD', 'CC', 'FD', 'RD',
  'CR', 'DR', 'HP', 'CD', 'STBD', 'TBD', 'TC', 'AP', 'TS', 'RTO', 'MRO', 'NA', 'II', 'III', 'IV',
]);
const LOWERCASE_JOINERS = new Set(['and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * Shows ALL-CAPS text in normal title case for printing
 * ("AUDIT FEE A/C" -> "Audit Fee A/c", "CASH PAID TO RAMESH" -> "Cash Paid to Ramesh").
 * Text that already has lowercase letters is left exactly as typed, and
 * codes (GST, SBI, P&L...) and words containing digits stay unchanged.
 */
export const toDisplayCase = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  if (!text || /[a-z]/.test(text)) return text;
  let isFirstWord = true;
  return text.replace(/\S+/g, word => {
    const first = isFirstWord;
    isFirstWord = false;
    const core = word.replace(/^[^A-Z0-9&]+|[^A-Z0-9&]+$/g, '');
    if (KEEP_UPPERCASE.has(core) || /\d/.test(word)) return word;
    const lower = word.toLowerCase();
    if (!first && LOWERCASE_JOINERS.has(lower)) return lower;
    return lower.replace(/(^|[(.-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  });
};

export const getSharedPrintStyles = (options?: SharedPrintStyleOptions) => {
  const isLandscape = options?.isLandscape ?? false;
  const fontSize = `${options?.fontSizePt ?? (isLandscape ? 9 : 8)}pt`;
  return `
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${fontSize};
      line-height: 1.3;
      margin: 0;
      padding: ${isLandscape ? '12px' : '6px'};
      background-color: #fff;
      color: #111;
      text-transform: uppercase;
    }

    /*
     * Layout rule: columns size to their content (table-layout: auto).
     * Numbers, dates and quantities never wrap or break mid-figure; only the
     * free-text columns (company, account, particulars...) wrap, and only at
     * spaces (never mid-word). Small regular text + thin borders keep everything on the A4 sheet.
     */
    table {
      width: 100%;
      table-layout: auto !important;
      border-collapse: collapse;
      margin-bottom: 8px;
    }

    th, td {
      border: 1px solid #9ca3af;
      padding: 2px 5px;
      font-size: ${fontSize};
      line-height: 1.3;
      box-sizing: border-box;
      vertical-align: top;
      word-break: normal;
      overflow-wrap: normal;
      overflow: visible !important;
      font-weight: normal;
      font-variant-numeric: tabular-nums;
    }

    th {
      background-color: #f3f4f6;
      font-weight: bold;
      text-align: left;
      white-space: normal;
      vertical-align: bottom;
    }

    /* Totals / summary rows */
    tr.totals td, tr.totals th, td.totals {
      font-weight: bold;
      background-color: #f3f4f6;
    }

    /* Fixed-content columns: shrink to fit the content, never wrap */
    .col-sno, .col-date, .col-qty, .col-purchase-qty, .col-sale-qty,
    .col-credit, .col-debit, .col-balance, .col-amount,
    .col-opening-balance, .col-opening, .col-closing-balance, .col-closing,
    .col-status {
      width: 1% !important;
      min-width: 0 !important;
    }
    td.col-sno, td.col-date, td.col-qty, td.col-purchase-qty, td.col-sale-qty,
    td.col-credit, td.col-debit, td.col-balance, td.col-amount,
    td.col-opening-balance, td.col-opening, td.col-closing-balance, td.col-closing,
    td.col-status {
      white-space: nowrap !important;
      word-break: keep-all !important;
    }
    .col-qty, .col-purchase-qty, .col-sale-qty, .col-status {
      text-align: center !important;
    }
    .col-credit, .col-debit, .col-balance, .col-amount,
    .col-opening-balance, .col-opening, .col-closing-balance, .col-closing {
      text-align: right !important;
    }

    /* Free-text columns: take the remaining width, wrap at spaces only */
    .col-particulars, .col-company, .col-account, .col-sub-account {
      width: auto !important;
      white-space: normal !important;
      word-break: normal !important;
      overflow-wrap: normal !important;
    }

    .text-right {
      text-align: right !important;
    }
    .text-center {
      text-align: center !important;
    }
    .text-bold {
      font-weight: bold !important;
    }
    .approved {
      background-color: #d1fae5 !important;
    }
    .pending {
      background-color: #fef3c7 !important;
    }

    @media print {
      @page {
        size: A4 ${isLandscape ? 'landscape' : 'portrait'};
        margin: ${isLandscape ? '8mm' : '6mm'};
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        font-size: ${fontSize} !important;
      }
      tr {
        page-break-inside: avoid;
      }
      th, tr.totals td, td.totals {
        background-color: #f3f4f6 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .approved {
        background-color: #d1fae5 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .pending {
        background-color: #fef3c7 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print {
        display: none !important;
      }
    }
  `;
};

export const getColClass = (key: string) => {
  const k = key.toLowerCase();
  if (k === 'sno' || k === 's_no' || k === 's.no') return 'col-sno';
  if (k === 'date' || k === 'c_date' || k === 'date') return 'col-date';
  if (k === 'credit') return 'col-credit';
  if (k === 'debit') return 'col-debit';
  if (k === 'balance') return 'col-balance';
  if (k === 'amount') return 'col-amount';
  if (k.includes('purchaseqty') || k.includes('purchase_qty') || k.includes('purchase quantity') || k.includes('purchase quantity') || k === 'purchasequantity') return 'col-purchase-qty';
  if (k.includes('saleqty') || k.includes('sale_qty') || k.includes('sale quantity') || k === 'salequantity') return 'col-sale-qty';
  if (k.includes('qty')) return 'col-qty';
  if (k === 'particulars') return 'col-particulars';
  if (k === 'companyname' || k === 'company_name' || k === 'company') return 'col-company';
  if (k === 'accountname' || k === 'acc_name' || k === 'account') return 'col-account';
  if (k === 'subaccount' || k === 'sub_acc_name' || k === 'sub account') return 'col-sub-account';
  if (k === 'approved' || k === 'status') return 'col-status';
  return '';
};

export const printTable = (
  data: any[],
  columns: { key: string; label: string; width?: string }[],
  options: PrintOptions = {}
) => {
  const {
    title = 'Report',
    subtitle = '',
    orientation = 'portrait',
    paperSize = 'A4',
    margins = { top: '1in', right: '0.5in', bottom: '1in', left: '0.5in' },
    includeHeader = true,
    includeFooter = true,
    headerText = 'Thirumala Group Business Management System',
    footerText = `Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
  } = options;

  // Create print window
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Popup blocked. Please allow popups for this site.');
  }

  // Generate CSS
  const css = `
    @media print {
      @page {
        size: ${paperSize} ${orientation};
        margin: ${margins.top} ${margins.right} ${margins.bottom} ${margins.left};
      }
    }
    
    body {
      font-family: 'Arial', sans-serif;
      font-size: 12px;
      line-height: 1.4;
      margin: 0;
      padding: 0;
      text-transform: uppercase;
    }
    
    .print-header {
      text-align: center;
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    
    .print-title {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin: 0;
    }
    
    .print-subtitle {
      font-size: 16px;
      color: #666;
      margin: 5px 0 0 0;
    }
    
    .print-header-text {
      font-size: 14px;
      color: #333;
      margin: 10px 0 0 0;
    }
    
    .print-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    
    .print-table th {
      background-color: #f3f4f6;
      border: 1px solid #d1d5db;
      padding: 8px;
      text-align: left;
      font-weight: bold;
      font-size: 11px;
    }
    
    .print-table td {
      border: 1px solid #d1d5db;
      padding: 6px 8px;
      font-size: 10px;
    }
    
    .print-table tr:nth-child(even) {
      background-color: #f9fafb;
    }
    
    .print-footer {
      text-align: center;
      border-top: 1px solid #333;
      padding-top: 10px;
      margin-top: 20px;
      font-size: 10px;
      color: #666;
    }
    
    .print-summary {
      margin: 0 auto 0 0;
      padding: 15px;
      background-color: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 4px;
      width: fit-content;
      max-width: 100%;
      margin-left: auto !important;
      margin-right: 0 !important;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    
    .print-summary h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #333;
    }
    
    .print-summary-row {
      display: flex;
      justify-content: space-between;
      margin: 5px 0;
      font-size: 11px;
    }
    
    .print-summary-label {
      font-weight: bold;
      color: #555;
    }
    
    .print-summary-value {
      color: #333;
    }
    
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .text-bold { font-weight: bold; }
    .text-green { color: #059669; }
    .text-red { color: #dc2626; }
    .text-orange { color: #ea580c; }
    ${getSharedPrintStyles({ isLandscape: orientation === 'landscape' })}
  `;

  const tableRows = data
    .map(row => {
      const cells = columns
        .map(col => {
          const value = row[col.key];
          let displayValue = value;

          if (typeof value === 'number') {
            if (
              col.key.toLowerCase().includes('amount') ||
              col.key.toLowerCase().includes('credit') ||
              col.key.toLowerCase().includes('debit') ||
              col.key.toLowerCase().includes('balance')
            ) {
              displayValue = `${value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            } else {
              displayValue = value.toLocaleString('en-IN');
            }
          }

          if (col.key.toLowerCase().includes('date') && value) {
            try {
              displayValue = format(new Date(value), 'dd/MM/yyyy');
            } catch (e) {
              displayValue = value;
            }
          }

          return `<td class="${getColClass(col.key)}">${displayValue || ''}</td>`;
        })
        .join('');

      return `<tr>${cells}</tr>`;
    })
    .join('');

  const tableHeaders = columns
    // No fixed widths: every column sizes itself to its content
    .map(col => `<th class="${getColClass(col.key)}">${col.label}</th>`)
    .join('');

  let summaryHTML = '';
  if (data.length > 0) {
    const numericColumns = columns.filter(
      col =>
        col.key.toLowerCase().includes('amount') ||
        col.key.toLowerCase().includes('credit') ||
        col.key.toLowerCase().includes('debit') ||
        col.key.toLowerCase().includes('balance')
    );

    if (numericColumns.length > 0) {
      const totals = numericColumns.map(col => {
        const total = data.reduce((sum, row) => {
          const value = parseFloat(row[col.key]) || 0;
          return sum + value;
        }, 0);
        return { label: col.label, total };
      });

      summaryHTML = `
        <div class="print-summary">
          <h3>Summary</h3>
          ${totals
            .map(
              item => `
            <div class="print-summary-row">
              <span class="print-summary-label">Total ${item.label}:</span>
              <span class="print-summary-value">${item.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          `
            )
            .join('')}
          <div class="print-summary-row">
            <span class="print-summary-label">Total Records:</span>
            <span class="print-summary-value">${data.length}</span>
          </div>
        </div>
      `;
    }
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>${css}</style>
    </head>
    <body>
      ${
        includeHeader
          ? `
        <div class="print-header">
          <h1 class="print-title">${title}</h1>
          ${subtitle ? `<p class="print-subtitle">${subtitle}</p>` : ''}
          <p class="print-header-text">${headerText}</p>
        </div>
      `
          : ''
      }
      
      ${summaryHTML}
      
      <table class="print-table">
        <thead>
          <tr>${tableHeaders}</tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      
      ${
        includeFooter
          ? `
        <div class="print-footer">
          <p>${footerText}</p>
        </div>
      `
          : ''
      }
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.print();
    printWindow.close();
  };
};

// Specialized print functions for different report types
export const printCashBook = (data: any[], options: PrintOptions = {}) => {
  const columns = [
    { key: 'sno', label: 'S.No', width: '60px' },
    { key: 'date', label: 'Date', width: '100px' },
    { key: 'companyName', label: 'Company', width: '150px' },
    { key: 'accountName', label: 'Account', width: '150px' },
    { key: 'subAccount', label: 'Sub Account', width: '150px' },
    { key: 'particulars', label: 'Particulars', width: '200px' },
    { key: 'credit', label: 'Credit', width: '100px' },
    { key: 'debit', label: 'Debit', width: '100px' },
    { key: 'staff', label: 'Staff', width: '100px' },
    { key: 'approved', label: 'Status', width: '80px' },
  ];

  return printTable(data, columns, {
    title: 'Cash Book Report',
    subtitle: 'Financial Transaction Details',
    ...options,
  });
};

export const printLedger = (data: any[], options: PrintOptions = {}) => {
  const columns = [
    { key: 'accountName', label: 'Account Name', width: '200px' },
    { key: 'credit', label: 'Credit', width: '120px' },
    { key: 'debit', label: 'Debit', width: '120px' },
    { key: 'balance', label: 'Balance', width: '120px' },
    { key: 'yesNo', label: 'Category', width: '100px' },
  ];

  return printTable(data, columns, {
    title: 'Ledger Report',
    subtitle: 'Account-wise Summary',
    ...options,
  });
};

export const printBalanceSheet = (data: any[], options: PrintOptions = {}) => {
  const columns = [
    { key: 'accountName', label: 'Account Name', width: '250px' },
    { key: 'credit', label: 'Credit', width: '120px' },
    { key: 'debit', label: 'Debit', width: '120px' },
    { key: 'balance', label: 'Balance', width: '120px' },
    { key: 'yesNo', label: 'P&L', width: '80px' },
    { key: 'result', label: 'Result', width: '100px' },
  ];

  return printTable(data, columns, {
    title: 'Balance Sheet',
    subtitle: 'Financial Position Report',
    ...options,
  });
};

export const printVehicles = (data: any[], options: PrintOptions = {}) => {
  const columns = [
    { key: 'sno', label: 'S.No', width: '60px' },
    { key: 'v_no', label: 'Vehicle No', width: '120px' },
    { key: 'v_type', label: 'Type', width: '150px' },
    { key: 'particulars', label: 'Particulars', width: '200px' },
    { key: 'tax_exp_date', label: 'Tax Expiry', width: '100px' },
    { key: 'insurance_exp_date', label: 'Insurance Expiry', width: '120px' },
    { key: 'fitness_exp_date', label: 'Fitness Expiry', width: '120px' },
    { key: 'permit_exp_date', label: 'Permit Expiry', width: '120px' },
  ];

  return printTable(data, columns, {
    title: 'Vehicle Management Report',
    subtitle: 'Fleet and Document Status',
    ...options,
  });
};

export const printBankGuarantees = (
  data: any[],
  options: PrintOptions = {}
) => {
  const columns = [
    { key: 'sno', label: 'S.No', width: '60px' },
    { key: 'bg_no', label: 'BG No', width: '150px' },
    { key: 'issue_date', label: 'Issue Date', width: '100px' },
    { key: 'exp_date', label: 'Expiry Date', width: '100px' },
    { key: 'work_name', label: 'Work Name', width: '250px' },
    { key: 'credit', label: 'Credit', width: '100px' },
    { key: 'debit', label: 'Debit', width: '100px' },
    { key: 'department', label: 'Department', width: '150px' },
  ];

  return printTable(data, columns, {
    title: 'Bank Guarantees Report',
    subtitle: 'BG Tracking and Management',
    ...options,
  });
};

export const printDrivers = (data: any[], options: PrintOptions = {}) => {
  const columns = [
    { key: 'sno', label: 'S.No', width: '60px' },
    { key: 'driver_name', label: 'Driver Name', width: '200px' },
    { key: 'license_no', label: 'License No', width: '150px' },
    { key: 'exp_date', label: 'License Expiry', width: '120px' },
    { key: 'phone', label: 'Phone', width: '120px' },
    { key: 'address', label: 'Address', width: '250px' },
    { key: 'particulars', label: 'Particulars', width: '200px' },
  ];

  return printTable(data, columns, {
    title: 'Drivers Report',
    subtitle: 'Driver Information and License Status',
    ...options,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Daily Report print document (Thirumala Group branding).
// buildDailyReportHtml() is shared by the on-screen preview and the printout,
// so the preview always matches the paper.
// ─────────────────────────────────────────────────────────────────────────────
export interface DailyReportHtmlOptions extends PrintOptions {
  /** Show the on-page Print button (off when the document is embedded in a preview). */
  showToolbar?: boolean;
}

const DAILY_TEXT_KEYS = new Set(['companyName', 'accountName', 'subAccount', 'particulars']);

export const buildDailyReportHtml = (data: any[], options: DailyReportHtmlOptions = {}) => {
  const {
    title = 'Daily Report',
    subtitle = '',
    includeHeader = true,
    includeFooter = true,
    headerText = 'Thirumala Group - Daily Transaction Report',
    footerText = `Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
    openingBalance = 0,
    closingBalance = 0,
    companyBalances = [],
    showToolbar = true,
  } = options;

  const formatCurrency = (value: number) =>
    value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const toNumber = (v: unknown) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };

  // Columns for the main table (Date, Staff and Status excluded per business requirement)
  const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'companyName', label: 'Company' },
    { key: 'accountName', label: 'Account' },
    { key: 'subAccount', label: 'Sub Account' },
    { key: 'particulars', label: 'Particulars' },
    { key: 'credit', label: 'Credit' },
    { key: 'debit', label: 'Debit' },
  ];

  const filteredColumns = columns.filter(col => {
    if (!data || data.length === 0) return true;
    return Object.prototype.hasOwnProperty.call(data[0], col.key);
  });

  const tableRows = data
    .map((row, index) => {
      const cells = filteredColumns
        .map(col => {
          let displayValue: string | number;
          if (col.key === 'sno') {
            displayValue = index + 1;
          } else if (col.key === 'credit' || col.key === 'debit') {
            const n = toNumber(row[col.key]);
            displayValue = n === 0 ? '-' : formatCurrency(n);
          } else if (DAILY_TEXT_KEYS.has(col.key)) {
            displayValue = toDisplayCase(row[col.key]) || '-';
          } else {
            displayValue = row[col.key] ?? '';
          }
          return `<td class="${getColClass(col.key)}">${displayValue}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const tableHeaders = filteredColumns
    .map(col => `<th class="${getColClass(col.key)}">${col.label}</th>`)
    .join('');

  const creditTotal = data.reduce((sum, row) => sum + toNumber(row.credit), 0);
  const debitTotal = data.reduce((sum, row) => sum + toNumber(row.debit), 0);
  const openingBalanceValue = Math.abs(openingBalance);
  const closingBalanceValue = Math.abs(closingBalance);
  const grandTotalCredit = creditTotal + openingBalanceValue;
  const grandTotalDebit = debitTotal + closingBalanceValue;

  // Summary rows at the bottom of the main table: label under Particulars, figures under Credit / Debit
  const labelSpan = Math.max(filteredColumns.length - 3, 0);
  const summaryRow = (label: string, credit: string, debit: string, extraClass = '') => `
    <tr class="totals ${extraClass}">
      ${labelSpan > 0 ? `<td colspan="${labelSpan}"></td>` : ''}
      <td class="text-right">${label}</td>
      <td class="col-credit">${credit}</td>
      <td class="col-debit">${debit}</td>
    </tr>`;
  const summaryRowsHTML = [
    summaryRow('Total', formatCurrency(creditTotal), formatCurrency(debitTotal), 'first-summary'),
    summaryRow('Opening Balance', formatCurrency(openingBalanceValue), '-'),
    summaryRow('Closing Balance', '-', formatCurrency(closingBalanceValue)),
    summaryRow('Grand Total', formatCurrency(grandTotalCredit), formatCurrency(grandTotalDebit), 'grand-total'),
  ].join('');

  // Company-wise balances: shown in the preview only (hidden on paper)
  let companyTableHTML = '';
  if (companyBalances && companyBalances.length > 0) {
    const balanceText = (amount: number) =>
      `${amount < 0 ? '-' : ''}${formatCurrency(Math.abs(amount))} ${amount < 0 ? 'DR' : 'CR'}`;
    const rows = companyBalances
      .map(company => `
          <tr>
            <td class="col-company">${toDisplayCase(company.companyName)}</td>
            <td class="col-opening ${company.openingBalance < 0 ? 'text-red' : 'text-green'}">${balanceText(company.openingBalance)}</td>
            <td class="col-closing ${company.closingBalance < 0 ? 'text-red' : 'text-green'}">${balanceText(company.closingBalance)}</td>
          </tr>`)
      .join('');

    companyTableHTML = `
      <div class="company-balances-container">
        <table>
          <thead>
            <tr><th colspan="3" class="text-center">Company-wise Opening &amp; Closing Balances</th></tr>
            <tr>
              <th class="col-company">Company</th>
              <th class="col-opening">Opening Balance</th>
              <th class="col-closing">Closing Balance</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  const subtitleHTML = subtitle
    ? subtitle.startsWith('Company:')
      ? `Company: <strong>${toDisplayCase(subtitle.replace('Company:', '').trim())}</strong>`
      : `<strong>${subtitle}</strong>`
    : '';

  const css = `
    ${getSharedPrintStyles({ isLandscape: false, fontSizePt: 8 })}

    body {
      background: #f3f4f6;
      padding: 16px;
    }
    .print-container {
      background: #fff;
      max-width: 210mm;
      margin: 0 auto;
      padding: 10mm 8mm;
      border: 1px solid #d1d5db;
      box-sizing: border-box;
    }
    .print-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1.5px solid #111;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .print-header .title { font-size: 11pt; font-weight: bold; }
    .print-header .brand { font-size: 13pt; font-weight: bold; text-align: center; }
    .print-header .brand-sub { font-size: 8pt; color: #555; text-align: center; }
    .print-header .meta { font-size: 9pt; text-align: right; }
    .print-header .meta-sub { font-size: 7.5pt; color: #555; text-align: right; }
    /* No fixed column widths: each column grows or shrinks with its content */
    tr.first-summary td { border-top: 1.5px solid #111; }
    tr.grand-total td { border-bottom: 1.5px solid #111; }
    .text-green { color: #047857; }
    .text-red { color: #b91c1c; }
    .company-balances-container { margin-top: 12px; }
    .print-footer {
      text-align: center;
      border-top: 1px solid #d1d5db;
      padding-top: 4px;
      margin-top: 10px;
      font-size: 7.5pt;
      color: #555;
    }
    .toolbar { text-align: center; margin: 0 0 12px 0; }
    .toolbar button {
      background: #2563eb;
      color: #fff;
      border: none;
      padding: 8px 24px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }

    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .print-container { max-width: none; border: none !important; padding: 0 !important; margin: 0 !important; }
      .toolbar, .company-balances-container { display: none !important; }
      tr.totals td { background: #f3f4f6 !important; }
    }
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title} - Thirumala Group</title>
  <meta charset="utf-8">
  <style>${css}</style>
</head>
<body>
  ${showToolbar ? `<div class="toolbar"><button onclick="window.print()">&#128424; Print</button></div>` : ''}
  <div class="print-container">
    ${includeHeader ? `
    <div class="print-header">
      <div style="flex:1;"><div class="title">${title}</div></div>
      <div style="flex:1;">
        <div class="brand">Thirumala Group</div>
        <div class="brand-sub">Business Management System</div>
      </div>
      <div style="flex:1;">
        ${subtitleHTML ? `<div class="meta">${subtitleHTML}</div>` : ''}
        <div class="meta-sub">${headerText}</div>
      </div>
    </div>
    ` : ''}

    <table class="main-table">
      <thead>
        <tr>${tableHeaders}</tr>
      </thead>
      <tbody>
        ${tableRows}
        ${summaryRowsHTML}
      </tbody>
    </table>

    ${companyTableHTML}

    ${includeFooter ? `<div class="print-footer">${footerText}</div>` : ''}
  </div>
</body>
</html>`;
};

export const printDailyReport = (data: any[], options: PrintOptions = {}) => {
  // Open a single print window — no second popup required
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Popup blocked. Please allow popups for this site.');
  }

  printWindow.document.write(buildDailyReportHtml(data, options));
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
};

/**
 * Prints the document shown in a preview <iframe> (same A4 page rules as the
 * preview), so no popup window is needed.
 */
export const printPreviewFrame = (frame: HTMLIFrameElement | null) => {
  const win = frame?.contentWindow;
  if (!win) return false;
  win.focus();
  win.print();
  return true;
};
