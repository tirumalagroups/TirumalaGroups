import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit, Eye, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
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

const PAGE_SIZE = 100;
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

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className='text-xs font-medium text-gray-500'>{label}</div>
    <div className='text-sm font-semibold text-gray-900 break-words'>{value || '—'}</div>
  </div>
);

const FinanceEditEntry: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const username = user?.username || 'Staff';
  const canDelete = !!user?.is_admin || !!user?.features?.includes('finance_delete_entry');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(PAGE_SIZE);
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

  useEffect(() => { setVisible(PAGE_SIZE); }, [filtered.length]);

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
    <div className='w-full'>
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6'>
        <div>
          <h1 className='text-3xl font-bold text-gray-900'>Edit Form</h1>
          <p className='text-gray-600 mt-1'>Edit and manage all finance entries, with complete history tracking</p>
        </div>
        <Button variant='secondary' onClick={async () => { await load(); toast.success('Data refreshed!'); }}>Refresh</Button>
      </div>

      {/* Filters */}
      <Card className='bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 p-6 mb-6'>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 w-full'>
          <div className='col-span-1'>
            <label className='block text-xs font-medium text-gray-700 mb-1'>Date</label>
            <FinanceSmartCalendar value={fDate} onChange={setFDate} module='DAY_BOOK' placeholder='dd/MM/yyyy' allowClear />
          </div>
          <div className='col-span-1'><SearchableSelect label='Customer' value={fCustomer} onChange={setFCustomer} options={options.customers} placeholder='All' /></div>
          <div className='col-span-1'><SearchableSelect label='Head of Account' value={fHead} onChange={setFHead} options={options.heads} placeholder='All' /></div>
          <div className='col-span-1'><SearchableSelect label='CD / Loan No' value={fLoan} onChange={setFLoan} options={options.loans} placeholder='All' /></div>
          <div className='col-span-1'><SearchableSelect label='Operator' value={fOperator} onChange={setFOperator} options={options.operators} placeholder='All' /></div>
          <div className='col-span-1'><SearchableSelect label='Particulars' value={fParticulars} onChange={setFParticulars} options={options.particulars} placeholder='All' /></div>
          <div className='col-span-1'><SearchableSelect label='Credit' value={fCredit} onChange={setFCredit} options={options.credits} placeholder='All' /></div>
          <div className='col-span-1'><SearchableSelect label='Debit' value={fDebit} onChange={setFDebit} options={options.debits} placeholder='All' /></div>
          <div className='col-span-1'><Input label='Search' value={fSearch} onChange={setFSearch} placeholder='Search entries...' /></div>
          <div className='col-span-1'>
            <SearchableSelect
              label='Status Filter'
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
            />
          </div>
          <div className='col-span-1 flex items-end'>
            <Button onClick={clearFilters} variant='secondary' className='w-full'>Clear Filters</Button>
          </div>
          <div className='col-span-1 flex items-end'>
            <div className='w-full text-center text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg py-2'>
              {filtered.length.toLocaleString('en-IN')} entries found
            </div>
          </div>
          <div className='col-span-1 flex items-end'>
            <Button variant='secondary' icon={RefreshCw} onClick={load}>Refresh</Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card title='Finance Entries' subtitle='Manage and edit your finance transaction records' className='p-0'>
        {loading ? (
          <div className='text-center py-10 text-gray-500'>Loading entries…</div>
        ) : shown.length === 0 ? (
          <div className='text-center py-8 text-gray-500'>No entries found matching your criteria.</div>
        ) : (
          <div className='w-full'>
            <table className='fit-table'>
              <thead className='bg-gray-50 border-b border-gray-200'>
                <tr>
                  <th className='py-1 text-left font-medium text-gray-700'>S.No</th>
                  <th className='py-1 text-left font-medium text-gray-700'>Date</th>
                  <th className='py-1 text-left font-medium text-gray-700'>Customer</th>
                  <th className='py-1 text-left font-medium text-gray-700'>Head of Account</th>
                  <th className='py-1 text-left font-medium text-gray-700'>CD / Loan No</th>
                  <th className='py-1 text-left font-medium text-gray-700'>Particulars</th>
                  <th className='py-1 text-right font-medium text-gray-700'>Credit</th>
                  <th className='py-1 text-right font-medium text-gray-700'>Debit</th>
                  <th className='py-1 text-left font-medium text-gray-700'>Operator</th>
                  <th className='py-1 text-left font-medium text-gray-700'>Entry Date and Time</th>
                  <th className='py-1 text-center font-medium text-gray-700'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} className={`border-b hover:bg-gray-50 transition-colors ${r.kind === 'NPA' ? 'bg-red-50' : ''}`}>
                    <td className='py-1 font-bold fit-nowrap'>{i + 1}</td>
                    <td className='py-1 font-bold fit-nowrap'>{dmy(r.transactionDate)}</td>
                    <td className='py-1 font-bold text-blue-600 fit-name'>{r.customerName || '—'}</td>
                    <td className='py-1 font-bold'>{r.displayType || displayHeadName(r.headOfAccount)}</td>
                    <td className='py-1 font-bold fit-nowrap'>{r.loanUuid ? r.accountOrLoanNo : (r.accountOrLoanNo && r.accountOrLoanNo !== '—' ? r.accountOrLoanNo : '—')}</td>
                    <td className='py-1 font-bold fit-particulars'>{displayHeadText(r.particulars) || '—'}</td>
                    <td className='py-1 text-right font-bold text-green-600 fit-nowrap tabular-nums'>{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                    <td className='py-1 text-right font-bold text-red-600 fit-nowrap tabular-nums'>{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className='py-1 font-bold'>{r.userName || '-'}</td>
                    <td className='py-1 text-left fit-nowrap'>
                      <div className='font-bold'>{dmy(r.entryTime || r.createdAt || r.transactionDate)}</div>
                      <div className='text-gray-500 font-bold'>{timeOf(r.entryTime || r.createdAt)}</div>
                    </td>
                    <td className='py-1 text-center fit-nowrap'>
                      <div className='inline-flex gap-1 justify-center items-center'>
                        <Button variant='secondary' onClick={() => setViewRow(r)} title='View Record'>
                          <Eye className='text-gray-700' />
                        </Button>
                        {canEditRow(r) && (
                          <Button onClick={() => openEdit(r)} title={r.kind === 'LOAN_ISSUE' ? 'Open in Edit Loan' : 'Edit Record'}>
                            <Edit className='text-white' />
                          </Button>
                        )}
                        {canDeleteRow(r) && (
                          <Button variant='danger' onClick={() => openDelete(r)} title='Delete Record'>
                            <Trash2 className='text-white' />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > visible && (
              <div className='text-center py-4'>
                <Button variant='secondary' onClick={() => setVisible(v => v + PAGE_SIZE)}>
                  Load More ({(filtered.length - visible).toLocaleString('en-IN')} more)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* View dialog */}
      {viewRow && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-lg'>
            <div className='p-6 border-b border-gray-200 flex items-center justify-between'>
              <h3 className='text-lg font-semibold'>View Entry</h3>
              <div className='flex items-center gap-2'>
                {canEditRow(viewRow) && <Button size='sm' icon={Edit} onClick={() => openEdit(viewRow)}>Edit</Button>}
                <Button size='sm' variant='secondary' onClick={() => setViewRow(null)}>Close</Button>
              </div>
            </div>
            <div className='p-6 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-4'>
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
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col shadow-lg'>
            <div className='p-6 border-b border-gray-200 flex items-center justify-between'>
              <h3 className='text-lg font-semibold'>Edit {formRow.kind === 'CASHBOOK' ? 'Day Book' : 'Capital'} Entry</h3>
              <Button size='sm' variant='secondary' onClick={() => setFormRow(null)}>Close</Button>
            </div>
            <div className='p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4'>
              <div>
                <label className='block text-xs font-medium text-gray-700 mb-1'>Date</label>
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
              <Input label='Credit' value={form.credit} onChange={v => setForm(f => ({ ...f, credit: v }))} inputMode='decimal' />
              <Input label='Debit' value={form.debit} onChange={v => setForm(f => ({ ...f, debit: v }))} inputMode='decimal' />
              <div className='md:col-span-2'>
                <Input label='Particulars' value={form.particulars} onChange={v => setForm(f => ({ ...f, particulars: v }))} />
              </div>
            </div>
            <div className='p-4 border-t border-gray-200 flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => setFormRow(null)}>Cancel</Button>
              <Button onClick={saveForm} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt edit dialog */}
      {receiptRow && receiptTx && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-4xl w-full max-h-[92vh] flex flex-col shadow-lg'>
            <div className='p-6 border-b border-gray-200 flex items-center justify-between'>
              <div>
                <h3 className='text-lg font-semibold'>Edit Receipt {receiptTx.receipt_no}</h3>
                <p className='text-sm text-gray-600'>{receiptRow.accountOrLoanNo} · {receiptRow.customerName}</p>
              </div>
              <Button size='sm' variant='secondary' onClick={() => { setReceiptRow(null); setReceiptTx(null); }}>Close</Button>
            </div>
            <div className='p-6 overflow-y-auto space-y-4'>
              <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                <Input label='Total Amount Paid' value={rcForm.amount} onChange={v => setRcForm(f => ({ ...f, amount: v }))} inputMode='decimal' />
                <div>
                  <label className='block text-xs font-medium text-gray-700 mb-1'>Payment Date</label>
                  <FinanceSmartCalendar value={rcForm.date} onChange={v => setRcForm(f => ({ ...f, date: v }))} module='DAY_BOOK' />
                </div>
                <Input label='Receipt No' value={rcForm.receiptNo} onChange={v => setRcForm(f => ({ ...f, receiptNo: v }))} />
              </div>
              <p className='text-sm text-gray-600'>
                Penalty, interest and principal are worked out from the amount by the same rules as a new payment,
                and the whole loan is recalculated.
              </p>

              <table className='w-full text-sm border border-gray-200'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='px-3 py-2 text-left'>Part</th>
                    <th className='px-3 py-2 text-right'>Now</th>
                    <th className='px-3 py-2 text-right'>After this change</th>
                  </tr>
                </thead>
                <tbody className='tabular-nums'>
                  {([
                    ['Penalty', preview?.before?.penaltyPaid, preview?.after?.penaltyPaid],
                    ['Interest', preview?.before?.interestPaid, preview?.after?.interestPaid],
                    ['Principal', preview?.before?.principalPaid, preview?.after?.principalPaid],
                    ['Total', preview?.before?.amount, preview?.after?.amount],
                    ['Loan principal balance', preview?.beforePrincipal, preview?.afterPrincipal],
                  ] as [string, number | undefined, number | undefined][]).map(([label, b, a]) => {
                    const changed = preview?.ok && b !== undefined && a !== undefined && Math.abs(a - b) > 0.005;
                    return (
                      <tr key={label} className={`border-t ${label === 'Total' ? 'font-bold' : ''}`}>
                        <td className='px-3 py-1.5'>{label}</td>
                        <td className='px-3 py-1.5 text-right'>{b === undefined ? '—' : fmt2(b)}</td>
                        <td className={`px-3 py-1.5 text-right ${changed ? 'font-bold text-blue-700' : ''}`}>{previewing || !preview?.ok || a === undefined ? '—' : fmt2(a)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {preview && preview.blockers.length > 0 && (
                <div className='border border-red-200 bg-red-50 text-red-800 rounded-lg p-3 text-sm font-medium space-y-1'>
                  {preview.blockers.map((b, i) => <div key={i}>{b}</div>)}
                </div>
              )}
              {preview && preview.ok && preview.warnings.length > 0 && (
                <div className='border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm font-medium space-y-1'>
                  {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              {preview?.ok && preview.laterChanged.length > 0 && (
                <table className='w-full text-sm border border-gray-200'>
                  <thead className='bg-gray-50'>
                    <tr>
                      <th className='px-3 py-2 text-left'>Later receipt</th>
                      <th className='px-3 py-2 text-right'>Interest + penalty now → after</th>
                      <th className='px-3 py-2 text-right'>Principal now → after</th>
                    </tr>
                  </thead>
                  <tbody className='tabular-nums'>
                    {preview.laterChanged.map(c => (
                      <tr key={c.receiptNo} className='border-t'>
                        <td className='px-3 py-1.5 font-medium'>{c.receiptNo}</td>
                        <td className='px-3 py-1.5 text-right'>{fmt2(c.before.interestPaid + c.before.penaltyPaid)} → {fmt2(c.after.interestPaid + c.after.penaltyPaid)}</td>
                        <td className='px-3 py-1.5 text-right'>{fmt2(c.before.principalPaid)} → {fmt2(c.after.principalPaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <Input label='Reason for this change *' value={rcForm.reason} onChange={v => setRcForm(f => ({ ...f, reason: v }))} />
            </div>
            <div className='p-4 border-t border-gray-200 flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => { setReceiptRow(null); setReceiptTx(null); }}>Cancel</Button>
              <Button onClick={saveReceipt} disabled={saving || previewing || !preview?.ok || !rcForm.reason.trim()}>
                {saving ? 'Saving…' : 'Save and Recalculate'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete dialog */}
      {deleteRow && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
          <div className='bg-white rounded-lg max-w-xl w-full max-h-[90vh] flex flex-col shadow-lg'>
            <div className='p-6 border-b border-gray-200'>
              <h3 className='text-lg font-semibold'>
                {deleteRow.kind === 'RECEIPT' ? `Delete whole receipt ${deleteTx?.receipt_no}` : 'Delete Entry'}
              </h3>
              <p className='text-sm text-gray-600'>{deleteRow.accountOrLoanNo} · {deleteRow.customerName || displayHeadName(deleteRow.headOfAccount)}</p>
            </div>
            <div className='p-6 overflow-y-auto space-y-3 text-sm'>
              {deleteRow.kind === 'RECEIPT' ? (
                <>
                  <p>This removes the full payment of <strong>{fmt2(Number(deleteTx?.amount))}</strong> and recalculates the whole loan. It can be restored from Edited / Deleted Logs.</p>
                  {deletePreview && deletePreview.blockers.length > 0 && (
                    <div className='border border-red-200 bg-red-50 text-red-800 rounded-lg p-3 font-medium space-y-1'>
                      {deletePreview.blockers.map((b, i) => <div key={i}>{b}</div>)}
                    </div>
                  )}
                  {deletePreview?.ok && (
                    <div className='border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-3 font-medium space-y-1'>
                      <div>Principal balance: {fmt2(deletePreview.beforePrincipal)} → {fmt2(deletePreview.afterPrincipal)}</div>
                      {deletePreview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                  )}
                  <Input label='Reason for deleting *' value={deleteReason} onChange={setDeleteReason} />
                </>
              ) : (
                <p>Delete this entry of <strong>{fmt2(Math.max(deleteRow.credit, deleteRow.debit))}</strong>? It can be restored from Edited / Deleted Logs.</p>
              )}
            </div>
            <div className='p-4 border-t border-gray-200 flex justify-end gap-2'>
              <Button variant='secondary' onClick={() => setDeleteRow(null)}>Cancel</Button>
              <Button
                variant='danger'
                onClick={confirmDelete}
                disabled={saving || (deleteRow.kind === 'RECEIPT' && (!deletePreview?.ok || !deleteReason.trim()))}
              >
                {saving ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceEditEntry;
