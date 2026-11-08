import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, User, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { formatRelationship } from '../../utils/relationship';

/**
 * Aadhaar Search
 * Search by Aadhaar number only, or pick an existing customer from the "Select Customer" dropdown.
 * Shows 4 tables: Running Loans, Closed Loans, As Guarantor 1, As Guarantor 2.
 * All figures come from the same calculation the Dues List uses (getDuesLedgerSummary).
 */

interface CustomerOption {
  id: string;
  customer_id: number | null;
  name: string;
  aadhaar: string | null;
  phone: string | null;
  phone_1: string | null;
  phone_2: string | null;
  father_name: string | null;
  father_husband_name: string | null;
  village: string | null;
  present_village: string | null;
  mandal: string | null;
  present_mandal: string | null;
  district: string | null;
  present_district: string | null;
}

interface LoanRow {
  id: string;
  loanNo: string;
  loanDate: string;
  status: string;
  isRunning: boolean;
  borrowerName: string;
  borrowerAadhaar: string;
  loanAmount: number;
  // null = not applicable (closed loan) or could not be calculated
  principal: number | null;
  interestPaid: number;
  penaltyPaid: number;
  dueDays: number | null;
  dueAmount: number | null;
  totalDue: number | null;
  calcMissing: boolean;
}

const CUSTOMER_FIELDS =
  'id, customer_id, name, aadhaar, phone, phone_1, phone_2, father_name, father_husband_name, village, present_village, mandal, present_mandal, district, present_district';

const statusInfo = (status: string): { label: string; badge: string; row: string } => {
  const s = (status || '').trim().toUpperCase();
  if (s === 'ACTIVE') return { label: 'Running', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', row: 'bg-emerald-50/60' };
  if (s === 'CLOSED') return { label: 'Closed', badge: 'bg-red-100 text-red-800 border-red-300', row: 'bg-red-50/70' };
  if (s === 'NPA_CLOSED' || s === 'NPA CLOSED' || s === 'NPA') return { label: 'NPA Closed', badge: 'bg-rose-100 text-rose-800 border-rose-300', row: 'bg-rose-50/70' };
  return { label: status || '—', badge: 'bg-amber-100 text-amber-800 border-amber-300', row: 'bg-amber-50/60' };
};

const fmtAmount = (v: number | null) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(v);
  return r < 0 ? `-${Math.abs(r).toLocaleString('en-IN')}` : r.toLocaleString('en-IN');
};

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const digitsOnly = (v: string | null | undefined) => (v || '').replace(/\D/g, '');

