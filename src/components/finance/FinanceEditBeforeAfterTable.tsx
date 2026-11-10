import React, { useEffect, useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import Button from '../UI/Button';

// Finance Edited Logs in the same look as Regular "Edited Records": every event is two rows,
// Before (red) and After (green), one column per field, changed cells highlighted.
// The rows are one record type at a time (Loans, Receipts, ...), so the columns fit that type.
// "Record created" events show "-" before and the new values after, labelled Created.

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

interface Props<E extends BeforeAfterEvent> {
  events: E[];
  formatValue: (field: string, value: any) => string;
  formatDate: (iso: string) => string;
  labelFor: (field: string) => string;
  onView: (event: E) => void;
}

const PAGE_SIZE = 20;
const MAX_CREATE_ONLY_COLUMNS = 8;
// Same colours as Regular Edited Records
const highlightAfterClass = 'bg-yellow-100';
const highlightBeforeClass = 'bg-red-50';
const cell = 'px-1.5 py-1 text-sm font-bold align-top';
const head = 'px-1.5 py-1.5 text-left font-semibold text-gray-700';

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

function FinanceEditBeforeAfterTable<E extends BeforeAfterEvent>({ events, formatValue, formatDate, labelFor, onView }: Props<E>) {
  const [page, setPage] = useState(1);
  const columns = useMemo(() => columnsFor(events), [events]);
  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [events]);
  const pageEvents = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const show = (field: string, value: any) =>
    value === undefined || value === null || value === '' ? '' : formatValue(field, value);

  if (events.length === 0) {
    return <div className='text-center py-8 text-gray-400 font-semibold text-sm'>No edits found.</div>;
  }

  return (
    <div>
      <div className='overflow-x-auto'>
        <table className='fit-table fit-dense border border-gray-200'>
          <thead className='sticky top-0 bg-gray-50 z-10'>
            <tr className='border-b border-gray-200'>
              <th className='px-1.5 py-1.5 text-center font-semibold text-gray-700 whitespace-nowrap'>S.No</th>
              <th className={`${head} whitespace-nowrap`}>Type</th>
              <th className={`${head} whitespace-nowrap`}>Loan No</th>
              <th className={head}>Customer</th>
              {columns.map(c => <th key={c} className={head}>{labelFor(c)}</th>)}
              <th className={head}>Edited By</th>
              <th className={head}>Edited At</th>
              <th className={head}>Source</th>
              <th className={`${head} text-right`}></th>
            </tr>
          </thead>
          <tbody>
            {pageEvents.map((e, idx) => {
              const changed = new Map(e.changedFields.map(f => [f.field, f]));
              const isCreate = e.eventType === 'CREATE';
              const before = (c: string) => {
                if (isCreate) return '-';
                const f = changed.get(c);
                return show(c, f ? f.oldValue : valueOf(e.rawLog.old_values, c));
              };
              const after = (c: string) => {
                const f = changed.get(c);
                return show(c, f ? f.newValue : valueOf(e.rawLog.new_values, c));
              };
              const isChanged = (c: string) => changed.has(c);
              return (
                <React.Fragment key={e.id}>
                  {/* Before row */}
                  <tr className='border-b border-gray-100 hover:bg-gray-50'>
                    <td rowSpan={2} className={`${cell} text-center`}>{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className={`${cell} text-red-600`}>Before</td>
                    <td rowSpan={2} className={`${cell} whitespace-nowrap text-blue-900`}>{e.displayLoanNo}</td>
                    <td rowSpan={2} className={cell}>{e.displayCustomer}</td>
                    {columns.map(c => (
                      <td key={c + '-b'} className={`${cell} ${!isCreate && isChanged(c) ? highlightBeforeClass : ''}`}>{before(c)}</td>
                    ))}
                    <td rowSpan={2} className={`${cell} uppercase`}>{e.operator}</td>
                    <td rowSpan={2} className={`${cell} whitespace-nowrap`}>{formatDate(e.timestamp)}</td>
                    <td rowSpan={2} className={cell}>
                      <span className='inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase bg-gray-100 text-gray-600 border border-gray-200'>{e.source}</span>
                    </td>
                    <td rowSpan={2} className={`${cell} text-right whitespace-nowrap`}>
                      <button
                        type='button'
                        onClick={() => onView(e)}
                        className='px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[12px] font-bold inline-flex items-center gap-1'
                      >
                        <Database className='w-3.5 h-3.5' /> View
                      </button>
                    </td>
                  </tr>
                  {/* After row */}
                  <tr className='border-b-2 border-gray-200 hover:bg-gray-50'>
                    <td className={`${cell} text-green-700`}>{isCreate ? 'Created' : 'After'}</td>
                    {columns.map(c => (
                      <td key={c + '-a'} className={`${cell} ${isChanged(c) ? highlightAfterClass : ''}`}>{after(c)}</td>
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
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
