import React, { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import Button from '../UI/Button';

// Finance "Edited / Deleted Entry", edited side, in the look of the Finance Edit Entry table:
// every event is two rows, Before and After, changed cells highlighted (before red, after yellow).
// The rows are one record type at a time:
//   * money entries (loan receipts, Day Book, capital) use the Edit Entry columns
//     (Date, Customer, Head of Account, CD / Loan No, Particulars, Credit, Debit), given as `columns`;
//   * other records (loans, customers, ...) get one column per edited field.
// "Record created" events show "-" before and the new values after, labelled Created.
// The same table is used on screen and in the print (printMode: every row, no buttons), so they match.

export interface BeforeAfterField {
  field: string;
  fieldLabel: string;
  oldValue: any;
  newValue: any;
}

export interface BeforeAfterEvent {
  id: string;
  eventType: 'CREATE' | 'EDIT';
  timestamp: string;
  operator: string;
  displayLoanNo: string;
  displayCustomer: string;
  source: string;
  changedFields: BeforeAfterField[];
  rawLog: { old_values?: any; new_values?: any };
}

/** A fixed column (Edit Entry style): what it shows before and after, and whether the edit changed it */
export interface LogColumn<E> {
  key: string;
  label: string;
  kind?: 'text' | 'credit' | 'debit' | 'code';
  before: (e: E) => string;
  after: (e: E) => string;
  changed: (e: E) => boolean;
}

interface Props<E extends BeforeAfterEvent> {
  events: E[];
  formatValue: (field: string, value: any) => string;
  formatDate: (iso: string) => string;
  labelFor: (field: string) => string;
  onView?: (event: E) => void;
  /** Edit Entry columns for money entries; without it, one column per edited field */
  columns?: LogColumn<E>[];
  /** Print: every event on one page, no View button */
  printMode?: boolean;
}

const PAGE_SIZE = 20;
const MAX_CREATE_ONLY_COLUMNS = 8;
// Same colours as Regular Edited Records
const highlightAfterClass = 'bg-yellow-100';
const highlightBeforeClass = 'bg-red-50';
// Same look as the Finance Edit Entry table
const head = 'px-1.5 py-2.5 text-left border-r border-slate-300';
const cell = 'px-1.5 py-2 border-r border-slate-100 font-bold text-slate-800 align-top';

/** Columns for this record type: every field changed by an edit, most often changed first. */
export const columnsFor = (events: BeforeAfterEvent[]): string[] => {
  const counts = new Map<string, number>();
  events.filter(e => e.eventType === 'EDIT').forEach(e =>
    e.changedFields.forEach(f => counts.set(f.field, (counts.get(f.field) || 0) + 1)));
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  }
  // Only creations: show the first fields of the newest one (the rest is in View)
  const first = events.find(e => e.eventType === 'CREATE');
  return (first?.changedFields || []).slice(0, MAX_CREATE_ONLY_COLUMNS).map(f => f.field);
};

const valueOf = (source: any, field: string): any =>
  source && typeof source === 'object' && field in source ? source[field] : undefined;

const kindClass = (kind?: LogColumn<any>['kind']) => {
  if (kind === 'credit') return 'text-right font-mono font-black text-emerald-700 tabular-nums whitespace-nowrap';
  if (kind === 'debit') return 'text-right font-mono font-black text-rose-700 tabular-nums whitespace-nowrap';
  if (kind === 'code') return 'font-mono font-black text-slate-900 whitespace-nowrap';
  return '';
};
const headKindClass = (kind?: LogColumn<any>['kind']) => {
  if (kind === 'credit') return 'text-right text-emerald-950 bg-emerald-100/60';
  if (kind === 'debit') return 'text-right text-rose-950 bg-rose-100/60';
  return '';
};

/** Field columns (loans, customers, ...) as fixed columns, so both kinds render the same way */
export const fieldColumns = <E extends BeforeAfterEvent>(
  events: E[], formatValue: (field: string, value: any) => string, labelFor: (field: string) => string
): LogColumn<E>[] => {
  const show = (field: string, value: any) =>
    value === undefined || value === null || value === '' ? '' : formatValue(field, value);
  return columnsFor(events).map(c => ({
    key: c,
    label: labelFor(c),
    before: (e: E) => {
      if (e.eventType === 'CREATE') return '-';
      const f = e.changedFields.find(x => x.field === c);
      return show(c, f ? f.oldValue : valueOf(e.rawLog.old_values, c));
    },
    after: (e: E) => {
      const f = e.changedFields.find(x => x.field === c);
      return show(c, f ? f.newValue : valueOf(e.rawLog.new_values, c));
    },
    changed: (e: E) => e.changedFields.some(x => x.field === c),
  }));
};

