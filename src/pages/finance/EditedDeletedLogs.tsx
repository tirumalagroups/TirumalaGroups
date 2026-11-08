import React, { useEffect, useState, useMemo } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import { FinanceSmartCalendar } from '../../components/finance/FinanceSmartCalendar';
import { supabaseFinance, FinanceEditedLog, FinanceDeletedLog } from '../../lib/supabaseFinance';
import { Trash2, Edit2, Search, Calendar, Database, X, Printer, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { exportToExcel } from '../../utils/excel';
import FinancePrintPreview from '../../components/finance/FinancePrintPreview';

export const ignoredKeys = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'customer_id',
  'fingerprint_url',
  'fingerprint_template',
  'fingerprint_added',
  'customer_fingerprint_template',
  'customer_fingerprint_image_url',
  'customer_fingerprint_added',
  'surety_fingerprint_template',
  'surety_fingerprint_image_url',
  'surety_fingerprint_added',
  'photo_url',
  'customer_photo_url',
  'surety_photo_url',
  'fingerprint_status',
  'fingerprint_id',
]);

export const keyLabelMap: Record<string, string> = {
  id: 'ID',
  created_at: 'CREATED AT',
  updated_at: 'UPDATED AT',
  deleted_at: 'DELETED AT',
  notes: 'NOTES',
  remarks: 'REMARKS',
  status: 'STATUS',
  name: 'NAME',
  phone: 'PHONE',
  phone_1: 'PHONE 1',
  phone_2: 'PHONE 2',
  phone2: 'PHONE 2',
  address: 'ADDRESS',
  aadhaar: 'AADHAAR NUMBER',
  father_name: 'FATHER/HUSBAND NAME',
  father_husband_name: 'FATHER/HUSBAND NAME',
  village: 'VILLAGE',
  mandal: 'MANDAL',
  district: 'DISTRICT',
  state: 'STATE',
  pincode: 'PINCODE',
  landmark: 'LANDMARK',

  loan_id: 'LOAN NUMBER',
  customer_id: 'CUSTOMER ID',
  date: 'LOAN DATE',
  amount: 'LOAN AMOUNT',
  interest_rate: 'INTEREST RATE (%)',
  duration_months: 'PERIOD (MONTHS)',
  period_days: 'PERIOD (DAYS)',
  due_type: 'DUE TYPE',
  due_amount: 'DUE AMOUNT',
  surety_name: 'SURETY NAME',
  surety_phone: 'SURETY PHONE',
  surety_aadhaar: 'SURETY AADHAAR',
  surety_relation: 'SURETY RELATION',
  surety_aadhaar_address: 'SURETY AADHAAR ADDRESS',
  surety_present_address: 'SURETY PRESENT ADDRESS',
  loan_category: 'LOAN CATEGORY',
  npa_closed: 'NPA CLOSED',
  document_charges: 'DOCUMENT CHARGES',
  penalty_percent: 'PENALTY RATE (%)',
  guarantor_1_id: 'GUARANTOR 1 ID',
  guarantor_2_id: 'GUARANTOR 2 ID',

  gps_latitude: 'GPS LATITUDE',
  gps_longitude: 'GPS LONGITUDE',
  google_maps_link: 'GOOGLE MAPS LINK',
  collateral_image: 'COLLATERAL IMAGE',
  collateral_address: 'COLLATERAL ADDRESS',
  particulars: 'ITEM DETAILS / PARTICULARS',
  extraDetails: 'EXTRA DETAILS',

  guarantor_id: 'GUARANTOR ID',
  permanent_address: 'PERMANENT ADDRESS',
  current_address: 'CURRENT ADDRESS',
  fingerprint_id: 'FINGERPRINT ID',
  fingerprint_added: 'FINGERPRINT ADDED',
  fingerprint_status: 'FINGERPRINT STATUS',
};

export const mapFieldLabel = (field: string): string => {
  if (keyLabelMap[field]) return keyLabelMap[field];
  return field
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(/\s+/)
    .map(word => word.toUpperCase())
    .join(' ');
};

export const formatDateHuman = (dateStr: string): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = String(hours).padStart(2, '0');
  
  return `${day}-${month}-${year} ${hoursStr}:${minutes} ${ampm}`;
};

