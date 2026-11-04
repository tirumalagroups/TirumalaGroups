import React, { useState, useEffect, useMemo } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Select from '../components/UI/Select';
import { supabaseDB, User } from '../lib/supabaseDatabase';
import { useTableMode } from '../contexts/TableModeContext';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import ModeLabel from '../components/UI/ModeLabel';
import { useBook } from '../contexts/BookContext';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { getSharedPrintStyles } from '../utils/print';

type AuditLogEntry = {
  id: string;
  cash_book_id: string;
  old_values: string | Record<string, any> | null;
  new_values: string | Record<string, any> | null;
  edited_by: string;
  edited_at: string;
  action?: string;
};

const FIELDS = [
  { key: 'c_date', label: 'Date' },
  { key: 'company_name', label: 'Company' },
  { key: 'acc_name', label: 'Main A/c' },
  { key: 'sub_acc_name', label: 'SubAccount' },
  { key: 'particulars', label: 'Particulars' },
  { key: 'purchase_qty', label: 'Purchase Qty' },
  { key: 'sale_qty', label: 'Sale Qty' },
  { key: 'credit', label: 'Credit' },
  { key: 'debit', label: 'Debit' },
  { key: 'staff', label: 'Staff' },
  { key: 'users', label: 'User' },
  { key: 'entry_time', label: 'Entry Time' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

type CashBookPartial = Partial<Record<FieldKey, any>>;

const PAGE_SIZE = 20;

// Changed cells: yellow on the After row, light red on the Before row
const highlightAfterClass = 'bg-yellow-100';
const highlightBeforeClass = 'bg-red-50';

// Amount / quantity / date / time columns stay on one line
const NOWRAP_FIELDS = new Set<FieldKey>([
  'c_date',
  'purchase_qty',
  'sale_qty',
  'credit',
  'debit',
  'entry_time',
]);

// Print column classes (see getSharedPrintStyles)
const PRINT_COL_CLASS: Partial<Record<FieldKey, string>> = {
  c_date: 'col-date',
  company_name: 'col-company',
  acc_name: 'col-account',
  sub_acc_name: 'col-sub-account',
  particulars: 'col-particulars',
  purchase_qty: 'col-purchase-qty',
  sale_qty: 'col-sale-qty',
  credit: 'col-credit',
  debit: 'col-debit',
  entry_time: 'col-date',
};

// edit_cash_book stores old/new values as a JSON string or as jsonb
const parseValues = (raw: AuditLogEntry['old_values']): CashBookPartial => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as CashBookPartial;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
};

const getFieldDisplay = (field: FieldKey, value: any) => {
  if (field === 'credit' || field === 'debit') {
    return value ? `${Number(value).toLocaleString()}` : '-';
  }
  if (field === 'sale_qty' || field === 'purchase_qty') {
    return value !== null && value !== undefined && value !== ''
      ? `${Number(value).toLocaleString()}`
      : '-';
  }
  if (field === 'c_date' && value) {
    return !isNaN(new Date(value).getTime())
      ? format(new Date(value), 'dd/MM/yyyy')
      : value;
  }
  if (field === 'entry_time' && value) {
    return !isNaN(new Date(value).getTime())
      ? format(new Date(value), 'HH:mm:ss')
      : value;
  }
  return value || '-';
};

const getChangedFields = (oldObj: CashBookPartial, newObj: CashBookPartial) => {
  const changed: Record<FieldKey, boolean> = {} as Record<FieldKey, boolean>;
  for (const { key } of FIELDS) {
    if ((oldObj?.[key] ?? '') !== (newObj?.[key] ?? '')) {
      changed[key] = true;
    }
  }
  return changed;
};

const formatEditedAt = (editedAt: string) =>
  editedAt && !isNaN(new Date(editedAt).getTime())
    ? format(new Date(editedAt), 'dd/MM/yyyy HH:mm')
    : '';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const EditedRecords = () => {
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editedDates, setEditedDates] = useState<string[]>([]);

  // Reload data when mode or book changes
  useEffect(() => {
    loadData();
  }, [tableMode, currentBook?.id]);

  // Reload when other screens signal a change (edit / delete / approve)
  useEffect(() => {
    const onRefresh = () => loadData();
    window.addEventListener('dashboard-refresh', onRefresh);
    return () => window.removeEventListener('dashboard-refresh', onRefresh);
  }, []);

  // Back to the first page whenever the filters change
  useEffect(() => {
    setPage(1);
  }, [selectedDate, userFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [log, userList, distinctDates] = await Promise.all([
        supabaseDB.getEditAuditLog(),
        supabaseDB.getUsers(),
        supabaseDB.getDistinctEditedDates(),
      ]);
      setEditedDates(distinctDates);
      setAuditLog((log || []) as AuditLogEntry[]);
      setUsers((userList || []) as User[]);
    } catch (error) {
      console.error('Error loading Edited Records data:', error);
      setAuditLog([]);
      setUsers([]);
      toast.error('Failed to load Edited Records data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Map userId to username
  const userMap = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach(u => {
      map[u.id] = u.username;
    });
    return map;
  }, [users]);

  // Dropdown of distinct edited dates (YYYY-MM-DD), newest first
  const editedDateOptions = useMemo(() => {
    const sortedDates = [...editedDates].sort((a, b) => (a < b ? 1 : -1));
    return [
      { value: '', label: 'All Dates' },
      ...sortedDates.map(d => ({
        value: d,
        label: format(new Date(d), 'dd/MM/yyyy'),
      })),
    ];
  }, [editedDates]);

  // Parsed + filtered log: real edits only (deletes live in Deleted Records)
  const filteredLog = useMemo(() => {
    return auditLog
      .map(log => {
        const oldObj = parseValues(log.old_values);
        const newObj = parseValues(log.new_values);
        return { log, oldObj, newObj, changed: getChangedFields(oldObj, newObj) };
      })
      .filter(({ log, changed }) => {
        const hasAnyChange = Object.values(changed).some(Boolean);
        const editedDate = log.edited_at ? String(log.edited_at).slice(0, 10) : '';
        const matchesDate = selectedDate === '' || editedDate === selectedDate;
        const matchesUser = userFilter === '' || log.edited_by === userFilter;
        const isDelete =
          log.action === 'DELETE' || (log.new_values == null && log.old_values != null);
        return matchesDate && matchesUser && !isDelete && hasAnyChange;
      });
  }, [auditLog, selectedDate, userFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredLog.length / PAGE_SIZE);
  const paginatedLog = filteredLog.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Print: same Before / After layout as the screen, A4 portrait, preview first
  const handlePrint = () => {
    if (filteredLog.length === 0) {
      toast.error('No edited records to print');
      return;
    }
    const printWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
    if (!printWindow) {
      toast.error('Please allow popups to print');
      return;
    }

    const headerCells = [
      '<th class="col-sno">S.No</th>',
      '<th class="col-status">Type</th>',
      ...FIELDS.map(f => `<th class="${PRINT_COL_CLASS[f.key] || ''}">${f.label}</th>`),
      '<th>Edited By</th>',
      '<th class="col-date">Edited At</th>',
    ].join('');

    const bodyRows = filteredLog
      .map(({ log, oldObj, newObj, changed }, idx) => {
        const editedBy = escapeHtml(userMap[log.edited_by] || log.edited_by);
        const editedAt = formatEditedAt(log.edited_at);
        const cells = (obj: CashBookPartial, isAfter: boolean) =>
          FIELDS.map(f => {
            const cls = PRINT_COL_CLASS[f.key] || '';
            const mark = changed[f.key] ? (isAfter ? 'changed-after' : 'changed-before') : '';
            return `<td class="${cls} ${mark}">${escapeHtml(getFieldDisplay(f.key, obj[f.key]))}</td>`;
          }).join('');
        return `
          <tr class="row-before">
            <td class="col-sno" rowspan="2">${idx + 1}</td>
            <td class="col-status type-before">Before</td>
            ${cells(oldObj, false)}
            <td rowspan="2">${editedBy}</td>
            <td class="col-date" rowspan="2">${editedAt}</td>
          </tr>
          <tr class="row-after">
            <td class="col-status type-after">After</td>
            ${cells(newObj, true)}
          </tr>`;
      })
      .join('');

    const modeLabel = tableMode === 'itr' ? 'ITR Mode' : 'Regular Mode';
    const filterLabel = [
      selectedDate ? `Edited Date: ${format(new Date(selectedDate), 'dd/MM/yyyy')}` : '',
      userFilter ? `Edited By: ${escapeHtml(userFilter)}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Edited Records</title>
  <style>
    ${getSharedPrintStyles({ isLandscape: false })}
    .header { text-align: center; margin-bottom: 6px; }
    .header h1 { margin: 0; font-size: 14pt; }
    .header p { margin: 2px 0; font-size: 9pt; }
    .type-before { color: #dc2626; }
    .type-after { color: #15803d; }
    .row-after td { border-bottom: 1.5px solid #000; }
    .changed-after { background-color: #fef9c3 !important; }
    .changed-before { background-color: #fee2e2 !important; }
    @media print {
      .changed-after, .changed-before {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    .toolbar { position: fixed; top: 12px; right: 12px; }
    .toolbar button {
      background: #2563eb; color: #fff; border: none; padding: 8px 18px;
      border-radius: 6px; font-weight: bold; cursor: pointer; margin-left: 6px;
    }
    .toolbar button.close { background: #6b7280; }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">Print</button>
    <button class="close" onclick="window.close()">Close</button>
  </div>
  <div class="header">
    <h1>Edited Records</h1>
    <p>${modeLabel} | ${escapeHtml(currentBook?.book_code || 'No Book')} | Edits: ${filteredLog.length}</p>
    ${filterLabel ? `<p>${filterLabel}</p>` : ''}
    <p>Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
  </div>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
  };

  return (
    <div className='space-y-6'>
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-center gap-3 no-print">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-xs text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold text-gray-900 flex items-center gap-2.5'>
            Edited Records
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
              currentBook?.is_locked
                ? 'bg-red-100 text-red-700'
                : tableMode === 'itr'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-blue-100 text-blue-700'
            }`}>
              {tableMode === 'itr' ? 'ITR Mode' : 'Regular Mode'} | {currentBook?.book_code || 'No Book'}
            </span>
          </h1>
          <p className='text-gray-600 mt-1'>Edits: {filteredLog.length}</p>
        </div>
      </div>

      <ModeLabel />
      <Card>
        <div className='flex flex-wrap gap-3 mb-4 items-end'>
          <Select
            label='Edited Date'
            value={selectedDate}
            onChange={setSelectedDate}
            options={editedDateOptions}
            className='w-48'
          />
          <Select
            label='Edited By'
            value={userFilter}
            onChange={setUserFilter}
            options={[
              { value: '', label: 'All Users' },
              ...users.map(u => ({ value: u.username, label: u.username })),
            ]}
            className='w-48'
          />
          <Button
            onClick={loadData}
            variant='secondary'
            size='sm'
            disabled={loading}
            className='flex items-center gap-2'
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button onClick={handlePrint} variant='secondary' size='sm'>
            Print
          </Button>
        </div>
        {loading ? (
          <div className='text-center py-8 text-blue-600 font-semibold'>
            Loading edit history...
          </div>
        ) : filteredLog.length === 0 ? (
          <div className='text-center py-8'>
            <div className='text-gray-500 mb-2'>No edit history found.</div>
            <div className='text-sm text-gray-400'>
              This is normal if no records have been edited yet.
            </div>
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='fit-table fit-dense border border-gray-200'>
              <thead className='sticky top-0 bg-gray-50 z-10'>
                <tr className='border-b border-gray-200'>
                  <th className='px-1.5 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap'>S.No</th>
                  <th className='px-1.5 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap'>Type</th>
                  {FIELDS.map(f => (
                    <th
                      key={f.key}
                      className={`px-1.5 py-1.5 font-semibold text-gray-700 ${
                        f.key === 'credit' || f.key === 'debit' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {f.label}
                    </th>
                  ))}
                  <th className='px-1.5 py-1.5 text-left font-semibold text-gray-700'>Edited By</th>
                  <th className='px-1.5 py-1.5 text-left font-semibold text-gray-700'>Edited At</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLog.map(({ log, oldObj, newObj, changed }, idx) => {
                  const editedBy = userMap[log.edited_by] || log.edited_by;
                  const editedAt = formatEditedAt(log.edited_at);
                  const cellClass = (key: FieldKey) =>
                    `px-1.5 py-1 text-sm font-bold align-top ${
                      NOWRAP_FIELDS.has(key) ? 'fit-nowrap' : key === 'particulars' ? 'fit-particulars' : ''
                    } ${key === 'credit' || key === 'debit' ? 'text-right' : ''}`;
                  return (
                    <React.Fragment key={log.id}>
                      {/* Before Edit Row */}
                      <tr className='border-b border-gray-100 hover:bg-gray-50'>
                        <td className='px-1.5 py-1 text-center text-sm font-bold align-top'>
                          {(page - 1) * PAGE_SIZE + idx + 1}
                        </td>
                        <td className='px-1.5 py-1 text-red-600 text-sm font-bold align-top'>Before</td>
                        {FIELDS.map(f => (
                          <td
                            key={f.key + '-before'}
                            className={`${cellClass(f.key)} ${changed[f.key] ? highlightBeforeClass : ''}`}
                          >
                            {getFieldDisplay(f.key, oldObj[f.key])}
                          </td>
                        ))}
                        <td className='px-1.5 py-1 text-sm font-bold align-top'>{editedBy}</td>
                        <td className='px-1.5 py-1 text-sm font-bold align-top whitespace-nowrap'>{editedAt}</td>
                      </tr>
                      {/* After Edit Row */}
                      <tr className='border-b-2 border-gray-200 hover:bg-gray-50'>
                        <td className='px-1.5 py-1'></td>
                        <td className='px-1.5 py-1 text-green-700 text-sm font-bold align-top'>After</td>
                        {FIELDS.map(f => (
                          <td
                            key={f.key + '-after'}
                            className={`${cellClass(f.key)} ${changed[f.key] ? highlightAfterClass : ''}`}
                          >
                            {getFieldDisplay(f.key, newObj[f.key])}
                          </td>
                        ))}
                        <td className='px-1.5 py-1 text-sm font-bold align-top'>{editedBy}</td>
                        <td className='px-1.5 py-1 text-sm font-bold align-top whitespace-nowrap'>{editedAt}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className='flex justify-center items-center gap-2 mt-4'>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Prev
                </Button>
                <span className='text-sm'>
                  Page {page} of {totalPages}
                </span>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default EditedRecords;
