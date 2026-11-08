import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarCheck } from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { useAuth } from '../contexts/AuthContext';
import MarkTab from '../components/attendance/MarkTab';
import SummaryTab from '../components/attendance/SummaryTab';
import StaffTab from '../components/attendance/StaffTab';
import HolidaysTab from '../components/attendance/HolidaysTab';
import LogsTab from '../components/attendance/LogsTab';
import { errorText } from '../components/attendance/common';
import {
  AttendanceLock,
  attendanceTablesReady,
  getHolidays,
  getLocks,
  getSalaryHistory,
  getStaff,
} from '../services/attendanceService';
import { AttendanceHoliday, AttendanceStaff, SalaryChange } from '../utils/attendanceCalc';

const TABS = [
  { key: 'mark', label: 'Mark Attendance' },
  { key: 'summary', label: 'Monthly Summary' },
  { key: 'staff', label: 'Job Holders' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'logs', label: 'Logs' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const Attendance: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('mark');
  const [state, setState] = useState<'loading' | 'ready' | 'no-tables' | 'error'>('loading');
  const [error, setError] = useState('');
  const [staff, setStaff] = useState<AttendanceStaff[]>([]);
  const [history, setHistory] = useState<SalaryChange[]>([]);
  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [locks, setLocks] = useState<AttendanceLock[]>([]);

  const reload = useCallback(async () => {
    const [s, h, d, l] = await Promise.all([getStaff(), getSalaryHistory(), getHolidays(), getLocks()]);
    setStaff(s);
    setHistory(h);
    setHolidays(d);
    setLocks(l);
  }, []);

  const start = useCallback(async () => {
    setState('loading');
    try {
      if (!(await attendanceTablesReady())) {
        setState('no-tables');
        return;
      }
      await reload();
      setState('ready');
    } catch (e) {
      setError(errorText(e));
      setState('error');
    }
  }, [reload]);

  useEffect(() => {
    if (user?.is_admin) start();
  }, [start, user?.is_admin]);

  if (user && !user.is_admin) return <Navigate to='/' replace />;

  const username = user?.username || 'Admin';

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2.5'>
          <CalendarCheck className='w-8 h-8 text-blue-600' />
          Attendance
        </h1>
        <p className='text-gray-500 mt-1'>Daily attendance and monthly salary. Sundays and holidays are paid week offs.</p>
      </div>

      {state === 'loading' && <div className='py-16 text-center text-gray-500'>Loading...</div>}

      {state === 'no-tables' && (
        <Card>
          <p className='font-bold text-gray-900'>Attendance is not set up yet.</p>
          <p className='text-gray-600 mt-2'>
            Run <span className='font-mono text-sm'>supabase/migrations/20261108000000_attendance.sql</span> in the
            Supabase SQL editor, then check again.
          </p>
          <Button className='mt-4' onClick={start}>
            Check Again
          </Button>
        </Card>
      )}

      {state === 'error' && (
        <Card>
          <p className='font-bold text-red-700'>Could not load attendance.</p>
          <p className='text-gray-600 mt-2'>{error}</p>
          <Button className='mt-4' onClick={start}>
            Try Again
          </Button>
        </Card>
      )}

      {state === 'ready' && (
        <>
          <div role='tablist' className='flex flex-wrap gap-1 border-b border-gray-200'>
            {TABS.map(t => (
              <button
                key={t.key}
                type='button'
                role='tab'
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 font-semibold rounded-t-lg border-b-2 -mb-px ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-700 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className='bg-white rounded-lg shadow-sm border border-gray-200 p-4'>
            {tab === 'mark' && <MarkTab staff={staff} holidays={holidays} locks={locks} username={username} />}
            {tab === 'summary' && (
              <SummaryTab
                staff={staff}
                history={history}
                holidays={holidays}
                locks={locks}
                username={username}
                onChanged={reload}
              />
            )}
            {tab === 'staff' && <StaffTab staff={staff} history={history} username={username} onChanged={reload} />}
            {tab === 'holidays' && (
              <HolidaysTab holidays={holidays} locks={locks} username={username} onChanged={reload} />
            )}
            {tab === 'logs' && <LogsTab />}
          </div>
        </>
      )}
    </div>
  );
};

export default Attendance;
