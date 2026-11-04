import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { 
  User, 
  Search, 
  Edit2, 
  Plus, 
  ArrowLeft, 
  RefreshCw, 
  Info,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Printer,
  X,
  MapPin,
  FileCode,
  History,
  ShieldAlert
} from 'lucide-react';
import toast from 'react-hot-toast';

export const getRelationshipDisplay = (rawRel: string | null | undefined): { label: string; name: string } => {
  if (!rawRel) return { label: 'Father/Husband/Wife', name: 'N/A' };
  if (rawRel.includes(':')) {
    const parts = rawRel.split(':');
    return { label: parts[0], name: parts[1] || '' };
  }
  return { label: 'Father/Husband', name: rawRel };
};

interface CustomerWithLoans {
  id: string;
  customer_id: number;
  name: string;
  father_husband_name: string | null;
  father_name: string | null;
  phone: string | null;
  phone_1: string | null;
  phone2: string | null;
  phone_2: string | null;
  village: string | null;
  present_village: string | null;
  aadhaar_village: string | null;
  mandal: string | null;
  present_mandal: string | null;
  aadhaar_mandal: string | null;
  district: string | null;
  present_district: string | null;
  aadhaar_district: string | null;
  address: string | null;
  present_address: string | null;
  aadhaar_address: string | null;
  aadhaar: string | null;
  partner_name: string | null;
  customer_photo_url: string | null;
  customer_fingerprint_image_url?: string | null;
  created_at: string;
  loans: {
    id: string;
    loan_id: string;
    loan_category: string;
    status: string;
    outstanding_amount?: number;
  }[];
}

