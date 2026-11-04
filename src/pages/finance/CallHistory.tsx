import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { FinanceLoanPaymentFollowup } from '../../lib/supabaseFinance';
import { 
  History, 
  Search, 
  Download, 
  Printer, 
  ChevronRight,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';

interface GroupedFollowUp {
  loan_id: string;
  db_loan_id: string; // The database UUID
  loan_number: string;
  loan_category: string;
  customer_name: string;
  customer_phone: string;
  partner_name: string;
  latest_follow_up: FinanceLoanPaymentFollowup;
  all_follow_ups: FinanceLoanPaymentFollowup[];
}

const CallHistory: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [followUps, setFollowUps] = useState<FinanceLoanPaymentFollowup[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState<'ALL' | 'CD' | 'HP' | 'STBD' | 'TBD'>('ALL');
  const [resultFilter, setResultFilter] = useState<string>('ALL');
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');
  
  // Modal state
  const [selectedGroup, setSelectedGroup] = useState<GroupedFollowUp | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isTimelinePrinting, setIsTimelinePrinting] = useState(false);

  // Detailed metrics state


  // Print state
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('finance_loan_payment_followups')
        .select(`
          *,
          loan:finance_loans(
            id,
            loan_id,
            loan_category,
            amount,
            status,
            customer_id,
            customer:finance_customers!customer_id(id, name, phone, partner_name)
          )
        `)
        .order('followed_up_at', { ascending: false });

      if (error) throw error;
      setFollowUps(data || []);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load call history logs');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (group: GroupedFollowUp) => {
    setSelectedGroup(group);
    setShowModal(true);
  };



  // Group by loan_id (using the string identifier)
  const groupedData = useMemo(() => {
    const groups: Record<string, FinanceLoanPaymentFollowup[]> = {};
    followUps.forEach(f => {
      const lid = f.loan?.loan_id || f.loan_id || 'UNKNOWN';
      if (!groups[lid]) {
        groups[lid] = [];
      }
      groups[lid].push(f);
    });

    const list: GroupedFollowUp[] = Object.keys(groups).map(loanIdStr => {
      const sorted = [...groups[loanIdStr]].sort(
        (a, b) => new Date(b.followed_up_at).getTime() - new Date(a.followed_up_at).getTime()
      );
      const latest = sorted[0];
      return {
        loan_id: loanIdStr,
        db_loan_id: latest.loan_id,
        loan_number: latest.loan?.loan_id || loanIdStr,
        loan_category: latest.loan?.loan_category || 'CD',
        customer_name: latest.loan?.customer?.name || 'N/A',
        customer_phone: latest.loan?.customer?.phone || 'N/A',
        partner_name: latest.loan?.customer?.partner_name || 'N/A',
        latest_follow_up: latest,
        all_follow_ups: sorted
      };
    });

    return list;
  }, [followUps]);

  // Extract unique staff list
  const staffList = useMemo(() => {
    const set = new Set<string>();
    followUps.forEach(f => {
      if (f.followed_up_by) set.add(f.followed_up_by);
    });
    return Array.from(set);
  }, [followUps]);

  // Filtered list
  const filteredGroups = useMemo(() => {
    return groupedData.filter(g => {
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const matchLoan = g.loan_number.toLowerCase().includes(q);
        const matchCust = g.customer_name.toLowerCase().includes(q);
        const matchPhone = g.customer_phone.toLowerCase().includes(q);
        const matchPartner = g.partner_name.toLowerCase().includes(q);
        if (!matchLoan && !matchCust && !matchPhone && !matchPartner) {
          return false;
        }
      }

      if (loanTypeFilter !== 'ALL' && g.loan_category !== loanTypeFilter) {
        return false;
      }

      if (resultFilter !== 'ALL' && g.latest_follow_up.result !== resultFilter) {
        return false;
      }

      if (staffFilter !== 'ALL' && g.latest_follow_up.followed_up_by !== staffFilter) {
        return false;
      }

      if (dateFilter && g.latest_follow_up.follow_up_date !== dateFilter) {
        return false;
      }

      return true;
    });
  }, [groupedData, searchQuery, loanTypeFilter, resultFilter, staffFilter, dateFilter]);

  const handleExportCSV = () => {
    if (filteredGroups.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = ['Loan Number', 'Category', 'Customer Name', 'Phone', 'Staff Name', 'Call Date', 'Result', 'Promised Amount', 'Remarks'];
    const rows = filteredGroups.map(g => [
      g.loan_number,
      g.loan_category,
      g.customer_name,
      g.customer_phone,
      g.latest_follow_up.followed_up_by,
      g.latest_follow_up.follow_up_date,
      g.latest_follow_up.result,
      g.latest_follow_up.promised_amount || 0,
      g.latest_follow_up.narration || ''
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Call_History_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Call History exported successfully');
  };

  const getCompactStatusStyle = (result: string) => {
    const r = (result || '').toUpperCase();
    if (r === 'ANSWERED') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (r === 'PROMISED TO PAY' || r === 'PROMISED') return 'bg-blue-100 text-blue-800 border-blue-300';
    if (r === 'CALL BACK' || r === 'CALLBACK') return 'bg-purple-100 text-purple-800 border-purple-300';
    if (r === 'BUSY') return 'bg-amber-100 text-amber-800 border-amber-300';
    if (r === 'NO RESPONSE' || r === 'NO ANSWER' || r === 'SWITCHED OFF' || r === 'PENDING') return 'bg-slate-100 text-slate-700 border-slate-300';
    if (r === 'WRONG NUMBER' || r === 'INVALID NUMBER') return 'bg-rose-100 text-rose-800 border-rose-300';
    if (r === 'PAID' || r === 'PAID_CLOSED' || r === 'LOAN_CLOSED') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (r === 'CLOSED' || r === 'NPA_CLOSED' || r === 'NPA CLOSED') return 'bg-orange-100 text-orange-800 border-orange-300';
    if (r === 'CUSTOMER_DECEASED' || r === 'DECEASED') return 'bg-slate-800 text-white border-slate-900';
    return 'bg-slate-100 text-slate-800 border-slate-300';
  };

  const stats = useMemo(() => {
    if (!selectedGroup) return { total: 0, answered: 0, promises: 0, callbacks: 0, pendingFollowUp: 0, lastContact: '—' };
    const list = selectedGroup.all_follow_ups;
    const total = list.length;
    const answered = list.filter(l => l.result === 'ANSWERED').length;
    const promises = list.filter(l => l.result === 'PROMISED TO PAY').length;
    const callbacks = list.filter(l => l.result === 'CALL BACK').length;
    const todayStr = new Date().toISOString().split('T')[0];
    const pendingFollowUp = list.filter(l => l.next_follow_up_date && l.next_follow_up_date >= todayStr).length;
    const lastContact = selectedGroup.latest_follow_up?.follow_up_date
      ? selectedGroup.latest_follow_up.follow_up_date.split('-').reverse().join('/')
      : '—';
    return { total, answered, promises, callbacks, pendingFollowUp, lastContact };
  }, [selectedGroup]);

  const handlePrintSingleLog = (log: FinanceLoanPaymentFollowup) => {
    toast.success(`Printing log #${log.id.slice(0, 6)}...`);
    window.print();
  };

  const timelinePrintContent = useMemo(() => {
    if (!selectedGroup) return null;
    return (
      <div className="p-4 text-slate-950 font-sans leading-tight uppercase text-[9px] print-audit-report">
        {/* Audit Report Header */}
        <div className="border-b-2 border-slate-900 pb-2 mb-3 flex justify-between items-end">
          <div>
            <h1 className="text-sm font-black tracking-wide text-slate-950">THIRUMALA FINANCE</h1>
            <h2 className="text-[10px] font-black uppercase text-slate-600">CALL HISTORY AUDIT REPORT</h2>
          </div>
          <div className="text-right font-mono text-[9px]">
            <div><span className="font-bold">GENERATED DATE:</span> {new Date().toLocaleString('en-IN')}</div>
            <div><span className="font-bold">OPERATOR:</span> {user?.username?.toUpperCase() || 'SYSTEM'}</div>
          </div>
        </div>

        {/* Compact Metadata Header Box */}
        <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-300 p-2 rounded mb-3 font-bold text-[9px]">
          <div><span className="text-slate-500 block text-[8px]">LOAN NUMBER</span> <span className="font-mono text-[10px] text-slate-950 font-black">{selectedGroup.loan_number}</span></div>
          <div><span className="text-slate-500 block text-[8px]">BORROWER</span> <span className="text-[10px] text-slate-950 font-black">{selectedGroup.customer_name}</span></div>
          <div><span className="text-slate-500 block text-[8px]">PHONE</span> <span className="font-mono text-slate-800">{selectedGroup.customer_phone || '—'}</span></div>
        </div>

        {/* Ledger Table */}
        <table className="w-full border-collapse border border-slate-400 text-[8.5px]">
          <thead>
            <tr className="border-b border-slate-400 bg-slate-200 font-bold text-slate-900 text-left">
              <th className="p-1 border border-slate-400 text-center w-6">SL</th>
              <th className="p-1 border border-slate-400 w-16">DATE</th>
              <th className="p-1 border border-slate-400 w-14">TIME</th>
              <th className="p-1 border border-slate-400 w-18 text-center">STATUS</th>
              <th className="p-1 border border-slate-400 w-20">CONTACTED</th>
              <th className="p-1 border border-slate-400 w-16">OPERATOR</th>
              <th className="p-1 border border-slate-400">REMARKS &amp; PROMISED DETAILS</th>
              <th className="p-1 border border-slate-400 w-16 text-center">NEXT FOLLOW-UP</th>
            </tr>
          </thead>
          <tbody>
            {selectedGroup.all_follow_ups.map((log, idx) => {
              const dateObj = new Date(log.followed_up_at || log.follow_up_date);
              const dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
              const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
              const contactedText = log.contacted_person === 'CUSTOMER' ? 'Borrower' :
                log.contacted_person === 'GUARANTOR_1' ? 'Guarantor 1' :
                log.contacted_person === 'GUARANTOR_2' ? 'Guarantor 2' : (log.contacted_person || '—');

              return (
                <tr key={log.id} className="border-b border-slate-300" style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                  <td className="p-1 border border-slate-300 text-center font-mono">{idx + 1}</td>
                  <td className="p-1 border border-slate-300 font-mono font-bold whitespace-nowrap">{dateStr}</td>
                  <td className="p-1 border border-slate-300 font-mono text-slate-700 whitespace-nowrap">{timeStr}</td>
                  <td className="p-1 border border-slate-300 text-center font-black whitespace-nowrap">{log.result}</td>
                  <td className="p-1 border border-slate-300 font-bold whitespace-nowrap">{contactedText}</td>
                  <td className="p-1 border border-slate-300 font-bold whitespace-nowrap">{log.followed_up_by || '—'}</td>
                  <td className="p-1 border border-slate-300 leading-tight">
                    {log.promised_amount ? (
                      <span className="font-bold text-slate-950 mr-1">[PROMISED: {log.promised_amount.toLocaleString('en-IN')}]</span>
                    ) : null}
                    {log.narration || '—'}
                  </td>
                  <td className="p-1 border border-slate-300 text-center font-mono font-bold whitespace-nowrap">
                    {log.next_follow_up_date ? log.next_follow_up_date.split('-').reverse().join('/') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer Summary */}
        <div className="mt-3 pt-1.5 border-t border-slate-400 flex justify-between items-center text-[8px] font-bold uppercase">
          <div>TOTAL CALL LOGS: {stats.total} | ANSWERED: {stats.answered} | PROMISES: {stats.promises} | CALLBACKS: {stats.callbacks}</div>
          <div>PAGE 1 OF 1</div>
        </div>
      </div>
    );
  }, [selectedGroup, stats, user]);

  const printableContent = useMemo(() => {
    return (
      <div className="p-6 uppercase font-bold text-xs">
        <h2 className="text-center text-lg border-b pb-2 mb-4">CALL HISTORY REPORT</h2>
        <div className="flex justify-between mb-4">
          <div>DATE: {new Date().toLocaleDateString('en-IN')}</div>
          <div>TOTAL RECORD GROUPS: {filteredGroups.length}</div>
        </div>
        <table className="w-full border-collapse border border-slate-400 text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-400 p-1.5 text-left">LOAN NO</th>
              <th className="border border-slate-400 p-1.5 text-left">CUSTOMER</th>
              <th className="border border-slate-400 p-1.5 text-left">DATE</th>
              <th className="border border-slate-400 p-1.5 text-left">RESULT</th>
              <th className="border border-slate-400 p-1.5 text-left">STAFF</th>
              <th className="border border-slate-400 p-1.5 text-left">REMARKS</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.map(g => (
              <tr key={g.loan_id} className="h-[36px]">
                <td className="border border-slate-400 p-1.5 font-mono">{g.loan_number}</td>
                <td className="border border-slate-400 p-1.5">{g.customer_name}</td>
                <td className="border border-slate-400 p-1.5">{g.latest_follow_up.follow_up_date}</td>
                <td className="border border-slate-400 p-1.5">{g.latest_follow_up.result}</td>
                <td className="border border-slate-400 p-1.5">{g.latest_follow_up.followed_up_by}</td>
                <td className="border border-slate-400 p-1.5 font-normal">{g.latest_follow_up.narration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [filteredGroups]);

  return (
    <div className="space-y-6">
      
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white border border-slate-150 rounded-xl p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600" />
            Call History Ledger
          </h2>
          <p className="text-xs font-bold text-slate-500 uppercase mt-0.5">
            Review and search historic collection calls and customer callbacks logs
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsPrinting(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold uppercase transition-colors shadow-sm cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold uppercase transition-colors shadow-sm cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter and Search Panel */}
      <div className="bg-white border border-slate-150 rounded-xl p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          
          {/* Search Box */}
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </span>
            <input
              type="text"
              placeholder="SEARCH ID / CUSTOMER / PHONE..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs font-bold uppercase text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

          {/* Loan Category */}
          <select
            value={loanTypeFilter}
            onChange={(e) => setLoanTypeFilter(e.target.value as any)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold uppercase text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
          >
            <option value="ALL">ALL LEDGERS</option>
            <option value="CD">CD LEDGER</option>
            <option value="HP">HP LEDGER</option>
            <option value="STBD">STBD LEDGER</option>
            <option value="TBD">TBD LEDGER</option>
          </select>

          {/* Result Filter */}
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold uppercase text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
          >
            <option value="ALL">ALL RESULTS</option>
            <option value="ANSWERED">ANSWERED</option>
            <option value="PROMISED TO PAY">PROMISED TO PAY</option>
            <option value="CALL BACK">CALL BACK</option>
            <option value="NO ANSWER">NO ANSWER</option>
            <option value="BUSY">BUSY</option>
            <option value="SWITCHED OFF">SWITCHED OFF</option>
            <option value="WRONG NUMBER">WRONG NUMBER</option>
            <option value="WRONG NUMBER">WRONG NUMBER</option>
          </select>

          {/* Staff Filter */}
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold uppercase text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
          >
            <option value="ALL">ALL STAFF</option>
            {staffList.map(staff => (
              <option key={staff} value={staff}>{staff.toUpperCase()}</option>
            ))}
          </select>

          {/* Call Date */}
          <div className="min-w-[150px]">
            <FinanceSmartCalendar
              value={dateFilter}
              onChange={setDateFilter}
              module="CALL_HISTORY"
              placeholder="FILTER CALL DATE"
              allowClear
            />
          </div>

        </div>
      </div>

      {/* Grid List */}
      <div className="bg-white border border-slate-150 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-slate-400 font-bold uppercase text-xs">
            Loading call logs database...
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-slate-400 font-bold uppercase text-xs">
            No Call History records match filters.
          </div>
        ) : (
          <div>
            <table className="w-full divide-y divide-slate-155">
              <thead className="bg-slate-50 uppercase font-bold text-[12px] text-slate-700">
                <tr>
                  <th className="px-3 py-2.5 text-left">Loan ID</th>
                  <th className="px-3 py-2.5 text-left">Borrower Name</th>
                  <th className="px-3 py-2.5 text-center">Last Call Date</th>
                  <th className="px-3 py-2.5 text-center">Result</th>
                  <th className="px-3 py-2.5 text-left">Staff Name</th>
                  <th className="px-3 py-2.5 text-left">Last Log Remarks</th>
                  <th className="px-3 py-2.5 text-center">Logs count</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredGroups.map((g) => (
                  <tr 
                    key={g.loan_id} 
                    onDoubleClick={() => handleOpenModal(g)}
                    className="hover:bg-slate-50/50 cursor-pointer transition-colors h-[38px]"
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 text-[13px] min-[1600px]:text-[14px] font-mono font-bold text-slate-900">{g.loan_number}</td>
                    <td className="px-3 py-1.5 text-[13px] min-[1600px]:text-[14px]">
                      <div className="font-bold text-slate-900">{g.customer_name}</div>
                      <div className="text-slate-500 font-mono tabular-nums">{g.customer_phone}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[13px] min-[1600px]:text-[14px] text-center font-mono font-bold text-slate-700 tabular-nums">
                      {g.latest_follow_up.follow_up_date}
                    </td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-black uppercase ${getCompactStatusStyle(g.latest_follow_up.result)}`}>
                        {g.latest_follow_up.result}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[13px] min-[1600px]:text-[14px] font-bold text-slate-700 uppercase">
                      {g.latest_follow_up.followed_up_by}
                    </td>
                    <td className="min-w-[9rem] [overflow-wrap:anywhere] px-3 py-1.5 text-[13px] min-[1600px]:text-[14px] text-slate-700" title={g.latest_follow_up.narration}>
                      {g.latest_follow_up.narration}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[13px] min-[1600px]:text-[14px] text-center font-bold font-mono text-indigo-700 bg-indigo-50/30">
                      {g.all_follow_ups.length}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[13px] min-[1600px]:text-[14px] text-right">
                      <button
                        onClick={() => handleOpenModal(g)}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-900 font-bold uppercase cursor-pointer"
                      >
                        Ledger
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Centered High-Density Audit Ledger Details Modal */}
      {showModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-xl border border-slate-200 max-w-[95vw] w-11/12 md:w-[90vw] lg:w-[85vw] shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
            
            {/* Modal Header — Single Compact 1-Line Row */}
            <div className="bg-[#0b1329] text-white px-4 py-2.5 flex justify-between items-center shrink-0">
              <div className="flex flex-wrap items-center gap-2.5 text-xs font-black uppercase tracking-wide">
                <span>ACCOUNT: <span className="text-blue-400 font-mono">{selectedGroup.loan_number}</span></span>
                <span className="text-slate-500">•</span>
                <span>BORROWER: <span className="text-slate-100">{selectedGroup.customer_name}</span></span>
                <span className="text-slate-500">•</span>
                <span>PHONE: <span className="text-slate-300 font-mono">{selectedGroup.customer_phone || '—'}</span></span>
              </div>
              <button 
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-hidden p-3.5 flex flex-col bg-slate-50/40 min-h-0">
              <div className="w-full flex flex-col overflow-hidden max-h-full">
                
                {/* Top Summary Bar - 40% Height Reduction Single Row */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3 shrink-0 uppercase font-bold text-center text-[10px]">
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-center">
                    <span className="text-slate-500 text-[11px] leading-none mb-1">Total Calls</span>
                    <span className="text-base font-black text-slate-900 leading-none tabular-nums">{stats.total}</span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-center">
                    <span className="text-slate-500 text-[11px] leading-none mb-1">Answered</span>
                    <span className="text-base font-black text-emerald-600 leading-none tabular-nums">{stats.answered}</span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-center">
                    <span className="text-slate-500 text-[11px] leading-none mb-1">Promises</span>
                    <span className="text-base font-black text-blue-600 leading-none tabular-nums">{stats.promises}</span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-center">
                    <span className="text-slate-500 text-[11px] leading-none mb-1">Callbacks</span>
                    <span className="text-base font-black text-purple-600 leading-none tabular-nums">{stats.callbacks}</span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-center">
                    <span className="text-slate-500 text-[11px] leading-none mb-1">Pending</span>
                    <span className="text-base font-black text-amber-700 leading-none tabular-nums">{stats.pendingFollowUp}</span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-center">
                    <span className="text-slate-500 text-[11px] leading-none mb-1">Last Call</span>
                    <span className="text-[14px] font-black text-slate-950 leading-none font-mono">{stats.lastContact}</span>
                  </div>
                </div>

                {/* Call History Ledger Table (Replacing Old Timeline Cards Completely) */}
                <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white shadow-2xs min-h-0">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-100 border-b border-slate-250 sticky top-0 font-black uppercase text-slate-600 select-none text-[10px]">
                      <tr>
                        <th className="px-2 py-1.5 border-r border-slate-200 text-center w-8">SL</th>
                        <th className="px-2 py-1.5 border-r border-slate-200 w-24">Date</th>
                        <th className="px-2 py-1.5 border-r border-slate-200 w-20">Time</th>
                        <th className="px-2.5 py-1.5 border-r border-slate-200 w-28 text-center">Status</th>
                        <th className="px-2.5 py-1.5 border-r border-slate-200 w-32">Contacted Person</th>
                        <th className="px-2 py-1.5 border-r border-slate-200 w-28">Operator</th>
                        <th className="px-2.5 py-1.5 border-r border-slate-200">Remarks &amp; Notes</th>
                        <th className="px-2 py-1.5 border-r border-slate-200 w-28 text-center">Next Follow-Up</th>
                        <th className="px-2 py-1.5 border-r border-slate-200 w-12 text-center">Attach</th>
                        <th className="px-2 py-1.5 border-r border-slate-200 w-12 text-center">Audio</th>
                        <th className="px-2 py-1.5 text-center w-16">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 font-sans">
                      {selectedGroup.all_follow_ups.map((log, idx) => {
                        const dateObj = new Date(log.followed_up_at || log.follow_up_date);
                        const dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                        const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                        const contactedText = log.contacted_person === 'CUSTOMER' ? 'Borrower' :
                          log.contacted_person === 'GUARANTOR_1' ? 'Guarantor 1' :
                          log.contacted_person === 'GUARANTOR_2' ? 'Guarantor 2' : (log.contacted_person || '—');

                        return (
                          <tr key={log.id} className="hover:bg-slate-50/80 transition-colors h-[38px]">
                            <td className="px-2 py-1.5 border-r border-slate-200 text-center font-bold text-slate-400 font-mono">{idx + 1}</td>
                            <td className="px-2 py-1.5 border-r border-slate-200 font-mono font-bold text-slate-800 whitespace-nowrap">{dateStr}</td>
                            <td className="px-2 py-1.5 border-r border-slate-200 font-mono text-slate-600 whitespace-nowrap">{timeStr}</td>
                            <td className="px-2.5 py-1.5 border-r border-slate-200 text-center whitespace-nowrap">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-black uppercase border ${getCompactStatusStyle(log.result)}`}>
                                {log.result}
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 border-r border-slate-200 font-semibold text-slate-800 uppercase whitespace-nowrap">{contactedText}</td>
                            <td className="px-2 py-1.5 border-r border-slate-200 font-semibold text-slate-700 uppercase whitespace-nowrap">{log.followed_up_by || '—'}</td>
                            <td className="px-2.5 py-1.5 border-r border-slate-200 text-slate-800 font-medium max-w-xs" title={log.narration || ''}>
                              <div className="line-clamp-2 leading-tight">
                                {log.promised_amount ? (
                                  <span className="font-bold text-emerald-700 mr-1.5 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200 font-mono text-[10px]">
                                    PROMISED: {log.promised_amount.toLocaleString('en-IN')}
                                  </span>
                                ) : null}
                                {log.narration || 'No remarks recorded.'}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 border-r border-slate-200 text-center font-mono font-bold text-slate-700 whitespace-nowrap">
                              {log.next_follow_up_date ? (
                                <span className="text-amber-800 font-black">{log.next_follow_up_date.split('-').reverse().join('/')}</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 border-r border-slate-200 text-center font-bold">
                              {(log as any).attachment_url ? (
                                <a href={(log as any).attachment_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 cursor-pointer" title="View Attachment">📎</a>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 border-r border-slate-200 text-center font-bold">
                              {(log as any).audio_url ? (
                                <a href={(log as any).audio_url} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-800 cursor-pointer" title="Listen Audio">🎤</a>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <button
                                onClick={() => handlePrintSingleLog(log)}
                                className="text-[10px] font-bold uppercase text-slate-600 hover:text-slate-900 border border-slate-200 rounded px-1.5 py-0.5 hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Print Log"
                              >
                                PRINT
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-4 py-2.5 sm:px-6 border-t border-slate-200 flex justify-between items-center shrink-0">
              <button
                onClick={() => setIsTimelinePrinting(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0b1329] text-white hover:bg-slate-800 rounded-lg text-xs font-bold uppercase transition-colors shadow-2xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print Audit Report
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold uppercase transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Print Preview Handler */}
      <FinancePrintPreview
        isOpen={isPrinting}
        onClose={() => setIsPrinting(false)}
        title="Call History Ledger Report"
        documentTitle="CallHistoryReport"
      >
        {printableContent}
      </FinancePrintPreview>

      {/* Individual Customer Timeline Print Preview */}
      <FinancePrintPreview
        isOpen={isTimelinePrinting}
        onClose={() => setIsTimelinePrinting(false)}
        title="Customer Interaction Timeline"
        documentTitle={`Timeline_${selectedGroup?.loan_number || 'Report'}`}
      >
        {timelinePrintContent}
      </FinancePrintPreview>

    </div>
  );
};

export default CallHistory;