export const formatLogValue = (field: string, val: any): string => {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'boolean') return val ? 'YES' : 'NO';
  if (typeof val === 'object') {
    try {
      return Object.entries(val)
        .map(([k, v]) => `${mapFieldLabel(k)}: ${formatLogValue(k, v)}`)
        .join('\n');
    } catch {
      return JSON.stringify(val);
    }
  }

  const fieldLower = field.toLowerCase();
  const numVal = Number(val);
  
  if (!isNaN(numVal) && typeof val !== 'string') {
    if (fieldLower.includes('rate') || fieldLower.includes('percent') || fieldLower.includes('interest')) {
      return `${numVal}%`;
    }
    if (fieldLower.includes('amount') || fieldLower.includes('charge') || fieldLower.includes('fee') || fieldLower.includes('balance') || fieldLower === 'debit' || fieldLower === 'credit' || fieldLower.includes('liability')) {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
      }).format(numVal);
    }
  } else if (typeof val === 'string') {
    const parsedNum = Number(val);
    if (!isNaN(parsedNum) && val.trim() !== '') {
      if (fieldLower.includes('amount') || fieldLower.includes('charge') || fieldLower.includes('fee') || fieldLower.includes('balance') || fieldLower.includes('liability')) {
        return new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency: 'INR',
          maximumFractionDigits: 2,
        }).format(parsedNum);
      }
      if (fieldLower.includes('rate') || fieldLower.includes('percent')) {
        return `${parsedNum}%`;
      }
    }
  }

  return String(val);
};

export const mapTableName = (table: string): string => {
  switch (table) {
    case 'finance_loans':
      return 'LOANS';
    case 'finance_customers':
      return 'CUSTOMERS';
    case 'finance_loans_collateral':
      return 'COLLATERAL';
    case 'finance_guarantors':
      return 'GUARANTORS';
    case 'finance_partners':
      return 'PARTNERS';
    case 'finance_capital_entries':
      return 'CAPITAL ENTRIES';
    case 'finance_cashbook_entries':
      return 'CASHBOOK ENTRIES';
    case 'finance_transactions':
      return 'LOAN RECEIPTS';
    default:
      return table.toUpperCase();
  }
};

export interface ChangedField {
  field: string;
  fieldLabel: string;
  oldValue: any;
  newValue: any;
}

export interface GroupedEditAuditEvent {
  id: string; // Audit log database UUID
  eventType: 'CREATE' | 'EDIT';
  timestamp: string; // ISO string
  operator: string;
  tableName: string;
  recordId: string;
  displayLoanNo: string;
  displayCustomer: string;
  source: string;
  changedFields: ChangedField[];
  rawLog: FinanceEditedLog;
}

export interface FlattenedLog {
  id: string;
  logId: string;
  edited_at: string;
  edited_by: string;
  table_name: string;
  record_id: string;
  field: string;
  oldValue: any;
  newValue: any;
  source: string;
  loanNo: string;
  customer: string;
  rawLog: FinanceEditedLog;
}

// Backward compatibility export for tests
export const flattenLog = (log: FinanceEditedLog): FlattenedLog[] => {
  const oldVals = log.old_values || {};
  const newVals = log.new_values || {};

  if (typeof newVals === 'object' && newVals !== null && 'field_name' in newVals) {
    const field = newVals.field_name;
    const oldValue = 'value' in oldVals ? oldVals.value : (oldVals[field] !== undefined ? oldVals[field] : null);
    const newValue = newVals.value !== undefined ? newVals.value : (newVals[field] !== undefined ? newVals[field] : null);
    const source = newVals.source || 'EDIT LOAN';
    const loanNo = newVals.loan_number || oldVals.loan_number || '';
    const customer = newVals.customer_name || oldVals.customer_name || '';

    return [{
      id: `${log.id}-${field}`,
      logId: log.id,
      edited_at: log.edited_at,
      edited_by: log.edited_by,
      table_name: log.table_name,
      record_id: log.record_id,
      field,
      oldValue,
      newValue,
      source,
      loanNo,
      customer,
      rawLog: log,
    }];
  }

  const flattened: FlattenedLog[] = [];
  const allKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));

  for (const key of allKeys) {
    if (ignoredKeys.has(key)) continue;

    const oldV = oldVals[key];
    const newV = newVals[key];

    const oldStr = typeof oldV === 'object' && oldV !== null ? JSON.stringify(oldV) : String(oldV);
    const newStr = typeof newV === 'object' && newV !== null ? JSON.stringify(newV) : String(newV);

    if (oldV !== newV && oldStr !== newStr) {
      let loanNo = '';
      if (log.table_name === 'finance_loans') {
        loanNo = oldVals.loan_id || newVals.loan_id || '';
      }

      let customer = '';
      if (log.table_name === 'finance_customers') {
        customer = oldVals.name || newVals.name || '';
      } else if (log.table_name === 'finance_guarantors') {
        customer = oldVals.name || newVals.name || '';
      }

      flattened.push({
        id: `${log.id}-${key}`,
        logId: log.id,
        edited_at: log.edited_at,
        edited_by: log.edited_by,
        table_name: log.table_name,
        record_id: log.record_id,
        field: key,
        oldValue: oldV,
        newValue: newV,
        source: 'SYSTEM',
        loanNo,
        customer,
        rawLog: log,
      });
    }
  }

  return flattened;
};

