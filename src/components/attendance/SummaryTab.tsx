import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Lock, Printer, Unlock } from 'lucide-react';
import Button from '../UI/Button';
import {
  AttendanceHoliday,
  AttendanceRecord,
  AttendanceStaff,
  calculateMonth,
  daysInMonth,
  dayKind,
  DayKind,
  monthDates,
  MonthSummaryRow,
  SalaryChange,
  SALARY_DIVISOR,
  STATUS_LABEL,
} from '../../utils/attendanceCalc';
import { AttendanceLock, getRecords, lockMonth, unlockMonth } from '../../services/attendanceService';
import { getSharedPrintStyles, PREVIEW_FIT_HEAD, printPreviewFrame } from '../../utils/print';
import { Dialog, errorText, fmtDate, fmtDays, fmtMoney, fmtMonth, MonthPicker, ReasonDialog } from './common';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const buildPrintHtml = (month: string, rows: MonthSummaryRow[], locked: boolean) => {
  const total = rows.reduce((s, r) => s + r.payable, 0);
  const totalSalary = rows.reduce((s, r) => s + r.salary, 0);
  const unmarked = rows.reduce((s, r) => s + r.unmarked, 0);
  const num = 'class="text-center"';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attendance ${esc(fmtMonth(month))}</title>
  <style>
    ${getSharedPrintStyles({ isLandscape: false, fontSizePt: 8 })}
    body { background: #f3f4f6; padding: 16px; }
    .page { background: #fff; max-width: 210mm; margin: 0 auto; padding: 10mm 8mm; box-sizing: border-box; }
    .head { text-align: center; border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
    .brand { font-size: 13pt; font-weight: bold; }
    .sub { font-size: 10pt; font-weight: bold; margin-top: 2px; }
    .note { font-size: 7.5pt; color: #444; margin-top: 8px; }
    .warn { font-size: 8pt; font-weight: bold; color: #b45309; margin-bottom: 6px; }
    td.money, th.money { text-align: right; white-space: nowrap; }
    td.nowrap { white-space: nowrap; }
    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .page { max-width: none; padding: 0 !important; margin: 0 !important; }
    }
  </style>${PREVIEW_FIT_HEAD}</head><body><div class="page">
    <div class="head">
      <div class="brand">Thirumala Group</div>
      <div class="sub">Attendance and Salary - ${esc(fmtMonth(month))}${locked ? ' (Closed)' : ''}</div>
    </div>
    ${unmarked > 0 ? `<div class="warn">Provisional: ${unmarked} days are not marked yet</div>` : ''}
    <table>
      <thead><tr>
        <th>S.No</th><th>Job Holder Name</th><th>Relation</th><th>Village</th><th class="money">Salary</th>
        <th ${num}>Present</th><th ${num}>Half Day</th><th ${num}>Absent</th><th ${num}>Week Off</th>
        <th ${num}>Paid Days</th><th class="money">Payable</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            r => `<tr>
          <td ${num}>${r.sno}</td><td>${esc(r.name)}</td><td>${esc(r.relation)}</td><td>${esc(r.village)}</td>
          <td class="money">${esc(fmtMoney(r.salary))}</td>
          <td ${num}>${r.present}</td><td ${num}>${r.half_day}</td><td ${num}>${r.absent}</td><td ${num}>${r.week_off}</td>
          <td ${num}>${fmtDays(r.paid_days)}</td><td class="money">${esc(fmtMoney(r.payable))}</td>
        </tr>`
          )
          .join('')}
        <tr class="totals">
          <td colspan="4" class="text-right">Total</td><td class="money">${esc(fmtMoney(totalSalary))}</td>
          <td colspan="5"></td><td class="money">${esc(fmtMoney(total))}</td>
        </tr>
      </tbody>
    </table>
    <div class="note">Salary = Salary / ${SALARY_DIVISOR} x Paid Days. Paid Days = ${SALARY_DIVISOR} - Absent - (Half Days x 0.5). Sundays and holidays are paid week offs.</div>
    <div class="note">Printed on ${format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
  </div></body></html>`;
};

const KIND_CELL: Record<DayKind, string> = {
  present: 'bg-green-100 text-green-900 border-green-200',
  half_day: 'bg-amber-100 text-amber-900 border-amber-200',
  absent: 'bg-red-100 text-red-900 border-red-200',
  week_off: 'bg-sky-100 text-sky-900 border-sky-200',
  unmarked: 'bg-white text-gray-500 border-gray-200',
  not_employed: 'bg-gray-100 text-gray-400 border-gray-200',
};

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PersonCalendar: React.FC<{
  row: MonthSummaryRow;
  staff?: AttendanceStaff;
  month: string;
  records: AttendanceRecord[];
  holidays: AttendanceHoliday[];
  onClose: () => void;
}> = ({ row, staff, month, records, holidays, onClose }) => {
  const dates = monthDates(month);
  const [y, m] = month.split('-').map(Number);
  const blanks = new Date(y, m - 1, 1).getDay();
  const holidayDates = new Set(holidays.map(h => h.holiday_date));
  const own = new Map(records.filter(r => r.staff_id === row.staff_id).map(r => [r.attendance_date, r] as const));
  const withReason = dates.filter(d => {
    const r = own.get(d);
    return staff && r?.reason && dayKind(staff, d, r, holidayDates) === r.status;
  });

  return (
    <Dialog title={`${row.name} - ${fmtMonth(month)}`} onClose={onClose} width='max-w-2xl'>
      <div className='grid grid-cols-7 gap-1 text-center text-sm'>
        {WEEK.map(w => (
          <div key={w} className='font-semibold text-gray-600 py-1'>
            {w}
          </div>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {dates.map(d => {
          const kind: DayKind = staff ? dayKind(staff, d, own.get(d), holidayDates) : 'unmarked';
          return (
            <div key={d} className={`border rounded p-1 min-h-[52px] ${KIND_CELL[kind]}`}>
              <div className='font-bold'>{Number(d.slice(8))}</div>
              <div className='text-xs leading-tight'>{STATUS_LABEL[kind]}</div>
            </div>
          );
        })}
      </div>
      <div className='mt-4 p-3 rounded-lg bg-gray-50 text-sm font-semibold'>
        Paid days {fmtDays(row.paid_days)} x {fmtMoney(row.salary)} / {SALARY_DIVISOR} ={' '}
        <span className='text-blue-700'>{fmtMoney(row.payable)}</span>
      </div>
      {withReason.length > 0 && (
        <table className='fit-table mt-4 border border-gray-200'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='text-left font-semibold'>Date</th>
              <th className='text-left font-semibold'>Status</th>
              <th className='text-left font-semibold'>Reason</th>
            </tr>
          </thead>
          <tbody>
            {withReason.map(d => {
              const r = own.get(d)!;
              return (
                <tr key={d} className='border-t border-gray-100'>
                  <td className='whitespace-nowrap'>{fmtDate(d)}</td>
                  <td className='whitespace-nowrap'>{STATUS_LABEL[r.status]}</td>
                  <td>{r.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Dialog>
  );
};

const SummaryTab: React.FC<{
  staff: AttendanceStaff[];
  history: SalaryChange[];
  holidays: AttendanceHoliday[];
  locks: AttendanceLock[];
  username: string;
  onChanged: () => Promise<void>;
}> = ({ staff, history, holidays, locks, username, onChanged }) => {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MonthSummaryRow | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getRecords(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`)
      .then(r => live && setRecords(r))
      .catch(e => toast.error(errorText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [month]);

  const lock = locks.find(l => l.month === month);
  const rows = useMemo(
    () => (lock ? lock.summary : calculateMonth(staff, month, records, holidays, history)),
    [lock, staff, month, records, holidays, history]
  );
  const totals = useMemo(
    () => ({
      payable: rows.reduce((s, r) => s + r.payable, 0),
      salary: rows.reduce((s, r) => s + r.salary, 0),
      unmarked: rows.reduce((s, r) => s + r.unmarked, 0),
    }),
    [rows]
  );
  const printHtml = useMemo(
    () => (showPrint ? buildPrintHtml(month, rows, !!lock) : ''),
    [showPrint, month, rows, lock]
  );

  const doClose = async () => {
    setBusy(true);
    try {
      await lockMonth(month, rows, username);
      await onChanged();
      toast.success(`${fmtMonth(month)} closed`);
      setConfirmClose(false);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const doOpen = async (reason: string) => {
    try {
      await unlockMonth(month, reason, username);
      await onChanged();
      toast.success(`${fmtMonth(month)} opened`);
      setConfirmOpen(false);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <MonthPicker value={month} onChange={setMonth} />
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='secondary' icon={Printer} disabled={rows.length === 0} onClick={() => setShowPrint(true)}>
            Print Preview
          </Button>
          {lock ? (
            <Button variant='danger' icon={Unlock} onClick={() => setConfirmOpen(true)}>
              Open Month
            </Button>
          ) : (
            <Button
              icon={Lock}
              disabled={rows.length === 0 || loading}
              onClick={() => {
                if (totals.unmarked > 0) {
                  toast.error(`${totals.unmarked} days are not marked yet, so this month cannot be closed`);
                  return;
                }
                setConfirmClose(true);
              }}
            >
              Close Month
            </Button>
          )}
        </div>
      </div>

      <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
        <div className='p-3 rounded-lg border border-gray-200 bg-white'>
          <div className='text-sm text-gray-500'>Job Holders</div>
          <div className='text-xl font-bold'>{rows.length}</div>
        </div>
        <div className='p-3 rounded-lg border border-gray-200 bg-white'>
          <div className='text-sm text-gray-500'>Total Salary</div>
          <div className='text-xl font-bold'>{fmtMoney(totals.salary)}</div>
        </div>
        <div className='p-3 rounded-lg border border-blue-200 bg-blue-50'>
          <div className='text-sm text-blue-700'>Total Payable</div>
          <div className='text-xl font-bold text-blue-800'>{fmtMoney(totals.payable)}</div>
        </div>
        <div
          className={`p-3 rounded-lg border ${
            lock
              ? 'border-gray-300 bg-gray-100'
              : totals.unmarked > 0
                ? 'border-amber-200 bg-amber-50'
                : 'border-green-200 bg-green-50'
          }`}
        >
          <div className='text-sm text-gray-600'>Month Status</div>
          <div className='text-xl font-bold'>
            {lock ? 'Closed' : totals.unmarked > 0 ? `${totals.unmarked} days not marked` : 'Ready to close'}
          </div>
        </div>
      </div>

      {lock && (
        <div className='p-3 rounded-lg bg-gray-100 border border-gray-300 text-gray-800 text-sm font-semibold'>
          Closed by {lock.locked_by} on {format(new Date(lock.locked_at), 'dd/MM/yyyy HH:mm')}. These figures are final
          and stay as they were at closing.
        </div>
      )}
      {!lock && totals.unmarked > 0 && (
        <div className='p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm font-semibold'>
          Provisional: days not marked are not deducted yet, so Payable can still go down.
        </div>
      )}

      {loading ? (
        <div className='py-12 text-center text-gray-500'>Loading...</div>
      ) : rows.length === 0 ? (
        <div className='py-12 text-center text-gray-500'>No job holders in {fmtMonth(month)}.</div>
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
                <th className='text-center font-semibold'>Present</th>
                <th className='text-center font-semibold'>Half Day</th>
                <th className='text-center font-semibold'>Absent</th>
                <th className='text-center font-semibold'>Week Off</th>
                <th className='text-center font-semibold'>Not Marked</th>
                <th className='text-center font-semibold'>Paid Days</th>
                <th className='text-right font-semibold'>Payable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.staff_id}
                  onClick={() => setSelected(r)}
                  className='border-b border-gray-100 hover:bg-blue-50 cursor-pointer'
                >
                  <td className='text-center'>{r.sno}</td>
                  <td className='font-semibold text-blue-700'>{r.name}</td>
                  <td>{r.relation}</td>
                  <td>{r.village}</td>
                  <td className='text-right whitespace-nowrap'>{fmtMoney(r.salary)}</td>
                  <td className='text-center'>{r.present}</td>
                  <td className='text-center'>{r.half_day}</td>
                  <td className='text-center'>{r.absent}</td>
                  <td className='text-center'>{r.week_off}</td>
                  <td className={`text-center ${r.unmarked > 0 ? 'text-amber-700 font-bold' : ''}`}>{r.unmarked}</td>
                  <td className='text-center font-semibold'>{fmtDays(r.paid_days)}</td>
                  <td className='text-right font-bold whitespace-nowrap'>{fmtMoney(r.payable)}</td>
                </tr>
              ))}
              <tr className='bg-gray-50 font-bold'>
                <td colSpan={4} className='text-right'>
                  Total
                </td>
                <td className='text-right whitespace-nowrap'>{fmtMoney(totals.salary)}</td>
                <td colSpan={6} />
                <td className='text-right whitespace-nowrap'>{fmtMoney(totals.payable)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <PersonCalendar
          row={selected}
          staff={staff.find(s => s.id === selected.staff_id)}
          month={month}
          records={records}
          holidays={holidays}
          onClose={() => setSelected(null)}
        />
      )}

      {showPrint && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 z-50 no-print'>
          <div className='bg-white rounded-lg w-[98vw] h-[96vh] flex flex-col shadow-2xl'>
            <div className='flex items-center justify-between px-6 py-4 border-b'>
              <h3 className='text-lg font-bold text-gray-900'>Print Preview - Attendance</h3>
              <div className='flex items-center gap-2'>
                <Button
                  size='sm'
                  onClick={() => {
                    if (!printPreviewFrame(frameRef.current)) toast.error('Could not print');
                  }}
                >
                  Print
                </Button>
                <Button size='sm' variant='secondary' onClick={() => setShowPrint(false)}>
                  Close
                </Button>
              </div>
            </div>
            <iframe
              ref={frameRef}
              title='Attendance print preview'
              srcDoc={printHtml}
              className='flex-1 w-full rounded-b-lg'
            />
          </div>
        </div>
      )}

      {confirmClose && (
        <Dialog title={`Close ${fmtMonth(month)}?`} onClose={() => setConfirmClose(false)}>
          <p className='text-sm text-gray-700'>
            {rows.length} job holders, total payable{' '}
            <span className='font-bold'>{fmtMoney(totals.payable)}</span>. After closing, attendance and salary figures
            for this month cannot change unless an admin opens the month again with a reason.
          </p>
          <div className='flex justify-end gap-2 mt-4'>
            <Button variant='secondary' disabled={busy} onClick={() => setConfirmClose(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={doClose}>
              {busy ? 'Closing...' : 'Close Month'}
            </Button>
          </div>
        </Dialog>
      )}

      {confirmOpen && (
        <ReasonDialog
          title={`Open ${fmtMonth(month)}?`}
          message='The figures will be recalculated from the current attendance and salary details.'
          confirmLabel='Open Month'
          danger
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doOpen}
        />
      )}
    </div>
  );
};

export default SummaryTab;
