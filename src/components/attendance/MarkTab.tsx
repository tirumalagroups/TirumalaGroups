import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { CheckCheck, ChevronLeft, ChevronRight, Lock, Save, Search } from 'lucide-react';
import Button from '../UI/Button';
import Input from '../UI/Input';
import {
  AttendanceHoliday,
  AttendanceRecord,
  AttendanceStaff,
  AttendanceStatus,
  isEmployedOn,
  monthOf,
  needsReason,
  relationText,
} from '../../utils/attendanceCalc';
import { AttendanceLock, DayChange, getRecords, saveDay } from '../../services/attendanceService';
import { errorText, fmtDate, fmtMoney, ReasonDialog } from './common';

interface Draft {
  status: AttendanceStatus | null;
  reason: string;
}

const STATUS_BUTTONS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: 'present', label: 'Present', on: 'bg-green-600 text-white border-green-600' },
  { value: 'half_day', label: 'Half Day', on: 'bg-amber-500 text-white border-amber-500' },
  { value: 'absent', label: 'Absent', on: 'bg-red-600 text-white border-red-600' },
];

const shiftDay = (date: string, by: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return format(new Date(y, m - 1, d + by), 'yyyy-MM-dd');
};

const MarkTab: React.FC<{
  staff: AttendanceStaff[];
  holidays: AttendanceHoliday[];
  locks: AttendanceLock[];
  username: string;
}> = ({ staff, holidays, locks, username }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [saved, setSaved] = useState<Map<string, AttendanceRecord>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [missingReason, setMissingReason] = useState<Set<string>>(new Set());
  const [pendingChanges, setPendingChanges] = useState<DayChange[] | null>(null);

  const load = async (forDate: string) => {
    setLoading(true);
    try {
      const records = await getRecords(forDate, forDate);
      const map = new Map(records.map(r => [r.staff_id, r] as const));
      setSaved(map);
      setDrafts(
        Object.fromEntries(records.map(r => [r.staff_id, { status: r.status, reason: r.reason }]))
      );
      setMissingReason(new Set());
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(date);
  }, [date]);

  const holiday = holidays.find(h => h.holiday_date === date);
  const locked = locks.some(l => l.month === monthOf(date));
  const future = date > today;
  const readOnly = locked || future || !!holiday;

  const rows = useMemo(() => staff.filter(s => isEmployedOn(s, date)), [staff, date]);
  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(s => `${s.name} ${s.village} ${relationText(s)}`.toUpperCase().includes(q));
  }, [rows, search]);

  const changes: DayChange[] = useMemo(
    () =>
      rows.flatMap(s => {
        const d = drafts[s.id];
        if (!d?.status) return [];
        const existing = saved.get(s.id);
        const reason = d.status === 'present' ? '' : d.reason.trim();
        if (existing && existing.status === d.status && existing.reason === reason) return [];
        return [{ staff: s, status: d.status, reason, existing }];
      }),
    [rows, drafts, saved]
  );
  const dirty = changes.length > 0;

  const counts = useMemo(() => {
    const c = { present: 0, half_day: 0, absent: 0, none: 0 };
    rows.forEach(s => {
      const st = drafts[s.id]?.status;
      if (st) c[st] += 1;
      else c.none += 1;
    });
    return c;
  }, [rows, drafts]);

  const changeDate = (next: string) => {
    if (next === date) return;
    if (dirty) {
      toast.error('Save or discard your changes first');
      return;
    }
    setDate(next);
  };

  const setStatus = (id: string, status: AttendanceStatus) => {
    setDrafts(prev => ({
      ...prev,
      [id]: { status, reason: status === 'present' ? '' : prev[id]?.reason || '' },
    }));
    setMissingReason(prev => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const markAllPresent = () => {
    setDrafts(prev => {
      const next = { ...prev };
      rows.forEach(s => {
        if (!next[s.id]?.status) next[s.id] = { status: 'present', reason: '' };
      });
      return next;
    });
  };

  const doSave = async (list: DayChange[], changeReason: string) => {
    setSaving(true);
    try {
      await saveDay(date, list, changeReason, username);
      toast.success(`Saved ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`);
      setPendingChanges(null);
      await load(date);
    } catch (e) {
      toast.error(errorText(e));
      await load(date);
      setPendingChanges(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    const missing = changes.filter(c => needsReason(c.status) && !c.reason);
    if (missing.length > 0) {
      setMissingReason(new Set(missing.map(c => c.staff.id)));
      toast.error('Reason is compulsory for Half Day and Absent');
      return;
    }
    if (changes.some(c => c.existing)) {
      setPendingChanges(changes);
      return;
    }
    doSave(changes, '');
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='flex items-end gap-1'>
          <button
            type='button'
            aria-label='Previous day'
            onClick={() => changeDate(shiftDay(date, -1))}
            className='p-2.5 rounded-lg border border-gray-300 hover:bg-gray-50'
          >
            <ChevronLeft className='w-4 h-4' />
          </button>
          <Input label='Date' type='date' value={date} onChange={changeDate} className='w-44' />
          <button
            type='button'
            aria-label='Next day'
            onClick={() => changeDate(shiftDay(date, 1))}
            className='p-2.5 rounded-lg border border-gray-300 hover:bg-gray-50'
          >
            <ChevronRight className='w-4 h-4' />
          </button>
          {date !== today && (
            <Button variant='secondary' className='ml-2' onClick={() => changeDate(today)}>
              Today
            </Button>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-2 text-sm font-semibold'>
          <span className='px-2.5 py-1 rounded-full bg-green-100 text-green-800'>Present {counts.present}</span>
          <span className='px-2.5 py-1 rounded-full bg-amber-100 text-amber-800'>Half Day {counts.half_day}</span>
          <span className='px-2.5 py-1 rounded-full bg-red-100 text-red-800'>Absent {counts.absent}</span>
          <span className='px-2.5 py-1 rounded-full bg-gray-100 text-gray-700'>Not Marked {counts.none}</span>
        </div>
      </div>

      {holiday && (
        <div className='p-4 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 font-semibold'>
          {fmtDate(date)} is a holiday ({holiday.name}). It is taken out of the month, so nobody needs marking.
        </div>
      )}
      {locked && (
        <div className='p-4 rounded-lg bg-gray-100 border border-gray-300 text-gray-800 font-semibold flex items-center gap-2'>
          <Lock className='w-4 h-4' /> This month is closed. Open it from Monthly Summary to make changes.
        </div>
      )}
      {future && (
        <div className='p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-semibold'>
          This date is in the future, so attendance cannot be marked yet.
        </div>
      )}

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='relative w-full max-w-xs'>
          <Search className='w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search name or village'
            className='w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm'
          />
        </div>
        {!readOnly && (
          <div className='flex flex-wrap items-center gap-2'>
            <Button variant='secondary' icon={CheckCheck} onClick={markAllPresent} disabled={counts.none === 0}>
              Mark All Present
            </Button>
            {dirty && (
              <Button variant='secondary' onClick={() => load(date)} disabled={saving}>
                Discard
              </Button>
            )}
            <Button icon={Save} onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Saving...' : `Save${dirty ? ` (${changes.length})` : ''}`}
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className='py-12 text-center text-gray-500'>Loading...</div>
      ) : rows.length === 0 ? (
        <div className='py-12 text-center text-gray-500'>
          No job holders on this date. Add them in the Job Holders tab.
        </div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='fit-table fit-lg border border-gray-200'>
            <thead className='bg-gray-50'>
              <tr className='border-b border-gray-200 text-gray-700'>
                <th className='text-center font-semibold'>S.No</th>
                <th className='text-left font-semibold'>Job Holder Name</th>
                <th className='text-left font-semibold'>Relation</th>
                <th className='text-left font-semibold'>Village</th>
                <th className='text-right font-semibold'>Salary</th>
                <th className='text-center font-semibold'>Attendance</th>
                <th className='text-left font-semibold w-1/4'>Reason</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => {
                const d = drafts[s.id];
                const showReason = d?.status && d.status !== 'present';
                return (
                  <tr key={s.id} className='border-b border-gray-100 hover:bg-gray-50'>
                    <td className='text-center'>{s.sno}</td>
                    <td className='font-semibold'>{s.name}</td>
                    <td>{relationText(s)}</td>
                    <td>{s.village}</td>
                    <td className='text-right whitespace-nowrap'>{fmtMoney(s.salary)}</td>
                    <td className='text-center'>
                      <div className='inline-flex gap-1'>
                        {STATUS_BUTTONS.map(b => (
                          <button
                            key={b.value}
                            type='button'
                            disabled={readOnly}
                            aria-pressed={d?.status === b.value}
                            onClick={() => setStatus(s.id, b.value)}
                            className={`border rounded font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                              d?.status === b.value ? b.on : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                            }`}
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      {showReason ? (
                        <input
                          value={d.reason}
                          disabled={readOnly}
                          onChange={e => {
                            const reason = e.target.value.toUpperCase();
                            setDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], reason } }));
                          }}
                          placeholder='Reason (compulsory)'
                          aria-label={`Reason for ${s.name}`}
                          className={`w-full border rounded px-2 py-1 font-semibold disabled:bg-gray-100 ${
                            missingReason.has(s.id) && !d.reason.trim()
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-300'
                          }`}
                        />
                      ) : (
                        <span className='text-gray-400'>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingChanges && (
        <ReasonDialog
          title='Changing saved attendance'
          message={
            <>
              {pendingChanges.filter(c => c.existing).length} saved{' '}
              {pendingChanges.filter(c => c.existing).length === 1 ? 'entry' : 'entries'} for {fmtDate(date)} will
              change:{' '}
              <span className='font-semibold'>
                {pendingChanges
                  .filter(c => c.existing)
                  .map(c => c.staff.name)
                  .join(', ')}
              </span>
              . The old and new values are kept in the logs.
            </>
          }
          confirmLabel='Save Changes'
          onCancel={() => setPendingChanges(null)}
          onConfirm={reason => doSave(pendingChanges, reason)}
        />
      )}
    </div>
  );
};

export default MarkTab;