export const getEventChangedFields = (log: FinanceEditedLog): ChangedField[] => {
  const oldVals = log.old_values || {};
  const newVals = log.new_values || {};

  if (typeof newVals === 'object' && newVals !== null && 'field_name' in newVals) {
    const field = newVals.field_name;
    const oldV = 'value' in oldVals ? oldVals.value : oldVals[field];
    const newV = newVals.value !== undefined ? newVals.value : newVals[field];
    if (oldV !== newV) {
      return [{
        field,
        fieldLabel: mapFieldLabel(field),
        oldValue: oldV,
        newValue: newV
      }];
    }
    return [];
  }

  const allKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));
  const changed: ChangedField[] = [];

  for (const key of allKeys) {
    if (ignoredKeys.has(key)) continue;

    const oldV = oldVals[key];
    const newV = newVals[key];

    const oldStr = (oldV === null || oldV === undefined) ? '' : (typeof oldV === 'object' ? JSON.stringify(oldV) : String(oldV).trim());
    const newStr = (newV === null || newV === undefined) ? '' : (typeof newV === 'object' ? JSON.stringify(newV) : String(newV).trim());

    if (oldStr !== newStr && (oldStr !== '' || newStr !== '')) {
      changed.push({
        field: key,
        fieldLabel: mapFieldLabel(key),
        oldValue: oldV,
        newValue: newV
      });
    }
  }

  return changed;
};

