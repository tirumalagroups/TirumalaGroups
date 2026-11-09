import React, { useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import Button from '../UI/Button';
import Input from '../UI/Input';
import { AttendanceHoliday, monthOf } from '../../utils/attendanceCalc';
import { addHoliday, AttendanceLock, removeHoliday } from '../../services/attendanceService';
import { errorText, fmtDate } from './common';

const HolidaysTab: React.FC<{
  holidays: AttendanceHoliday[];
  locks: AttendanceLock[];
  username: string;
  onChanged: () => Promise<void>;
}> = ({ holidays, locks, username, onChanged }) => {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return toast.error('Enter the holiday name');
    setBusy(true);
    try {
      await addHoliday(date, name.trim(), username);
      setName('');
      await onChanged();
      toast.success('Holiday added');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: AttendanceHoliday) => {
    setBusy(true);
    try {
      await removeHoliday(h, username);
      await onChanged();
      toast.success('Holiday removed');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...holidays].sort((a, b) => b.holiday_date.localeCompare(a.holiday_date));

  return (
    <div className='space-y-4'>
      <p className='text-sm text-gray-600'>
        There are no holidays by default. A holiday added here is taken out of the month for everyone, so nobody loses
        pay for it.
      </p>
      <div className='flex flex-wrap items-end gap-3'>
        <Input label='Date' type='date' value={date} onChange={setDate} className='w-44' />
        <Input label='Holiday Name' uppercase value={name} onChange={setName} className='w-72' />
        <Button icon={Plus} onClick={add} disabled={busy}>
          Add Holiday
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className='py-12 text-center text-gray-500'>No holidays added yet.</div>
      ) : (
        <div className='overflow-x-auto max-w-2xl'>
          <table className='fit-table fit-lg border border-gray-200'>
            <thead className='bg-gray-50'>
              <tr className='border-b border-gray-200 text-gray-700'>
                <th className='text-left font-semibold'>Date</th>
                <th className='text-left font-semibold'>Holiday</th>
                <th className='text-center font-semibold'>Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(h => {
                const locked = locks.some(l => l.month === monthOf(h.holiday_date));
                return (
                  <tr key={h.holiday_date} className='border-b border-gray-100'>
                    <td className='whitespace-nowrap'>{fmtDate(h.holiday_date)}</td>
                    <td className='font-semibold'>{h.name}</td>
                    <td className='text-center'>
                      {locked ? (
                        <span className='text-gray-500'>Month closed</span>
                      ) : (
                        <button
                          type='button'
                          disabled={busy}
                          aria-label={`Remove ${h.name}`}
                          onClick={() => remove(h)}
                          className='inline-flex items-center gap-1 text-red-700 border border-red-200 rounded hover:bg-red-50'
                        >
                          <Trash2 className='w-3.5 h-3.5' /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HolidaysTab;
