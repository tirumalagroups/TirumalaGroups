import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { supabaseFinance } from '../../lib/supabaseFinance';
import { formatRelationship } from '../../utils/relationship';

/**
 * Aadhaar Search
 * Type an Aadhaar number (or name / phone / customer ID) and pick the customer from the dropdown.
 * Shows 4 tables: Running Loans, All Loans, As Guarantor 1, As Guarantor 2.
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
  if (s === 'CLOSED') return { label: 'Closed', badge: 'bg-slate-200 text-slate-700 border-slate-300', row: 'bg-slate-100/80 text-slate-600' };
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

// Characters that would break the PostgREST "or" filter
const cleanQuery = (q: string) => q.replace(/[,()*%\\]/g, ' ').trim();

const AadhaarSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<CustomerOption | null>(null);
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [ownLoans, setOwnLoans] = useState<LoanRow[]>([]);
  const [g1Loans, setG1Loans] = useState<LoanRow[]>([]);
  const [g2Loans, setG2Loans] = useState<LoanRow[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  // Set when the box text is filled in by picking a customer, so it doesn't search again
  const skipNextSearch = useRef(false);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Customer lookup while typing (Aadhaar first; name / phone / ID also work)
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const q = cleanQuery(query);
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const digits = q.replace(/\s+/g, '');
        let filter = `aadhaar.ilike.%${digits}%,name.ilike.%${q}%,phone.ilike.%${digits}%,phone_1.ilike.%${digits}%,phone_2.ilike.%${digits}%`;
        if (/^\d{1,9}$/.test(digits)) filter += `,customer_id.eq.${digits}`;
        const { data, error } = await supabase
          .from('finance_customers')
          .select(CUSTOMER_FIELDS)
          .or(filter)
          .order('name', { ascending: true })
          .limit(25);
        if (seq !== searchSeq.current) return;
        if (error) throw error;
        const list = (data || []) as CustomerOption[];
        setOptions(list);
        setHighlight(0);
        // A full 12-digit Aadhaar that matches exactly one customer is selected straight away
        const exact = /^\d{12}$/.test(digits) ? list.filter(c => (c.aadhaar || '').replace(/\s+/g, '') === digits) : [];
        if (exact.length === 1) {
          pickCustomer(exact[0]);
        } else {
          setShowDropdown(true);
        }
      } catch (err) {
        console.error('Aadhaar search failed:', err);
        if (seq === searchSeq.current) toast.error('Search failed. Please try again.');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pickCustomer = (c: CustomerOption) => {
    setSelected(c);
    setShowDropdown(false);
    const text = c.aadhaar || c.name;
    if (text !== query) skipNextSearch.current = true;
    setQuery(text);
    loadLoans(c);
  };

  const clearSelection = () => {
    setSelected(null);
    setQuery('');
    setOptions([]);
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || options.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pickCustomer(options[highlight]); }
    else if (e.key === 'Escape') setShowDropdown(false);
  };

  const village = (c: CustomerOption) => c.present_village || c.village || '';
  const phoneOf = (c: CustomerOption) => c.phone_1 || c.phone || '';

  return (
    <div className="space-y-3 w-full font-outfit text-slate-800 p-2">
      {/* Header + search */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-3">
        <div>
          <h1 className="text-[22px] font-bold uppercase text-slate-900 leading-tight">Aadhaar Search</h1>
          <p className="text-[13px] text-slate-500 font-bold uppercase">
            Enter the Aadhaar number (or name / phone) and select the customer to see their loans and guarantees
          </p>
        </div>

        <div ref={boxRef} className="relative max-w-2xl">
          <div className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => options.length > 0 && setShowDropdown(true)}
              onKeyDown={onKeyDown}
              placeholder="Aadhaar number, name or phone…"
              className="w-full h-[48px] bg-white border border-slate-300 rounded pl-10 pr-10 text-[16px] font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {(query || selected) && (
              <button
                type="button"
                onClick={clearSelection}
                title="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {showDropdown && cleanQuery(query).length >= 2 && (
            <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded shadow-lg max-h-[320px] overflow-y-auto">
              {searching && <div className="px-3 py-2 text-[13px] text-slate-500 font-bold uppercase">Searching…</div>}
              {!searching && options.length === 0 && (
                <div className="px-3 py-2 text-[13px] text-slate-500 font-bold uppercase">No customer found</div>
              )}
              {!searching && options.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pickCustomer(c)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100 last:border-0 ${i === highlight ? 'bg-slate-100' : 'bg-white'}`}
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
              ))}
            </div>
          )}
        </div>
      </div>

      {!selected && (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center">
          <Search className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-[14px] font-bold uppercase text-slate-500">Search a customer to see their loans</p>
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
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-200 border border-slate-400" /> Closed</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-200 border border-rose-400" /> NPA Closed</span>
            <span className="text-slate-400 normal-case font-semibold">Closed loans show "—" for amounts still due.</span>
          </div>

          {loadingLoans ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-[14px] font-bold uppercase text-slate-500">
              Loading loans…
            </div>
          ) : (
            <>
              <LoanTable title="1. Running Loans" rows={runningLoans} mode="own" />
              <LoanTable title="2. All Loans (Running + Closed)" rows={ownLoans} mode="own" showStatus />
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

const LoanTable: React.FC<{ title: string; rows: LoanRow[]; mode: 'own' | 'guarantor'; showStatus?: boolean }> = ({ title, rows, mode, showStatus }) => {
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
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <h2 className="text-[15px] font-bold uppercase text-slate-900">{title}</h2>
        <span className="text-[12px] font-bold uppercase text-slate-500">{rows.length} loan{rows.length === 1 ? '' : 's'}</span>
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