const EditedDeletedLogs: React.FC = () => {
  const { user } = useAuth();
  const [logType, setLogType] = useState<'edited' | 'deleted'>('edited');
  const [editedLogs, setEditedLogs] = useState<FinanceEditedLog[]>([]);
  const [deletedLogs, setDeletedLogs] = useState<FinanceDeletedLog[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTableType, setFilterTableType] = useState('all');
  const [filterOperator, setFilterOperator] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Modal state for view details
  const [selectedEventForModal, setSelectedEventForModal] = useState<GroupedEditAuditEvent | null>(null);
  const [selectedDeleteForModal, setSelectedDeleteForModal] = useState<FinanceDeletedLog | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const el = await supabaseFinance.getEditedLogs();
      setEditedLogs(el);

      const dl = await supabaseFinance.getDeletedLogs();
      setDeletedLogs(dl);

      const l = await supabaseFinance.getLoans();
      setLoans(l);

      const c = await supabaseFinance.getCustomers();
      setCustomers(c);
    } catch (err) {
      console.error(err);
      toast.error('FAILED TO LOAD LOGS REGISTRY');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (log: FinanceDeletedLog) => {
    if (!window.confirm(`ARE YOU SURE YOU WANT TO RESTORE THIS DELETED RECORD BACK TO ${log.table_name.toUpperCase()}?`)) return;
    setRestoring(log.id);
    try {
      const staffName = user?.username || 'STAFF';
      const success = await supabaseFinance.restoreDeletedRecord(log.id, log.table_name, log.old_values, staffName);
      if (success) {
        toast.success('RECORD SUCCESSFULLY RESTORED!');
        fetchLogs();
      } else {
        toast.error('FAILED TO RESTORE RECORD');
      }
    } catch (err) {
      console.error(err);
      toast.error('RESTORATION ERROR');
    } finally {
      setRestoring(null);
    }
  };

  // Lookup maps
  const customerMap = useMemo(() => {
    const map: Record<string, string> = {};
    customers.forEach(c => {
      map[c.id] = c.name;
    });
    return map;
  }, [customers]);

  const loanMap = useMemo(() => {
    const map: Record<string, any> = {};
    loans.forEach(l => {
      map[l.id] = l;
      if (l.loan_id) map[l.loan_id] = l;
    });
    return map;
  }, [loans]);

  const guarantorLoanMap = useMemo(() => {
    const map: Record<string, any> = {};
    loans.forEach(l => {
      if (l.guarantor_1_id) map[l.guarantor_1_id] = l;
      if (l.guarantor_2_id) map[l.guarantor_2_id] = l;
    });
    return map;
  }, [loans]);

  // Grouped Edit Audit Events (Distinguishing CREATE vs EDIT Events)
  const groupedEditEvents = useMemo(() => {
    const result: GroupedEditAuditEvent[] = [];

    editedLogs.forEach(log => {
      const oldVals = log.old_values || {};
      const newVals = log.new_values || {};

      let displayLoanNo = '';
      let displayCustomer = '';

      if (log.table_name === 'finance_loans') {
        const lObj = loanMap[log.record_id];
        displayLoanNo = lObj?.loan_id || oldVals.loan_id || newVals.loan_id || oldVals.loan_number || newVals.loan_number || '';
        displayCustomer = lObj?.customer?.name || customerMap[oldVals.customer_id] || customerMap[newVals.customer_id] || oldVals.customer_name || newVals.customer_name || '';
      } else if (log.table_name === 'finance_loans_collateral') {
        const lObj = loanMap[log.record_id];
        displayLoanNo = lObj?.loan_id || '';
        displayCustomer = lObj?.customer?.name || '';
      } else if (log.table_name === 'finance_guarantors') {
        const lObj = guarantorLoanMap[log.record_id];
        displayLoanNo = lObj?.loan_id || '';
        displayCustomer = lObj?.customer?.name || oldVals.name || newVals.name || '';
      } else if (log.table_name === 'finance_customers') {
        const matchedLoan = loans.find(l => l.customer_id === log.record_id);
        displayLoanNo = matchedLoan?.loan_id || '';
        displayCustomer = oldVals.name || newVals.name || customerMap[log.record_id] || '';
      }

      const isCreate = !oldVals || Object.keys(oldVals).length === 0 || (newVals && newVals.source === 'RECORD CREATED');

      if (isCreate) {
        // Record Creation Event
        const initialFields = Object.entries(newVals)
          .filter(([key]) => !ignoredKeys.has(key) && key !== 'source')
          .map(([key, val]) => ({
            field: key,
            fieldLabel: mapFieldLabel(key),
            oldValue: null,
            newValue: val
          }));

        result.push({
          id: log.id,
          eventType: 'CREATE',
          timestamp: log.edited_at,
          operator: log.edited_by || 'SYSTEM',
          tableName: log.table_name,
          recordId: log.record_id,
          displayLoanNo: displayLoanNo || '-',
          displayCustomer: displayCustomer || '-',
          source: 'RECORD CREATED',
          changedFields: initialFields,
          rawLog: log,
        });
      } else {
        // Edit Event (Update Operation)
        const changedFields = getEventChangedFields(log);
        if (changedFields.length === 0) return; // Ignore no-ops

        result.push({
          id: log.id,
          eventType: 'EDIT',
          timestamp: log.edited_at,
          operator: log.edited_by || 'SYSTEM',
          tableName: log.table_name,
          recordId: log.record_id,
          displayLoanNo: displayLoanNo || '-',
          displayCustomer: displayCustomer || '-',
          source: newVals?.source || 'RECORD EDITED',
          changedFields,
          rawLog: log,
        });
      }
    });

    // Sort newest first
    return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [editedLogs, loans, customers, customerMap, loanMap, guarantorLoanMap]);

  // Default date range = earliest to latest log date of the logs shown (Edited or Deleted).
  // It stays the default until the user picks a date; "Clear" goes back to the default.
  const [datesTouched, setDatesTouched] = useState(false);
  const defaultDateRange = useMemo(() => {
    const stamps = logType === 'edited'
      ? groupedEditEvents.map(e => e.timestamp)
      : deletedLogs.map(l => l.deleted_at);
    const times = stamps.map(t => new Date(t).getTime()).filter(t => Number.isFinite(t));
    if (times.length === 0) return { start: '', end: '' };
    const toIsoDate = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return { start: toIsoDate(Math.min(...times)), end: toIsoDate(Math.max(...times)) };
  }, [logType, groupedEditEvents, deletedLogs]);

  useEffect(() => {
    if (datesTouched) return;
    setFilterStartDate(defaultDateRange.start);
    setFilterEndDate(defaultDateRange.end);
  }, [defaultDateRange, datesTouched]);

  // Unique operators list
  const uniqueOperators = useMemo(() => {
    const ops = new Set<string>();
    editedLogs.forEach(log => {
      if (log.edited_by) ops.add(log.edited_by);
    });
    deletedLogs.forEach(log => {
      if (log.deleted_by) ops.add(log.deleted_by);
    });
    return Array.from(ops).sort();
  }, [editedLogs, deletedLogs]);

  // Filtered edited events
  const filteredEvents = useMemo(() => {
    return groupedEditEvents.filter(item => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        const matchLoan = item.displayLoanNo.toLowerCase().includes(q);
        const matchCustomer = item.displayCustomer.toLowerCase().includes(q);
        const matchOperator = item.operator.toLowerCase().includes(q);
        const matchTable = mapTableName(item.tableName).toLowerCase().includes(q);
        const matchFields = item.changedFields.some(f => 
          f.fieldLabel.toLowerCase().includes(q) ||
          f.field.toLowerCase().includes(q) ||
          formatLogValue(f.field, f.oldValue).toLowerCase().includes(q) ||
          formatLogValue(f.field, f.newValue).toLowerCase().includes(q)
        );
        if (!matchLoan && !matchCustomer && !matchOperator && !matchTable && !matchFields) {
          return false;
        }
      }

      if (filterTableType !== 'all' && item.tableName !== filterTableType) {
        return false;
      }

      if (filterOperator !== 'all' && item.operator.toUpperCase() !== filterOperator.toUpperCase()) {
        return false;
      }

      if (filterStartDate) {
        const start = new Date(filterStartDate);
        start.setHours(0, 0, 0, 0);
        const itemDate = new Date(item.timestamp);
        if (itemDate < start) return false;
      }

      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        const itemDate = new Date(item.timestamp);
        if (itemDate > end) return false;
      }

      return true;
    });
  }, [groupedEditEvents, searchQuery, filterTableType, filterOperator, filterStartDate, filterEndDate]);

  // Helper for deleted log summary
  const getDeletedLogSummary = (log: FinanceDeletedLog): string => {
    const vals = log.old_values || {};
    switch (log.table_name) {
      case 'finance_loans': {
        const custName = customerMap[vals.customer_id] || '';
        return `LOAN NUMBER: ${vals.loan_id || '-'} ${custName ? `(${custName})` : ''}`;
      }
      case 'finance_customers':
        return `CUSTOMER: ${vals.name || '-'}`;
      case 'finance_guarantors':
        return `GUARANTOR: ${vals.name || '-'}`;
      case 'finance_transactions':
        return `RECEIPT: ${vals.receipt_no || '-'} (${Number(vals.amount || 0).toLocaleString('en-IN')})`;
      case 'finance_loans_collateral':
        return `COLLATERAL FOR LOAN UUID: ${vals.loan_id || '-'}`;
      default:
        return `RECORD ID: ${log.record_id}`;
    }
  };

  // Filtered deleted logs
  const filteredDeletedLogs = useMemo(() => {
    return deletedLogs.filter(log => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        const summary = getDeletedLogSummary(log).toLowerCase();
        const operator = (log.deleted_by || '').toLowerCase();
        const tableName = mapTableName(log.table_name).toLowerCase();
        if (!summary.includes(q) && !operator.includes(q) && !tableName.includes(q)) {
          return false;
        }
      }

      if (filterTableType !== 'all' && log.table_name !== filterTableType) {
        return false;
      }

      if (filterOperator !== 'all' && log.deleted_by.toUpperCase() !== filterOperator.toUpperCase()) {
        return false;
      }

      if (filterStartDate) {
        const start = new Date(filterStartDate);
        start.setHours(0, 0, 0, 0);
        const itemDate = new Date(log.deleted_at);
        if (itemDate < start) return false;
      }

      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        const itemDate = new Date(log.deleted_at);
        if (itemDate > end) return false;
      }

      return true;
    }).sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());
  }, [deletedLogs, searchQuery, filterTableType, filterOperator, filterStartDate, filterEndDate, customerMap]);

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-green-100 pb-4 gap-4">
        <div>
          <h1 className="finance-h1 font-bold uppercase text-slate-900">AUDIT LOGS REGISTRY</h1>
          <p className="finance-small-label uppercase text-slate-900 font-bold">
            GROUPED FINANCIAL AUDIT EVENTS · RECONCILED UPDATE & DELETION LOGS
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowPrintPreview(true)} variant="primary" size="sm" icon={Printer}>
            Print
          </Button>
          <Button onClick={() => {
            if (logType === 'edited') {
              const data = filteredEvents.map(item => ({
                Timestamp: formatDateHuman(item.timestamp),
                Operator: item.operator,
                Table: mapTableName(item.tableName),
                'Loan No': item.displayLoanNo,
                Customer: item.displayCustomer,
                'Total Fields Changed': item.changedFields.length,
                'Changed Field Names': item.changedFields.map(f => f.fieldLabel).join(', '),
                Source: item.source
              }));
              exportToExcel(data, `Grouped_Edit_Audit_Logs_${new Date().toISOString().split('T')[0]}`);
            } else {
              const data = filteredDeletedLogs.map(log => ({
                Timestamp: formatDateHuman(log.deleted_at),
                Operator: log.deleted_by,
                Table: mapTableName(log.table_name),
                Details: getDeletedLogSummary(log)
              }));
              exportToExcel(data, `Deleted_Audit_Logs_${new Date().toISOString().split('T')[0]}`);
            }
            toast.success('Excel Audit Logs Exported!');
          }} variant="secondary" size="sm" icon={Download}>
            Excel
          </Button>
        </div>
      </div>

      {/* Log Type Toggle & Count Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-2 max-w-xs">
          <button
            onClick={() => setLogType('edited')}
            className={`flex-1 py-2 px-4 rounded-lg border transition-all flex justify-center items-center gap-2 text-xs font-bold uppercase ${ logType === 'edited' ? 'bg-green-100 text-green-700 border-green-300 shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' }`}
          >
            <Edit2 className="w-4 h-4" />
            EDITED LOGS ({filteredEvents.length})
          </button>
          <button
            onClick={() => setLogType('deleted')}
            className={`flex-1 py-2 px-4 rounded-lg border transition-all flex justify-center items-center gap-2 text-xs font-bold uppercase ${ logType === 'deleted' ? 'bg-red-100 text-red-700 border-red-300 shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' }`}
          >
            <Trash2 className="w-4 h-4" />
            DELETED LOGS ({filteredDeletedLogs.length})
          </button>
        </div>

        <div className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
          Showing {logType === 'edited' ? `${filteredEvents.length} Grouped Edit Audit Event(s)` : `${filteredDeletedLogs.length} Deleted Log Event(s)`}
        </div>
      </div>

      {/* Premium Filter Panel */}
      {!loading && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search Input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="SEARCH LOAN NO, CUSTOMER, OPERATOR, FIELD, TABLE, OR VALUE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all uppercase"
              />
            </div>

            {/* Table Type Selector */}
            <div className="w-full md:w-52">
              <select
                value={filterTableType}
                onChange={(e) => setFilterTableType(e.target.value)}
                className="w-full py-2 px-3 border border-slate-200 rounded-lg text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all uppercase"
              >
                <option value="all">ALL TABLES</option>
                <option value="finance_loans">LOANS</option>
                <option value="finance_customers">CUSTOMERS</option>
                <option value="finance_loans_collateral">COLLATERAL</option>
                <option value="finance_guarantors">GUARANTORS</option>
                <option value="finance_partners">PARTNERS</option>
                <option value="finance_capital_entries">CAPITAL ENTRIES</option>
              </select>
            </div>

            {/* Operator Selector */}
            <div className="w-full md:w-52">
              <select
                value={filterOperator}
                onChange={(e) => setFilterOperator(e.target.value)}
                className="w-full py-2 px-3 border border-slate-200 rounded-lg text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all uppercase"
              >
                <option value="all">ALL OPERATORS</option>
                {uniqueOperators.map(op => (
                  <option key={op} value={op}>{op.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Range & Clear Filters */}
          <div className="flex flex-col gap-3 pt-3 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <Calendar className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider whitespace-nowrap">DATE RANGE FILTER:</span>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Start Date */}
                <div className="min-w-[160px] w-[160px]">
                  <FinanceSmartCalendar
                    value={filterStartDate}
                    onChange={(v: string) => { setDatesTouched(true); setFilterStartDate(v); }}
                    module="EDIT_DELETE_LOGS"
                    placeholder="START DATE"
                    allowClear
                  />
                </div>

                <span className="text-slate-400 text-xs font-bold uppercase shrink-0">→</span>

                {/* End Date */}
                <div className="min-w-[160px] w-[160px]">
                  <FinanceSmartCalendar
                    value={filterEndDate}
                    onChange={(v: string) => { setDatesTouched(true); setFilterEndDate(v); }}
                    module="EDIT_DELETE_LOGS"
                    placeholder="END DATE"
                    allowClear
                  />
                </div>

                {(searchQuery || filterTableType !== 'all' || filterOperator !== 'all' || datesTouched) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilterTableType('all');
                      setFilterOperator('all');
                      setDatesTouched(false);
                    }}
                    className="text-xs font-bold text-rose-600 hover:text-rose-800 transition-colors uppercase tracking-wider whitespace-nowrap shrink-0"
                  >
                    ✕ CLEAR FILTERS
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-green-500"></div>
        </div>
      ) : logType === 'edited' ? (
        /* Grouped Edited Logs Table View (1 Event = 1 Row) */
        <Card title="EDITED RECORDS LOGS" className="shadow-md">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-slate-400 uppercase font-bold text-xs">No transactions found.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl">
              <table className="w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">TIMESTAMP</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">OPERATOR</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">TABLE</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">LOAN NO</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">CUSTOMER</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">CHANGED FIELDS</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">SOURCE</th>
                    <th className="px-3 py-3 text-right text-xs font-black text-slate-800 uppercase tracking-wider">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredEvents.map((item) => {
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-3 py-3 min-w-[7.5rem] text-[13px] min-[1600px]:text-[14px] text-slate-700 font-mono tabular-nums">
                          {formatDateHuman(item.timestamp)}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-slate-900 font-bold uppercase">
                          {item.operator}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-slate-700 font-mono font-bold">
                          {mapTableName(item.tableName)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-blue-900 font-mono font-black">
                          {item.displayLoanNo}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-slate-900 font-bold">
                          {item.displayCustomer}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] min-w-[11rem]">
                          {item.eventType === 'CREATE' ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider">
                                RECORD CREATED
                              </span>
                              <span className="text-slate-500 font-medium">Initial Record Creation</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                                {item.changedFields.length} Field{item.changedFields.length > 1 ? 's' : ''} Edited
                              </span>
                              <span className="text-slate-700 font-medium">
                                {item.changedFields.map(f => f.fieldLabel).join(', ')}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
                            {item.source}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-right">
                          <button
                            onClick={() => setSelectedEventForModal(item)}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg !text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors uppercase whitespace-nowrap"
                          >
                            <Database className="w-3.5 h-3.5" />
                            VIEW<span className="hidden min-[1600px]:inline"> DETAILS</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        /* Deleted Logs Table View */
        <Card title="DELETED RECORDS LOGS" className="shadow-md">
          {filteredDeletedLogs.length === 0 ? (
            <div className="text-center py-8 text-slate-400 uppercase font-bold text-xs">No transactions found.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl">
              <table className="w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">TIMESTAMP</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">OPERATOR</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">TABLE</th>
                    <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider">DETAILS</th>
                    <th className="px-3 py-3 text-right text-xs font-black text-slate-800 uppercase tracking-wider">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredDeletedLogs.map((log) => {
                    return (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-3 py-3 min-w-[7.5rem] text-[13px] min-[1600px]:text-[14px] text-slate-700 font-mono tabular-nums">
                          {formatDateHuman(log.deleted_at)}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-slate-900 font-bold uppercase">
                          {log.deleted_by}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-slate-700 font-mono font-bold">
                          {mapTableName(log.table_name)}
                        </td>
                        <td className="px-3 py-3 text-[13px] min-[1600px]:text-[14px] text-slate-900 font-bold">
                          {getDeletedLogSummary(log)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedDeleteForModal(log)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg !text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors uppercase whitespace-nowrap"
                          >
                            <Database className="w-3.5 h-3.5" />
                            VIEW<span className="hidden min-[1600px]:inline"> DETAILS</span>
                          </button>
                          <Button
                            onClick={() => handleRestore(log)}
                            variant="success"
                            size="sm"
                            disabled={restoring === log.id}
                            className="font-bold uppercase !text-[12px]"
                          >
                            {restoring === log.id ? 'RESTORING...' : 'RESTORE'}
                          </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Expandable Grouped Edit Event Audit Modal */}
      {selectedEventForModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0b1329] text-white p-4 flex justify-between items-center shrink-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${selectedEventForModal.eventType === 'CREATE' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}>
                    {selectedEventForModal.eventType === 'CREATE' ? 'RECORD CREATED' : mapTableName(selectedEventForModal.tableName)}
                  </span>
                  <h3 className="text-sm font-black uppercase tracking-wider">
                    {selectedEventForModal.eventType === 'CREATE' ? 'RECORD CREATION AUDIT LOG' : 'GROUPED EDIT AUDIT EVENT'}
                  </h3>
                </div>
                <p className="text-[11px] text-slate-300">
                  Loan No: <strong className="text-white font-mono">{selectedEventForModal.displayLoanNo}</strong> · Customer: <strong className="text-white">{selectedEventForModal.displayCustomer}</strong> · Operator: <strong className="text-white">{selectedEventForModal.operator}</strong>
                </p>
              </div>
              <button 
                onClick={() => setSelectedEventForModal(null)} 
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Sub-header info banner */}
            <div className="bg-slate-100 px-6 py-3 border-b border-slate-200 text-xs flex flex-wrap justify-between items-center gap-2 shrink-0">
              <div>
                <span className="font-bold text-slate-500 uppercase">TIMESTAMP: </span>
                <span className="font-mono font-bold text-slate-900">{formatDateHuman(selectedEventForModal.timestamp)}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500 uppercase">EVENT CLASSIFICATION: </span>
                <span className={`font-bold px-2 py-0.5 rounded border ${selectedEventForModal.eventType === 'CREATE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                  {selectedEventForModal.eventType === 'CREATE' ? 'NEW RECORD INSERT' : `${selectedEventForModal.changedFields.length} FIELD(S) EDITED`}
                </span>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-4">
              {selectedEventForModal.eventType === 'CREATE' ? (
                /* Initial Creation Snapshot Cards */
                <div className="space-y-3">
                  <div className="text-xs font-black uppercase text-emerald-800 tracking-wider">
                    INITIAL CREATED RECORD SNAPSHOT
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {selectedEventForModal.changedFields.map((f, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-1">
                        <div className="text-[10px] font-black text-slate-400 uppercase">{f.fieldLabel}</div>
                        <div className="text-xs font-bold text-slate-900 font-mono whitespace-pre-wrap">
                          {formatLogValue(f.field, f.newValue)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Edit Diff Table */
                <table className="min-w-full divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider w-1/4">FIELD NAME</th>
                      <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider w-3/8">BEFORE (OLD VALUE)</th>
                      <th className="px-3 py-3 text-left text-xs font-black text-slate-800 uppercase tracking-wider w-3/8">AFTER (NEW VALUE)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedEventForModal.changedFields.map((f, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-xs font-bold text-slate-900 uppercase align-top">
                          {f.fieldLabel}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="p-2.5 rounded-lg border text-xs font-mono whitespace-pre-wrap leading-relaxed text-rose-700 bg-rose-50 border-rose-200">
                            {formatLogValue(f.field, f.oldValue)}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="p-2.5 rounded-lg border text-xs font-mono whitespace-pre-wrap leading-relaxed text-emerald-800 bg-emerald-50 border-emerald-250">
                            {formatLogValue(f.field, f.newValue)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex justify-end shrink-0">
              <button 
                onClick={() => setSelectedEventForModal(null)} 
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold uppercase transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deleted Record Snapshot Modal */}
      {selectedDeleteForModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-rose-950 text-white p-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider">DELETED RECORD AUDIT SNAPSHOT</h3>
                <p className="text-[11px] text-rose-200 uppercase mt-0.5">
                  Table: {mapTableName(selectedDeleteForModal.table_name)} · Operator: {selectedDeleteForModal.deleted_by.toUpperCase()}
                </p>
              </div>
              <button 
                onClick={() => setSelectedDeleteForModal(null)} 
                className="text-rose-300 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(selectedDeleteForModal.old_values || {})
                  .filter(([key]) => !ignoredKeys.has(key))
                  .map(([key, val]) => (
                    <div key={key} className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-1.5">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{mapFieldLabel(key)}</div>
                      <div className="text-xs font-semibold text-rose-700 font-mono whitespace-pre-wrap">{formatLogValue(key, val)}</div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex justify-between items-center shrink-0">
              <span className="text-xs font-mono font-bold text-slate-500">Deleted On: {formatDateHuman(selectedDeleteForModal.deleted_at)}</span>
              <button 
                onClick={() => setSelectedDeleteForModal(null)} 
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold uppercase transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Logs Print Preview */}
      <FinancePrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        title="Audit Logs Report"
        documentTitle="AUDIT_LOGS_REPORT"
      >
        <div className="space-y-6 mt-6 text-[10px]">
          <div className="flex justify-between items-end border-b-2 border-slate-900 pb-2 mb-4">
            <div>
              <p className="text-[12px] uppercase text-slate-700 font-bold">Grouped Audit Logs Registry</p>
            </div>
          </div>

          {logType === 'edited' ? (
            <table className="w-full border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[9px]">
                  <th className="p-2 text-left border-r border-slate-300">Timestamp</th>
                  <th className="p-2 text-left border-r border-slate-300">Operator</th>
                  <th className="p-2 text-left border-r border-slate-300">Table</th>
                  <th className="p-2 text-left border-r border-slate-300">Loan No</th>
                  <th className="p-2 text-left border-r border-slate-300">Customer</th>
                  <th className="p-2 text-left border-r border-slate-300">Changed Fields</th>
                  <th className="p-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((item) => (
                  <tr key={item.id} className="border-b border-slate-200">
                    <td className="p-2 border-r border-slate-300">{formatDateHuman(item.timestamp)}</td>
                    <td className="p-2 border-r border-slate-300">{item.operator}</td>
                    <td className="p-2 border-r border-slate-300">{mapTableName(item.tableName)}</td>
                    <td className="p-2 border-r border-slate-300">{item.displayLoanNo}</td>
                    <td className="p-2 border-r border-slate-300">{item.displayCustomer}</td>
                    <td className="p-2 border-r border-slate-300">{item.changedFields.map(f => f.fieldLabel).join(', ')}</td>
                    <td className="p-2">{item.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[9px]">
                  <th className="p-2 text-left border-r border-slate-300">Timestamp</th>
                  <th className="p-2 text-left border-r border-slate-300">Operator</th>
                  <th className="p-2 text-left border-r border-slate-300">Table</th>
                  <th className="p-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeletedLogs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-200">
                    <td className="p-2 border-r border-slate-300">{formatDateHuman(log.deleted_at)}</td>
                    <td className="p-2 border-r border-slate-300">{log.deleted_by}</td>
                    <td className="p-2 border-r border-slate-300">{mapTableName(log.table_name)}</td>
                    <td className="p-2">{getDeletedLogSummary(log)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </FinancePrintPreview>
    </div>
  );
};

export default EditedDeletedLogs;