const Customers: React.FC = () => {
  const navigate = useNavigate();

  // State
  const [customers, setCustomers] = useState<CustomerWithLoans[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Stats Counters
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    lastUpdated: '—'
  });

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<'Customer ID' | 'Latest' | 'Oldest' | 'Name' | 'Village' | 'Mandal' | 'District' | 'Partner'>('Customer ID');
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [pageIndex, setPageIndex] = useState(0);

  // Selected Customer Profile View Modal & Extra parameters
  const [selectedCust, setSelectedCust] = useState<CustomerWithLoans | null>(null);
  const [selectedCustDocs, setSelectedCustDocs] = useState<any[]>([]);
  const [selectedCustFollowups, setSelectedCustFollowups] = useState<any[]>([]);
  const [selectedCustGuarantors, setSelectedCustGuarantors] = useState<any[]>([]);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPageIndex(0); // Reset page on search change
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Listen to instant customer photo updates
  useEffect(() => {
    const handlePhotoUpdated = (e: Event) => {
      const customEvt = e as CustomEvent<{ customerId: string; photoUrl: string }>;
      if (customEvt.detail?.customerId && customEvt.detail?.photoUrl) {
        setCustomers(prev =>
          prev.map(c =>
            c.id === customEvt.detail.customerId
              ? { ...c, customer_photo_url: customEvt.detail.photoUrl }
              : c
          )
        );
      }
    };
    window.addEventListener('customer_photo_updated', handlePhotoUpdated);
    return () => window.removeEventListener('customer_photo_updated', handlePhotoUpdated);
  }, []);

  // Fetch summary counters
  const fetchStats = async () => {
    try {
      const { count: total } = await supabase.from('finance_customers').select('*', { count: 'exact', head: true });
      const { count: active } = await supabase.from('finance_loans').select('id', { count: 'exact', head: true }).eq('status', 'Active');
      
      const { data: lastLog } = await supabase
        .from('finance_edited_logs')
        .select('edited_at')
        .order('edited_at', { ascending: false })
        .limit(1);

      const lastUpdatedStr = lastLog && lastLog[0] 
        ? new Date(lastLog[0].edited_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
        : '—';

      setStats({
        total: total || 0,
        active: active || 0,
        inactive: (total || 0) - (active || 0),
        lastUpdated: lastUpdatedStr
      });
    } catch (err) {
      console.warn('Could not fetch dashboard counters', err);
    }
  };

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      let queryBuilder = supabase
        .from('finance_customers')
        .select('*', { count: 'exact' });

      // Apply Search filter on multiple columns
      const trimmedQuery = debouncedSearch.trim();
      if (trimmedQuery.length >= 2) {
        let matchingCustomerIds: string[] = [];
        
        // Match loan numbers
        if (trimmedQuery.length >= 3) {
          const { data: loanMatches } = await supabase
            .from('finance_loans')
            .select('customer_id')
            .ilike('loan_id', `%${trimmedQuery}%`);
          if (loanMatches && loanMatches.length > 0) {
            matchingCustomerIds = loanMatches.map(lm => lm.customer_id).filter(Boolean) as string[];
          }
        }

        // Match partners
        const { data: partnerMatches } = await supabase
          .from('finance_partners')
          .select('name')
          .ilike('name', `%${trimmedQuery}%`);
        const partnerNames = partnerMatches ? partnerMatches.map(p => p.name) : [];

        const isNum = !isNaN(Number(trimmedQuery));
        let filterStr = `name.ilike.%${trimmedQuery}%,phone.ilike.%${trimmedQuery}%,phone_1.ilike.%${trimmedQuery}%,phone_2.ilike.%${trimmedQuery}%,aadhaar.ilike.%${trimmedQuery}%,father_name.ilike.%${trimmedQuery}%,father_husband_name.ilike.%${trimmedQuery}%,address.ilike.%${trimmedQuery}%,present_address.ilike.%${trimmedQuery}%,present_village.ilike.%${trimmedQuery}%,village.ilike.%${trimmedQuery}%,mandal.ilike.%${trimmedQuery}%,present_mandal.ilike.%${trimmedQuery}%,district.ilike.%${trimmedQuery}%,present_district.ilike.%${trimmedQuery}%`;
        
        if (isNum) {
          filterStr += `,customer_id.eq.${trimmedQuery}`;
        }
        if (partnerNames.length > 0) {
          partnerNames.forEach(pn => {
            filterStr += `,partner_name.ilike.%${pn}%`;
          });
        }
        if (matchingCustomerIds.length > 0) {
          matchingCustomerIds.forEach(cid => {
            filterStr += `,id.eq.${cid}`;
          });
        }
        
        queryBuilder = queryBuilder.or(filterStr);
      }

      // Apply Sorting - default to ascending numerical Customer ID
      if (sortBy === 'Name') {
        queryBuilder = queryBuilder.order('name', { ascending: true });
      } else if (sortBy === 'Customer ID') {
        queryBuilder = queryBuilder.order('customer_id', { ascending: true, nullsFirst: false });
      } else if (sortBy === 'Latest') {
        queryBuilder = queryBuilder.order('created_at', { ascending: false });
      } else if (sortBy === 'Oldest') {
        queryBuilder = queryBuilder.order('created_at', { ascending: true });
      } else if (sortBy === 'Village') {
        queryBuilder = queryBuilder.order('present_village', { ascending: true });
      } else if (sortBy === 'Mandal') {
        queryBuilder = queryBuilder.order('present_mandal', { ascending: true });
      } else if (sortBy === 'District') {
        queryBuilder = queryBuilder.order('present_district', { ascending: true });
      } else if (sortBy === 'Partner') {
        queryBuilder = queryBuilder.order('partner_name', { ascending: true });
      } else {
        queryBuilder = queryBuilder.order('customer_id', { ascending: true, nullsFirst: false });
      }

      // Pagination
      const from = pageIndex * pageSize;
      const to = from + pageSize - 1;
      queryBuilder = queryBuilder.range(from, to);

      const { data, count, error } = await queryBuilder;
      if (error) throw error;

      const rawCustomers = data || [];

      // Fetch linked loans in a batch to calculate active status details
      if (rawCustomers.length > 0) {
        const customerIds = rawCustomers.map(c => c.id);
        const { data: dbLoans } = await supabase
          .from('finance_loans')
          .select('id, customer_id, loan_id, loan_category, status, total_principal')
          .in('customer_id', customerIds);

        const mapped: CustomerWithLoans[] = rawCustomers.map(c => {
          const linkedLoans = (dbLoans || [])
            .filter(l => l.customer_id === c.id)
            .map(l => ({
              id: l.id,
              loan_id: l.loan_id,
              loan_category: l.loan_category,
              status: l.status,
              outstanding_amount: l.total_principal
            }));

          return {
            ...c,
            loans: linkedLoans
          };
        });

        setCustomers(mapped);
      } else {
        setCustomers([]);
      }

      setTotalCount(count || 0);
    } catch (err) {
      console.error(err);
      toast.error('Failed to query database');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, sortBy, pageIndex, pageSize]);

  useEffect(() => {
    fetchCustomers();
    fetchStats();
  }, [fetchCustomers]);

  // Load extra details when selectedCust is opened
  useEffect(() => {
    if (!selectedCust) {
      setSelectedCustDocs([]);
      setSelectedCustFollowups([]);
      setSelectedCustGuarantors([]);
      return;
    }

    const fetchExtraDetails = async () => {
      try {
        const loanIds = selectedCust.loans.map(l => l.id);
        if (loanIds.length === 0) return;

        // Fetch documents
        const { data: docs } = await supabase
          .from('finance_loan_documents')
          .select('*')
          .in('loan_id', loanIds);
        setSelectedCustDocs(docs || []);

        // Fetch followups
        const { data: followups } = await supabase
          .from('finance_loan_payment_followups')
          .select('*')
          .in('loan_id', loanIds)
          .order('followed_up_at', { ascending: false });
        setSelectedCustFollowups(followups || []);

        // Fetch guarantors
        const { data: loansWithGuarantors } = await supabase
          .from('finance_loans')
          .select('id, loan_id, guarantor_1_id, guarantor_2_id')
          .in('id', loanIds);
        
        if (loansWithGuarantors && loansWithGuarantors.length > 0) {
          const gIds = [
            ...loansWithGuarantors.map(l => l.guarantor_1_id),
            ...loansWithGuarantors.map(l => l.guarantor_2_id)
          ].filter(Boolean) as string[];

          if (gIds.length > 0) {
            const { data: guarantors } = await supabase
              .from('finance_customers')
              .select('id, name, phone_1, phone, customer_id')
              .in('id', gIds);
            setSelectedCustGuarantors(guarantors || []);
          }
        }
      } catch (err) {
        console.error('Failed to load customer profile details:', err);
      }
    };

    fetchExtraDetails();
  }, [selectedCust]);

  const handlePrint = (cust: CustomerWithLoans) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const rel = getRelationshipDisplay(cust.father_name || cust.father_husband_name);
    const activeLoans = cust.loans?.filter(l => l.status === 'Active') || [];
    const closedLoans = cust.loans?.filter(l => l.status === 'Closed') || [];

    printWindow.document.write(`
      <html>
        <head>
          <title>Customer Profile Sheet - #${cust.customer_id}</title>
          <style>
            body { font-family: 'Times New Roman', Times, serif; padding: 25px; color: #000; line-height: 1.35; font-size: 13px; text-transform: uppercase; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
            .header h2 { margin: 0; font-size: 24px; font-weight: bold; text-transform: uppercase; }
            .header h3 { margin: 3px 0 0 0; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
            .section-title { font-weight: bold; text-transform: uppercase; font-size: 13px; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 8px; margin-top: 15px; }
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
            .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
            .info-table td { padding: 4px 6px; border: 1px solid #ddd; vertical-align: top; }
            .info-table td.lbl { font-weight: bold; width: 35%; background: #f9f9f9; text-transform: uppercase; font-size: 11px; }
            .photo-signature-box { display: flex; justify-content: space-between; align-items: start; margin-top: 10px; border: 1px solid #000; padding: 12px; background: #fff; }
            .photo-box { width: 110px; height: 110px; border: 1px solid #000; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 10px; font-weight: bold; }
            .photo-box img { max-width: 100%; max-height: 100%; object-fit: cover; }
            .sig-box { width: 180px; height: 80px; border: 1px solid #000; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 10px; font-weight: bold; }
            .sig-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
            table.loans-table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 12px; }
            table.loans-table th { border: 1px solid #000; background: #f0f0f0; font-weight: bold; padding: 4px 6px; text-align: left; text-transform: uppercase; }
            table.loans-table td { border: 1px solid #000; padding: 4px 6px; }
            .footer-meta { font-size: 10px; color: #555; text-align: right; margin-top: 20px; border-top: 1px dashed #ccc; padding-top: 5px; }
            @media print {
              body { padding: 0; }
              @page { size: A4; margin: 1cm; }
            }
          </style>
        </head>
        <body onload="window.print()">
          <div class="header">
            <h2>THIRUMALA GROUPS</h2>
            <h3>Borrower Registry Registry Profile Sheet</h3>
          </div>

          <div style="display: flex; gap: 15px; margin-bottom: 10px;">
            <div style="flex: 1;">
              <div class="section-title" style="margin-top: 0;">Borrower Profile Details</div>
              <table class="info-table">
                <tr>
                  <td class="lbl">Customer ID</td>
                  <td style="font-weight: bold; font-family: monospace;">#${cust.customer_id || 'N/A'}</td>
                </tr>
                <tr>
                  <td class="lbl">Borrower Name</td>
                  <td style="font-weight: bold; text-transform: uppercase;">${cust.name}</td>
                </tr>
                <tr>
                  <td class="lbl">${rel.label}</td>
                  <td style="text-transform: uppercase;">${rel.name}</td>
                </tr>
                <tr>
                  <td class="lbl">Introducing Partner</td>
                  <td style="text-transform: uppercase;">${cust.partner_name || 'Direct / None'}</td>
                </tr>
              </table>
            </div>
            <div class="photo-box" style="margin-top: 10px;">
              ${cust.customer_photo_url ? `<img src="${cust.customer_photo_url}" />` : 'NO PHOTOGRAPH'}
            </div>
          </div>

          <div class="grid-2">
            <div>
              <div class="section-title">Contact Information</div>
              <table class="info-table">
                <tr>
                  <td class="lbl">Primary Phone</td>
                  <td style="font-family: monospace; font-weight: bold;">${cust.phone_1 || cust.phone || '—'}</td>
                </tr>
                <tr>
                  <td class="lbl">Alternate Phone</td>
                  <td style="font-family: monospace;">${cust.phone_2 || cust.phone2 || '—'}</td>
                </tr>
                <tr>
                  <td class="lbl">Aadhaar UID</td>
                  <td style="font-family: monospace; font-weight: bold;">${cust.aadhaar || '—'}</td>
                </tr>
              </table>
            </div>

            <div>
              <div class="section-title">Locality / Area Parameters</div>
              <table class="info-table">
                <tr>
                  <td class="lbl">Village / Locality</td>
                  <td style="text-transform: uppercase;">${cust.present_village || cust.village || '—'}</td>
                </tr>
                <tr>
                  <td class="lbl">Mandal / Taluk</td>
                  <td style="text-transform: uppercase;">${cust.present_mandal || cust.mandal || '—'}</td>
                </tr>
                <tr>
                  <td class="lbl">District</td>
                  <td style="text-transform: uppercase;">${cust.present_district || cust.district || '—'}</td>
                </tr>
              </table>
            </div>
          </div>

          <div class="section-title">Address Information</div>
          <table class="info-table">
            <tr>
              <td class="lbl" style="width: 25%;">Present / Present Address</td>
              <td>${cust.present_address || cust.address || '—'}</td>
            </tr>
            <tr>
              <td class="lbl" style="width: 25%;">Aadhaar / Permanent Address</td>
              <td>${cust.aadhaar_address || '—'}</td>
            </tr>
          </table>

          <div class="section-title">Loan Accounts registry Summary</div>
          <div style="margin-bottom: 10px;">
            <p style="margin: 0 0 5px 0; font-weight: bold; font-size: 11px; text-transform: uppercase; color: #444;">Active Accounts (${activeLoans.length})</p>
            ${activeLoans.length > 0 ? `
              <table class="loans-table">
                <thead>
                  <tr>
                    <th style="width: 20%;">Loan ID</th>
                    <th style="width: 25%;">Category</th>
                    <th style="width: 25%;">Outstanding Principal</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${activeLoans.map(l => `
                    <tr>
                      <td style="font-family: monospace; font-weight: bold;">${l.loan_id}</td>
                      <td style="text-transform: uppercase;">${l.loan_category}</td>
                      <td style="font-weight: bold; font-family: monospace;">${l.outstanding_amount ? l.outstanding_amount.toLocaleString('en-IN') : '0.00'}</td>
                      <td style="font-weight: bold; color: green; text-transform: uppercase;">${l.status}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p style="margin: 0; font-style: italic; font-size: 11px; color: #777;">No active loan accounts.</p>'}
          </div>

          <div style="margin-top: 10px;">
            <p style="margin: 0 0 5px 0; font-weight: bold; font-size: 11px; text-transform: uppercase; color: #444;">Closed Accounts (${closedLoans.length})</p>
            ${closedLoans.length > 0 ? `
              <table class="loans-table">
                <thead>
                  <tr>
                    <th style="width: 20%;">Loan ID</th>
                    <th style="width: 25%;">Category</th>
                    <th style="width: 25%;">Outstanding Principal</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${closedLoans.map(l => `
                    <tr>
                      <td style="font-family: monospace; font-weight: bold;">${l.loan_id}</td>
                      <td style="text-transform: uppercase;">${l.loan_category}</td>
                      <td style="font-family: monospace;">${l.outstanding_amount ? l.outstanding_amount.toLocaleString('en-IN') : '0.00'}</td>
                      <td style="font-weight: bold; text-transform: uppercase; color: #555;">${l.status}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p style="margin: 0; font-style: italic; font-size: 11px; color: #777;">No closed loan accounts.</p>'}
          </div>

          <div class="section-title">Fingerprint / Signature Capture</div>
          <div class="photo-signature-box">
            <div>
              <p style="margin: 0 0 5px 0; font-weight: bold; font-size: 10px; text-transform: uppercase;">Borrower Digital Signature</p>
              <div class="sig-box">
                ${cust.customer_fingerprint_image_url ? `<img src="${cust.customer_fingerprint_image_url}" />` : 'NO CAPTURED SIGNATURE'}
              </div>
            </div>
            <div>
              <p style="margin: 0 0 5px 0; font-weight: bold; font-size: 10px; text-transform: uppercase;">Operator Signature & Stamp</p>
              <div class="sig-box" style="border: 1px dashed #999; display: flex; align-items: flex-end; padding-bottom: 5px;">
                <span style="font-size: 8px; color: #aaa; text-transform: uppercase; width: 100%; text-align: center;">Verified Signature</span>
              </div>
            </div>
          </div>

          <div class="footer-meta">
            Generated Date: ${new Date().toLocaleString('en-IN')} | Generated By: Thirumala Finance Registry
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };



  return (
    <div className="space-y-3 w-full select-none font-outfit text-slate-800 p-2">
      
      {/* Top Header Actions Bar */}
      <div className="flex justify-between items-center bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        <div>
          <h1 className="text-[24px] font-bold uppercase text-slate-900 tracking-tight leading-none">CUSTOMERS</h1>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs font-bold text-slate-500 uppercase">
            <span>Registered Borrowers: <strong className="text-slate-800 font-mono">{stats.total}</strong></span>
            <span>•</span>
            <span>Total Customers: <strong className="text-slate-800 font-mono">{stats.total}</strong></span>
            <span>•</span>
            <span>Active: <strong className="text-emerald-700 font-mono">{stats.active}</strong></span>
            <span>•</span>
            <span>Inactive (future): <strong className="text-slate-700 font-mono">{stats.inactive}</strong></span>
            <span>•</span>
            <span>Last Updated: <strong className="text-slate-800 font-mono">{stats.lastUpdated}</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate('/finance')}
            className="inline-flex items-center justify-center gap-1 px-3 h-[48px] bg-white text-slate-700 border border-slate-250 rounded hover:bg-slate-50 font-bold text-[16px] uppercase"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={() => { fetchCustomers(); fetchStats(); }}
            className="inline-flex items-center justify-center gap-1 px-3 h-[48px] bg-white text-slate-700 border border-slate-250 rounded hover:bg-slate-50 font-bold text-[16px] uppercase"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => navigate('/finance/new-customer')}
            className="inline-flex items-center justify-center gap-1 px-4 h-[48px] bg-[#0b1329] text-white border border-slate-800 rounded hover:bg-slate-800 font-bold text-[16px] uppercase"
          >
            <Plus className="w-4 h-4" />
            New Customer
          </button>
        </div>
      </div>

      {/* Filters & Search Control Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-white border border-slate-200 rounded-lg p-3 shadow-sm items-end">
        {/* Search Input */}
        <div className="md:col-span-6 relative space-y-1">
          <label className="text-[15px] font-bold text-slate-500 uppercase block">Search Borrowers</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID / Name / Phone / Aadhaar / Village / Partner..."
              className="w-full pl-9 pr-8 border border-slate-250 rounded text-[16px] text-slate-800 placeholder-slate-400 focus:outline-none font-bold h-[50px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-4 text-slate-400 hover:text-slate-650 font-black text-xs"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Sort select */}
        <div className="md:col-span-3 space-y-1">
          <label className="text-[15px] font-bold text-slate-500 uppercase block">Sort</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full bg-white border border-slate-250 rounded px-3 text-[16px] text-slate-850 focus:outline-none h-[48px] font-bold uppercase"
          >
            <option value="Customer ID">Customer ID (Asc)</option>
            <option value="Latest">Newest</option>
            <option value="Oldest">Oldest</option>
            <option value="Name">Name A-Z</option>
            <option value="Village">Village</option>
            <option value="Mandal">Mandal</option>
            <option value="District">District</option>
            <option value="Partner">Partner</option>
          </select>
        </div>

        {/* Size select */}
        <div className="md:col-span-3 space-y-1">
          <label className="text-[15px] font-bold text-slate-500 uppercase block">Rows Per Page</label>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value) as any); setPageIndex(0); }}
            className="w-full bg-white border border-slate-250 rounded px-3 text-[16px] text-slate-800 focus:outline-none h-[48px] font-bold"
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </select>
        </div>
      </div>

      {/* Main Customers List Card */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-900 mb-2"></div>
          <p className="text-slate-500 font-bold uppercase text-[11px] tracking-wider">Loading Customer DB...</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-slate-200 shadow-sm space-y-3">
          <div className="p-2 bg-slate-50 border rounded-full max-w-fit mx-auto">
            <Info className="w-8 h-8 text-slate-300" />
          </div>
          <h2 className="text-sm font-bold uppercase text-slate-700">No Customers Found</h2>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col w-full">
          {/* Table Container */}
          <div className="overflow-x-auto overflow-y-auto max-h-[520px] w-full custom-scrollbar">
            <table className="w-full table-fixed divide-y divide-slate-200 text-[13px]">
              <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700">
                <tr className="divide-x divide-slate-200">
                  <th className="w-[4%] min-w-[36px] px-1.5 py-2.5 text-center font-bold uppercase text-[11px] tracking-wider">SL</th>
                  <th className="w-[6%] min-w-[55px] px-2 py-2.5 text-center font-bold uppercase text-[11px] tracking-wider">Cust ID</th>
                  <th className="w-[19%] min-w-[140px] px-3 py-2.5 text-left font-bold uppercase text-[11px] tracking-wider">Borrower Name</th>
                  <th className="w-[11%] min-w-[95px] px-2 py-2.5 text-left font-bold uppercase text-[11px] tracking-wider">Phone 1</th>
                  <th className="w-[11%] min-w-[95px] px-2 py-2.5 text-left font-bold uppercase text-[11px] tracking-wider">Phone 2</th>
                  <th className="w-[13%] min-w-[100px] px-2.5 py-2.5 text-left font-bold uppercase text-[11px] tracking-wider">Village</th>
                  <th className="w-[13%] min-w-[100px] px-2.5 py-2.5 text-left font-bold uppercase text-[11px] tracking-wider">Mandal</th>
                  <th className="w-[14%] min-w-[100px] px-2.5 py-2.5 text-left font-bold uppercase text-[11px] tracking-wider">District</th>
                  <th className="w-[9%] min-w-[80px] px-1.5 py-2.5 text-center font-bold uppercase text-[11px] tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white divide-x divide-slate-100 font-semibold text-slate-800">
                {customers.map((cust, index) => {
                  return (
                    <tr
                      key={cust.id}
                      onClick={() => setSelectedCust(cust)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="px-1.5 py-2 text-center text-slate-400 font-mono font-bold text-xs">
                        {pageIndex * pageSize + index + 1}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-900 font-bold text-center text-xs">
                        {cust.customer_id ?? '—'}
                      </td>
                      <td className="px-3 py-2 uppercase text-slate-900 font-bold break-words whitespace-normal leading-snug">
                        {cust.name}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-800 font-bold whitespace-nowrap text-xs">
                        {cust.phone_1 || cust.phone || '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-500 whitespace-nowrap text-xs">
                        {cust.phone_2 || cust.phone2 || '—'}
                      </td>
                      <td className="px-2.5 py-2 text-slate-800 uppercase break-words whitespace-normal text-xs leading-snug">
                        {cust.present_village || cust.village || cust.aadhaar_village || '—'}
                      </td>
                      <td className="px-2.5 py-2 text-slate-800 uppercase break-words whitespace-normal text-xs leading-snug">
                        {cust.present_mandal || cust.mandal || cust.aadhaar_mandal || '—'}
                      </td>
                      <td className="px-2.5 py-2 text-slate-800 uppercase break-words whitespace-normal text-xs leading-snug">
                        {cust.present_district || cust.district || cust.aadhaar_district || '—'}
                      </td>
                      <td className="px-1.5 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-center gap-1.5 items-center">
                          <button
                            onClick={() => setSelectedCust(cust)}
                            title="View Details"
                            className="p-1 hover:bg-slate-100 rounded text-slate-600 border border-slate-200 active:scale-95 transition-transform"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => navigate(`/finance/new-customer?edit=${cust.id}`)}
                            title="Edit Borrower"
                            className="p-1 hover:bg-slate-100 rounded text-slate-600 border border-slate-200 active:scale-95 transition-transform"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePrint(cust)}
                            title="Print profile"
                            className="p-1 hover:bg-slate-100 rounded text-slate-600 border border-slate-200 active:scale-95 transition-transform"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table pagination Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex items-center justify-between">
            <div className="text-slate-500 font-bold text-xs uppercase">
              Showing <strong className="text-slate-850 font-mono">{pageIndex * pageSize + 1}</strong> to{' '}
              <strong className="text-slate-850 font-mono">
                {Math.min((pageIndex + 1) * pageSize, totalCount)}
              </strong>{' '}
              of <strong className="text-slate-850 font-mono">{totalCount}</strong> records
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                disabled={pageIndex === 0}
                className="p-1 rounded border border-slate-250 bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPageIndex(p => p + 1)}
                disabled={(pageIndex + 1) * pageSize >= totalCount}
                className="p-1 rounded border border-slate-250 bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Profile details View Modal */}
      {selectedCust && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white border border-slate-200 w-full max-w-5xl rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in duration-150">
            
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-slate-300">#{selectedCust.customer_id}</span>
                <span className="font-extrabold uppercase text-sm tracking-wide">{selectedCust.name}</span>
              </div>
              <button
                onClick={() => setSelectedCust(null)}
                className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-4 bg-slate-50">
              
              {/* Photo & Parameters row */}
              <div className="flex flex-col sm:flex-row gap-4 p-3 bg-white border border-slate-200 rounded items-start shadow-sm">
                <div className="w-20 h-20 rounded border border-slate-200 overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 group relative">
                  {selectedCust.customer_photo_url ? (
                    <>
                      <img
                        src={selectedCust.customer_photo_url}
                        alt={selectedCust.name}
                        className="w-full h-full object-cover"
                      />
                      <div 
                        onClick={() => selectedCust.customer_photo_url && setPreviewPhoto(selectedCust.customer_photo_url)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[9px] font-bold transition-opacity cursor-pointer uppercase"
                      >
                        Zoom
                      </div>
                    </>
                  ) : (
                    <User className="w-10 h-10 text-slate-350" />
                  )}
                </div>
                
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Guardian Relationship</span>
                    {(() => {
                      const rel = getRelationshipDisplay(selectedCust.father_name || selectedCust.father_husband_name);
                      return (
                        <span className="text-sm font-bold text-slate-850">
                          <strong className="text-[10px] text-slate-450 uppercase mr-1">{rel.label}:</strong>
                          {rel.name.toUpperCase()}
                        </span>
                      );
                    })()}
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Introducing Partner</span>
                    <span className="text-sm font-bold text-slate-800">{(selectedCust.partner_name || 'Direct Customer').toUpperCase()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Primary Phone</span>
                    <span className="text-sm font-mono font-bold text-slate-800">{selectedCust.phone_1 || selectedCust.phone || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Alternate Phone</span>
                    <span className="text-sm font-mono font-bold text-slate-800">{selectedCust.phone_2 || selectedCust.phone2 || '—'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Aadhaar UID (Protected)</span>
                    <span className="text-sm font-mono font-bold text-slate-900 tracking-wider">
                      {selectedCust.aadhaar ? `XXXX-XXXX-${selectedCust.aadhaar.slice(-4)}` : 'NOT FOUND'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Profile Date</span>
                    <span className="text-sm font-semibold text-slate-600">
                      {new Date(selectedCust.created_at).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Grid sections layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Left block */}
                <div className="space-y-4">
                  {/* Address */}
                  <div className="bg-white p-3 border border-slate-200 rounded space-y-2.5 shadow-sm">
                    <h4 className="text-[11px] font-bold uppercase text-slate-850 tracking-wider flex items-center gap-1.5 border-b pb-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      Address parameters
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="p-2 bg-slate-50 border border-slate-150 rounded">
                        <span className="text-[9px] text-slate-400 uppercase font-bold block">Present Address</span>
                        <p className="font-semibold text-slate-700 leading-normal">
                          {selectedCust.present_address || selectedCust.address || '—'}
                        </p>
                        <div className="text-[9px] font-bold text-slate-500 pt-1 uppercase">
                          Village: {selectedCust.present_village || selectedCust.village || '—'} | Mandal: {selectedCust.present_mandal || selectedCust.mandal || '—'}
                        </div>
                      </div>
                      
                      <div className="p-2 bg-slate-50 border border-slate-150 rounded">
                        <span className="text-[9px] text-slate-400 uppercase font-bold block">Aadhaar Address</span>
                        <p className="font-semibold text-slate-700 leading-normal">
                          {selectedCust.aadhaar_address || '—'}
                        </p>
                        <div className="text-[9px] font-bold text-slate-500 pt-1 uppercase">
                          Village: {selectedCust.aadhaar_village || '—'} | Mandal: {selectedCust.aadhaar_mandal || '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Documents list */}
                  <div className="bg-white p-3 border border-slate-200 rounded space-y-2 shadow-sm">
                    <h4 className="text-[11px] font-bold uppercase text-slate-850 tracking-wider flex items-center gap-1.5 border-b pb-1.5">
                      <FileCode className="w-3.5 h-3.5 text-slate-500" />
                      Documents Checklist ({selectedCustDocs.length})
                    </h4>
                    
                    {selectedCustDocs.length > 0 ? (
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                        {selectedCustDocs.map(doc => (
                          <div key={doc.id} className="flex justify-between items-center p-2 bg-slate-50 border border-slate-150 rounded text-xs">
                            <div>
                              <span className="font-bold text-slate-800 block leading-tight">{doc.document_name}</span>
                              <span className="text-[9px] text-slate-450 uppercase font-bold">{doc.category}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {doc.file_url && (
                                <a 
                                  href={doc.file_url} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="text-[9px] bg-slate-905 text-white font-bold uppercase px-2 py-0.5 rounded hover:bg-slate-800"
                                >
                                  View
                                </a>
                              )}
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${doc.is_submitted ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                {doc.is_submitted ? 'Submitted' : 'Pending'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 text-center text-xs text-slate-400 font-bold uppercase">
                        No uploaded documents.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right block */}
                <div className="space-y-4">
                  {/* Loan accounts summary */}
                  <div className="bg-white p-3 border border-slate-200 rounded space-y-2 shadow-sm">
                    <h4 className="text-[11px] font-bold uppercase text-slate-850 tracking-wider flex items-center gap-1.5 border-b pb-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      Loan Accounts ({selectedCust.loans.length})
                    </h4>
                    
                    {selectedCust.loans && selectedCust.loans.length > 0 ? (
                      <div className="border border-slate-200 rounded overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-100">
                            <tr>
                              <th className="px-2 py-1 text-left font-bold text-slate-600 uppercase">Loan ID</th>
                              <th className="px-2 py-1 text-left font-bold text-slate-600 uppercase">Type</th>
                              <th className="px-2 py-1 text-right font-bold text-slate-600 uppercase">Outstanding</th>
                              <th className="px-2 py-1 text-center font-bold text-slate-600 uppercase">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {selectedCust.loans.map(l => (
                              <tr key={l.id} className="hover:bg-slate-50/50">
                                <td className="px-2 py-1 font-mono font-bold text-slate-900">{l.loan_id}</td>
                                <td className="px-2 py-1 font-bold text-slate-650 uppercase">{l.loan_category}</td>
                                <td className="px-2 py-1 font-mono font-bold text-slate-800 text-right">
                                  {l.outstanding_amount ? l.outstanding_amount.toLocaleString('en-IN') : '0.00'}
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                    l.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-650'
                                  }`}>
                                    {l.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 text-center text-xs text-slate-400 font-bold uppercase">
                        No linked loan accounts.
                      </div>
                    )}
                  </div>

                  {/* Guarantors registry */}
                  <div className="bg-white p-3 border border-slate-200 rounded space-y-2 shadow-sm">
                    <h4 className="text-[11px] font-bold uppercase text-slate-850 tracking-wider flex items-center gap-1.5 border-b pb-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                      Guarantors ({selectedCustGuarantors.length})
                    </h4>
                    
                    {selectedCustGuarantors.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {selectedCustGuarantors.map(g => (
                          <div key={g.id} className="p-2 bg-slate-50 border border-slate-150 rounded">
                            <span className="text-[9px] text-slate-400 uppercase font-bold block">Guarantor Name</span>
                            <span className="font-bold text-slate-900 block uppercase">{g.name}</span>
                            <span className="text-[9px] text-slate-500 font-mono">Phone: {g.phone_1 || g.phone || '—'}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 text-center text-xs text-slate-400 font-bold uppercase">
                        No guarantors registry linked.
                      </div>
                    )}
                  </div>

                  {/* Call timeline */}
                  <div className="bg-white p-3 border border-slate-200 rounded space-y-2 shadow-sm">
                    <h4 className="text-[11px] font-bold uppercase text-slate-850 tracking-wider flex items-center gap-1.5 border-b pb-1.5">
                      <History className="w-3.5 h-3.5 text-slate-500" />
                      Follow-up Timeline ({selectedCustFollowups.length})
                    </h4>
                    
                    {selectedCustFollowups.length > 0 ? (
                      <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-0.5 text-xs">
                        {selectedCustFollowups.map(log => (
                          <div key={log.id} className="p-2 bg-slate-50 border border-slate-150 rounded space-y-1">
                            <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold uppercase">
                              <span>Staff: {log.followed_up_by}</span>
                              <span>{new Date(log.followed_up_at).toLocaleDateString('en-IN')}</span>
                            </div>
                            <p className="font-bold text-slate-800">
                              <span className="text-[9px] text-slate-450 uppercase font-bold mr-1">Outcome:</span>
                              {log.result}
                            </p>
                            <p className="text-slate-650 leading-relaxed text-[11px] bg-white p-1.5 border border-slate-100 rounded">
                              {log.narration}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 text-center text-xs text-slate-400 font-bold uppercase">
                        No callback followups logged.
                      </div>
                    )}
                  </div>
                </div>

              </div>

            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex justify-between items-center">
              <button
                onClick={() => handlePrint(selectedCust)}
                className="inline-flex items-center gap-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-250 rounded px-3 py-1.5 font-bold text-xs uppercase transition-colors shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Profile
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedCust(null)}
                  className="px-3 py-1.5 text-xs font-bold uppercase text-slate-600 hover:bg-slate-100 rounded border bg-white"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    const cid = selectedCust.id;
                    setSelectedCust(null);
                    navigate(`/finance/new-customer?edit=${cid}`);
                  }}
                  className="px-3 py-1.5 text-xs font-bold uppercase bg-slate-905 hover:bg-slate-800 text-white rounded active:scale-95 transition-transform"
                >
                  Edit Profile
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Photo Preview Modal */}
      {previewPhoto && (
        <div 
          onClick={() => setPreviewPhoto(null)}
          className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4 cursor-zoom-out"
        >
          <div className="relative max-w-lg max-h-[85vh] overflow-hidden rounded bg-white p-2">
            <img src={previewPhoto} alt="Customer Preview" className="max-w-full max-h-[80vh] object-contain rounded" />
            <button 
              onClick={() => setPreviewPhoto(null)}
              className="absolute top-4 right-4 bg-black/60 hover:bg-black text-white p-1 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default Customers;
