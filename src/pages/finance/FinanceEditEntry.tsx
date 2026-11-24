import LoadMoreBar, { LOAD_STEP } from '../../components/UI/LoadMoreBar';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit, Eye, FileEdit, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Input from '../../components/UI/Input';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { supabaseFinance, FinanceCashbookAccount } from '../../lib/supabaseFinance';
import { dailyFinancialTransactionService, DailyFinancialTransaction } from '../../services/dailyFinancialTransactionService';
import {
  classifyEntry, EntryKind, findReceiptTx, previewReceiptChange, ReceiptPreview, saveReceiptEdit, deleteReceipt,
  saveCashbookEdit, deleteCashbook, saveCapitalEdit, deleteCapital
} from '../../services/financeEntryEditService';
import { displayHeadName, displayHeadText } from '../../utils/financeLabels';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';

type Row = DailyFinancialTransaction & { kind: EntryKind; loanUuid: string | null; loanStatus: string };

const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmt2 = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoDay = (d?: string | null) => String(d || '').split('T')[0];
const dmy = (d?: string | null) => {
  const [y, m, dd] = isoDay(d).split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : '—';
};
const timeOf = (d?: string | null) => {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t.getTime()) ? '' : t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};
const statusLabel = (s: string) => {
  const u = (s || '').trim().toUpperCase();
  if (u === 'ACTIVE') return 'Running';
  if (u === 'CLOSED') return 'Closed';
  if (u.startsWith('NPA')) return 'NPA Closed';
  return s || '';
};

const KIND_NOTE: Record<EntryKind, string> = {
  CASHBOOK: 'Day Book entry',
  CAPITAL: 'Capital entry',
  LOAN_ISSUE: 'Loan issue: edited in the Edit Loan screen',
  NPA: 'NPA close: view only',
  RECEIPT: 'Loan receipt: editing recalculates the whole loan',
  OTHER: 'View only',
};

// Same look as the Day Book screen
const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold uppercase shadow-2xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_DARK = `${BTN_BASE} bg-slate-900 hover:bg-slate-800 text-white`;
const BTN_LIGHT = `${BTN_BASE} bg-slate-100 hover:bg-slate-200 text-slate-800`;
const LABEL = 'block text-[12px] font-bold uppercase text-slate-700 mb-1';
const OVERLAY = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
const PANEL = 'bg-white rounded-xl w-full flex flex-col shadow-lg border border-slate-200';
const DIALOG_HEAD = 'px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3';
const DIALOG_TITLE = 'text-[15px] font-black uppercase text-slate-900 tracking-wide';
const DIALOG_FOOT = 'px-5 py-3 border-t border-slate-200 flex justify-end gap-2';

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className='text-[10px] font-black uppercase tracking-wider text-slate-500'>{label}</div>
    <div className='text-sm font-bold text-slate-900 break-words mt-0.5'>{value || '—'}</div>
  </div>
);