const AadhaarSearch: React.FC = () => {
  // All customers, for the "Select Customer" dropdown and Aadhaar matching
  const [allCustomers, setAllCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  // Aadhaar box: searches by Aadhaar number only
  const [aadhaarInput, setAadhaarInput] = useState('');
  const [showAadhaarList, setShowAadhaarList] = useState(false);
  const [aadhaarHighlight, setAadhaarHighlight] = useState(0);

  // "Select Customer" dropdown
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');
  const [customerHighlight, setCustomerHighlight] = useState(0);

  const [selected, setSelected] = useState<CustomerOption | null>(null);
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [ownLoans, setOwnLoans] = useState<LoanRow[]>([]);
  const [g1Loans, setG1Loans] = useState<LoanRow[]>([]);
  const [g2Loans, setG2Loans] = useState<LoanRow[]>([]);
  const aadhaarBoxRef = useRef<HTMLDivElement>(null);
  const customerBoxRef = useRef<HTMLDivElement>(null);

  // Load every customer once (sorted by name)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let rows: CustomerOption[] = [];
        for (let page = 0; page < 50; page++) {
          const { data, error } = await supabase
            .from('finance_customers')
            .select(CUSTOMER_FIELDS)
            .order('name', { ascending: true })
            .range(page * 1000, page * 1000 + 999);
          if (error) throw error;
          rows = rows.concat((data || []) as CustomerOption[]);
          if (!data || data.length < 1000) break;
        }
        if (alive) setAllCustomers(rows);
      } catch (err) {
        console.error('Failed to load customers:', err);
        toast.error('Failed to load customers');
      } finally {
        if (alive) setLoadingCustomers(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Close the lists on an outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (aadhaarBoxRef.current && !aadhaarBoxRef.current.contains(e.target as Node)) setShowAadhaarList(false);
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) setShowCustomerList(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const aadhaarDigits = digitsOnly(aadhaarInput);

  // Customers whose Aadhaar contains the typed digits (from 4 digits on)
  const aadhaarMatches = useMemo(() => {
    if (aadhaarDigits.length < 4) return [];
    return allCustomers.filter(c => digitsOnly(c.aadhaar).includes(aadhaarDigits)).slice(0, 25);
  }, [allCustomers, aadhaarDigits]);

  // Dropdown list, narrowed by the small filter box inside it (name or customer ID)
  const customerOptions = useMemo(() => {
    const f = customerFilter.trim().toLowerCase().replace(/^#/, '');
    if (!f) return allCustomers;
    return allCustomers.filter(c => (c.name || '').toLowerCase().includes(f) || String(c.customer_id ?? '') === f);
  }, [allCustomers, customerFilter]);

  const pickCustomer = (c: CustomerOption) => {
    setSelected(c);
    setAadhaarInput(digitsOnly(c.aadhaar));
    setShowAadhaarList(false);
    setShowCustomerList(false);
    setCustomerFilter('');
    loadLoans(c);
  };

  const onAadhaarChange = (value: string) => {
    const d = digitsOnly(value).slice(0, 12);
    setAadhaarInput(d);
    setAadhaarHighlight(0);
    setShowAadhaarList(true);
    // A full 12-digit Aadhaar that belongs to exactly one customer is opened straight away
    if (d.length === 12) {
      const exact = allCustomers.filter(c => digitsOnly(c.aadhaar) === d);
      if (exact.length === 1) pickCustomer(exact[0]);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    setAadhaarInput('');
    setCustomerFilter('');
    setShowAadhaarList(false);
    setShowCustomerList(false);
    setOwnLoans([]);
    setG1Loans([]);
    setG2Loans([]);
  };

  const loadLoans = async (c: CustomerOption) => {
    setLoadingLoans(true);
    setOwnLoans([]);
    setG1Loans([]);
    setG2Loans([]);
    try {
      const { data: loans, error } = await supabase
        .from('finance_loans')
        .select('id, loan_id, date, amount, status, customer_id, guarantor_1_id, guarantor_2_id')
        .or(`customer_id.eq.${c.id},guarantor_1_id.eq.${c.id},guarantor_2_id.eq.${c.id}`);
      if (error) throw error;
      const loanList = loans || [];
      if (loanList.length === 0) return;

      // Same figures as the Dues List (CD engine for CD loans, due entries for others)
      const summary = await supabaseFinance.getDuesLedgerSummary(undefined, loanList.map(l => l.id));
      const positionById = new Map<string, any>((summary.dues || []).map((p: any) => [p.id, p]));

      // Borrower name + Aadhaar for the guarantor tables
      const borrowerIds = [...new Set(loanList.map(l => l.customer_id).filter(Boolean))] as string[];
      const borrowerMap = new Map<string, { name: string; aadhaar: string }>();
      if (borrowerIds.length > 0) {
        const { data: borrowers } = await supabase.from('finance_customers').select('id, name, aadhaar').in('id', borrowerIds);
        (borrowers || []).forEach((b: any) => borrowerMap.set(b.id, { name: b.name || '', aadhaar: b.aadhaar || '' }));
      }

      const toRow = (l: any): LoanRow => {
        const pos = positionById.get(l.id);
        const status = (pos?.status || l.status || '').trim();
        const isRunning = status.toUpperCase() === 'ACTIVE';
        const borrower = borrowerMap.get(l.customer_id) || { name: pos?.customer_name || '', aadhaar: '' };
        return {
          id: l.id,
          loanNo: l.loan_id || '—',
          loanDate: pos?.loan_date || l.date || '',
          status,
          isRunning,
          borrowerName: borrower.name,
          borrowerAadhaar: borrower.aadhaar,
          // Original amount given (CD loans: the disbursement row, same as the CD Ledger "Loan Issue")
          loanAmount: Number(pos?.original_loan_amount ?? pos?.loan_amount ?? l.amount ?? 0),
          // A closed loan has nothing outstanding
          principal: pos && isRunning ? Number(pos.current_principal || 0) : null,
          // Includes the interest taken when the loan was issued, as in the CD Ledger
          interestPaid: Number(pos?.interest_paid || 0) + Number(pos?.opening_interest || 0),
          penaltyPaid: Number(pos?.penalty_paid || 0),
          dueDays: pos && isRunning ? Number(pos.due_days || 0) : null,
          dueAmount: pos && isRunning ? Number(pos.present_due || 0) : null,
          totalDue: pos && isRunning ? Number(pos.closing_amount || 0) : null,
          calcMissing: !pos
        };
      };

      const byDate = (a: LoanRow, b: LoanRow) => (a.loanDate || '').localeCompare(b.loanDate || '');
      setOwnLoans(loanList.filter(l => l.customer_id === c.id).map(toRow).sort(byDate));
      setG1Loans(loanList.filter(l => l.guarantor_1_id === c.id).map(toRow).sort(byDate));
      setG2Loans(loanList.filter(l => l.guarantor_2_id === c.id).map(toRow).sort(byDate));

      if (summary.integrityErrors && summary.integrityErrors.length > 0) {
        toast.error(`${summary.integrityErrors.length} loan(s) could not be calculated; see the CD Ledger for them.`);
      }
    } catch (err) {
      console.error('Failed to load loans:', err);
      toast.error('Failed to load loans for this customer');
    } finally {
      setLoadingLoans(false);
    }
  };

  const runningLoans = useMemo(() => ownLoans.filter(l => l.isRunning), [ownLoans]);
  const closedLoans = useMemo(() => ownLoans.filter(l => !l.isRunning), [ownLoans]);

  const listKeys = (
    e: React.KeyboardEvent<HTMLInputElement>,
    list: CustomerOption[],
    highlight: number,
    setHighlight: React.Dispatch<React.SetStateAction<number>>,
    close: () => void
  ) => {
    if (e.key === 'Escape') { close(); return; }
    if (list.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pickCustomer(list[Math.min(highlight, list.length - 1)]); }
  };

  const village = (c: CustomerOption) => c.present_village || c.village || '';
  const phoneOf = (c: CustomerOption) => c.phone_1 || c.phone || '';

  const optionRow = (c: CustomerOption, active: boolean, onHover: () => void) => (
    <button
      key={c.id}
      type="button"
      onMouseEnter={onHover}
      onClick={() => pickCustomer(c)}
      className={`w-full text-left px-3 py-2 border-b border-slate-100 last:border-0 ${active ? 'bg-slate-100' : 'bg-white'}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-bold text-[15px] text-slate-900 uppercase">{c.name}</span>
        <span className="font-mono text-[13px] text-slate-700 whitespace-nowrap">{c.aadhaar || 'NO AADHAAR'}</span>
      </div>
      <div className="text-[12px] text-slate-500 font-semibold uppercase">
        #{c.customer_id ?? '—'}
        {formatRelationship(c.father_name || c.father_husband_name) ? ` · ${formatRelationship(c.father_name || c.father_husband_name)}` : ''}
        {phoneOf(c) ? ` · ${phoneOf(c)}` : ''}
        {village(c) ? ` · ${village(c)}` : ''}
      </div>
    </button>
  );

  return (
    <div className="space-y-3 w-full font-outfit text-slate-800 p-2">
      {/* Header + search */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold uppercase text-slate-900 leading-tight">Aadhaar Search</h1>
            <p className="text-[13px] text-slate-500 font-bold uppercase">
              Enter the Aadhaar number, or select an existing customer, to see their loans and guarantees
            </p>
          </div>
          {selected && (
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex items-center gap-1 h-[38px] px-3 border border-slate-300 rounded text-[14px] font-bold uppercase text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
          {/* Aadhaar number only */}
          <div ref={aadhaarBoxRef} className="relative">
            <label className="block mb-1 text-[13px] font-bold uppercase text-slate-700">Aadhaar Number</label>
            <div className="relative">
              <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                inputMode="numeric"
                value={aadhaarInput}
                onChange={(e) => onAadhaarChange(e.target.value)}
                onFocus={() => aadhaarDigits.length >= 4 && setShowAadhaarList(true)}
                onKeyDown={(e) => listKeys(e, aadhaarMatches, aadhaarHighlight, setAadhaarHighlight, () => setShowAadhaarList(false))}
                placeholder="12-digit Aadhaar number"
                className="w-full h-[48px] bg-white border border-slate-300 rounded pl-10 pr-3 text-[16px] font-bold font-mono tracking-wider text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
            {showAadhaarList && aadhaarDigits.length >= 4 && !(selected && digitsOnly(selected.aadhaar) === aadhaarDigits) && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded shadow-lg max-h-[320px] overflow-y-auto">
                {loadingCustomers && <div className="px-3 py-2 text-[13px] text-slate-500 font-bold uppercase">Loading customers…</div>}
                {!loadingCustomers && aadhaarMatches.length === 0 && (
                  <div className="px-3 py-2 text-[13px] text-slate-500 font-bold uppercase">No customer with this Aadhaar number</div>
                )}
                {aadhaarMatches.map((c, i) => optionRow(c, i === aadhaarHighlight, () => setAadhaarHighlight(i)))}
              </div>
            )}
          </div>

          {/* Select an existing customer */}
          <div ref={customerBoxRef} className="relative">
            <label className="block mb-1 text-[13px] font-bold uppercase text-slate-700">
              Select Customer {!loadingCustomers && <span className="text-slate-400">({allCustomers.length})</span>}
            </label>
            <button
              type="button"
              onClick={() => { setShowCustomerList(v => !v); setCustomerHighlight(0); }}
              className="w-full h-[48px] bg-white border border-slate-300 rounded px-3 flex items-center justify-between gap-2 text-left focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              <span className={`truncate text-[16px] font-bold uppercase ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
                {selected ? `${selected.name}  #${selected.customer_id ?? '—'}` : loadingCustomers ? 'Loading customers…' : 'Select existing customer'}
              </span>
              <ChevronDown className="w-5 h-5 text-slate-500 shrink-0" />
            </button>
            {showCustomerList && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded shadow-lg">
                <div className="p-2 border-b border-slate-200">
                  <input
                    type="text"
                    autoFocus
                    value={customerFilter}
                    onChange={(e) => { setCustomerFilter(e.target.value); setCustomerHighlight(0); }}
                    onKeyDown={(e) => listKeys(e, customerOptions, customerHighlight, setCustomerHighlight, () => setShowCustomerList(false))}
                    placeholder="Type name or customer ID to narrow the list"
                    className="w-full h-[38px] border border-slate-300 rounded px-2 text-[14px] font-semibold focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {customerOptions.length === 0 && (
                    <div className="px-3 py-2 text-[13px] text-slate-500 font-bold uppercase">No customer found</div>
                  )}
                  {customerOptions.map((c, i) => optionRow(c, i === customerHighlight, () => setCustomerHighlight(i)))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!selected && (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center">
          <Search className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-[14px] font-bold uppercase text-slate-500">Enter an Aadhaar number or select a customer to see their loans</p>
        </div>
      )}

      {selected && (
        <>
          {/* Selected customer */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-slate-500" />
              <span className="text-[18px] font-bold uppercase text-slate-900">{selected.name}</span>
              <span className="text-[13px] font-mono font-bold text-slate-500">#{selected.customer_id ?? '—'}</span>
            </div>
            <Info label="Aadhaar" value={selected.aadhaar || '—'} mono />
            <Info label="Guardian" value={formatRelationship(selected.father_name || selected.father_husband_name) || '—'} />
            <Info label="Phone" value={[selected.phone_1 || selected.phone, selected.phone_2].filter(Boolean).join(' / ') || '—'} mono />
            <Info label="Village" value={village(selected) || '—'} />
            <Info label="Mandal / District" value={[selected.present_mandal || selected.mandal, selected.present_district || selected.district].filter(Boolean).join(', ') || '—'} />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[12px] font-bold uppercase text-slate-600 px-1">
            <span>Colours:</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-200 border border-emerald-400" /> Running</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-200 border border-red-400" /> Closed</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-200 border border-rose-400" /> NPA Closed</span>
            <span className="text-slate-400 normal-case font-semibold">Closed loans show "—" for amounts still due.</span>
          </div>

          {loadingLoans ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-[14px] font-bold uppercase text-slate-500">
              Loading loans…
            </div>
          ) : (
            <>
              <LoanTable title="1. Running Loans" titleClass="bg-emerald-100 text-emerald-900 border-emerald-300" rows={runningLoans} mode="own" />
              <LoanTable title="2. Closed Loans (Closed + NPA Closed)" titleClass="bg-red-100 text-red-900 border-red-300" rows={closedLoans} mode="own" showStatus />
              <LoanTable title="3. As Guarantor 1" rows={g1Loans} mode="guarantor" showStatus />
              <LoanTable title="4. As Guarantor 2" rows={g2Loans} mode="guarantor" showStatus />
            </>
          )}
        </>
      )}
    </div>
  );
};

const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="leading-tight">
    <div className="text-[11px] font-bold uppercase text-slate-400">{label}</div>
    <div className={`text-[14px] font-bold text-slate-800 uppercase ${mono ? 'font-mono' : ''}`}>{value}</div>
  </div>
);

const LoanTable: React.FC<{ title: string; titleClass?: string; rows: LoanRow[]; mode: 'own' | 'guarantor'; showStatus?: boolean }> = ({ title, titleClass, rows, mode, showStatus }) => {
  const totals = useMemo(() => {
    const sum = (pick: (r: LoanRow) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
    return {
      loanAmount: sum(r => r.loanAmount),
      principal: sum(r => r.principal),
      interestPaid: sum(r => r.interestPaid),
      penaltyPaid: sum(r => r.penaltyPaid),
      dueAmount: sum(r => r.dueAmount),
      totalDue: sum(r => r.totalDue)
    };
  }, [rows]);

  const isGuarantor = mode === 'guarantor';
  const th = 'px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-700 border-b border-slate-300';
  const num = 'fit-nowrap px-2 py-1.5 text-right font-mono tabular-nums';
  const labelCols = 3 + (isGuarantor ? 2 : 0) + (showStatus ? 1 : 0);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className={`flex items-center justify-between px-3 py-2 border-b ${titleClass || 'bg-slate-50 border-slate-200 text-slate-900'}`}>
        <h2 className="text-[15px] font-bold uppercase">{title}</h2>
        <span className="text-[12px] font-bold uppercase opacity-70">{rows.length} loan{rows.length === 1 ? '' : 's'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-[13px] font-bold uppercase text-slate-400">No loans</div>
      ) : (
        <table className="fit-table w-full border-collapse text-slate-800">
          <thead className="bg-slate-100">
            <tr>
              <th className={`${th} text-center`}>Sl.No</th>
              <th className={`${th} text-left`}>CD / Loan No</th>
              <th className={`${th} text-left`}>Loan Date</th>
              {isGuarantor && <th className={`${th} text-left`}>Customer Name</th>}
              {isGuarantor && <th className={`${th} text-left`}>Customer Aadhaar</th>}
              {showStatus && <th className={`${th} text-center`}>Status</th>}
              <th className={`${th} text-right`}>Loan Amount</th>
              <th className={`${th} text-right`}>Principal Balance</th>
              <th className={`${th} text-right`}>Interest Paid</th>
              <th className={`${th} text-right`}>Penalty Paid</th>
              <th className={`${th} text-right`}>Due Days</th>
              <th className={`${th} text-right`}>Due Amount</th>
              <th className={`${th} text-right`}>Total Due Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const st = statusInfo(r.status);
              return (
                <tr key={r.id} className={`border-b border-slate-200 ${st.row}`}>
                  <td className="fit-nowrap px-2 py-1.5 text-center font-mono text-slate-500">{i + 1}</td>
                  <td className="fit-nowrap px-2 py-1.5 font-mono font-bold text-slate-900">
                    {r.loanNo}
                    {r.calcMissing && <span title="Could not be calculated" className="ml-1 text-rose-600">⚠</span>}
                  </td>
                  <td className="fit-nowrap px-2 py-1.5 font-mono">{fmtDate(r.loanDate)}</td>
                  {isGuarantor && <td className="px-2 py-1.5 font-bold uppercase">{r.borrowerName || '—'}</td>}
                  {isGuarantor && <td className="fit-nowrap px-2 py-1.5 font-mono">{r.borrowerAadhaar || '—'}</td>}
                  {showStatus && (
                    <td className="fit-nowrap px-2 py-1.5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded border text-[11px] font-bold uppercase ${st.badge}`}>{st.label}</span>
                    </td>
                  )}
                  <td className={num}>{fmtAmount(r.loanAmount)}</td>
                  <td className={num}>{fmtAmount(r.principal)}</td>
                  <td className={num}>{fmtAmount(r.interestPaid)}</td>
                  <td className={num}>{fmtAmount(r.penaltyPaid)}</td>
                  <td className={`${num} ${r.dueDays !== null && r.dueDays > 90 ? 'text-rose-700 font-bold' : ''}`}>{r.dueDays === null ? '—' : r.dueDays}</td>
                  <td className={num}>{fmtAmount(r.dueAmount)}</td>
                  <td className={`${num} font-bold`}>{fmtAmount(r.totalDue)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
              <td colSpan={labelCols} className="px-2 py-2 text-right uppercase text-[12px]">Total</td>
              <td className={num}>{fmtAmount(totals.loanAmount)}</td>
              <td className={num}>{fmtAmount(totals.principal)}</td>
              <td className={num}>{fmtAmount(totals.interestPaid)}</td>
              <td className={num}>{fmtAmount(totals.penaltyPaid)}</td>
              <td className={num}></td>
              <td className={num}>{fmtAmount(totals.dueAmount)}</td>
              <td className={num}>{fmtAmount(totals.totalDue)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
};

export default AadhaarSearch;