function FinanceEditBeforeAfterTable<E extends BeforeAfterEvent>({
  events, formatValue, formatDate, labelFor, onView, columns, printMode = false,
}: Props<E>) {
  const [page, setPage] = useState(1);
  const moneyMode = !!columns;
  const cols = useMemo(
    () => columns || fieldColumns(events, formatValue, labelFor),
    [columns, events, formatValue, labelFor]
  );
  const pageSize = printMode ? Math.max(1, events.length) : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  useEffect(() => { setPage(1); }, [events]);
  const pageEvents = printMode ? events : events.slice((page - 1) * pageSize, page * pageSize);
  const showActions = !printMode && !!onView;

  if (events.length === 0) {
    return <div className='text-center py-8 text-gray-400 font-semibold text-sm'>No edits found.</div>;
  }

  return (
    <div>
      <div className={printMode ? '' : 'overflow-x-auto'}>
        <table className='fit-table w-full divide-y divide-slate-200 border border-slate-200'>
          <thead className={`${printMode ? '' : 'sticky top-0 z-10'} bg-slate-200 shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)]`}>
            <tr className='text-slate-950 uppercase font-black tracking-wider'>
              <th className='px-1 py-2.5 text-center border-r border-slate-300'>#</th>
              <th className={head}>Type</th>
              {!moneyMode && <th className={head}>CD / Loan No</th>}
              {!moneyMode && <th className={head}>Customer</th>}
              {cols.map(c => <th key={c.key} className={`${head} ${headKindClass(c.kind)}`}>{c.label}</th>)}
              <th className={head}>Edited By</th>
              <th className={showActions ? head : head.replace(' border-r border-slate-300', '')}>Edited At</th>
              {showActions && <th className='px-1.5 py-2.5 text-center'>Actions</th>}
            </tr>
          </thead>
          <tbody className='bg-white'>
            {pageEvents.map((e, idx) => {
              const isCreate = e.eventType === 'CREATE';
              const n = (page - 1) * pageSize + idx + 1;
              return (
                <React.Fragment key={e.id}>
                  {/* Before row */}
                  <tr className='border-t border-slate-200 hover:bg-slate-50/90'>
                    <td rowSpan={2} className='fit-nowrap px-1 py-2 text-center border-r border-slate-100 text-slate-500 font-bold align-top'>{n}</td>
                    <td className={`${cell} text-red-600`}>Before</td>
                    {!moneyMode && <td rowSpan={2} className={`${cell} font-mono font-black text-slate-900 whitespace-nowrap`}>{e.displayLoanNo}</td>}
                    {!moneyMode && <td rowSpan={2} className={`${cell} font-black text-slate-950`}>{e.displayCustomer}</td>}
                    {cols.map(c => (
                      <td key={c.key + '-b'} className={`${cell} ${kindClass(c.kind)} ${!isCreate && c.changed(e) ? highlightBeforeClass : ''}`}>{c.before(e)}</td>
                    ))}
                    <td rowSpan={2} className={`${cell} uppercase text-slate-700`}>{e.operator}</td>
                    <td rowSpan={2} className={`${cell} whitespace-nowrap`}>{formatDate(e.timestamp)}</td>
                    {showActions && (
                      <td rowSpan={2} className='fit-nowrap px-1.5 py-2 text-center align-top'>
                        <button
                          type='button'
                          onClick={() => onView?.(e)}
                          className='rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                          title='View Record'
                          aria-label='View Record'
                        >
                          <Eye />
                        </button>
                      </td>
                    )}
                  </tr>
                  {/* After row */}
                  <tr className='border-b-2 border-slate-300 hover:bg-slate-50/90'>
                    <td className={`${cell} text-green-700`}>{isCreate ? 'Created' : 'After'}</td>
                    {cols.map(c => (
                      <td key={c.key + '-a'} className={`${cell} ${kindClass(c.kind)} ${c.changed(e) ? highlightAfterClass : ''}`}>{c.after(e)}</td>
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!printMode && totalPages > 1 && (
        <div className='flex justify-center items-center gap-2 mt-4'>
          <Button size='sm' variant='secondary' onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
          <span className='text-sm'>Page {page} of {totalPages}</span>
          <Button size='sm' variant='secondary' onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}

export default FinanceEditBeforeAfterTable;