const FinanceEditEntry: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const username = user?.username || 'Staff';
  const canDelete = !!user?.is_admin || !!user?.features?.includes('finance_delete_entry');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(LOAD_STEP);
  const [accounts, setAccounts] = useState<FinanceCashbookAccount[]>([]);

  // Filters
  const [fDate, setFDate] = useState('');
  const [fCustomer, setFCustomer] = useState('');
  const [fHead, setFHead] = useState('');
  const [fLoan, setFLoan] = useState('');
  const [fOperator, setFOperator] = useState('');
  const [fParticulars, setFParticulars] = useState('');
  const [fCredit, setFCredit] = useState('');
  const [fDebit, setFDebit] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [fStatus, setFStatus] = useState('');

  // Dialogs
  const [viewRow, setViewRow] = useState<Row | null>(null);
  const [formRow, setFormRow] = useState<Row | null>(null);
  const [form, setForm] = useState({ date: '', head: '', accountNo: '', particulars: '', credit: '', debit: '' });
  const [receiptRow, setReceiptRow] = useState<Row | null>(null);
  const [receiptTx, setReceiptTx] = useState<any>(null);
  const [rcForm, setRcForm] = useState({ amount: '', date: '', receiptNo: '', reason: '' });
  const [preview, setPreview] = useState<ReceiptPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteTx, setDeleteTx] = useState<any>(null);
  const [deletePreview, setDeletePreview] = useState<ReceiptPreview | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [oldest, loansRes, accs] = await Promise.all([
        dailyFinancialTransactionService.getOldestTransactionDate(),
        supabase.from('finance_loans').select('id, loan_id, status'),
        supabaseFinance.getCashbookAccounts()
      ]);
      setAccounts(accs);
      const byNo = new Map<string, { id: string; status: string }>();
      (loansRes.data || []).forEach((l: any) => byNo.set(l.loan_id, { id: l.id, status: l.status }));
      const txs = await dailyFinancialTransactionService.getDailyFinancialTransactions({
        fromDate: oldest || '2000-01-01',
        toDate: getLocalBusinessDateISO(),
        financeMode: 'REGULAR'
      });
      const list: Row[] = txs.map(t => {
        const loan = t.accountOrLoanNo ? byNo.get(t.accountOrLoanNo) : undefined;
        return {
          ...t,
          kind: classifyEntry(t),
          loanUuid: loan?.id || null,
          loanStatus: loan?.status || ''
        };
      });
      list.sort((a, b) =>
        isoDay(b.transactionDate).localeCompare(isoDay(a.transactionDate))
        || new Date(b.entryTime || b.createdAt || 0).getTime() - new Date(a.entryTime || a.createdAt || 0).getTime());
      setRows(list);
    } catch (e: any) {
      console.error('Failed to load finance entries:', e);
      toast.error('Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const options = useMemo(() => {
    const uniq = (get: (r: Row) => string | null | undefined, label?: (v: string) => string) =>
      [...new Set(rows.map(get).filter(Boolean) as string[])].sort().map(v => ({ value: v, label: label ? label(v) : v }));
    return {
      customers: uniq(r => r.customerName),
      heads: uniq(r => r.headOfAccount, displayHeadName),
      loans: uniq(r => (r.loanUuid ? r.accountOrLoanNo : null)),
      operators: uniq(r => r.userName),
      particulars: uniq(r => r.particulars, displayHeadText),
      credits: uniq(r => (r.credit > 0 ? String(r.credit) : null), v => fmt(Number(v))),
      debits: uniq(r => (r.debit > 0 ? String(r.debit) : null), v => fmt(Number(v))),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return rows.filter(r => {
      if (fDate && isoDay(r.transactionDate) !== fDate) return false;
      if (fCustomer && r.customerName !== fCustomer) return false;
      if (fHead && r.headOfAccount !== fHead) return false;
      if (fLoan && r.accountOrLoanNo !== fLoan) return false;
      if (fOperator && r.userName !== fOperator) return false;
      if (fParticulars && r.particulars !== fParticulars) return false;
      if (fCredit && String(r.credit) !== fCredit) return false;
      if (fDebit && String(r.debit) !== fDebit) return false;
      if (fStatus) {
        if (fStatus === 'DAYBOOK' && r.kind !== 'CASHBOOK') return false;
        if (fStatus === 'CAPITAL' && r.kind !== 'CAPITAL') return false;
        if (['Running', 'Closed', 'NPA Closed'].includes(fStatus) && statusLabel(r.loanStatus) !== fStatus) return false;
      }
      if (q) {
        const hay = [r.customerName, r.accountOrLoanNo, r.receiptOrVoucherNo, r.particulars, displayHeadName(r.headOfAccount), r.userName]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, fDate, fCustomer, fHead, fLoan, fOperator, fParticulars, fCredit, fDebit, fSearch, fStatus]);

  const filteredTotals = useMemo(
    () => filtered.reduce((t, r) => ({ credit: t.credit + (r.credit || 0), debit: t.debit + (r.debit || 0) }), { credit: 0, debit: 0 }),
    [filtered]
  );

  useEffect(() => { setVisible(LOAD_STEP); }, [filtered.length]);

  const clearFilters = () => {
    setFDate(''); setFCustomer(''); setFHead(''); setFLoan(''); setFOperator('');
    setFParticulars(''); setFCredit(''); setFDebit(''); setFSearch(''); setFStatus('');
  };

  // --- Open the right editor for a row ---
  const openEdit = async (r: Row) => {
    setViewRow(null);
    if (r.kind === 'LOAN_ISSUE') {
      navigate('/finance/edit-loan-entry');
      return;
    }
    if (r.kind === 'CASHBOOK' || r.kind === 'CAPITAL') {
      setForm({
        date: isoDay(r.transactionDate), head: r.headOfAccount || '', accountNo: r.accountOrLoanNo === '—' ? '' : (r.accountOrLoanNo || ''),
        particulars: r.particulars || '', credit: r.credit ? String(r.credit) : '', debit: r.debit ? String(r.debit) : ''
      });
      setFormRow(r);
      return;
    }
    if (r.kind === 'RECEIPT' && r.loanUuid && r.receiptOrVoucherNo) {
      const tx = await findReceiptTx(r.loanUuid, r.receiptOrVoucherNo);
      if (!tx) {
        toast.error('No payment is saved for this receipt, so it can only be viewed.');
        setViewRow(r);
        return;
      }
      setReceiptTx(tx);
      setReceiptRow(r);
      setRcForm({ amount: String(tx.amount), date: isoDay(tx.date), receiptNo: tx.receipt_no || '', reason: '' });
      setPreview(null);
    }
  };

  // Live preview of what a receipt change does
  useEffect(() => {
    if (!receiptRow || !receiptTx || !receiptRow.loanUuid) return;
    let alive = true;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const p = await previewReceiptChange(receiptRow.loanUuid as string, {
          txId: receiptTx.id, newAmount: parseFloat(rcForm.amount), newDate: rcForm.date, newReceiptNo: rcForm.receiptNo
        });
        if (alive) setPreview(p);
      } catch (e) {
        console.error(e);
      } finally {
        if (alive) setPreviewing(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [receiptRow, receiptTx, rcForm.amount, rcForm.date, rcForm.receiptNo]);

  const saveForm = async () => {
    if (!formRow) return;
    const credit = parseFloat(form.credit) || 0;
    const debit = parseFloat(form.debit) || 0;
    if (!form.date) { toast.error('Date is required'); return; }
    if ((credit > 0) === (debit > 0)) { toast.error('Enter either Credit or Debit (one of them)'); return; }
    if (!form.particulars.trim()) { toast.error('Particulars is required'); return; }
    setSaving(true);
    try {
      if (formRow.kind === 'CASHBOOK') {
        await saveCashbookEdit(formRow.sourceRecordId, {
          entry_date: form.date, head_of_account: form.head, account_number: form.accountNo || null,
          particulars: form.particulars.trim(), credit, debit
        }, username);
      } else {
        await saveCapitalEdit(formRow.sourceRecordId, { entry_date: form.date, particulars: form.particulars.trim(), credit, debit }, username);
      }
      toast.success('Entry updated');
      setFormRow(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const saveReceipt = async () => {
    if (!receiptRow?.loanUuid || !receiptTx || !preview?.ok) return;
    if (!rcForm.reason.trim()) { toast.error('Reason is required'); return; }
    setSaving(true);
    try {
      await saveReceiptEdit({
        loanId: receiptRow.loanUuid, txId: receiptTx.id, newAmount: parseFloat(rcForm.amount), newDate: rcForm.date,
        newReceiptNo: rcForm.receiptNo, reason: rcForm.reason, username
      });
      toast.success('Receipt updated and loan recalculated');
      setReceiptRow(null);
      setReceiptTx(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = async (r: Row) => {
    setDeleteReason('');
    setDeletePreview(null);
    setDeleteTx(null);
    if (r.kind === 'RECEIPT' && r.loanUuid && r.receiptOrVoucherNo) {
      const tx = await findReceiptTx(r.loanUuid, r.receiptOrVoucherNo);
      if (!tx) { toast.error('No payment is saved for this receipt.'); return; }
      setDeleteTx(tx);
      setDeletePreview(await previewReceiptChange(r.loanUuid, { txId: tx.id, deleted: true }));
    }
    setDeleteRow(r);
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    setSaving(true);
    try {
      const row = { date: isoDay(deleteRow.transactionDate), amount: Math.max(deleteRow.credit, deleteRow.debit) };
      if (deleteRow.kind === 'CASHBOOK') await deleteCashbook(deleteRow.sourceRecordId, row, username);
      else if (deleteRow.kind === 'CAPITAL') await deleteCapital(deleteRow.sourceRecordId, row, username);
      else if (deleteRow.kind === 'RECEIPT' && deleteRow.loanUuid && deleteTx) {
        if (!deleteReason.trim()) { toast.error('Reason is required'); setSaving(false); return; }
        await deleteReceipt({ loanId: deleteRow.loanUuid, txId: deleteTx.id, reason: deleteReason, username });
      }
      toast.success('Entry deleted');
      setDeleteRow(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not delete. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const canEditRow = (r: Row) => ['CASHBOOK', 'CAPITAL', 'LOAN_ISSUE', 'RECEIPT'].includes(r.kind);
  const canDeleteRow = (r: Row) => canDelete && ['CASHBOOK', 'CAPITAL', 'RECEIPT'].includes(r.kind);
  const shown = filtered.slice(0, visible);

  return (
    <div className='flex flex-col gap-2 w-full max-w-[100%] mx-auto px-2 pt-1 pb-3'>
      {/* Page header */}
      <div className='flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-200'>
        <div className='flex items-center gap-2.5'>
          <div className='w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs'>
            <FileEdit className='w-4 h-4 text-amber-400' />
          </div>
          <div>
            <h1 className='text-[16px] font-black uppercase text-slate-900 tracking-wide leading-none'>Edit Entry</h1>
            <p className='text-[11px] text-slate-600 font-semibold mt-0.5'>Edit and manage all finance entries, with complete history tracking</p>
          </div>
        </div>
        <button type='button' className={BTN_DARK} onClick={async () => { await load(); toast.success('Data refreshed!'); }}>
          <RefreshCw className='w-4 h-4' /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className='bg-white border border-slate-200 rounded-xl p-2 shadow-2xs'>
        <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 w-full'>
          <div>
            <label className={LABEL}>Date</label>
            <FinanceSmartCalendar value={fDate} onChange={setFDate} module='DAY_BOOK' placeholder='dd/MM/yyyy' allowClear />
          </div>
          <div><label className={LABEL}>Customer</label><SearchableSelect value={fCustomer} onChange={setFCustomer} options={options.customers} placeholder='All' /></div>
          <div><label className={LABEL}>Head of Account</label><SearchableSelect value={fHead} onChange={setFHead} options={options.heads} placeholder='All' /></div>
          <div><label className={LABEL}>CD / Loan No</label><SearchableSelect value={fLoan} onChange={setFLoan} options={options.loans} placeholder='All' /></div>
          <div><label className={LABEL}>Operator</label><SearchableSelect value={fOperator} onChange={setFOperator} options={options.operators} placeholder='All' /></div>
          <div><label className={LABEL}>Particulars</label><SearchableSelect value={fParticulars} onChange={setFParticulars} options={options.particulars} placeholder='All' /></div>
          <div><label className={LABEL}>Credit</label><SearchableSelect value={fCredit} onChange={setFCredit} options={options.credits} placeholder='All' /></div>
          <div><label className={LABEL}>Debit</label><SearchableSelect value={fDebit} onChange={setFDebit} options={options.debits} placeholder='All' /></div>
          <div><label className={LABEL}>Status</label><SearchableSelect
            value={fStatus}
            onChange={setFStatus}
            options={[
              { value: '', label: 'All' },
              { value: 'Running', label: 'Running Loans' },
              { value: 'Closed', label: 'Closed Loans' },
              { value: 'NPA Closed', label: 'NPA Closed' },
              { value: 'DAYBOOK', label: 'Day Book Entries' },
              { value: 'CAPITAL', label: 'Capital Entries' },
            ]}
            placeholder='All'
          /></div>
          <div className='flex items-end gap-2'>
            <div className='relative flex-1 min-w-0'>
              <Search className='w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400' />
              <input
                type='text'
                placeholder='Search entries...'
                aria-label='Search entries'
                value={fSearch}
                onChange={e => setFSearch(e.target.value)}
                className='w-full pl-8 pr-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white'
              />
            </div>
            <button type='button' className={`${BTN_LIGHT} shrink-0`} onClick={clearFilters}>
              <RotateCcw className='w-3.5 h-3.5' /> Clear
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className='bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden'>
        <div className='px-3 py-2 border-b border-slate-200 bg-slate-100/90 flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <span className='text-xs font-black uppercase text-slate-900 tracking-wider'>Finance Entries</span>
            <span className='text-[10px] font-black uppercase px-2 py-0.5 bg-slate-900 text-white rounded font-mono'>
              {filtered.length.toLocaleString('en-IN')} {filtered.length === 1 ? 'Record' : 'Records'}
            </span>
          </div>
          <div className='flex items-center gap-4 text-xs font-mono font-black text-slate-800'>
            <span>Filtered Credit: <strong className='text-emerald-700'>{fmt2(filteredTotals.credit)}</strong></span>
            <span>Filtered Debit: <strong className='text-rose-700'>{fmt2(filteredTotals.debit)}</strong></span>
          </div>
        </div>

        {loading ? (
          <div className='flex justify-center py-16 bg-white'>
            <div className='animate-spin rounded-full h-8 w-8 border-t-2 border-slate-900' />
          </div>
        ) : shown.length === 0 ? (
          <div className='px-3 py-12 text-center text-slate-500 font-extrabold'>No entries found matching your criteria.</div>
        ) : (
          <div className='overflow-y-auto w-full' style={{ maxHeight: 'calc(100vh - 340px)', minHeight: 320 }}>
            <table data-no-load-more className='fit-table w-full divide-y divide-slate-200'>
              <thead className='sticky top-0 z-10 bg-slate-200 shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)]'>
                <tr className='text-slate-950 uppercase font-black tracking-wider'>
                  <th className='px-1 py-2.5 text-center border-r border-slate-300'>#</th>
                  <th className='px-1.5 py-2.5 text-left border-r border-slate-300'>Date</th>
                  <th className='px-2 py-2.5 text-left border-r border-slate-300'>Customer</th>
                  <th className='px-1.5 py-2.5 text-left border-r border-slate-300'>Head of Account</th>
                  <th className='px-1.5 py-2.5 text-left border-r border-slate-300'>CD / Loan No</th>
                  <th className='px-2 py-2.5 text-left border-r border-slate-300'>Particulars</th>
                  <th className='px-1.5 py-2.5 text-right border-r border-slate-300 text-emerald-950 bg-emerald-100/60'>Credit</th>
                  <th className='px-1.5 py-2.5 text-right border-r border-slate-300 text-rose-950 bg-rose-100/60'>Debit</th>
                  <th className='px-1.5 py-2.5 text-left border-r border-slate-300'>Operator</th>
                  <th className='px-1.5 py-2.5 text-left border-r border-slate-300'>Entry Date and Time</th>
                  <th className='px-1.5 py-2.5 text-center'>Actions</th>
                </tr>
              </thead>
              <tbody className='bg-white divide-y divide-slate-200'>
                {shown.map((r, i) => (
                  <tr key={r.id} className={`transition-colors ${r.kind === 'NPA' ? 'bg-rose-50 hover:bg-rose-100/60' : 'hover:bg-slate-50/90'}`}>
                    <td className='fit-nowrap px-1 py-2 text-center border-r border-slate-100 text-slate-500 font-bold'>{i + 1}</td>
                    <td className='fit-nowrap px-1.5 py-2 border-r border-slate-100 font-bold text-slate-900'>{dmy(r.transactionDate)}</td>
                    <td className='fit-name px-2 py-2 border-r border-slate-100 font-black text-slate-950'>{r.customerName || '—'}</td>
                    <td className='px-1.5 py-2 border-r border-slate-100 font-bold text-slate-800'>{r.displayType || displayHeadName(r.headOfAccount)}</td>
                    <td className='fit-nowrap px-1.5 py-2 border-r border-slate-100 font-mono font-black text-slate-900'>{r.loanUuid ? r.accountOrLoanNo : (r.accountOrLoanNo && r.accountOrLoanNo !== '—' ? r.accountOrLoanNo : '—')}</td>
                    <td className='fit-particulars px-2 py-2 border-r border-slate-100 font-semibold text-slate-700'>{displayHeadText(r.particulars) || '—'}</td>
                    <td className='fit-nowrap px-1.5 py-2 text-right border-r border-slate-100 font-mono font-black text-emerald-700 tabular-nums'>{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                    <td className='fit-nowrap px-1.5 py-2 text-right border-r border-slate-100 font-mono font-black text-rose-700 tabular-nums'>{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className='px-1.5 py-2 border-r border-slate-100 font-bold text-slate-700'>{r.userName || '-'}</td>
                    <td className='fit-nowrap px-1.5 py-2 border-r border-slate-100'>
                      <div className='font-bold text-slate-900'>{dmy(r.entryTime || r.createdAt || r.transactionDate)}</div>
                      <div className='text-slate-500 font-bold'>{timeOf(r.entryTime || r.createdAt)}</div>
                    </td>
                    <td className='fit-nowrap px-1.5 py-2 text-center'>
                      <div className='inline-flex gap-1 justify-center items-center'>
                        <button type='button' className='rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300' onClick={() => setViewRow(r)} title='View Record' aria-label='View Record'>
                          <Eye />
                        </button>
                        {canEditRow(r) && (
                          <button type='button' className='rounded bg-slate-900 hover:bg-slate-800 text-white border border-slate-900' onClick={() => openEdit(r)} title={r.kind === 'LOAN_ISSUE' ? 'Open in Edit Loan' : 'Edit Record'} aria-label='Edit Record'>
                            <Edit />
                          </button>
                        )}
                        {canDeleteRow(r) && (
                          <button type='button' className='rounded bg-rose-600 hover:bg-rose-700 text-white border border-rose-600' onClick={() => openDelete(r)} title='Delete Record' aria-label='Delete Record'>
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMoreBar shown={shown.length} total={filtered.length} onMore={() => setVisible(v => v + LOAD_STEP)} onRefresh={() => setVisible(LOAD_STEP)} />
          </div>
        )}
      </div>

      {/* View dialog */}
      {viewRow && (
        <div className={OVERLAY}>
          <div className={`${PANEL} max-w-4xl max-h-[90vh]`}>
            <div className={DIALOG_HEAD}>
              <h3 className={DIALOG_TITLE}>View Entry</h3>
              <div className='flex items-center gap-2'>
                {canEditRow(viewRow) && <button type='button' className={BTN_DARK} onClick={() => openEdit(viewRow)}><Edit className='w-4 h-4' /> Edit</button>}
                <button type='button' className={BTN_LIGHT} onClick={() => setViewRow(null)}>Close</button>
              </div>
            </div>
            <div className='p-5 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-4'>
              <Field label='Date' value={dmy(viewRow.transactionDate)} />
              <Field label='Customer' value={viewRow.customerName} />
              <Field label='Head of Account' value={viewRow.displayType || displayHeadName(viewRow.headOfAccount)} />
              <Field label='CD / Loan No' value={viewRow.accountOrLoanNo} />
              <Field label='Receipt No' value={viewRow.receiptOrVoucherNo} />
              <Field label='Loan Status' value={statusLabel(viewRow.loanStatus)} />
              <Field label='Credit' value={viewRow.credit > 0 ? fmt2(viewRow.credit) : '-'} />
              <Field label='Debit' value={viewRow.debit > 0 ? fmt2(viewRow.debit) : '-'} />
              <Field label='Operator' value={viewRow.userName} />
              <Field label='Entry Date and Time' value={`${dmy(viewRow.entryTime || viewRow.createdAt)} ${timeOf(viewRow.entryTime || viewRow.createdAt)}`} />
              <Field label='Type' value={KIND_NOTE[viewRow.kind]} />
              <div className='col-span-2 md:col-span-3'><Field label='Particulars' value={displayHeadText(viewRow.particulars)} /></div>
            </div>
          </div>
        </div>
      )}

      {/* Day Book / Capital edit dialog */}
      {formRow && (
        <div className={OVERLAY}>
          <div className={`${PANEL} max-w-5xl max-h-[94vh]`}>
            <div className={DIALOG_HEAD}>
              <h3 className={DIALOG_TITLE}>Edit {formRow.kind === 'CASHBOOK' ? 'Day Book' : 'Capital'} Entry</h3>
              <button type='button' className={BTN_LIGHT} onClick={() => setFormRow(null)}>Close</button>
            </div>
            {/* Tall enough that the date calendar opens inside the box */}
            <div className='p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 content-start min-h-[480px]'>
              <div>
                <label className={LABEL}>Date</label>
                <FinanceSmartCalendar value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} module='DAY_BOOK' />
              </div>
              {formRow.kind === 'CASHBOOK' ? (
                <SearchableSelect
                  label='Head of Account'
                  value={form.head}
                  onChange={v => setForm(f => ({ ...f, head: v }))}
                  options={accounts.map(a => ({ value: a.account_name, label: a.account_name }))
                    .concat(accounts.some(a => a.account_name === form.head) ? [] : [{ value: form.head, label: form.head }])}
                />
              ) : (
                <Field label='Partner' value={formRow.customerName || formRow.partnerName} />
              )}
              {/* Only one of Credit / Debit: typing in one locks the other; clearing it unlocks */}
              <Input label='Credit' value={form.credit} onChange={v => setForm(f => ({ ...f, credit: v }))} inputMode='decimal'
                disabled={form.debit.trim() !== '' && Number(form.debit) !== 0} />
              <Input label='Debit' value={form.debit} onChange={v => setForm(f => ({ ...f, debit: v }))} inputMode='decimal'
                disabled={form.credit.trim() !== '' && Number(form.credit) !== 0} />
              <div className='md:col-span-2'>
                <Input label='Particulars' value={form.particulars} onChange={v => setForm(f => ({ ...f, particulars: v }))} />
              </div>
            </div>
            <div className={DIALOG_FOOT}>
              <button type='button' className={BTN_LIGHT} onClick={() => setFormRow(null)}>Cancel</button>
              <button type='button' className={BTN_DARK} onClick={saveForm} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt edit dialog */}
      {receiptRow && receiptTx && (
        <div className={OVERLAY}>
          <div className={`${PANEL} max-w-5xl max-h-[94vh]`}>
            <div className={DIALOG_HEAD}>
              <div>
                <h3 className={DIALOG_TITLE}>Edit Receipt {receiptTx.receipt_no}</h3>
                <p className='text-[12px] text-slate-500 font-semibold mt-0.5'>{receiptRow.accountOrLoanNo} · {receiptRow.customerName}</p>
              </div>
              <button type='button' className={BTN_LIGHT} onClick={() => { setReceiptRow(null); setReceiptTx(null); }}>Close</button>
            </div>
            <div className='p-5 overflow-y-auto space-y-4 min-h-[480px]'>
              <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                <Input label='Total Amount Paid' value={rcForm.amount} onChange={v => setRcForm(f => ({ ...f, amount: v }))} inputMode='decimal' />
                <div>
                  <label className={LABEL}>Payment Date</label>
                  <FinanceSmartCalendar value={rcForm.date} onChange={v => setRcForm(f => ({ ...f, date: v }))} module='DAY_BOOK' />
                </div>
                {/* Receipt numbers are made by the system, so they cannot be changed here */}
                <Input label='Receipt No' value={rcForm.receiptNo} disabled readOnly />
              </div>
              <p className='text-[13px] text-slate-600 font-semibold'>
                Penalty, interest and principal are worked out from the amount by the same rules as a new payment,
                and the whole loan is recalculated.
              </p>

              <table className='w-full text-sm border border-slate-200'>
                <thead className='bg-slate-200 text-slate-950 uppercase'>
                  <tr>
                    <th className='px-3 py-2 text-left font-black'>Part</th>
                    <th className='px-3 py-2 text-right font-black'>Now</th>
                    <th className='px-3 py-2 text-right font-black'>After this change</th>
                  </tr>
                </thead>
                <tbody className='tabular-nums font-mono'>
                  {([
                    ['Penalty', preview?.before?.penaltyPaid, preview?.after?.penaltyPaid],
                    ['Interest', preview?.before?.interestPaid, preview?.after?.interestPaid],
                    ['Principal', preview?.before?.principalPaid, preview?.after?.principalPaid],
                    ['Total', preview?.before?.amount, preview?.after?.amount],
                    ['Loan principal balance', preview?.beforePrincipal, preview?.afterPrincipal],
                  ] as [string, number | undefined, number | undefined][]).map(([label, b, a]) => {
                    const changed = preview?.ok && b !== undefined && a !== undefined && Math.abs(a - b) > 0.005;
                    return (
                      <tr key={label} className={`border-t border-slate-200 ${label === 'Total' ? 'font-black' : 'font-semibold'}`}>
                        <td className='px-3 py-1.5 font-sans'>{label}</td>
                        <td className='px-3 py-1.5 text-right'>{b === undefined ? '—' : fmt2(b)}</td>
                        <td className={`px-3 py-1.5 text-right ${changed ? 'font-black text-emerald-700' : ''}`}>{previewing || !preview?.ok || a === undefined ? '—' : fmt2(a)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {preview && preview.blockers.length > 0 && (
                <div className='border border-rose-300 bg-rose-50 text-rose-900 rounded-lg p-3 text-sm font-bold space-y-1'>
                  {preview.blockers.map((b, i) => <div key={i}>{b}</div>)}
                </div>
              )}
              {preview && preview.ok && preview.warnings.length > 0 && (
                <div className='border border-amber-300 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm font-bold space-y-1'>
                  {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              {preview?.ok && preview.laterChanged.length > 0 && (
                <table className='w-full text-sm border border-slate-200'>
                  <thead className='bg-slate-200 text-slate-950 uppercase'>
                    <tr>
                      <th className='px-3 py-2 text-left font-black'>Later receipt</th>
                      <th className='px-3 py-2 text-right font-black'>Interest + penalty now → after</th>
                      <th className='px-3 py-2 text-right font-black'>Principal now → after</th>
                    </tr>
                  </thead>
                  <tbody className='tabular-nums font-mono font-semibold'>
                    {preview.laterChanged.map(c => (
                      <tr key={c.receiptNo} className='border-t border-slate-200'>
                        <td className='px-3 py-1.5 font-black'>{c.receiptNo}</td>
                        <td className='px-3 py-1.5 text-right'>{fmt2(c.before.interestPaid + c.before.penaltyPaid)} → {fmt2(c.after.interestPaid + c.after.penaltyPaid)}</td>
                        <td className='px-3 py-1.5 text-right'>{fmt2(c.before.principalPaid)} → {fmt2(c.after.principalPaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <Input label='Reason for this change *' value={rcForm.reason} onChange={v => setRcForm(f => ({ ...f, reason: v }))} />
            </div>
            <div className={DIALOG_FOOT}>
              <button type='button' className={BTN_LIGHT} onClick={() => { setReceiptRow(null); setReceiptTx(null); }}>Cancel</button>
              <button type='button' className={BTN_DARK} onClick={saveReceipt} disabled={saving || previewing || !preview?.ok || !rcForm.reason.trim()}>
                {saving ? 'Saving…' : 'Save and Recalculate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete dialog */}
      {deleteRow && (
        <div className={OVERLAY}>
          <div className={`${PANEL} max-w-xl max-h-[90vh]`}>
            <div className='px-5 py-3 border-b border-slate-200'>
              <h3 className={DIALOG_TITLE}>
                {deleteRow.kind === 'RECEIPT' ? `Delete whole receipt ${deleteTx?.receipt_no}` : 'Delete Entry'}
              </h3>
              <p className='text-[12px] text-slate-500 font-semibold mt-0.5'>{deleteRow.accountOrLoanNo} · {deleteRow.customerName || displayHeadName(deleteRow.headOfAccount)}</p>
            </div>
            <div className='p-5 overflow-y-auto space-y-3 text-sm font-semibold text-slate-800'>
              {deleteRow.kind === 'RECEIPT' ? (
                <>
                  <p>This removes the full payment of <strong>{fmt2(Number(deleteTx?.amount))}</strong> and recalculates the whole loan. It can be restored from Edited / Deleted Entry.</p>
                  {deletePreview && deletePreview.blockers.length > 0 && (
                    <div className='border border-rose-300 bg-rose-50 text-rose-900 rounded-lg p-3 font-bold space-y-1'>
                      {deletePreview.blockers.map((b, i) => <div key={i}>{b}</div>)}
                    </div>
                  )}
                  {deletePreview?.ok && (
                    <div className='border border-amber-300 bg-amber-50 text-amber-900 rounded-lg p-3 font-bold space-y-1'>
                      <div>Principal balance: {fmt2(deletePreview.beforePrincipal)} → {fmt2(deletePreview.afterPrincipal)}</div>
                      {deletePreview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                  )}
                  <Input label='Reason for deleting *' value={deleteReason} onChange={setDeleteReason} />
                </>
              ) : (
                <p>Delete this entry of <strong>{fmt2(Math.max(deleteRow.credit, deleteRow.debit))}</strong>? It can be restored from Edited / Deleted Entry.</p>
              )}
            </div>
            <div className={DIALOG_FOOT}>
              <button type='button' className={BTN_LIGHT} onClick={() => setDeleteRow(null)}>Cancel</button>
              <button
                type='button'
                className='inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-extrabold uppercase shadow-2xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                onClick={confirmDelete}
                disabled={saving || (deleteRow.kind === 'RECEIPT' && (!deletePreview?.ok || !deleteReason.trim()))}
              >
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceEditEntry;
