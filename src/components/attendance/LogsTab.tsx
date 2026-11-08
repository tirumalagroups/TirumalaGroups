import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Search } from 'lucide-react';
import { AttendanceLog, getLogs } from '../../services/attendanceService';
import { errorText, fmtDate, fmtMonth, MonthPicker } from './common';

const targetText = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? fmtDate(value) : /^\d{4}-\d{2}$/.test(value) ? fmtMonth(value) : value || '-');

const LogsTab: React.FC = () => {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    const [y, m] = month.split('-').map(Number);
    getLogs(new Date(y, m - 1, 1).toISOString(), new Date(y, m, 1).toISOString())
      .then(rows => live && setLogs(rows))
      .catch(e => toast.error(errorText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [month]);

  const actions = useMemo(() => [...new Set(logs.map(l => l.action))].sort(), [logs]);
  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    return logs.filter(l => {
      if (action && l.action !== action) return false;
      if (!q) return true;
      return [l.staff_name, l.changed_by, l.old_value, l.new_value, l.reason, l.field]
        .join(' ')
        .toUpperCase()
        .includes(q);
    });
  }, [logs, search, action]);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <MonthPicker value={month} onChange={setMonth} />
        <div className='relative w-64'>
          <Search className='w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search'
            className='w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm'
          />
        </div>
        <select
          value={action}
          onChange={e => setAction(e.target.value)}
          aria-label='Action'
          className='border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold'
        >
          <option value=''>All Actions</option>
          {actions.map(a => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className='py-12 text-center text-gray-500'>Loading...</div>
      ) : visible.length === 0 ? (
        <div className='py-12 text-center text-gray-500'>No changes recorded in {fmtMonth(month)}.</div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='fit-table fit-lg border border-gray-200'>
            <thead className='bg-gray-50'>
              <tr className='border-b border-gray-200 text-gray-700'>
                <th className='text-left font-semibold'>When</th>
                <th className='text-left font-semibold'>Action</th>
                <th className='text-left font-semibold'>Job Holder</th>
                <th className='text-left font-semibold'>For Date</th>
                <th className='text-left font-semibold'>Field</th>
                <th className='text-left font-semibold'>Old Value</th>
                <th className='text-left font-semibold'>New Value</th>
                <th className='text-left font-semibold'>Reason</th>
                <th className='text-left font-semibold'>By</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(l => (
                <tr key={l.id} className='border-b border-gray-100'>
                  <td className='whitespace-nowrap'>{format(new Date(l.created_at), 'dd/MM/yyyy HH:mm')}</td>
                  <td className='font-semibold'>{l.action}</td>
                  <td>{l.staff_name || '-'}</td>
                  <td className='whitespace-nowrap'>{targetText(l.target_date)}</td>
                  <td>{l.field || '-'}</td>
                  <td className='text-red-700'>{targetText(l.old_value)}</td>
                  <td className='text-green-800'>{targetText(l.new_value)}</td>
                  <td>{l.reason || '-'}</td>
                  <td>{l.changed_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LogsTab;
