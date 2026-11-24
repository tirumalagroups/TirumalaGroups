import { sortNumerically } from '../../lib/financialCalculations';
import { getLocalBusinessDateISO } from '../../utils/dateUtils';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Input from '../../components/UI/Input';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance, FinanceCustomer, FinancePartner } from '../../lib/supabaseFinance';
import { supabase } from '../../lib/supabase';
import { 
  ArrowLeft, 
  User, 
  Calculator, 
  Printer, 
  X, 
  Trash2, 
  Check,
  Search,
  Camera,
  AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { validateFinanceForm, ValidationField } from '../../utils/financeValidation';
import { useAuth } from '../../contexts/AuthContext';
import { BiometricScanner } from '../../components/finance/BiometricScanner';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';
import { cdLedgerRebuildService } from '../../services/cdLedgerRebuildService';
import { buildHPContract, hpLoanPreview, isHPOpeningRow } from '../../services/hpLedgerEngine';


import { getRelationshipDisplay } from "../../utils/relationship";
export { getRelationshipDisplay };

// Module-level variable used to defer partner-name matching after partners list
// loads. Set by loadLoanForEdit, consumed by the partners useEffect.
let _deferredEditPartnerName: string | null = null;

interface LoanEntryProps {
  editLoanId?: string;
  onCancelEdit?: () => void;
}
const LoanEntry: React.FC<LoanEntryProps> = ({ editLoanId, onCancelEdit }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const dateRef = useRef<HTMLInputElement>(null);
  const loanIdRef = useRef<HTMLInputElement>(null);
  const partnerRef = useRef<HTMLSelectElement>(null);
  const custNameRef = useRef<HTMLInputElement>(null);
  const custPhoneRef = useRef<HTMLInputElement>(null);
  const g1SearchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const docChargesRef = useRef<HTMLInputElement>(null);
  const interestRateRef = useRef<HTMLInputElement>(null);
  const durationMonthsRef = useRef<HTMLInputElement>(null);
  const installmentsRef = useRef<HTMLInputElement>(null);
  const particularsRef = useRef<HTMLTextAreaElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // Form State - Basics
  const [date, setDate] = useState(() => getLocalBusinessDateISO());
  const [loanCategory, setLoanCategory] = useState<'CD' | 'STBD' | 'HP' | 'TBD' | 'L'>('CD');
  const [loanId, setLoanId] = useState('');

  // Form State - Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [custName, setCustName] = useState('');
  const [custFatherName, setCustFatherName] = useState('');
  const [custAadhaar, setCustAadhaar] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custPhone2, setCustPhone2] = useState('');
  const [custAadhaarAddress, setCustAadhaarAddress] = useState('');
  const [custPresentAddress, setCustPresentAddress] = useState('');
  const [custHouseNo, setCustHouseNo] = useState('');
  const [custMandal, setCustMandal] = useState('');
  const [custVillage, setCustVillage] = useState('');
  // Village saved on the customer record; when empty the field can be filled in here
  const [custVillageSaved, setCustVillageSaved] = useState(false);
  const [custDistrict, setCustDistrict] = useState('');
  const [custPhoto, setCustPhoto] = useState<string | null>(null);
  const [custSignature, setCustSignature] = useState<string | null>(null);
  const [custFingerprintUrl, setCustFingerprintUrl] = useState<string | null>(null);
  const [custFingerprintTemplate, setCustFingerprintTemplate] = useState<string | null>(null);
  const [custFingerprintAdded, setCustFingerprintAdded] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [custDropdownOpen, setCustDropdownOpen] = useState(false);
  const [npaWarning, setNpaWarning] = useState<any>(null);

  if (custFingerprintAdded) {
    // satisfies typescript unused warning
  }

  // Form State - Guarantor 1
  const [g1SelectedId, setG1SelectedId] = useState('');
  const [g1Name, setG1Name] = useState('');
  const [g1Phone, setG1Phone] = useState('');
  const [g1Phone2, setG1Phone2] = useState('');
  const [g1Aadhaar, setG1Aadhaar] = useState('');
  const [g1AadhaarAddress, setG1AadhaarAddress] = useState('');
  const [g1PresentAddress, setG1PresentAddress] = useState('');
  const [g1Photo, setG1Photo] = useState<string | null>(null);
  const [g1Signature, setG1Signature] = useState<string | null>(null);
  const [g1Search, setG1Search] = useState('');
  const [g1DropdownOpen, setG1DropdownOpen] = useState(false);

  // Form State - Guarantor 2
  const [g2SelectedId, setG2SelectedId] = useState('');
  const [g2Name, setG2Name] = useState('');
  const [g2Phone, setG2Phone] = useState('');
  const [g2Phone2, setG2Phone2] = useState('');
  const [g2Aadhaar, setG2Aadhaar] = useState('');
  const [g2AadhaarAddress, setG2AadhaarAddress] = useState('');
  const [g2PresentAddress, setG2PresentAddress] = useState('');
  const [g2Photo, setG2Photo] = useState<string | null>(null);
  const [g2Signature, setG2Signature] = useState<string | null>(null);
  const [g2Search, setG2Search] = useState('');
  const [g2DropdownOpen, setG2DropdownOpen] = useState(false);

  // Reference Data lists
  const [partners, setPartners] = useState<Partial<FinancePartner>[]>([]);
  const [activeLoans, setActiveLoans] = useState<any[]>([]);

  // Search Results State
  const [customerSearchResults, setCustomerSearchResults] = useState<Partial<FinanceCustomer>[]>([]);
  const [g1SearchResults, setG1SearchResults] = useState<Partial<FinanceCustomer>[]>([]);
  const [g2SearchResults, setG2SearchResults] = useState<Partial<FinanceCustomer>[]>([]);
  const [isSearchingCust, setIsSearchingCust] = useState(false);
  const [isSearchingG1, setIsSearchingG1] = useState(false);
  const [isSearchingG2, setIsSearchingG2] = useState(false);

  // Form State - Loan Terms
  const [amount, setAmount] = useState('');
  const [docCharges, setDocCharges] = useState('');
  const [interestRate, setInterestRate] = useState('3'); // 3% default
  const [durationMonths, setDurationMonths] = useState('');
  const [penaltyPercent, setPenaltyPercent] = useState('0.75'); // 0.75% default
  const [dueType, setDueType] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  const [particulars, setParticulars] = useState('');
  // HP only: total number of installments (saved in duration_months; the period goes in period_days)
  const [installmentsCount, setInstallmentsCount] = useState('');

  // Edit-only states
  const [hasLedgerActivity, setHasLedgerActivity] = useState(false);

  // Form State - Partner
  const [selectedPartnerId, setSelectedPartnerId] = useState('');

  // Form State - Dynamic Documents List
  const [loanDocs, setLoanDocs] = useState<Array<{ id?: string; name: string; fileUrl: string | null; fileName?: string }>>([
    { name: 'Gold Invoice', fileUrl: null },
    { name: 'Bank Passbook', fileUrl: null },
    { name: 'Land Registration', fileUrl: null },
    { name: 'Driving Licence', fileUrl: null }
  ]);

  // Form State - Asset/Collateral Multiple Locations
  const [locations, setLocations] = useState<Array<{
    address: string;
    latitude: string;
    longitude: string;
    mapsLink: string;
    image: string | null;
    remarks?: string;
    images?: string[];
  }>>([{ address: '', latitude: '', longitude: '', mapsLink: '', image: null, remarks: '', images: [] }]);

  // Form State - Remarks & Extra
  const [remarks, setRemarks] = useState('');
  const [extraDetails, setExtraDetails] = useState('');

  // Refs for closing dropdowns
  const dropdownRef = useRef<HTMLDivElement>(null);
  const g1DropdownRef = useRef<HTMLDivElement>(null);
  const g2DropdownRef = useRef<HTMLDivElement>(null);

  // Lookup states
  const [existingCdSearch, setExistingCdSearch] = useState('');
  const [isLookupMode, setIsLookupMode] = useState(false);
  const [cdSuggestions, setCdSuggestions] = useState<string[]>([]);
  const [showCdSuggestions, setShowCdSuggestions] = useState(false);
  const cdSearchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCustDropdownOpen(false);
      }
      if (g1DropdownRef.current && !g1DropdownRef.current.contains(e.target as Node)) {
        setG1DropdownOpen(false);
      }
      if (g2DropdownRef.current && !g2DropdownRef.current.contains(e.target as Node)) {
        setG2DropdownOpen(false);
      }
      if (cdSearchDropdownRef.current && !cdSearchDropdownRef.current.contains(e.target as Node)) {
        setShowCdSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const searchCache = useRef<Record<string, any[]>>({});

  // Debounced search hooks (Fetch only if search query is 2+ characters)
  useEffect(() => {
    if (!custSearch || custSearch.trim().length < 2) {
      setCustomerSearchResults([]);
      return;
    }
    const q = custSearch.trim();
    const cacheKey = `cust_${q.toLowerCase()}`;
    if (searchCache.current[cacheKey]) {
      setCustomerSearchResults(searchCache.current[cacheKey]);
      return;
    }

    setIsSearchingCust(true);
    const delay = setTimeout(async () => {
      const results = await supabaseFinance.searchCustomers(q);
      searchCache.current[cacheKey] = results;
      setCustomerSearchResults(results);
      setIsSearchingCust(false);
    }, 300);
    return () => clearTimeout(delay);
  }, [custSearch]);

  useEffect(() => {
    if (!g1Search || g1Search.trim().length < 2) {
      setG1SearchResults([]);
      return;
    }
    const q = g1Search.trim();
    const cacheKey = `g1_${q.toLowerCase()}`;
    if (searchCache.current[cacheKey]) {
      setG1SearchResults(searchCache.current[cacheKey]);
      return;
    }

    setIsSearchingG1(true);
    const delay = setTimeout(async () => {
      const results = await supabaseFinance.searchCustomers(q);
      searchCache.current[cacheKey] = results;
      setG1SearchResults(results);
      setIsSearchingG1(false);
    }, 300);
    return () => clearTimeout(delay);
  }, [g1Search]);

  useEffect(() => {
    if (!g2Search || g2Search.trim().length < 2) {
      setG2SearchResults([]);
      return;
    }
    const q = g2Search.trim();
    const cacheKey = `g2_${q.toLowerCase()}`;
    if (searchCache.current[cacheKey]) {
      setG2SearchResults(searchCache.current[cacheKey]);
      return;
    }

    setIsSearchingG2(true);
    const delay = setTimeout(async () => {
      const results = await supabaseFinance.searchCustomers(q);
      searchCache.current[cacheKey] = results;
      setG2SearchResults(results);
      setIsSearchingG2(false);
    }, 300);
    return () => clearTimeout(delay);
  }, [g2Search]);

  useEffect(() => {
    fetchReferenceData();
  }, []);

  useEffect(() => {
    if (editLoanId) {
      loadLoanForEdit(editLoanId);
    }
  }, [editLoanId]);

  const loadLoanForEdit = async (id: string) => {
    setLoading(true);
    try {
      const fullLoan = await supabaseFinance.getLoanById(id);
      if (!fullLoan) {
        toast.error('Failed to load loan record for editing');
        return;
      }

      // ── TRANSACTION LOCK DETECTION ─────────────────────────────────────────
      // Lock core fields when ANY transaction or ledger activity beyond opening entries exists.
      const [cdNonOpeningRes, txNonDisbRes, cdInterestRes, duesPaidRes] = await Promise.all([
        supabase
          .from('finance_cd_ledger_entries')
          .select('id')
          .eq('loan_id', id)
          .not('entry_type', 'in', '(original_loan,opening_commission,document_charge)')
          .limit(1),
        // (an HP loan's opening row, installment 1 kept at disbursement, is not a repayment)
        supabase
          .from('finance_transactions')
          .select('id, remarks')
          .eq('loan_id', id)
          .neq('type', 'Disbursement'),
        supabase
          .from('finance_cd_interest_details')
          .select('id')
          .eq('loan_id', id)
          .limit(1),
        supabase
          .from('finance_dues')
          .select('id')
          .eq('loan_id', id)
          .gt('paid_amount', 0)
          .limit(1),
      ]);

      const hasCustomerRepaymentActivity =
        !!(cdNonOpeningRes.data && cdNonOpeningRes.data.length > 0) ||
        !!(txNonDisbRes.data && txNonDisbRes.data.some((t: any) => !isHPOpeningRow(t))) ||
        !!(cdInterestRes.data && cdInterestRes.data.length > 0) ||
        !!(duesPaidRes.data && duesPaidRes.data.length > 0);

      setHasLedgerActivity(hasCustomerRepaymentActivity);

      // Customer
      const cust = fullLoan.customer;
      if (cust) {
        setSelectedCustomerId(cust.id);
        setCustName(cust.name || '');
        setCustPhone(cust.phone_1 || cust.phone || '');
        setCustPhone2(cust.phone_2 || cust.phone2 || '');
        setCustAadhaar(cust.aadhaar || '');
        setCustPhoto(cust.customer_photo_url || null);
        setCustSignature(cust.customer_fingerprint_image_url || null);
        setCustFatherName(cust.father_name || cust.father_husband_name || '');
        setCustAadhaarAddress(cust.aadhaar_address || '');
        setCustPresentAddress(cust.present_address || '');
        setCustHouseNo(cust.address || '');
        setCustMandal(cust.mandal || '');
        setCustVillage(cust.present_village || cust.village || '');
        setCustVillageSaved(!!(cust.present_village || cust.village));
        setCustDistrict(cust.district || '');
      }

      setLoanId(fullLoan.loan_id);
      setLoanCategory(fullLoan.loan_category as any || 'CD');
      // ── Always load the stored loan date ──
      if (fullLoan.date) {
        setDate(fullLoan.date.substring(0, 10));
      }
      setAmount(String(fullLoan.amount));
      setInterestRate(String(fullLoan.interest_rate));
      if (fullLoan.loan_category === 'HP') {
        // HP: period in period_days, installments in duration_months
        setDurationMonths(String(fullLoan.period_days || 30));
        setInstallmentsCount(String(fullLoan.duration_months || ''));
      } else {
        setDurationMonths(String(fullLoan.duration_months));
      }
      setDueType(fullLoan.due_type);
      setDocCharges(String(fullLoan.document_charges || 0));
      setPenaltyPercent(String(fullLoan.penalty_percent || 0.75));

      // Guarantors
      if (fullLoan.guarantor_1_id) setG1SelectedId(fullLoan.guarantor_1_id);
      if (fullLoan.guarantor_2_id) setG2SelectedId(fullLoan.guarantor_2_id);

      // ── Partner: restore from stored loan or customer ────────────────
      const storedPartnerId = fullLoan.partner_id || (fullLoan as any).customer?.partner_id || null;
      const storedPartnerName = fullLoan.partner_name || (fullLoan as any).customer?.partner_name || null;
      
      if (storedPartnerId) {
        setSelectedPartnerId(storedPartnerId);
        _deferredEditPartnerName = null;
      } else if (storedPartnerName) {
        setPartners(prev => {
          const match = prev.find(p => p.name === storedPartnerName);
          if (match && match.id) setSelectedPartnerId(match.id as string);
          return prev;
        });
        _deferredEditPartnerName = storedPartnerName;
      } else {
        _deferredEditPartnerName = null;
      }

      let loadedParticulars = '';
      let loadedExtraDetails = '';
      let loadedRemarks = '';

      const { data: colLogs } = await supabase
        .from('finance_edited_logs')
        .select('*')
        .eq('table_name', 'finance_loans_collateral')
        .eq('record_id', id)
        .order('edited_at', { ascending: false })
        .limit(1);

      if (colLogs && colLogs.length > 0) {
        const cLog = colLogs[0].new_values;
        if (cLog.particulars) loadedParticulars = cLog.particulars;
        if (cLog.extraDetails) loadedExtraDetails = cLog.extraDetails;
        if (cLog.locations && Array.isArray(cLog.locations)) {
          setLocations(cLog.locations);
        } else if (cLog.collateral_address || cLog.gps_latitude) {
          setLocations([{
            address: cLog.collateral_address || '',
            latitude: cLog.gps_latitude || '',
            longitude: cLog.gps_longitude || '',
            mapsLink: cLog.google_maps_link || '',
            image: cLog.collateral_image || null
          }]);
        }
      }

      // Fallback or augment from fullLoan.remarks if not found in colLogs
      if (fullLoan.remarks) {
        const rawRemarks = fullLoan.remarks;
        const partMatch = rawRemarks.match(/Particulars:\s*([^|]+)/i);
        if (partMatch && partMatch[1] && !loadedParticulars) {
          loadedParticulars = partMatch[1].trim();
        }

        const extraMatch = rawRemarks.match(/Extra:\s*([^|]+)/i);
        if (extraMatch && extraMatch[1] && !loadedExtraDetails) {
          const ext = extraMatch[1].trim();
          if (ext !== 'N/A') loadedExtraDetails = ext;
        }

        // Extract base remarks (parts before Particulars/Collateral/Extra)
        const parts = rawRemarks.split('|').map(s => s.trim());
        const baseParts = parts.filter(p => 
          !p.toLowerCase().startsWith('particulars:') &&
          !p.toLowerCase().startsWith('collateral:') &&
          !p.toLowerCase().startsWith('extra:') &&
          !p.startsWith('[NPA CLOSED')
        );
        if (baseParts.length > 0) {
          loadedRemarks = baseParts.join(' | ');
        }
      }

      setParticulars(loadedParticulars);
      setExtraDetails(loadedExtraDetails);
      setRemarks(loadedRemarks);

      const { data: dbDocs } = await supabase
        .from('finance_loan_documents')
        .select('*')
        .eq('loan_id', id);

      if (dbDocs) {
        const mapped: Array<{ id?: string; name: string; fileUrl: string | null; fileName?: string }> = dbDocs.map(d => ({
          id: d.id,
          name: d.document_name,
          fileUrl: d.file_url || null,
          fileName: d.file_name || undefined
        }));
        const defaults = ['Gold Invoice', 'Bank Passbook', 'Land Registration', 'Driving Licence'];
        defaults.forEach(defName => {
          if (!mapped.some(m => m.name.toLowerCase() === defName.toLowerCase())) {
            mapped.push({ name: defName, fileUrl: null });
          }
        });
        setLoanDocs(mapped);
      }

    } catch (err) {
      console.error(err);
      toast.error('Failed to load edit loan parameters');
    } finally {
      setLoading(false);
    }
  };

  const fetchReferenceData = async () => {
    setLoading(true);
    try {
      const prts = await supabaseFinance.getPartnerBasics();
      setPartners(prts);

      const loans = await supabaseFinance.getRecentLoans(5);
      setActiveLoans(loans);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load reference data');
    } finally {
      setLoading(false);
    }
  };

  const handleExistingCdLookup = async (cdAcNo: string) => {
    if (!cdAcNo.trim()) return;
    try {
      const { data: loanData, error: loanErr } = await supabase
        .from('finance_loans')
        .select('*, customer:finance_customers!customer_id(*)')
        .eq('loan_id', cdAcNo.trim())
        .maybeSingle();

      if (loanErr) throw loanErr;

      if (!loanData) {
        toast.error('NO EXISTING ACCOUNT FOUND WITH THIS CD NUMBER');
        return;
      }

      setIsLookupMode(true);
      
      const cust = loanData.customer;
      if (cust) {
        setSelectedCustomerId(cust.id);
        setCustName(cust.name || '');
        setCustPhone(cust.phone_1 || cust.phone || '');
        setCustPhone2(cust.phone_2 || cust.phone2 || '');
        setCustAadhaar(cust.aadhaar || '');
        setCustPhoto(cust.customer_photo_url || null);
        setCustSignature(cust.customer_fingerprint_image_url || null);
        setCustFatherName(cust.father_name || cust.father_husband_name || '');
        setCustAadhaarAddress(cust.aadhaar_address || '');
        setCustPresentAddress(cust.present_address || '');
        setCustHouseNo(cust.address || '');
        setCustMandal(cust.mandal || '');
        setCustVillage(cust.present_village || cust.village || '');
        setCustVillageSaved(!!(cust.present_village || cust.village));
        setCustDistrict(cust.district || '');
      }

      setLoanId(loanData.loan_id);
      setLoanCategory(loanData.loan_category || 'CD');
      setAmount(String(loanData.amount));
      setInterestRate(String(loanData.interest_rate));
      if (loanData.loan_category === 'HP') {
        setDurationMonths(String(loanData.period_days || 30));
        setInstallmentsCount(String(loanData.duration_months || ''));
      } else {
        setDurationMonths(String(loanData.duration_months));
      }
      setDueType(loanData.due_type);
      setDocCharges(String(loanData.document_charges || 0));
      setPenaltyPercent(String(loanData.penalty_percent || 0.75));

      setG1SelectedId(loanData.guarantor_1_id || '');
      setG2SelectedId(loanData.guarantor_2_id || '');

      const { data: colLogs } = await supabase
        .from('finance_edited_logs')
        .select('*')
        .eq('table_name', 'finance_loans_collateral')
        .eq('record_id', loanData.id)
        .order('edited_at', { ascending: false })
        .limit(1);
      if (colLogs && colLogs.length > 0) {
        const cLog = colLogs[0].new_values;
        setParticulars(cLog.particulars || '');
        setExtraDetails(cLog.extraDetails || '');
        if (cLog.locations && Array.isArray(cLog.locations)) {
          setLocations(cLog.locations);
        } else {
          setLocations([{
            address: cLog.collateral_address || '',
            latitude: cLog.gps_latitude || '',
            longitude: cLog.gps_longitude || '',
            mapsLink: cLog.google_maps_link || '',
            image: cLog.collateral_image || null
          }]);
        }
      }

      const { data: dbDocs } = await supabase
        .from('finance_loan_documents')
        .select('*')
        .eq('loan_id', loanData.id);

      if (dbDocs) {
        const mapped: Array<{ id?: string; name: string; fileUrl: string | null; fileName?: string }> = dbDocs.map(d => ({
          id: d.id,
          name: d.document_name,
          fileUrl: d.file_url || null,
          fileName: d.file_name || undefined
        }));
        const defaults = ['Gold Invoice', 'Bank Passbook', 'Land Registration', 'Driving Licence'];
        defaults.forEach(defName => {
          if (!mapped.some(m => m.name.toLowerCase() === defName.toLowerCase())) {
            mapped.push({ name: defName, fileUrl: null });
          }
        });
        setLoanDocs(mapped);
      }

      toast.success('EXISTING ACCOUNT LOADED IN VIEW MODE');
    } catch (err: any) {
      console.error(err);
      toast.error('FAILED TO LOOKUP EXISTING CD ACCOUNT');
    }
  };

  const handleClearLookup = () => {
    setExistingCdSearch('');
    setIsLookupMode(false);
    setSelectedCustomerId('');
    setCustName('');
    setCustPhone('');
    setCustPhone2('');
    setCustAadhaar('');
    setCustPhoto(null);
    setCustSignature(null);
    setCustFatherName('');
    setCustAadhaarAddress('');
    setCustPresentAddress('');
    setCustHouseNo('');
    setCustMandal('');
    setCustVillage('');
    setCustVillageSaved(false);
    setCustDistrict('');
    setAmount('');
    setInterestRate('3');
    setDurationMonths('');
    setDueType('Daily');
    setDocCharges('');
    setPenaltyPercent('0.75');
    
    setG1SelectedId('');
    setG1Name('');
    setG1Phone('');
    setG1Phone2('');
    setG1Aadhaar('');
    setG1AadhaarAddress('');
    setG1PresentAddress('');
    setG1Photo(null);
    setG1Signature(null);
    
    setG2SelectedId('');
    setG2Name('');
    setG2Phone('');
    setG2Phone2('');
    setG2Aadhaar('');
    setG2AadhaarAddress('');
    setG2PresentAddress('');
    setG2Photo(null);
    setG2Signature(null);

    setParticulars('');
    setExtraDetails('');
    setLoanDocs([
      { name: 'Gold Invoice', fileUrl: null },
      { name: 'Bank Passbook', fileUrl: null },
      { name: 'Land Registration', fileUrl: null },
      { name: 'Driving Licence', fileUrl: null }
    ]);
    setLocations([{ address: '', latitude: '', longitude: '', mapsLink: '', image: null }]);
    generateSequentialId(activeLoans, loanCategory);
  };

  const handleSearchChange = async (val: string) => {
    const upperVal = val.toUpperCase();
    setExistingCdSearch(upperVal);
    if (!upperVal.trim()) {
      handleClearLookup();
      setCdSuggestions([]);
      setShowCdSuggestions(false);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('finance_loans')
        .select('loan_id')
        .ilike('loan_id', `${upperVal}%`)
        .limit(10);
      if (!error && data) {
        setCdSuggestions(data.map(l => l.loan_id).sort((a,b) => sortNumerically(a, b)));
        setShowCdSuggestions(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectCdSuggestion = (val: string) => {
    setExistingCdSearch(val);
    setShowCdSuggestions(false);
    handleExistingCdLookup(val);
  };

  // Generate Auto sequential Loan ID
  const generateSequentialId = (loansList: any[], category: string) => {
    if (editLoanId) return; // Keep existing ID in edit mode
    const prefix = category === 'L' ? 'L' : category;
    const matchingLoans = loansList.filter(l => {
      const lid = (l.loan_id || '').toUpperCase();
      return lid.startsWith(prefix);
    });
    
    let maxNum = 0;
    matchingLoans.forEach(l => {
      const lid = (l.loan_id || '').toUpperCase();
      const suffix = lid.slice(prefix.length);
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    });

    const nextNum = maxNum + 1;
    const paddedCount = String(nextNum).padStart(3, '0');
    setLoanId(`${prefix}${paddedCount}`);
  };

  useEffect(() => {
    if (activeLoans.length > 0 || !loading) {
      generateSequentialId(activeLoans, loanCategory);
    }
  }, [loanCategory, activeLoans, loading]);

  // Autofill customer data
  useEffect(() => {
    const checkNPA = async (id: string, aadhaar: string) => {
        try {
            const { data } = await supabase.from('finance_npa_records').select('*').or(`customer_id.eq.${id},aadhaar.eq.${aadhaar}`).limit(1);
            if (data && data.length > 0) {
                setNpaWarning(data[0]);
                toast.error(`WARNING: This customer has an NPA record closed on ${new Date(data[0].closed_at).toLocaleDateString('en-IN')}`, { duration: 6000 });
            } else {
                setNpaWarning(null);
            }
        } catch (e) {
            setNpaWarning(null);
        }
    };

    const fetchCustomer = async () => {
      if (!selectedCustomerId) return;
      const selected = await supabaseFinance.getCustomerById(selectedCustomerId);
      if (selected) {
        setCustName(selected.name);
        setCustFatherName(selected.father_name || selected.father_husband_name || '');
        setCustPhone(selected.phone_1 || selected.phone || '');
        setCustPhone2(selected.phone_2 || selected.phone2 || '');
        setCustAadhaar(selected.aadhaar || '');
        setCustPhoto(selected.customer_photo_url || null);
        setCustSignature(selected.customer_fingerprint_image_url || null);
        setCustFingerprintUrl(selected.customer_fingerprint_image_url || selected.fingerprint_url || null);
        setCustFingerprintTemplate(selected.customer_fingerprint_template || selected.fingerprint_template || null);
        setCustFingerprintAdded(!!(selected.customer_fingerprint_added || selected.fingerprint_added));
        
        setCustAadhaarAddress(selected.aadhaar_address || '');
        setCustPresentAddress(selected.present_address || '');
        setCustHouseNo(selected.address || '');
        setCustMandal(selected.mandal || '');
        setCustVillage(selected.present_village || selected.village || '');
        setCustVillageSaved(!!(selected.present_village || selected.village));
        setCustDistrict(selected.district || '');
        
        checkNPA(selected.id, selected.aadhaar || '');

        if (selected.partner_name) {
          const matchPartner = partners.find(p => p.name === selected.partner_name);
          if (matchPartner) {
            setSelectedPartnerId(matchPartner.id as string);
          }
        }
      }
    };

    fetchCustomer();
  }, [selectedCustomerId, partners]);

  // Autofill guarantor 1 data
  useEffect(() => {
    const fetchG1 = async () => {
      if (!g1SelectedId) return;
      const selected = await supabaseFinance.getCustomerById(g1SelectedId);
      if (selected) {
        setG1Name(selected.name);
        setG1Phone(selected.phone_1 || selected.phone || '');
        setG1Phone2(selected.phone_2 || selected.phone2 || '');
        setG1Aadhaar(selected.aadhaar || '');
        setG1AadhaarAddress(selected.aadhaar_address || '');
        setG1PresentAddress(selected.present_address || selected.address || '');
        setG1Photo(selected.customer_photo_url || null);
        setG1Signature(selected.customer_fingerprint_image_url || null);
      }
    };
    fetchG1();
  }, [g1SelectedId]);

  // Autofill guarantor 2 data
  useEffect(() => {
    const fetchG2 = async () => {
      if (!g2SelectedId) return;
      const selected = await supabaseFinance.getCustomerById(g2SelectedId);
      if (selected) {
        setG2Name(selected.name);
        setG2Phone(selected.phone_1 || selected.phone || '');
        setG2Phone2(selected.phone_2 || selected.phone2 || '');
        setG2Aadhaar(selected.aadhaar || '');
        setG2AadhaarAddress(selected.aadhaar_address || '');
        setG2PresentAddress(selected.present_address || selected.address || '');
        setG2Photo(selected.customer_photo_url || null);
        setG2Signature(selected.customer_fingerprint_image_url || null);
      }
    };
    fetchG2();
  }, [g2SelectedId]);

  // Autofill partner name — also handles deferred matching from loadLoanForEdit
  useEffect(() => {
    if (_deferredEditPartnerName && partners.length > 0 && !selectedPartnerId) {
      const match = partners.find(p => p.name === _deferredEditPartnerName);
      if (match && match.id) {
        setSelectedPartnerId(match.id as string);
        _deferredEditPartnerName = null;
      }
    }
  }, [partners]);

  // Helper to format currency properly as Indian Rupees
  const formatRupee = (value: number) => {
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const addLocation = () => {
    setLocations([...locations, { address: '', latitude: '', longitude: '', mapsLink: '', image: null }]);
  };

  const removeLocation = (index: number) => {
    setLocations(locations.filter((_, i) => i !== index));
  };

  const updateLocation = (index: number, field: string, value: any) => {
    setLocations(locations.map((loc, i) => i === index ? { ...loc, [field]: value } : loc));
  };

  const handleRefreshCustPhoto = async () => {
    if (!selectedCustomerId) return;
    try {
      const selected = await supabaseFinance.getCustomerById(selectedCustomerId);
      if (selected) {
        setCustPhoto(selected.customer_photo_url || null);
        setCustSignature(selected.customer_fingerprint_image_url || null);
        toast.success('Borrower photo & signature refreshed');
      }
    } catch (e) {
      toast.error('Failed to refresh photo');
    }
  };





  // Live Calculations
  const liveCalculations = useMemo(() => {
    const P = Number(amount);
    const R = Number(interestRate);
    const D = Number(durationMonths);
    const docFees = Number(docCharges) || 0;

    if (isNaN(P) || P <= 0 || isNaN(R) || R < 0 || isNaN(D) || D < 0) {
      return null;
    }

    let interestAmount = 0;
    const penalty = 0; // Explicitly 0 during new loan creation
    let duesCount = 0;
    let dueAmount = 0;

    if (loanCategory === 'HP') {
      // HP: flat interest per period; installment 1 principal and doc charges kept at disbursement
      const N = Number(installmentsCount);
      if (!Number.isInteger(N) || N < 2 || !Number.isInteger(D) || D < 1) return null;
      const hp = hpLoanPreview(buildHPContract({
        date, amount: P, duration_months: N, period_days: D, interest_rate: R,
        penalty_percent: Number(penaltyPercent) || 0.75, document_charges: docFees
      }));
      return {
        principal: P,
        interestAmount: hp.totalInterest,
        penalty: 0,
        totalRenewal: 0,
        totalClose: parseFloat((P + hp.totalInterest).toFixed(2)),
        totalRepayment: parseFloat((P + hp.totalInterest).toFixed(2)),
        duesCount: N,
        dueAmount: hp.installmentAmount,
        docFees,
        netDisbursed: hp.netCash,
        payableAmount: hp.netCash,
        hp
      };
    }

    if (loanCategory === 'CD') {
      interestAmount = P * (R / 100) * (D / 30);
      duesCount = D;
    } else {
      interestAmount = P * (R / 100) * D;
      if (dueType === 'Daily') {
        duesCount = D * 30;
      } else if (dueType === 'Weekly') {
        duesCount = Math.round(D * 4.33);
      } else {
        duesCount = D;
      }
      dueAmount = duesCount > 0 ? ((P + interestAmount) / duesCount) : 0;
    }

    const netDisbursed = P - interestAmount - docFees;
    const payableAmount = netDisbursed;
    const totalRenewal = interestAmount + penalty;
    const totalClose = P + interestAmount + penalty;

    return {
      principal: P,
      interestAmount: parseFloat(interestAmount.toFixed(2)),
      penalty: penalty,
      totalRenewal: parseFloat(totalRenewal.toFixed(2)),
      totalClose: parseFloat(totalClose.toFixed(2)),
      totalRepayment: parseFloat(totalClose.toFixed(2)),
      duesCount,
      dueAmount: parseFloat(dueAmount.toFixed(2)),
      docFees,
      netDisbursed: parseFloat(netDisbursed.toFixed(2)),
      payableAmount: parseFloat(payableAmount.toFixed(2)),
      hp: null as ReturnType<typeof hpLoanPreview> | null
    };
  }, [amount, interestRate, durationMonths, dueType, docCharges, loanCategory, installmentsCount, penaltyPercent, date]);

  // HP: period defaults to 30 days on a new loan
  useEffect(() => {
    if (loanCategory === 'HP' && !editLoanId && durationMonths === '') setDurationMonths('30');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanCategory]);

  const handlePrintPreview = () => {
    setShowPrintPreview(true);
  };

  // Form Reset / Clear
  const handleClearForm = () => {
    if (!window.confirm('Are you sure you want to clear the form? All details will be reset.')) return;
    
    setDate(getLocalBusinessDateISO());
    setLoanCategory('CD');
    setSelectedCustomerId('');
    setCustName('');
    setCustFatherName('');
    setCustPhone('');
    setCustPhone2('');
    setCustAadhaar('');
    setCustPhoto(null);
    setCustSignature(null);
    setCustFingerprintUrl(null);
    setCustFingerprintTemplate(null);
    setCustFingerprintAdded(false);
    setCustAadhaarAddress('');
    setCustPresentAddress('');
    setCustHouseNo('');
    setCustMandal('');
    setCustVillage('');
    setCustVillageSaved(false);
    setCustDistrict('');
    setCustSearch('');
    setCustDropdownOpen(false);
    setNpaWarning(null);

    setG1SelectedId('');
    setG1Name('');
    setG1Phone('');
    setG1Phone2('');
    setG1Aadhaar('');
    setG1AadhaarAddress('');
    setG1PresentAddress('');
    setG1Photo(null);
    setG1Signature(null);

    setG2SelectedId('');
    setG2Name('');
    setG2Phone('');
    setG2Phone2('');
    setG2Aadhaar('');
    setG2AadhaarAddress('');
    setG2PresentAddress('');
    setG2Photo(null);
    setG2Signature(null);

    setAmount('');
    setDocCharges('');
    setInterestRate('3');
    setDurationMonths('');
    setInstallmentsCount('');
    setPenaltyPercent('0.75');
    setDueType('Daily');
    setParticulars('');

    setSelectedPartnerId('');

    setRemarks('');
    setExtraDetails('');

    setLoanDocs([
      { name: 'Gold Invoice', fileUrl: null },
      { name: 'Bank Passbook', fileUrl: null },
      { name: 'Land Registration', fileUrl: null },
      { name: 'Driving Licence', fileUrl: null }
    ]);
    setLocations([{ address: '', latitude: '', longitude: '', mapsLink: '', image: null }]);
    toast.success('Form cleared successfully');
  };

  // Mandatory field toggles — controls which "optional" fields become required during save.
  // Phone and Aadhaar for borrower/guarantors are optional by default but can be
  // tightened here or driven from ledger settings in the future.
  const mandatoryFields = {
    borrowerPhone: false,
    borrowerAadhaar: false,
    g1Aadhaar: false,
    g1Phone: false,
    g2Aadhaar: false,
    g2Phone: false,
  };

  const handleSaveLoan = async (e: React.FormEvent) => {
    e.preventDefault();

    const fields: ValidationField[] = [
      { name: 'date', label: 'Date', value: date, required: true, ref: dateRef },
      { name: 'loanId', label: 'Loan Number', value: loanId, required: true, ref: loanIdRef },
      { name: 'selectedPartnerId', label: 'Assigned Partner', value: selectedPartnerId, required: true, ref: partnerRef as any },
      { name: 'custName', label: 'Customer Name', value: custName, required: true, ref: custNameRef },
      { name: 'custVillage', label: 'Village', value: custVillage, required: true },
      { name: 'custPhone', label: 'Customer Phone', value: custPhone, required: mandatoryFields.borrowerPhone, ref: custPhoneRef },
      { name: 'custAadhaar', label: 'Customer Aadhaar UID', value: custAadhaar, required: mandatoryFields.borrowerAadhaar },
      { name: 'g1SelectedId', label: 'Guarantor 1', value: g1SelectedId || g1Name, required: true, ref: g1SearchRef as any },
      { name: 'g1Aadhaar', label: 'Guarantor 1 Aadhaar', value: g1Aadhaar, required: mandatoryFields.g1Aadhaar },
      { name: 'g1Phone', label: 'Guarantor 1 Phone', value: g1Phone, required: mandatoryFields.g1Phone },
      { name: 'amount', label: 'Loan Amount', value: amount, required: true, ref: amountRef },
      { name: 'docCharges', label: 'Document Charges', value: docCharges, required: true, ref: docChargesRef as any },
      { name: 'interestRate', label: 'Rate of Interest', value: interestRate, required: true, ref: interestRateRef },
      { name: 'durationMonths', label: 'Period', value: durationMonths, required: true, ref: durationMonthsRef },
      ...(loanCategory === 'HP'
        ? [{ name: 'installmentsCount', label: 'Installments', value: installmentsCount, required: true, ref: installmentsRef }]
        : []),
      { name: 'particulars', label: 'Particulars', value: particulars, required: true, ref: particularsRef as any },
    ];

    if (g2Name?.trim() || g2Aadhaar?.trim() || g2Phone?.trim()) {
      if (!g2Name?.trim()) fields.push({ name: 'g2Name', label: 'Guarantor 2 Name', value: g2Name, required: true });
      if (mandatoryFields.g2Aadhaar && !g2Aadhaar?.trim()) fields.push({ name: 'g2Aadhaar', label: 'Guarantor 2 Aadhaar', value: g2Aadhaar, required: true });
      if (mandatoryFields.g2Phone && !g2Phone?.trim()) fields.push({ name: 'g2Phone', label: 'Guarantor 2 Phone', value: g2Phone, required: true });
    }

    const { isValid, errors: newErrors } = validateFinanceForm(fields);
    setErrors(newErrors);
    if (!isValid) return;

    if (loanCategory === 'HP') {
      const n = Number(installmentsCount);
      const d = Number(durationMonths);
      if (!Number.isInteger(n) || n < 2) {
        setErrors(p => ({ ...p, installmentsCount: true }));
        toast.error('Installments must be a whole number, 2 or more.');
        return;
      }
      if (!Number.isInteger(d) || d < 1) {
        setErrors(p => ({ ...p, durationMonths: true }));
        toast.error('Period must be a whole number of days, 1 or more.');
        return;
      }
    }

    if (!liveCalculations) {
      toast.error('Please enter valid loan terms (Amount, Rate, Duration)');
      return;
    }

    if (!selectedCustomerId) {
      toast.error('Please search and select an existing Customer. Customer creation is not allowed during loan entry.');
      return;
    }

    setSaving(true);
    const saveToastId = toast.loading(editLoanId ? 'Updating loan parameters...' : 'Saving new loan...');
    try {
      const staffName = user?.username || 'Staff';

      // Create dues schedule (not for HP: its installments are worked out from the loan terms)
      const duesList: any[] = [];
      const start = new Date(date);
      for (let i = 1; loanCategory !== 'HP' && i <= liveCalculations.duesCount; i++) {
        const dDate = new Date(start);
        if (dueType === 'Daily') {
          dDate.setDate(start.getDate() + i);
        } else if (dueType === 'Weekly') {
          dDate.setDate(start.getDate() + i * 7);
        } else {
          dDate.setMonth(start.getMonth() + i);
        }
        duesList.push({
          due_date: getLocalBusinessDateISO(dDate),
          amount: liveCalculations.dueAmount
        });
      }

      // Combined Guarantors Surety details for backward compat
      const combinedSuretyName = [g1Name, g2Name].filter(Boolean).join(' / ') || null;
      const combinedSuretyPhone = [g1Phone, g2Phone].filter(Boolean).join(' / ') || null;
      const combinedSuretyAadhaar = [g1Aadhaar, g2Aadhaar].filter(Boolean).join(' / ') || null;
      const combinedSuretyAadhaarAddress = [g1AadhaarAddress, g2AadhaarAddress].filter(Boolean).join(' / ') || null;
      const combinedSuretyPresentAddress = [g1PresentAddress, g2PresentAddress].filter(Boolean).join(' / ') || null;

      const remarksParts: string[] = [];
      if (remarks?.trim()) {
        remarksParts.push(remarks.trim());
      }
      if (particulars?.trim()) {
        remarksParts.push(`Particulars: ${particulars.trim()}`);
      }
      const locStr = locations.map(l => l.address).filter(Boolean).join(', ') || 'N/A';
      const gpsStr = locations.map(l => l.latitude && l.longitude ? `${l.latitude},${l.longitude}` : '').filter(Boolean).join(' / ') || 'N/A';
      remarksParts.push(`Collateral: ${locStr}, GPS: ${gpsStr}`);
      if (extraDetails?.trim()) {
        remarksParts.push(`Extra: ${extraDetails.trim()}`);
      } else {
        remarksParts.push('Extra: N/A');
      }

      const finalRemarks = remarksParts.join(' | ');

      const selectedPartner = partners.find(p => p.id === selectedPartnerId);
      const partnerName = selectedPartner ? selectedPartner.name : null;

      const loanPayload = {
        loan_id: loanId,
        customer_id: selectedCustomerId,
        date,
        amount: liveCalculations.principal,
        interest_rate: Number(interestRate),
        // HP keeps the number of installments here (its period goes in period_days)
        duration_months: loanCategory === 'HP' ? Number(installmentsCount) : Number(durationMonths),
        due_type: dueType,
        due_amount: liveCalculations.dueAmount,
        surety_name: combinedSuretyName,
        surety_phone: combinedSuretyPhone,
        surety_aadhaar: combinedSuretyAadhaar,
        surety_aadhaar_address: combinedSuretyAadhaarAddress,
        surety_present_address: combinedSuretyPresentAddress,
        remarks: finalRemarks,
        customer_photo_url: custPhoto,
        surety_photo_url: g1Photo || g2Photo || null,
        father_husband_name: custFatherName || null,
        loan_category: loanCategory,
        guarantor_1_id: g1SelectedId || null,
        guarantor_2_id: g2SelectedId || null,
        partner_id: selectedPartnerId || null,
        partner_name: partnerName,
        penalty_percent: Number(penaltyPercent) || 0.75,
        document_charges: Number(docCharges) || 0,
        // CD and HP both count their period in days (HP: days between installments)
        period_days: (loanCategory === 'CD' || loanCategory === 'HP') ? ((durationMonths === '' || durationMonths === null || durationMonths === undefined) ? 30 : Number(durationMonths)) : null
      };

      const linkedDocs: any[] = [];
      loanDocs.forEach(d => {
        if (d.fileUrl) {
          linkedDocs.push({
            category: 'DocumentPhoto',
            document_name: d.name,
            remarks: null,
            is_submitted: true,
            file_url: d.fileUrl,
            file_name: d.fileName || null,
            uploaded_by: staffName,
            uploaded_at: new Date().toISOString()
          });
        }
      });

      if (editLoanId) {
        // Edit mode save
        // 1. Update customer record
        await supabaseFinance.updateCustomer(selectedCustomerId, {
          name: custName,
          phone: custPhone || null,
          phone_1: custPhone || null,
          phone_2: custPhone2 || null,
          phone2: custPhone2 || null,
          address: custHouseNo || null,
          aadhaar: custAadhaar || null,
          father_husband_name: custFatherName || null,
          father_name: custFatherName || null,
          aadhaar_address: custAadhaarAddress || null,
          present_address: custPresentAddress || null,
          village: custVillage.trim() || null,
          present_village: custVillage.trim() || null,
          mandal: custMandal || null,
          present_mandal: custMandal || null,
          district: custDistrict || null,
          present_district: custDistrict || null,
          partner_name: partnerName
        }, staffName);


        // 2. Update loan record
        await supabaseFinance.updateLoan(editLoanId, loanPayload, staffName);

        // 3. Persist collateral and particulars metadata
        const collateralJSON = {
          locations: locations,
          collateral_address: locations[0]?.address || '',
          gps_latitude: locations[0]?.latitude || '',
          gps_longitude: locations[0]?.longitude || '',
          google_maps_link: locations[0]?.mapsLink || '',
          collateral_image: locations[0]?.image || null,
          particulars,
          extraDetails,
          document_charges: liveCalculations?.docFees || Number(docCharges) || 0
        };
        try {
          await supabase.from('finance_edited_logs').insert([{
            table_name: 'finance_loans_collateral',
            record_id: editLoanId,
            old_values: {},
            new_values: collateralJSON,
            edited_by: staffName
          }]);
        } catch (err) {
          console.warn('Could not record collateral JSON metadata for edit loan', err);
        }

        // 4. Update documents
        await supabase.from('finance_loan_documents').delete().eq('loan_id', editLoanId);
        if (linkedDocs.length > 0) {
          const mappedDocs = linkedDocs.map(d => ({ ...d, loan_id: editLoanId }));
          await supabase.from('finance_loan_documents').insert(mappedDocs);
        }

        // 5. CD Sequential Rebuild
        if (loanCategory === 'CD' && hasLedgerActivity) {
          const rebuildResult = await cdLedgerRebuildService.rebuildCDLoanLifecycle(editLoanId, 'FULL_RECALCULATE');
          if (!rebuildResult.success) {
            throw new Error(rebuildResult.error || 'Rebuild of CD loan history failed');
          }
        }

        toast.success(`Loan Account ${loanId} updated successfully!`, { id: saveToastId });
        if (onCancelEdit) {
          onCancelEdit();
        } else {
          navigate('/finance');
        }
      } else {
        // Update/save customer details first
        if (selectedCustomerId) {
          await supabaseFinance.updateCustomer(selectedCustomerId, {
            name: custName,
            phone: custPhone || null,
            phone_1: custPhone || null,
            phone_2: custPhone2 || null,
            phone2: custPhone2 || null,
            address: custHouseNo || null,
            aadhaar: custAadhaar || null,
            father_husband_name: custFatherName || null,
            father_name: custFatherName || null,
            aadhaar_address: custAadhaarAddress || null,
            present_address: custPresentAddress || null,
            village: custVillage.trim() || null,
            present_village: custVillage.trim() || null,
            mandal: custMandal || null,
            present_mandal: custMandal || null,
            district: custDistrict || null,
            present_district: custDistrict || null,
            partner_name: partnerName
          }, staffName, true);
        }

        const savedLoan = await supabaseFinance.createLoan(
          loanPayload,
          { id: selectedCustomerId },
          duesList,
          [],
          linkedDocs,
          staffName
        );

        if (savedLoan) {
          const collateralJSON = {
            locations: locations,
            collateral_address: locations[0]?.address || '',
            gps_latitude: locations[0]?.latitude || '',
            gps_longitude: locations[0]?.longitude || '',
            google_maps_link: locations[0]?.mapsLink || '',
            collateral_image: locations[0]?.image || null,
            particulars,
            extraDetails,
            document_charges: liveCalculations.docFees
          };
          try {
            await supabase.from('finance_edited_logs').insert([{
              table_name: 'finance_loans_collateral',
              record_id: savedLoan.id,
              old_values: {},
              new_values: collateralJSON,
              edited_by: staffName
            }]);
          } catch (err) {
            console.warn('Could not record collateral JSON metadata', err);
          }

          toast.success(`Loan Account ${loanId} created and disbursed successfully!`, { id: saveToastId });
          navigate('/finance');
        } else {
          toast.error('Disbursal failed. Duplicate Loan Number.', { id: saveToastId });
        }
      }

    } catch (err: any) {
      console.error(err);
      toast.error(`Operation failed: ${err.message || 'database error'}`, { id: saveToastId });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-900"></div>
      </div>
    );
  }

  return (
    <div className="space-y-2 w-full select-none print:p-0 print:bg-white">

      {/* Compact Header Bar */}
      <div className="flex items-center justify-between bg-white border border-slate-200 px-3 py-2 rounded print:hidden">
        <div>
          <h1 className="text-[24px] font-bold uppercase text-slate-900 tracking-tight leading-none">
            {editLoanId ? `EDIT LOAN ACCOUNT` : `NEW LOAN ENTRY`}
          </h1>
          <div className="mt-0.5 flex items-center gap-4">
            <span className="text-[16px] font-black text-slate-950 font-mono">LOAN NO: {loanId || '---'}</span>
            <span className="text-[16px] font-black text-slate-700 font-mono">DATE: {date || '---'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={editLoanId ? onCancelEdit : () => navigate('/finance')}
            className="inline-flex items-center gap-1 px-3 h-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50 font-bold text-[13px] uppercase"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            BACK
          </button>
          {!editLoanId && (
            <Link
              to="/finance/calculator"
              className="inline-flex items-center gap-1 px-3 h-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50 font-bold text-[13px] uppercase"
            >
              <Calculator className="w-3.5 h-3.5" />
              CALCULATOR
            </Link>
          )}
          <button
            onClick={handlePrintPreview}
            disabled={!liveCalculations}
            className="inline-flex items-center gap-1 px-3 h-[36px] bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-50 font-bold text-[13px] uppercase disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5" />
            PREVIEW &amp; PRINT
          </button>
          {!editLoanId && (
            <button
              onClick={isLookupMode ? handleClearLookup : handleClearForm}
              className="inline-flex items-center gap-1 px-3 h-[36px] bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 font-bold text-[13px] uppercase"
            >
              <X className="w-3.5 h-3.5" />
              CLEAR
            </button>
          )}
          <button
            onClick={handleSaveLoan}
            disabled={saving || isLookupMode}
            className="inline-flex items-center gap-1 px-4 h-[36px] bg-[#0b1329] text-white border border-slate-800 rounded hover:bg-slate-800 font-bold text-[13px] uppercase disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'SAVING...' : editLoanId ? 'SAVE CHANGES' : 'SAVE LOAN'}
          </button>
        </div>
      </div>

      {isLookupMode && (
        <div className="bg-blue-50 border border-blue-400 text-blue-900 px-3 py-2 rounded flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="font-bold text-[13px] tracking-wider uppercase">VIEW MODE — EXISTING ACCOUNT LOADED</span>
          </div>
          <button type="button" onClick={handleClearLookup}
            className="text-[12px] bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded font-bold uppercase">
            EXIT VIEW MODE
          </button>
        </div>
      )}

      {editLoanId && hasLedgerActivity && (
        <div className="bg-amber-50 border-l-4 border-amber-500 px-3 py-2 rounded-r flex gap-2 items-center">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <span className="text-amber-800 font-bold text-[13px] uppercase">Original Loan Terms Locked — </span>
            <span className="text-amber-700 text-[12px] uppercase">Core loan terms (Date, Principal, Rate, Penalty, Period, Doc Charges, Partner, Guarantors, Particulars) cannot be changed because transaction/ledger activity exists for this loan.</span>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="w-full space-y-2">

        {/* Card 1: BASICS */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <h3 className="text-slate-900 border-b border-slate-100 pb-1.5 uppercase font-bold text-[15px]">BASICS</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <FinanceSmartCalendar
                label="DATE"
                value={date}
                onChange={(val) => { setDate(val); setErrors(p => ({...p, date: false})); }}
                disabled={isLookupMode || (!!editLoanId && hasLedgerActivity)}
                module="CD_LEDGER"
                required
                error={errors.date}
              />
            </div>

            <div>
              <label className="peek-label uppercase block mb-1 text-[11px] font-bold text-slate-700">
                LEDGER TYPE <span className="text-red-500 ml-1">*</span>
              </label>
              <select
                value={loanCategory}
                disabled={isLookupMode || !!editLoanId}
                onChange={(e) => setLoanCategory(e.target.value as any)}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none peek-caption-12 font-bold"
                style={{ fontFamily: 'Times New Roman', fontSize: '15px' }}
                required
              >
                <option value="CD">CD LEDGER</option>
                <option value="STBD">STBD LEDGER</option>
                <option value="HP">HP LEDGER</option>
                <option value="TBD">TBD LEDGER</option>
              </select>
            </div>

            <div>
              <label className="peek-label uppercase block mb-1 text-[11px] font-bold text-slate-700">
                LOAN NUMBER <span className="text-red-500 ml-1">*</span>
              </label>
              <input
                type="text"
                ref={loanIdRef}
                value={loanId}
                disabled={isLookupMode || !!editLoanId}
                onChange={(e) => { setLoanId(e.target.value); setErrors(p => ({...p, loanId: false})) }}
                placeholder="e.g. CD001"
                className={`w-full bg-slate-50 border rounded-lg p-2 text-slate-700 focus:outline-none font-mono peek-caption-12 ${errors.loanId ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                required
              />
            </div>

            <div>
              <label className="peek-label uppercase block mb-1 text-[11px] font-bold text-slate-700">
                SEARCH LOAN AC/NO
              </label>
              <div ref={cdSearchDropdownRef} className="relative flex gap-2">
                <div className="relative flex-grow">
                  <input
                    type="text"
                    value={existingCdSearch}
                    disabled={!!editLoanId}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => {
                      if (existingCdSearch.trim()) {
                        setShowCdSuggestions(true);
                      }
                    }}
                    placeholder="E.G. CD001"
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none font-mono peek-caption-12 uppercase disabled:bg-slate-50"
                  />
                  {showCdSuggestions && cdSuggestions.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {cdSuggestions.map((suggestion) => (
                        <div
                          key={suggestion}
                          onClick={() => handleSelectCdSuggestion(suggestion)}
                          className="px-3 py-2 hover:bg-slate-50 cursor-pointer text-slate-800 font-mono text-xs border-b border-slate-50 last:border-0 uppercase"
                        >
                          {suggestion}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!!editLoanId}
                  onClick={() => handleExistingCdLookup(existingCdSearch)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg font-bold text-xs uppercase shadow-sm flex-shrink-0 disabled:opacity-50"
                >
                  SEARCH
                </button>
              </div>
            </div>
          </div>
        </div>

        <fieldset disabled={isLookupMode} className="space-y-2">

        {/* NPA Warning Banner */}
        {npaWarning && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
            <div className="flex">
              <div className="flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800 uppercase">
                  NPA Record Found
                </h3>
                <div className="mt-2 text-sm text-red-700 space-y-1">
                  <p>
                    This customer had a previous Non-Performing Asset (NPA) closed on <strong>{new Date(npaWarning.closed_at).toLocaleDateString('en-IN')}</strong>. 
                    Reason: {npaWarning.reason || 'N/A'}.
                  </p>
                  <p className="font-bold flex flex-wrap gap-x-6 gap-y-1 mt-1">
                    <span>TOTAL LIABILITY: {
                      (
                        npaWarning.total_liability !== undefined && npaWarning.total_liability !== null && Number(npaWarning.total_liability) > 0
                          ? Number(npaWarning.total_liability) 
                          : (Number(npaWarning.balance_amount || 0) + Number(npaWarning.interest_due || 0) + Number(npaWarning.penalty_due || 0))
                      ).toLocaleString('en-IN', { minimumFractionDigits: 2 })
                    }</span>
                    <span>SETTLEMENT AMOUNT: {(npaWarning.settlement_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    <span>WAIVED AMOUNT: {
                      (
                        npaWarning.waived_amount !== undefined && npaWarning.waived_amount !== null && Number(npaWarning.waived_amount) > 0
                          ? Number(npaWarning.waived_amount)
                          : Math.max(0, 
                              (
                                npaWarning.total_liability !== undefined && npaWarning.total_liability !== null && Number(npaWarning.total_liability) > 0
                                  ? Number(npaWarning.total_liability) 
                                  : (Number(npaWarning.balance_amount || 0) + Number(npaWarning.interest_due || 0) + Number(npaWarning.penalty_due || 0))
                              ) - Number(npaWarning.settlement_amount || 0)
                            )
                      ).toLocaleString('en-IN', { minimumFractionDigits: 2 })
                    }</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Card 2: CUSTOMER */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <h3 className="text-slate-900 uppercase font-bold text-[15px]">
              CUSTOMER DETAILS
            </h3>
            {selectedCustomerId && !editLoanId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCustomerId('');
                  setCustName('');
                  setCustFatherName('');
                  setCustPhone('');
                  setCustPhone2('');
                  setCustAadhaar('');
                  setCustPhoto(null);
                  setCustSignature(null);
                  setCustFingerprintUrl(null);
                  setCustFingerprintTemplate(null);
                  setCustFingerprintAdded(false);
                  setCustAadhaarAddress('');
                  setCustPresentAddress('');
                  setCustHouseNo('');
                  setCustMandal('');
                  setCustVillage('');
                  setCustVillageSaved(false);
    setCustVillage('');
    setCustVillageSaved(false);
                  setCustDistrict('');
                  setNpaWarning(null);
                }}
                className="text-red-655 hover:underline peek-small-10 uppercase font-bold text-xs"
              >
                CLEAR SELECTION
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-3 rounded border border-slate-100 print:hidden">
              {!editLoanId ? (
                <div ref={dropdownRef} className="space-y-1">
                  <label className="peek-label uppercase block text-[11px] font-bold text-slate-700">
                    SEARCH CUSTOMER
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      value={custSearch}
                      onChange={(e) => {
                        setCustSearch(e.target.value);
                        setCustDropdownOpen(true);
                      }}
                      onFocus={() => setCustDropdownOpen(true)}
                      placeholder="Search by customer name, ID, phone, or Aadhaar..."
                      className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none peek-caption-12"
                    />
                    
                    {isSearchingCust && (
                      <div className="absolute inset-y-0 right-10 pr-3 flex items-center pointer-events-none">
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-slate-400"></div>
                      </div>
                    )}
                    {custDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {customerSearchResults.length === 0 && !isSearchingCust ? (
                          <div className="px-4 py-3 text-slate-400 text-center peek-h3 uppercase text-xs">
                            No matching customers found
                          </div>
                        ) : (
                          customerSearchResults.map((c) => (
                              <div
                                key={c.id}
                                onClick={() => {
                                  if (c.id) setSelectedCustomerId(c.id);
                                  setCustDropdownOpen(false);
                                  setCustSearch('');
                                }}
                                className="px-4 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                              >
                                <div>
                                  <div className="text-slate-900 peek-caption-12 font-bold">{c.name}</div>
                                  <div className="text-[9px] text-slate-400 mt-0.5 peek-button uppercase">
                                    ID: #{c.customer_id || 'N/A'} | Aadhaar: {c.aadhaar || 'N/A'} | Village: {c.village || 'N/A'}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {(c.phone_1 || c.phone) ? (
                                    <div className="text-slate-500 font-mono peek-small-10 font-bold">
                                      {c.phone_1 || c.phone}
                                    </div>
                                  ) : null}
                                  {c.customer_photo_url && (
                                    <div className="w-8 h-8 rounded-full border overflow-hidden shrink-0">
                                      <img src={c.customer_photo_url} alt="Profile" className="w-full h-full object-cover" />
                                    </div>
                                  )}
                                </div>
                              </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="peek-label uppercase block text-[11px] font-bold text-slate-700">
                    LOAN CUSTOMER
                  </label>
                  <div className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-slate-900 font-bold text-xs uppercase h-[38px] flex items-center">
                    {custName} {loanId ? `(#${loanId})` : ''}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="peek-label uppercase block text-[11px] font-bold text-slate-700">
                  ASSIGNED PARTNER <span className="text-red-500 ml-1">*</span>
                </label>
                <select
                  ref={partnerRef}
                  value={selectedPartnerId}
                  disabled={!!editLoanId && hasLedgerActivity}
                  onChange={(e) => {
                    setSelectedPartnerId(e.target.value);
                    setErrors((p) => ({ ...p, selectedPartnerId: false }));
                  }}
                  className={`w-full bg-white border rounded-lg p-2 text-slate-900 focus:outline-none peek-caption-12 font-bold h-[38px] disabled:bg-slate-100 disabled:cursor-not-allowed ${
                    errors.selectedPartnerId
                      ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500'
                      : 'border-slate-200 focus:ring-1 focus:ring-slate-900'
                  }`}
                  style={{ fontFamily: 'Times New Roman', fontSize: '15px' }}
                >
                  <option value="">-- SELECT PARTNER --</option>
                  {[...partners].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_md ? '(MD)' : '(Partner)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Customer Inputs Panel */}
            <div className="bg-slate-50 p-3 rounded border border-slate-150 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 font-bold text-xs uppercase">
                <Input label="Customer Name" value={custName} onChange={editLoanId ? setCustName : undefined} readOnly={!editLoanId} placeholder="Name" />
                {(() => {
                  const rel = getRelationshipDisplay(custFatherName);
                  return (
                    <Input 
                      label={`${rel.label} Name`} 
                      value={rel.name} 
                      onChange={editLoanId ? (v: string) => setCustFatherName(rel.type ? `${rel.type}:${v}` : v) : undefined}
                      readOnly={!editLoanId} 
                      placeholder="Father/Husband/Wife's Name" 
                    />
                  );
                })()}
                <Input label="Aadhaar UID" value={custAadhaar} onChange={editLoanId ? setCustAadhaar : undefined} readOnly={!editLoanId} placeholder="Aadhaar" />
                <Input label="Phone 1" value={custPhone} onChange={editLoanId ? setCustPhone : undefined} readOnly={!editLoanId} placeholder="Phone 1" />
                <Input label="Phone 2" value={custPhone2} onChange={editLoanId ? setCustPhone2 : undefined} readOnly={!editLoanId} placeholder="Phone 2" />
              </div>

              {/* Address: same layout as New Customer (Aadhaar | Present | House No, Village, Mandal, District) */}
              <div className="grid grid-cols-12 gap-3 border-t border-slate-100 pt-2">
                <div className="col-span-12 md:col-span-4 flex flex-col">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Aadhaar Address <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={custAadhaarAddress}
                    onChange={editLoanId ? (e) => setCustAadhaarAddress(e.target.value) : undefined}
                    readOnly={!editLoanId}
                    placeholder="Aadhaar Address (Door No, Street, Village, Mandal, District)"
                    rows={3}
                    className="w-full flex-1 bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none resize-none peek-caption-12 read-only:bg-slate-50"
                  />
                </div>
                <div className="col-span-12 md:col-span-4 flex flex-col">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Present Address <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={custPresentAddress}
                    onChange={editLoanId ? (e) => setCustPresentAddress(e.target.value) : undefined}
                    readOnly={!editLoanId}
                    placeholder="Street / Area / Landmark"
                    rows={3}
                    className="w-full flex-1 bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none resize-none peek-caption-12 read-only:bg-slate-50"
                  />
                </div>
                <div className="col-span-12 md:col-span-4 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">House No <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={custHouseNo}
                      onChange={editLoanId ? (e) => setCustHouseNo(e.target.value) : undefined}
                      readOnly={!editLoanId}
                      placeholder="DOOR NO"
                      className="w-full bg-white border rounded-lg px-2 text-sm text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none h-[38px] read-only:bg-slate-50 border-slate-200 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Village <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={custVillage}
                      onChange={(editLoanId || !custVillageSaved) ? (e) => { setCustVillage(e.target.value); setErrors(p => ({ ...p, custVillage: false })); } : undefined}
                      readOnly={!(editLoanId || !custVillageSaved)}
                      placeholder="VILLAGE"
                      title={!editLoanId && !custVillageSaved ? 'No village saved for this customer yet: type it here and it is saved to the customer with the loan' : undefined}
                      className={`w-full bg-white border rounded-lg px-2 text-sm text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none h-[38px] read-only:bg-slate-50 uppercase ${errors.custVillage ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-200'}`}
                    />
                    {errors.custVillage && <p className="text-xs text-red-500 font-bold mt-1">Village is required</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Mandal <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={custMandal}
                      onChange={editLoanId ? (e) => setCustMandal(e.target.value) : undefined}
                      readOnly={!editLoanId}
                      placeholder="MANDAL"
                      className="w-full bg-white border rounded-lg px-2 text-sm text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none h-[38px] read-only:bg-slate-50 border-slate-200 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">District <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={custDistrict}
                      onChange={editLoanId ? (e) => setCustDistrict(e.target.value) : undefined}
                      readOnly={!editLoanId}
                      placeholder="DISTRICT"
                      className="w-full bg-white border rounded-lg px-2 text-sm text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none h-[38px] read-only:bg-slate-50 border-slate-200 uppercase"
                    />
                  </div>
                </div>
              </div>

              {/* Photo, Signature & Biometrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-slate-150">
                <div className="bg-white border border-slate-200 rounded p-3 flex flex-col items-center justify-center space-y-2">
                  <span className="peek-label uppercase text-slate-500 font-bold mb-1 text-[11px]">Customer Photo</span>
                  <div className="w-28 h-28 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden relative">
                    {custPhoto ? (
                      <img src={custPhoto} alt="Customer" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center text-slate-400 gap-1">
                        <User className="w-8 h-8 stroke-1" />
                        <span className="text-[9px] peek-button uppercase">NO PHOTO</span>
                      </div>
                    )}
                  </div>
                  {selectedCustomerId && (
                    <button
                      type="button"
                      onClick={handleRefreshCustPhoto}
                      className="text-[10px] bg-white text-slate-700 border border-slate-200 px-3 py-1.5 rounded hover:bg-slate-50 shadow-sm font-bold uppercase transition-colors"
                    >
                      REFRESH PHOTO
                    </button>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded p-3 flex flex-col items-center justify-center space-y-2">
                  <span className="peek-label uppercase text-slate-500 font-bold mb-1 text-[11px]">Customer Signature</span>
                  <div className="w-28 h-28 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden relative">
                    {custSignature ? (
                      <img src={custSignature} alt="Signature" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 font-bold uppercase">No Signature</span>
                    )}
                  </div>
                </div>

                <BiometricScanner
                  label="Customer Fingerprint Capture"
                  existingTemplate={custFingerprintTemplate}
                  existingImageUrl={custFingerprintUrl}
                  disabled={true}
                  onFingerprintSaved={(url, template, added) => {
                    setCustFingerprintUrl(url);
                    setCustFingerprintTemplate(template);
                    setCustFingerprintAdded(added);
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: GUARANTORS */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <h3 className="text-slate-900 border-b border-slate-100 pb-2 uppercase font-bold text-[15px]">
            GUARANTORS
          </h3>
          
          {/* Guarantor 1 */}
          <div className="space-y-3 pb-4 border-b border-slate-100">
            <div className="flex justify-between items-center">
              <h4 className="text-slate-900 font-bold text-xs uppercase tracking-wide">
                GUARANTOR 1 <span className="text-red-500 ml-1">*</span>
              </h4>
              {g1SelectedId && (!editLoanId || !hasLedgerActivity) && (
                <button
                  type="button"
                  onClick={() => {
                    setG1SelectedId('');
                    setG1Name('');
                    setG1Phone('');
                    setG1Phone2('');
                    setG1Aadhaar('');
                    setG1AadhaarAddress('');
                    setG1PresentAddress('');
                    setG1Photo(null);
                    setG1Signature(null);
                    setErrors(p => ({ ...p, g1SelectedId: false }));
                  }}
                  className="text-[10px] text-red-655 hover:underline peek-button uppercase font-bold"
                >
                  CLEAR SELECTION
                </button>
              )}
            </div>

            {/* Search select existing guarantor 1 */}
            <div ref={g1DropdownRef} className="relative print:hidden">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <input
                ref={g1SearchRef}
                type="text"
                value={g1Search}
                disabled={!!editLoanId && hasLedgerActivity}
                onChange={(e) => {
                  setG1Search(e.target.value);
                  setG1DropdownOpen(true);
                  setErrors(p => ({ ...p, g1SelectedId: false }));
                }}
                onFocus={() => {
                  if (!editLoanId || !hasLedgerActivity) setG1DropdownOpen(true);
                }}
                placeholder={!!editLoanId && hasLedgerActivity ? "Guarantor 1 locked" : "Type to search guarantor 1..."}
                className={`w-full border rounded-lg pl-9 pr-4 py-2 text-slate-800 focus:outline-none peek-caption-12 ${
                  !!editLoanId && hasLedgerActivity
                    ? 'bg-slate-100 cursor-not-allowed'
                    : errors.g1SelectedId
                      ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500'
                      : 'bg-slate-50 border-slate-200 focus:ring-1 focus:ring-slate-900'
                }`}
              />
              
              {isSearchingG1 && (
                <div className="absolute inset-y-0 right-10 pr-3 flex items-center pointer-events-none">
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-slate-400"></div>
                </div>
              )}
              {g1DropdownOpen && (!editLoanId || !hasLedgerActivity) && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {g1SearchResults.length === 0 && !isSearchingG1 ? (
                    <div className="px-4 py-3 text-slate-400 text-center peek-h3 uppercase text-xs">
                      No matching guarantors
                    </div>
                  ) : (
                    g1SearchResults.map((g) => (
                      <div
                        key={g.id}
                        onClick={() => {
                          if (g.id) setG1SelectedId(g.id);
                          setG1DropdownOpen(false);
                          setG1Search('');
                          setErrors(p => ({ ...p, g1SelectedId: false }));
                        }}
                        className="px-4 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                      >
                        <div>
                          <div className="text-slate-900 peek-caption-12 font-bold">{g.name}</div>
                          <div className="text-[9px] text-slate-400 mt-0.5 peek-button uppercase">
                            ID: #{g.customer_id || 'N/A'} | Aadhaar: {g.aadhaar || 'N/A'}
                          </div>
                        </div>
                        {(g.phone || g.phone_1) && (
                          <div className="text-[9px] text-slate-500 font-mono peek-button font-bold">
                            {g.phone || g.phone_1}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Guarantor 1 details */}
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 pt-2">
              <Input label="Name" value={g1Name} readOnly placeholder="Name" />
              <Input label="Aadhaar" value={g1Aadhaar} readOnly placeholder="Aadhaar" />
              <Input label="Phone 1" value={g1Phone} readOnly placeholder="Phone 1" />
              <Input label="Phone 2" value={g1Phone2} readOnly placeholder="Phone 2" />
              <div className="flex flex-col items-center justify-center">
                <span className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Photo</span>
                <div className="w-14 h-14 bg-slate-50 border rounded overflow-hidden">
                  {g1Photo ? (
                    <img src={g1Photo} alt="G1" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-350"><User className="w-5 h-5" /></div>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-center justify-center">
                <span className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Signature</span>
                <div className="w-14 h-14 bg-slate-50 border rounded overflow-hidden flex items-center justify-center">
                  {g1Signature ? (
                    <img src={g1Signature} alt="G1 Sig" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[8px] text-slate-400 uppercase">None</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Aadhaar Address
                </label>
                <textarea
                  value={g1AadhaarAddress}
                  readOnly
                  placeholder="Guarantor 1 Aadhaar Address"
                  rows={1}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none resize-none peek-caption-12"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Present Address
                </label>
                <textarea
                  value={g1PresentAddress}
                  readOnly
                  placeholder="Guarantor 1 Present Address"
                  rows={1}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none resize-none peek-caption-12"
                />
              </div>
            </div>
          </div>

          {/* Guarantor 2 */}
          <div className="space-y-3 pt-2">
            <div className="flex justify-between items-center">
              <h4 className="text-slate-900 font-bold text-xs uppercase tracking-wide">
                GUARANTOR 2
              </h4>
              {g2SelectedId && (!editLoanId || !hasLedgerActivity) && (
                <button
                  type="button"
                  onClick={() => {
                    setG2SelectedId('');
                    setG2Name('');
                    setG2Phone('');
                    setG2Phone2('');
                    setG2Aadhaar('');
                    setG2AadhaarAddress('');
                    setG2PresentAddress('');
                    setG2Photo(null);
                    setG2Signature(null);
                  }}
                  className="text-[10px] text-red-655 hover:underline peek-button uppercase font-bold"
                >
                  CLEAR SELECTION
                </button>
              )}
            </div>

            {/* Search select existing guarantor 2 */}
            <div ref={g2DropdownRef} className="relative print:hidden">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                value={g2Search}
                disabled={!!editLoanId && hasLedgerActivity}
                onChange={(e) => {
                  setG2Search(e.target.value);
                  setG2DropdownOpen(true);
                }}
                onFocus={() => {
                  if (!editLoanId || !hasLedgerActivity) setG2DropdownOpen(true);
                }}
                placeholder={!!editLoanId && hasLedgerActivity ? "Guarantor 2 locked" : "Type to search guarantor 2..."}
                className={`w-full border rounded-lg pl-9 pr-4 py-2 text-slate-800 focus:outline-none peek-caption-12 ${
                  !!editLoanId && hasLedgerActivity
                    ? 'bg-slate-100 cursor-not-allowed'
                    : 'bg-slate-50 border-slate-200 focus:ring-1 focus:ring-slate-900'
                }`}
              />
              
              {isSearchingG2 && (
                <div className="absolute inset-y-0 right-10 pr-3 flex items-center pointer-events-none">
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-slate-400"></div>
                </div>
              )}
              {g2DropdownOpen && (!editLoanId || !hasLedgerActivity) && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {g2SearchResults.length === 0 && !isSearchingG2 ? (
                    <div className="px-4 py-3 text-slate-400 text-center peek-h3 uppercase text-xs">
                      No matching guarantors
                    </div>
                  ) : (
                    g2SearchResults.map((g) => (
                      <div
                        key={g.id}
                        onClick={() => {
                          if (g.id) setG2SelectedId(g.id);
                          setG2DropdownOpen(false);
                          setG2Search('');
                        }}
                        className="px-4 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0"
                      >
                        <div>
                          <div className="text-slate-900 peek-caption-12 font-bold">{g.name}</div>
                          <div className="text-[9px] text-slate-400 mt-0.5 peek-button uppercase">
                            ID: #{g.customer_id || 'N/A'} | Aadhaar: {g.aadhaar || 'N/A'}
                          </div>
                        </div>
                        {(g.phone || g.phone_1) && (
                          <div className="text-[9px] text-slate-500 font-mono peek-button font-bold">
                            {g.phone || g.phone_1}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Guarantor 2 details */}
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 pt-2">
              <Input label="Name" value={g2Name} readOnly placeholder="Name" />
              <Input label="Aadhaar" value={g2Aadhaar} readOnly placeholder="Aadhaar" />
              <Input label="Phone 1" value={g2Phone} readOnly placeholder="Phone 1" />
              <Input label="Phone 2" value={g2Phone2} readOnly placeholder="Phone 2" />
              <div className="flex flex-col items-center justify-center">
                <span className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Photo</span>
                <div className="w-14 h-14 bg-slate-50 border rounded overflow-hidden">
                  {g2Photo ? (
                    <img src={g2Photo} alt="G2" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-355"><User className="w-5 h-5" /></div>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-center justify-center">
                <span className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Signature</span>
                <div className="w-14 h-14 bg-slate-50 border rounded overflow-hidden flex items-center justify-center">
                  {g2Signature ? (
                    <img src={g2Signature} alt="G2 Sig" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[8px] text-slate-400 uppercase">None</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Aadhaar Address
                </label>
                <textarea
                  value={g2AadhaarAddress}
                  readOnly
                  placeholder="Guarantor 2 Aadhaar Address"
                  rows={1}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none resize-none peek-caption-12"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Present Address
                </label>
                <textarea
                  value={g2PresentAddress}
                  readOnly
                  placeholder="Guarantor 2 Present Address"
                  rows={1}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none resize-none peek-caption-12"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: LOAN TERMS */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-slate-800 font-bold text-[15px] uppercase">
              LOAN TERMS
            </h3>
            <p className="text-slate-500 text-xs uppercase mt-0.5">
              Principal and rates of interest, penalty, document charges and net disbursement preview
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 items-end">
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">LOAN AMOUNT () <span className="text-red-500">*</span></label>
              <input
                type="number"
                ref={amountRef}
                value={amount}
                disabled={!!editLoanId && hasLedgerActivity}
                onChange={(e) => { setAmount(e.target.value); setErrors(p => ({...p, amount: false})) }}
                className={`w-full bg-white border rounded-lg p-2 text-sm text-slate-800 focus:outline-none h-[38px] ${errors.amount ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500' : 'border-slate-200 focus:ring-1 focus:ring-slate-900'}`}
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">INTEREST ({loanCategory === 'HP' ? '% per period' : '% pm'}) <span className="text-red-500">*</span></label>
              <input
                type="number"
                ref={interestRateRef}
                value={interestRate}
                disabled={(!user?.is_admin) || (!!editLoanId && hasLedgerActivity)}
                onChange={(e) => { setInterestRate(e.target.value); setErrors(p => ({...p, interestRate: false})) }}
                className={`w-full bg-white border rounded-lg p-2 text-sm text-slate-800 focus:outline-none h-[38px] ${errors.interestRate ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500' : 'border-slate-200 focus:ring-1 focus:ring-slate-900'}`}
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">PENALTY ({loanCategory === 'HP' ? '% per period' : '% pm'}) <span className="text-red-500">*</span></label>
              <input
                type="number"
                value={penaltyPercent}
                disabled={(!user?.is_admin) || (!!editLoanId && hasLedgerActivity)}
                onChange={(e) => setPenaltyPercent(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-sm text-slate-800 focus:ring-1 focus:ring-slate-900 focus:outline-none h-[38px] disabled:bg-slate-50"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">PERIOD (DAYS) <span className="text-red-500">*</span></label>
              <input
                type="number"
                ref={durationMonthsRef}
                value={durationMonths}
                disabled={!!editLoanId && hasLedgerActivity}
                onChange={(e) => { setDurationMonths(e.target.value); setErrors(p => ({...p, durationMonths: false})) }}
                className={`w-full bg-white border rounded-lg p-2 text-sm text-slate-800 focus:outline-none h-[38px] ${errors.durationMonths ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500' : 'border-slate-200 focus:ring-1 focus:ring-slate-900'}`}
                required
              />
            </div>
            {loanCategory === 'HP' && (
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">INSTALLMENTS <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  ref={installmentsRef}
                  value={installmentsCount}
                  min={2}
                  step={1}
                  disabled={!!editLoanId && hasLedgerActivity}
                  onChange={(e) => { setInstallmentsCount(e.target.value); setErrors(p => ({...p, installmentsCount: false})) }}
                  className={`w-full bg-white border rounded-lg p-2 text-sm text-slate-800 focus:outline-none h-[38px] disabled:bg-slate-100 disabled:cursor-not-allowed ${errors.installmentsCount ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500' : 'border-slate-200 focus:ring-1 focus:ring-slate-900'}`}
                  required
                />
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">DOC CHARGES () <span className="text-red-500">*</span></label>
              <input
                ref={docChargesRef}
                type="number"
                value={docCharges}
                disabled={!!editLoanId && hasLedgerActivity}
                onChange={(e) => {
                  setDocCharges(e.target.value);
                  setErrors((p) => ({ ...p, docCharges: false }));
                }}
                className={`w-full bg-white border rounded-lg p-2 text-sm text-slate-800 focus:outline-none h-[38px] disabled:bg-slate-100 disabled:cursor-not-allowed ${
                  errors.docCharges
                    ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500'
                    : 'border-slate-200 focus:ring-1 focus:ring-slate-900'
                }`}
              />
            </div>
            
            {/* Realtime Disbursement Preview */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex flex-col justify-center items-center h-[38px] font-bold shadow-inner">
              <span className="text-[8px] text-slate-400 uppercase block tracking-wider">Net Amount To Borrower</span>
              <span className="text-[14px] text-emerald-800 font-black">
                {liveCalculations ? formatRupee(liveCalculations.netDisbursed) : '0.00'}
              </span>
            </div>
          </div>

          {loanCategory === 'HP' && liveCalculations?.hp && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 text-xs text-indigo-900 leading-relaxed">
              <span className="font-bold">HP schedule: </span>
              installment 1 = {formatRupee(liveCalculations.hp.schedule[0].principal)} principal, kept today.
              Then {liveCalculations.hp.schedule.length - 1} installments of {formatRupee(liveCalculations.hp.installmentAmount)} every {durationMonths} days
              ({formatRupee(liveCalculations.hp.principalPerInstallment)} principal + {formatRupee(liveCalculations.hp.interestPerInstallment)} interest),
              first on {liveCalculations.hp.schedule[1]?.dueDate}, last on {liveCalculations.hp.lastDueDate}.
              Total interest {formatRupee(liveCalculations.hp.totalInterest)}.
            </div>
          )}

          <div className="w-full">
            <label className="text-[11px] font-bold text-slate-700 uppercase mb-1 block">PARTICULARS <span className="text-red-500">*</span></label>
            <textarea
              ref={particularsRef}
              value={particulars}
              disabled={!!editLoanId && hasLedgerActivity}
              onChange={(e) => { setParticulars(e.target.value); setErrors(p => ({...p, particulars: false})) }}
              rows={1}
              className={`w-full bg-white border rounded-lg p-2 text-sm text-slate-800 focus:outline-none resize-none h-[38px] disabled:bg-slate-100 disabled:cursor-not-allowed ${errors.particulars ? 'border-red-500 bg-red-50 focus:ring-1 focus:ring-red-500' : 'border-slate-200 focus:ring-1 focus:ring-slate-900'}`}
            />
          </div>
        </div>

        {/* Card 6: DOCUMENTS SUBMITTED */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <div className="border-b border-slate-100 pb-2">
            <h3 className="text-slate-850 font-bold text-[15px] uppercase">
              DOCUMENTS SUBMITTED
            </h3>
            <p className="text-slate-500 text-xs uppercase mt-0.5">
              Select the documents physically submitted and enter any additional remarks
            </p>
          </div>

          <div className="space-y-4 pt-2">
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="min-w-full divide-y divide-slate-150 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-bold text-slate-700 uppercase">Document Name</th>
                    <th className="px-4 py-2.5 text-center font-bold text-slate-700 uppercase w-36">File Attachment</th>
                    <th className="px-4 py-2.5 text-center font-bold text-slate-700 uppercase w-24">View</th>
                    <th className="px-4 py-2.5 text-right font-bold text-slate-700 uppercase w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loanDocs.map((doc, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={doc.name}
                          onChange={(e) => {
                            const next = [...loanDocs];
                            next[idx].name = e.target.value;
                            setLoanDocs(next);
                          }}
                          placeholder="Document Name (e.g. Gold Invoice)"
                          className="w-full bg-white border border-slate-200 rounded p-1.5 font-bold text-slate-800 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        {doc.fileUrl ? (
                          <div className="text-emerald-700 font-bold flex items-center justify-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Uploaded
                          </div>
                        ) : (
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border rounded cursor-pointer hover:bg-slate-50 text-[10px] font-bold uppercase shadow-sm">
                            Upload File
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  try {
                                    const fileExt = file.name.split('.').pop();
                                    const fileName = `doc-${Date.now()}.${fileExt}`;
                                    const filePath = `documents/${fileName}`;
                                    const { error } = await supabase.storage
                                      .from('finance-photos')
                                      .upload(filePath, file);
                                    if (error) throw error;
                                    const { data } = supabase.storage
                                      .from('finance-photos')
                                      .getPublicUrl(filePath);
                                    
                                    const next = [...loanDocs];
                                    next[idx].fileUrl = data.publicUrl;
                                    next[idx].fileName = file.name;
                                    setLoanDocs(next);
                                    toast.success('Document uploaded!');
                                  } catch (err) {
                                    console.error(err);
                                    toast.error('Upload failed');
                                  }
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {doc.fileUrl ? (
                          <a
                            href={doc.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline uppercase font-bold text-[10px]"
                          >
                            View File
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            const next = loanDocs.filter((_, i) => i !== idx);
                            setLoanDocs(next);
                          }}
                          className="text-red-600 hover:underline uppercase font-bold text-[10px]"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => setLoanDocs(prev => [...prev, { name: '', fileUrl: null }])}
              className="py-1.5 px-4 bg-white border border-dashed border-slate-300 hover:border-slate-400 rounded text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors uppercase shadow-sm"
            >
              + Add Document
            </button>
          </div>
        </div>

        {/* Card 7: ASSET / COLLATERAL LOCATION */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <h3 className="text-slate-900 uppercase font-bold text-[15px]">
              ASSET / COLLATERAL INFORMATION
            </h3>
          </div>

          <div className="space-y-4">
            {locations.map((loc, idx) => (
              <div key={idx} className="border border-slate-200 rounded p-3 bg-slate-50/30 space-y-2">
                <div className="flex justify-between items-center border-b pb-1">
                  <span className="text-xs font-bold text-slate-700 uppercase">Location #{idx + 1}</span>
                  {locations.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLocation(idx)}
                      className="text-xs text-red-600 hover:underline uppercase font-bold"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <Input
                  label="Location Description"
                  value={loc.address}
                  onChange={(val) => updateLocation(idx, 'address', val)}
                  placeholder="Door No, Street, Landmark, Village..."
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Latitude"
                    value={loc.latitude}
                    onChange={(val) => updateLocation(idx, 'latitude', val)}
                    placeholder="GPS Latitude"
                  />
                  <Input
                    label="Longitude"
                    value={loc.longitude}
                    onChange={(val) => updateLocation(idx, 'longitude', val)}
                    placeholder="GPS Longitude"
                  />
                </div>
                <Input
                  label="Google Maps Location Link"
                  value={loc.mapsLink}
                  onChange={(val) => updateLocation(idx, 'mapsLink', val)}
                  placeholder="Paste Google Maps link here..."
                />
                     <Input
                  label="Remarks / Specific bounds"
                  value={loc.remarks || ''}
                  onChange={(val) => updateLocation(idx, 'remarks', val)}
                  placeholder="e.g. Bound east by road, west by plot 10"
                />

                {/* Location Image */}
                <div className="pt-2 space-y-2">
                  <label className="peek-label uppercase block mb-1 text-[11px] font-bold text-slate-700">Location Photos (Multiple)</label>
                  <div className="flex flex-wrap gap-4">
                    {(loc.images || []).map((imgUrl, imgIdx) => (
                      <div key={imgIdx} className="relative w-28 h-28 rounded-lg border overflow-hidden group">
                        <img src={imgUrl} alt={`Location ${imgIdx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            const nextImages = (loc.images || []).filter((_, i) => i !== imgIdx);
                            updateLocation(idx, 'images', nextImages);
                          }}
                          className="absolute inset-0 bg-black/50 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4 mb-0.5" />
                          <span className="text-[8px] uppercase">REMOVE</span>
                        </button>
                      </div>
                    ))}
                    {loc.image && (!loc.images || !loc.images.includes(loc.image)) && (
                      <div className="relative w-28 h-28 rounded-lg border overflow-hidden group">
                        <img src={loc.image} alt="Location Original" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => updateLocation(idx, 'image', null)}
                          className="absolute inset-0 bg-black/50 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4 mb-0.5" />
                          <span className="text-[8px] uppercase">REMOVE</span>
                        </button>
                      </div>
                    )}
                    <label className="w-28 h-28 flex flex-col items-center justify-center border border-dashed rounded-lg cursor-pointer hover:bg-slate-50/50">
                      <Camera className="w-5 h-5 text-slate-400 mb-1" />
                      <span className="text-[9px] text-slate-500 uppercase">Add Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const fileExt = file.name.split('.').pop();
                              const fileName = `loc-${Date.now()}.${fileExt}`;
                              const filePath = `collateral/${fileName}`;
                              const { error } = await supabase.storage
                                .from('finance-photos')
                                .upload(filePath, file);
                              if (error) throw error;
                              const { data } = supabase.storage
                                .from('finance-photos')
                                .getPublicUrl(filePath);
                              const currentImages = loc.images || [];
                              updateLocation(idx, 'images', [...currentImages, data.publicUrl]);
                              toast.success('Location image uploaded!');
                            } catch (err) {
                              console.error(err);
                              toast.error('Upload failed');
                            }
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addLocation}
              className="w-full py-2 bg-white border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm uppercase"
            >
              + Add More Locations
            </button>
          </div>
        </div>

        {/* Card 8: DESCRIPTION & EXTRA FEATURES */}
        <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
          <h3 className="text-slate-900 border-b border-slate-100 pb-2 uppercase font-bold text-[15px]">
            DESCRIPTION & EXTRA FEATURES
          </h3>
          <div className="space-y-4">
            <div>
              <label className="peek-label uppercase block mb-1 text-[11px] font-bold text-slate-700">
                REMARKS
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="REASON FOR BORROWING, REPAYMENT ARRANGEMENT..."
                rows={3}
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-gray-800 placeholder-gray-400 focus:ring-1 focus:ring-slate-900 focus:outline-none peek-caption-12"
              />
            </div>

            <div>
              <label className="peek-label uppercase block mb-1 text-[11px] font-bold text-slate-700">
                EXTRA DETAILS
              </label>
              <textarea
                value={extraDetails}
                onChange={(e) => setExtraDetails(e.target.value)}
                placeholder="SPECIAL CONDITIONS, ETC."
                rows={2}
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-gray-800 placeholder-gray-400 focus:ring-1 focus:ring-slate-900 focus:outline-none peek-caption-12"
              />
            </div>
          </div>
        </div>
        </fieldset>
      </div>

      {/* Print Preview Modal */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Loan Entry - Preview"
        documentTitle="LOAN ENTRY FORM"
      >
        <div className="space-y-2">
          {/* Top Header */}
          <div className="text-center border-b pb-4">
            <h1 className="peek-h1 text-xl font-bold">THIRUMALA GROUP - LOAN ENTRY</h1>
            <p className="text-slate-500 mt-1 finance-sidebar-link">Date: {date} | Loan Type: {loanCategory}</p>
          </div>
          
          {/* Customer Info */}
          <div>
            <h3 className="bg-slate-100 p-2 finance-sidebar-link uppercase font-bold text-sm">Customer Details</h3>
            <div className="grid grid-cols-2 gap-4 mt-2 p-2">
               <div><span className="text-gray-500 peek-caption-12 font-bold">NAME:</span> {custName}</div>
               {(() => {
                 const rel = getRelationshipDisplay(custFatherName);
                 return (
                   <div><span className="text-gray-500 peek-caption-12 font-bold">{rel.label.toUpperCase()}:</span> {rel.name}</div>
                 );
               })()}
               <div><span className="text-gray-500 peek-caption-12 font-bold">PHONE:</span> {custPhone}</div>
               <div><span className="text-gray-500 peek-caption-12 font-bold">AADHAAR:</span> {custAadhaar}</div>
               <div className="col-span-2"><span className="text-gray-500 peek-caption-12 font-bold">ADDRESS:</span> {custPresentAddress}</div>
            </div>
          </div>

          {/* Guarantors */}
          <div>
            <h3 className="bg-slate-100 p-2 finance-sidebar-link uppercase font-bold text-sm">Guarantor Details</h3>
            <div className="grid grid-cols-2 gap-4 mt-2 p-2">
               <div><span className="text-gray-500 peek-caption-12 font-bold">G1 NAME:</span> {g1Name}</div>
               <div><span className="text-gray-500 peek-caption-12 font-bold">G1 PHONE:</span> {g1Phone}</div>
               {g2Name && <div><span className="text-gray-500 peek-caption-12 font-bold">G2 NAME:</span> {g2Name}</div>}
               {g2Phone && <div><span className="text-gray-500 peek-caption-12 font-bold">G2 PHONE:</span> {g2Phone}</div>}
            </div>
          </div>

          {/* Loan Terms */}
          <div>
            <h3 className="bg-slate-100 p-2 finance-sidebar-link uppercase font-bold text-sm">Loan Terms</h3>
            <div className="grid grid-cols-2 gap-4 mt-2 p-2">
               <div><span className="text-gray-500 peek-caption-12 font-bold">PRINCIPAL:</span> {formatRupee(Number(amount) || 0)}</div>
               {loanCategory === 'HP' ? (
                 <>
                   <div><span className="text-gray-500 peek-caption-12 font-bold">INTEREST RATE:</span> {interestRate}% / PERIOD</div>
                   <div><span className="text-gray-500 peek-caption-12 font-bold">PENALTY:</span> {penaltyPercent}% / PERIOD</div>
                   <div><span className="text-gray-500 peek-caption-12 font-bold">INSTALLMENTS:</span> {installmentsCount} (EVERY {durationMonths} DAYS)</div>
                 </>
               ) : (
                 <>
                   <div><span className="text-gray-500 peek-caption-12 font-bold">INTEREST RATE:</span> {interestRate}% / MONTH</div>
                   <div><span className="text-gray-500 peek-caption-12 font-bold">DURATION:</span> {durationMonths} MONTHS</div>
                   <div><span className="text-gray-500 peek-caption-12 font-bold">DUE TYPE:</span> {dueType}</div>
                 </>
               )}
               <div><span className="text-gray-500 peek-caption-12 font-bold">DOC CHARGES:</span> {formatRupee(Number(docCharges) || 0)}</div>
               <div className="col-span-2"><span className="text-gray-500 peek-caption-12 font-bold">PARTICULARS:</span> {particulars}</div>
            </div>
          </div>

          {/* Live Calculation */}
          {liveCalculations && (
          <div>
            <h3 className="bg-slate-100 p-2 finance-sidebar-link uppercase font-bold text-sm">Calculations</h3>
            <div className="grid grid-cols-2 gap-4 mt-2 p-2">
               <div><span className="text-gray-500 peek-caption-12 font-bold">NET DISBURSED:</span> {formatRupee(liveCalculations.netDisbursed)}</div>
               <div><span className="text-gray-500 peek-caption-12 font-bold">TOTAL REPAYMENT:</span> {formatRupee(liveCalculations.totalRepayment)}</div>
               <div><span className="text-gray-500 peek-caption-12 font-bold">INSTALMENT COUNT:</span> {liveCalculations.duesCount}</div>
               <div><span className="text-gray-500 peek-caption-12 font-bold">INSTALMENT AMOUNT:</span> {formatRupee(liveCalculations.dueAmount)}</div>
            </div>
          </div>
          )}
          
          {/* Signatures */}
          <div className="pt-24 grid grid-cols-2 gap-10 text-center text-slate-500 finance-sidebar-link">
            <div>
              <div className="border-t border-slate-300 pt-2 w-48 mx-auto font-bold">Customer Signature</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2 w-48 mx-auto font-bold">Authorized Signatory</div>
            </div>
          </div>
        </div>
      </FinancePrintPreview>

    </div>
  );
};

export default LoanEntry;
