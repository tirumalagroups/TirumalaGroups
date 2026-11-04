import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance, FinancePartner, FinanceCapitalEntry } from '../../lib/supabaseFinance';
import { 
  ArrowLeft, 
  Printer, 
  Save, 
  RotateCcw, 
  Trash2, 
  Edit2, 
  Info 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { validateFinanceForm, ValidationField } from '../../utils/financeValidation';
import { useAuth } from '../../contexts/AuthContext';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';

interface DisplayCapitalEntry extends FinanceCapitalEntry {
  partner?: FinancePartner;
  running_balance?: number;
}

const CapitalEntry: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Data States
  const [partners, setPartners] = useState<FinancePartner[]>([]);
  const [entries, setEntries] = useState<DisplayCapitalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Form States (New / Edit Entry)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(() => getLocalBusinessDateISO());
  const [partnerId, setPartnerId] = useState('');
  const [particulars, setParticulars] = useState('');
  const [credit, setCredit] = useState('');
  const [debit, setDebit] = useState('');
  const [saving, setSaving] = useState(false);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const dateRef = React.useRef<HTMLInputElement>(null);
  const partnerIdRef = React.useRef<HTMLSelectElement>(null);

  const creditRef = React.useRef<HTMLInputElement>(null);
  const debitRef = React.useRef<HTMLInputElement>(null);

  // Bulk Distribution States
  const [bulkCreditAmount, setBulkCreditAmount] = useState('');
  const [bulkDebitAmount, setBulkDebitAmount] = useState('');
  const [bulkPosting, setBulkPosting] = useState(false);

  // Print Preview Modal State
  const [showPrintModal, setShowPrintModal] = useState(false);

  useEffect(() => {
    fetchData();
 }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const p = await supabaseFinance.getPartners();
      setPartners(p);

      const e = await supabaseFinance.getCapitalEntries();
      setEntries(e);
   } catch (err) {
      console.error(err);
      toast.error('Failed to load capital database details');
   } finally {
      setLoading(false);
   }
 };

  // Mutually exclusive Credit/Debit inputs handlers
  const handleCreditChange = (val: string) => {
    setCredit(val);
    if (val) setDebit('');
 };

  const handleDebitChange = (val: string) => {
    setDebit(val);
    if (val) setCredit('');
 };

  const handleResetForm = () => {
    setEditingId(null);
    setDate(getLocalBusinessDateISO());
    setPartnerId('');
    setParticulars('');
    setCredit('');
    setDebit('');
 };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // Prevent double submit

    const creditAmt = Number(credit) || 0;
    const debitAmt = Number(debit) || 0;

    const fields: ValidationField[] = [
      { name: 'date', label: 'Date', value: date, required: true, ref: dateRef },
      { name: 'partnerId', label: 'Partner', value: partnerId, required: true, ref: partnerIdRef as any },
      { 
        name: 'amount_xor', 
        label: 'Credit or Debit', 
        value: 'checked', 
        required: true, 
        customValidation: () => {
          if (creditAmt > 0 && debitAmt > 0) return 'Cannot enter both Credit and Debit';
          if (creditAmt < 0 || debitAmt < 0) return 'Amount cannot be negative';
          return (creditAmt > 0 || debitAmt > 0) ? null : 'Please enter a valid Credit or Debit amount greater than zero';
       }
     }
    ];

    const { isValid, errors: valErrors } = validateFinanceForm(fields);
    if (!isValid) {
      setErrors(valErrors);
      // Focus on first error element
      const firstError = Object.keys(valErrors)[0];
      const match = fields.find(f => f.name === firstError);
      if (match && match.ref && match.ref.current) {
        match.ref.current.focus();
     }
      return;
   }

    setSaving(true);
    try {
      if (editingId) {
        await supabaseFinance.updateCapitalEntry(editingId, {
          entry_date: date,
          partner_id: partnerId,
          partner_name: partners.find(p => p.id === partnerId)?.name || '',
          particulars: particulars.trim(),
          credit: creditAmt,
          debit: debitAmt
       }, user?.username || 'Staff');
        toast.success('Capital entry updated');
     } else {
        await supabaseFinance.createCapitalEntry({
          entry_date: date,
          partner_id: partnerId,
          partner_name: partners.find(p => p.id === partnerId)?.name || '',
          particulars: particulars.trim(),
          credit: creditAmt,
          debit: debitAmt,
          created_by: user?.username || 'Staff'
       });
        toast.success('Capital entry saved');
     }

      handleResetForm();
      fetchData(); // Refresh list
   } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to save capital transaction');
   } finally {
      setSaving(false);
   }
 };

  const handleEditClick = (entry: DisplayCapitalEntry) => {
    setEditingId(entry.id);
    setDate(entry.entry_date);
    setPartnerId(entry.partner_id);
    setParticulars(entry.particulars || '');
    setCredit(entry.credit > 0 ? entry.credit.toString() : '');
    setDebit(entry.debit > 0 ? entry.debit.toString() : '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
 };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete entry "${name || 'Capital Transaction'}"?`)) return;
    try {
      await supabaseFinance.deleteCapitalEntry(id, user?.username || 'Staff');
      toast.success('Capital transaction entry deleted');
      fetchData();
   } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to delete entry');
   }
 };

  const handleBulkSubmit = async (type: 'Credit' | 'Debit') => {
    const amount = type === 'Credit' ? bulkCreditAmount : bulkDebitAmount;
    const numAmt = Number(amount) || 0;

    if (numAmt <= 0) {
      toast.error(`Please enter a valid ${type} amount greater than zero`);
      return;
   }

    if (partners.length === 0) {
      toast.error('No partners available for distribution');
      return;
   }

    if (!window.confirm(`Distribute ${numAmt.toLocaleString('en-IN')} equally as ${type} across ${partners.length} partners? (${(numAmt / partners.length).toLocaleString('en-IN', { maximumFractionDigits: 2 })} each)`)) {
      return;
   }

    setBulkPosting(true);
    try {
      const splitAmount = Number((numAmt / partners.length).toFixed(2));
      const todayStr = getLocalBusinessDateISO();

      const promises = partners.map(p => {
        return supabaseFinance.createCapitalEntry({
          entry_date: todayStr,
          partner_id: p.id,
          partner_name: p.name || '',
          particulars: `BULK ${type.toUpperCase()} DISTRIBUTION (EQUAL SPLIT)`,
          credit: type === 'Credit' ? splitAmount : 0,
          debit: type === 'Debit' ? splitAmount : 0,
          created_by: user?.username || 'Staff'
       });
     });

      await Promise.all(promises);
      toast.success(`Distributed ${numAmt.toLocaleString('en-IN')} successfully`);
      
      // Reset inputs
      if (type === 'Credit') setBulkCreditAmount('');
      else setBulkDebitAmount('');

      fetchData();
   } catch (err) {
      console.error(err);
      toast.error('Failed to post bulk distribution entries');
   } finally {
      setBulkPosting(false);
   }
 };

  // Group transactions chronologically to compute running balance correctly
  const entriesWithRunningBalance = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      // Primary sort by date
      if (a.entry_date !== b.entry_date) {
        return a.entry_date.localeCompare(b.entry_date);
     }
      // Secondary sort by auto ID / created_at timestamp
      return a.created_at.localeCompare(b.created_at);
   });

    let balance = 0;
    const mapped = sorted.map(e => {
      balance = balance + (e.credit || 0) - (e.debit || 0);
      const partnerObj = partners.find(p => p.id === e.partner_id);
      return {
        ...e,
        partner: partnerObj,
        partner_name: partnerObj?.name || 'Unknown Partner',
        running_balance: balance
     };
   });

    // Return newest first for tabular presentation
    return mapped.reverse();
 }, [entries, partners]);

  // Compute live ledger summaries
  const summaries = useMemo(() => {
    let totalCapitalIn = 0;
    let totalDrawings = 0;

    entries.forEach(e => {
      totalCapitalIn += e.credit || 0;
      totalDrawings += e.debit || 0;
   });

    return {
      totalCapitalIn,
      totalDrawings,
      netValue: totalCapitalIn - totalDrawings
   };
 }, [entries]);

  // Partner Wise Balances
  const partnerBalances = useMemo(() => {
    return partners.map(p => {
      const pEntries = entries.filter(e => e.partner_id === p.id);
      const capitalIn = pEntries.reduce((sum, e) => sum + (e.credit || 0), 0);
      const drawings = pEntries.reduce((sum, e) => sum + (e.debit || 0), 0);
      return {
        partnerId: p.id,
        partnerName: p.name,
        capitalIn,
        drawings,
        netBalance: capitalIn - drawings
     };
   }).sort((a, b) => b.netBalance - a.netBalance);
 }, [partners, entries]);

  return (
    <div className="space-y-3 w-full select-none text-slate-800 p-2 font-outfit">
      
      {/* Top Header Actions Bar */}
      <div className="flex justify-between items-center bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        <div>
          <h1 className="text-[24px] font-bold uppercase tracking-tight text-slate-900 leading-none">CAPITAL REGISTER</h1>
          <p className="text-[14px] text-slate-400 font-bold uppercase mt-1">
            PARTNER CAPITAL ACCOUNTS & DRAWINGS LEDGER
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/finance')}
            className="inline-flex items-center justify-center gap-1.5 px-3 h-[48px] bg-white text-slate-700 border border-slate-250 rounded hover:bg-slate-50 font-bold text-[16px] uppercase"
          >
            <ArrowLeft className="w-4 h-4" />
            BACK
          </button>
          <button
            onClick={() => setShowPrintModal(true)}
            className="inline-flex items-center justify-center gap-1.5 px-4 h-[48px] bg-[#0b1329] text-white border border-slate-800 rounded hover:bg-slate-800 font-bold text-[16px] uppercase"
          >
            <Printer className="w-4 h-4" />
            PRINT
          </button>
        </div>
      </div>

      {/* Main Grid Layout - Side-by-Side: 65% Form & 35% Partner Balances */}
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch no-print`}>
        
        {/* Left Side: New Entry Form & Bulk Distribution Toolbar (lg:col-span-8 -> ~65%) */}
        <div className="lg:col-span-8 flex flex-col justify-between gap-3">
          
          {/* New Entry Form Card */}
          <Card 
            title={
              <span className="text-slate-900 text-[17px] font-bold uppercase">
                {editingId ? 'EDIT CAPITAL ENTRY' : 'NEW CAPITAL ENTRY'}
              </span>
           }
            subtitle={
              <span className="text-slate-400 text-[14px] font-bold uppercase">
                {editingId ? 'MODIFY PARTNER LEDGER ENTRY RECORD' : 'RECORD PARTNER DEPOSITS OR DRAWINGS'}
              </span>
           }
            className="shadow-sm border-slate-200 rounded"
          >
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FinanceSmartCalendar
                    label="DATE"
                    value={date}
                    onChange={(val) => { setDate(val); setErrors(p => ({...p, date: false})); }}
                    module="PARTNER_PERFORMANCE"
                    required
                    error={errors.date}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[15px] font-bold text-slate-700 uppercase block">
                    PARTNER <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={partnerId}
                    onChange={(e) => { setPartnerId(e.target.value); setErrors(p => ({...p, partnerId: false})) }}
                    ref={partnerIdRef as any}
                    className={`w-full bg-white border rounded px-3 text-[16px] focus:outline-none h-[48px] shadow-sm font-bold ${errors.partnerId ? "border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500" : "border-slate-250 focus:ring-1 focus:ring-slate-900"}`}
                    required
                  >
                    <option value="">SELECT PARTNER</option>
                    {partners.map(p => (
                      <option key={p.id} value={p.id}>{p.name.toUpperCase()} — {p.is_md ? 'MD' : 'PARTNER'}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[15px] font-bold text-slate-700 uppercase block">
                  PARTICULARS
                </label>
                <input
                  type="text"
                  value={particulars}
                  onChange={(e) => setParticulars(e.target.value)}
                  placeholder="e.g. CAPITAL INTRODUCTION / OFFICE DRAWINGS"
                  className="w-full bg-white border border-slate-250 rounded px-3 text-[16px] focus:outline-none shadow-sm h-[48px] font-bold uppercase"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[15px] font-bold text-slate-700 uppercase block">
                    CREDIT ()
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={credit}
                    onChange={(e) => { handleCreditChange(e.target.value); setErrors(p => ({...p, amount_xor: false})) }}
                    ref={creditRef}
                    className={`w-full bg-white border rounded px-3 text-[16px] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 shadow-sm h-[48px] font-bold ${errors.amount_xor ? "border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500" : "border-slate-250 focus:ring-1 focus:ring-slate-900"}`}
                    disabled={!!debit}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[15px] font-bold text-slate-700 uppercase block">
                    DEBIT ()
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={debit}
                    onChange={(e) => { handleDebitChange(e.target.value); setErrors(p => ({...p, amount_xor: false})) }}
                    ref={debitRef}
                    className={`w-full bg-white border rounded px-3 text-[16px] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 shadow-sm h-[48px] font-bold ${errors.amount_xor ? "border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500" : "border-slate-250 focus:ring-1 focus:ring-slate-900"}`}
                    disabled={!!credit}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="inline-flex items-center justify-center gap-1 px-4 h-[48px] bg-white text-slate-700 border border-slate-250 rounded hover:bg-slate-50 font-bold text-[16px] uppercase"
                >
                  <RotateCcw className="w-4 h-4" />
                  RESET
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-1 px-5 h-[48px] bg-[#0b1329] text-white border border-slate-800 rounded hover:bg-slate-800 font-bold text-[16px] uppercase"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'SAVING...' : 'SAVE'}
                </button>
              </div>
            </form>
          </Card>

          {/* Bulk Distribution compact toolbar */}
          <div className="bg-white border border-slate-200 rounded p-3 shadow-sm flex flex-col sm:flex-row items-center gap-3">
            <div className="text-[15px] font-bold text-slate-800 uppercase shrink-0">Bulk Distribution:</div>
            
            {/* Credit All */}
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <input
                type="number"
                value={bulkCreditAmount}
                onChange={(e) => setBulkCreditAmount(e.target.value)}
                placeholder="Credit amount to all"
                className="bg-white border border-slate-250 rounded p-1 text-[16px] focus:outline-none h-[44px] w-40 font-bold"
              />
              <button
                type="button"
                onClick={() => handleBulkSubmit('Credit')}
                disabled={bulkPosting}
                className="px-3 h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-xs uppercase"
              >
                Credit All
              </button>
            </div>

            <div className="hidden sm:block w-px h-6 bg-slate-200"></div>

            {/* Debit All */}
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <input
                type="number"
                value={bulkDebitAmount}
                onChange={(e) => setBulkDebitAmount(e.target.value)}
                placeholder="Debit amount to all"
                className="bg-white border border-slate-250 rounded p-1 text-[16px] focus:outline-none h-[44px] w-40 font-bold"
              />
              <button
                type="button"
                onClick={() => handleBulkSubmit('Debit')}
                disabled={bulkPosting}
                className="px-3 h-[44px] bg-rose-650 hover:bg-rose-700 text-white rounded font-bold text-xs uppercase"
              >
                Debit All
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Totals Summary & Partner Balances (lg:col-span-4 -> ~35%) */}
        <div className="lg:col-span-4 flex flex-col justify-between gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-slate-200 rounded p-3 shadow-sm text-center">
              <span className="text-[12px] font-bold text-slate-500 uppercase block">Total Capital In</span>
              <span className="font-mono text-emerald-700 text-[18px] font-black">{summaries.totalCapitalIn.toLocaleString('en-IN')}</span>
            </div>
            <div className="bg-white border border-slate-200 rounded p-3 shadow-sm text-center">
              <span className="text-[12px] font-bold text-slate-500 uppercase block">Total Drawings</span>
              <span className="font-mono text-rose-700 text-[18px] font-black">{summaries.totalDrawings.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <Card
            title={
              <div className="flex justify-between items-center w-full">
                <span className="text-slate-900 text-[17px] font-bold uppercase">
                  PARTNER BALANCES
                </span>
                <span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-100 rounded font-bold uppercase">
                  LIVE
                </span>
              </div>
           }
            subtitle={
              <span className="text-slate-400 text-[14px] font-bold uppercase">
                {partnerBalances.length} PARTNERS · NET {summaries.netValue.toLocaleString('en-IN')}
              </span>
           }
            className="flex-1 bg-white border border-slate-200 shadow-sm rounded overflow-hidden"
          >
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-slate-900"></div>
              </div>
            ) : partnerBalances.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-slate-200 rounded space-y-2">
                <h3 className="text-slate-800 text-[16px] uppercase font-bold">NO PARTNERS</h3>
                <p className="text-[14px] text-slate-400 font-bold uppercase">
                  Register partners first to track capital.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full divide-y divide-slate-100">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50">
                      <th className="py-2 px-2.5 text-left font-bold text-slate-600 text-[12px] uppercase">Partner</th>
                      <th className="py-2 px-2.5 text-right font-bold text-slate-600 text-[12px] uppercase">Capital</th>
                      <th className="py-2 px-2.5 text-right font-bold text-slate-600 text-[12px] uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {partnerBalances.map((pb) => (
                      <tr key={pb.partnerId} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-2.5 text-slate-900 font-bold uppercase text-[13px] leading-tight" title={pb.partnerName}>
                          {pb.partnerName}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-emerald-600 font-bold text-[14px] tabular-nums whitespace-nowrap">
                          {pb.capitalIn.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-slate-900 font-bold text-[14px] tabular-nums whitespace-nowrap">
                          {pb.netBalance.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

      </div>

      {/* Transactions Section: Starts immediately below, full width */}
      <div className={`w-full mt-3 no-print`}>
        <Card
          title={
            <span className="text-slate-900 text-[17px] font-bold uppercase">
              TRANSACTIONS RECORD
            </span>
         }
          subtitle={
            <span className="text-slate-400 text-[14px] font-bold uppercase">
              {entriesWithRunningBalance.length} ENTRIES RECORDED
            </span>
         }
          className="shadow-sm border-slate-200 rounded"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-2">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-900"></div>
              <p className="text-slate-400 text-[14px] font-bold uppercase">Loading capital entries...</p>
            </div>
          ) : entriesWithRunningBalance.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-200 rounded space-y-3">
              <Info className="w-8 h-8 text-slate-350 mx-auto" />
              <h3 className="text-slate-800 text-[16px] uppercase font-bold">NO TRANSACTIONS</h3>
              <p className="text-slate-400 text-[14px] font-bold uppercase">
                Post entries from the form above.
              </p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-[16px] divide-y divide-slate-200">
                <thead className="bg-slate-50 sticky top-0 z-10 text-slate-700">
                  <tr className="divide-x divide-slate-200">
                    <th className="px-3 py-2 text-left font-bold text-[15px] uppercase whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-left font-bold text-[15px] uppercase">Partner</th>
                    <th className="px-3 py-2 text-left font-bold text-[15px] uppercase">Particulars</th>
                    <th className="px-3 py-2 text-right font-bold text-[15px] uppercase whitespace-nowrap">Credit (Cr)</th>
                    <th className="px-3 py-2 text-right font-bold text-[15px] uppercase whitespace-nowrap">Debit (Dr)</th>
                    <th className="px-3 py-2 text-right font-bold text-[15px] uppercase">Balance</th>
                    <th className="pl-5 pr-3 py-2 text-left font-bold text-[15px] uppercase">By</th>
                    <th className="px-3 py-2 text-right font-bold text-[15px] uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white divide-x divide-slate-50 font-semibold text-slate-800">
                  {entriesWithRunningBalance.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/20" style={{ height: '38px' }}>
                      <td className="px-3 py-1.5 text-slate-700 font-mono tabular-nums whitespace-nowrap align-top">
                        {e.entry_date.split('-').reverse().join('/')}
                      </td>
                      <td className="px-3 py-1.5 text-slate-900 uppercase align-top" title={e.partner_name || e.partner?.name || ''}>
                        {e.partner_name?.toUpperCase() || e.partner?.name?.toUpperCase() || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-650 uppercase align-top [overflow-wrap:anywhere]" title={e.particulars || ''}>
                        {e.particulars || '—'}
                      </td>
                      <td className="px-3 py-1.5 align-top tabular-nums text-right font-mono text-emerald-700 font-bold whitespace-nowrap">
                        {e.credit > 0 ? `${e.credit.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 align-top tabular-nums text-right font-mono text-red-700 font-bold whitespace-nowrap">
                        {e.debit > 0 ? `${e.debit.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 align-top tabular-nums text-right font-mono text-slate-900 font-bold whitespace-nowrap">
                        {(e.running_balance || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="pl-5 pr-3 py-1.5 text-slate-500 uppercase align-top">
                        {e.created_by || 'STAFF'}
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap align-top" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditClick(e)}
                            title="Edit Entry"
                            className="p-1 hover:bg-slate-100 rounded text-slate-700 border border-slate-200"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id, e.particulars || '')}
                            title="Delete Entry"
                            className="p-1 hover:bg-red-50 rounded text-red-700 border border-slate-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* MODAL: Print Preview Panel */}
      <FinancePrintPreview
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        title="Capital Entry Ledger"
        documentTitle={`PARTNER CAPITAL & DRAWINGS LEDGER STATEMENT`}
      >
        <div className="text-center pb-6 border-b-2 border-slate-900">
          <h2 className="finance-brand">TIRUMALA FINANCE</h2>
          <p className="mt-1 finance-header-time uppercase">PARTNER CAPITAL & DRAWINGS LEDGER STATEMENT</p>
          <p className="text-slate-600 mt-0.5 finance-small-label">
            PRINTED DATE: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Total Summaries Section */}
        <div className="grid grid-cols-3 gap-4 py-6 border-b border-slate-300 font-sans finance-caption">
          <div>
            <p className="text-slate-500 finance-input uppercase">TOTAL CAPITAL IN:</p>
            <p className="text-emerald-600 mt-1 finance-brand">{summaries.totalCapitalIn.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-slate-500 finance-input uppercase">TOTAL DRAWINGS:</p>
            <p className="text-red-650 mt-1 finance-brand">{summaries.totalDrawings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-slate-500 finance-input uppercase">NET BALANCE:</p>
            <p className="text-slate-900 mt-1 finance-brand">{summaries.netValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* Partner Balances Summary Section */}
        <div className="py-6 border-b border-slate-300">
          <h3 className="finance-brand text-slate-800 uppercase mb-4">Partner Balances Summary</h3>
          <table className="min-w-full font-sans finance-caption">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="py-2 px-3 text-left font-bold text-slate-650 uppercase">Partner Name</th>
                <th className="py-2 px-3 text-right font-bold text-slate-650 uppercase">Total Capital In</th>
                <th className="py-2 px-3 text-right font-bold text-slate-650 uppercase">Total Drawings</th>
                <th className="py-2 px-3 text-right font-bold text-slate-650 uppercase">Net Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partnerBalances.map(pb => (
                <tr key={pb.partnerId}>
                  <td className="py-2 px-3 text-slate-800 uppercase font-medium">{pb.partnerName}</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-600">{pb.capitalIn.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-3 text-right font-mono text-red-600">{pb.drawings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{pb.netBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detailed Transactions List Section */}
        <div className="py-6">
          <h3 className="finance-brand text-slate-800 uppercase mb-4">Detailed Ledger Entries</h3>
          <table className="min-w-full font-sans finance-caption">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="py-2 px-2 text-left font-bold text-slate-600 uppercase">Date</th>
                <th className="py-2 px-2 text-left font-bold text-slate-600 uppercase">Partner</th>
                <th className="py-2 px-2 text-left font-bold text-slate-600 uppercase">Particulars</th>
                <th className="py-2 px-2 text-right font-bold text-slate-600 uppercase">Credit</th>
                <th className="py-2 px-2 text-right font-bold text-slate-600 uppercase">Debit</th>
                <th className="py-2 px-2 text-right font-bold text-slate-600 uppercase">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entriesWithRunningBalance.map(e => (
                <tr key={e.id}>
                  <td className="py-2 px-2 font-mono text-[13px]">{e.entry_date.split('-').reverse().join('/')}</td>
                  <td className="py-2 px-2 text-slate-800 uppercase text-[13px]">{e.partner_name}</td>
                  <td className="py-2 px-2 text-slate-600 uppercase text-[13px]">{e.particulars || '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-emerald-600 text-[13px]">{e.credit > 0 ? `${e.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-red-600 text-[13px]">{e.debit > 0 ? `${e.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 text-[13px]">{(e.running_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </FinancePrintPreview>

    </div>
  );
};

export default CapitalEntry;
