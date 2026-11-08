import { describe, expect, it } from 'vitest';
import {
  AttendanceRecord,
  AttendanceStaff,
  AttendanceStatus,
  calculateMonth,
  calculateStaffMonth,
  dayKind,
  isSunday,
  monthDates,
  paidDays,
  payableSalary,
  salaryForMonth,
} from '../utils/attendanceCalc';

const staff = (over: Partial<AttendanceStaff> = {}): AttendanceStaff => ({
  id: 's1',
  sno: 1,
  name: 'RAMU',
  relation_type: 'S/O',
  relation_name: 'KRISHNA',
  village: 'NELLORE',
  salary: 15000,
  joining_date: '2020-01-01',
  leaving_date: null,
  ...over,
});

/** Marks every Monday-Saturday of the month: Present, except the dates given. */
const markMonth = (
  month: string,
  exceptions: Record<string, AttendanceStatus> = {},
  id = 's1',
  holidays: string[] = []
): AttendanceRecord[] =>
  monthDates(month)
    .filter(d => !isSunday(d) && !holidays.includes(d))
    .map(d => ({
      staff_id: id,
      attendance_date: d,
      status: exceptions[d] ?? 'present',
      reason: exceptions[d] ? 'TEST' : '',
    }));

const row = (
  s: AttendanceStaff,
  month: string,
  records: AttendanceRecord[],
  holidays: string[] = [],
  history = [] as { staff_id: string; salary: number; effective_from: string }[]
) => {
  const r = calculateStaffMonth(s, month, records, new Set(holidays), history);
  if (!r) throw new Error('expected a row');
  return r;
};

describe('calendar', () => {
  it('finds real Sundays', () => {
    expect(isSunday('2026-11-08')).toBe(true);
    expect(isSunday('2026-11-09')).toBe(false);
    expect(isSunday('2026-02-01')).toBe(true);
  });

  it('knows month lengths, including leap years', () => {
    expect(monthDates('2026-02')).toHaveLength(28);
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(monthDates('2026-11')).toHaveLength(30);
    expect(monthDates('2026-12')).toHaveLength(31);
    expect(monthDates('2026-12')[30]).toBe('2026-12-31');
  });
});

describe('the examples agreed with the owner (salary 15000)', () => {
  it('February, never absent: full 15000', () => {
    const r = row(staff(), '2026-02', markMonth('2026-02'));
    expect(r.paid_days).toBe(30);
    expect(r.payable).toBe(15000);
    expect(r.unmarked).toBe(0);
  });

  it('31-day month, never absent: full 15000, not 15500', () => {
    const r = row(staff(), '2026-12', markMonth('2026-12'));
    expect(r.paid_days).toBe(30);
    expect(r.payable).toBe(15000);
  });

  it('30-day month, 2 half days and 4 absent: 25 days, 12500', () => {
    const r = row(
      staff(),
      '2026-11',
      markMonth('2026-11', {
        '2026-11-02': 'half_day',
        '2026-11-03': 'half_day',
        '2026-11-04': 'absent',
        '2026-11-05': 'absent',
        '2026-11-06': 'absent',
        '2026-11-07': 'absent',
      })
    );
    expect([r.half_day, r.absent]).toEqual([2, 4]);
    expect(r.paid_days).toBe(25);
    expect(r.payable).toBe(12500);
  });

  it('31-day month, 1 absent: 29 days, 14500', () => {
    const r = row(staff(), '2026-12', markMonth('2026-12', { '2026-12-01': 'absent' }));
    expect(r.paid_days).toBe(29);
    expect(r.payable).toBe(14500);
  });
});

describe('week offs', () => {
  it('counts every Sunday as week off, with no entry needed', () => {
    const r = row(staff(), '2026-11', markMonth('2026-11'));
    expect(r.week_off).toBe(5);
    expect(r.present).toBe(25);
    expect(r.present + r.week_off).toBe(30);
  });

  it('counts a holiday as week off and does not deduct it', () => {
    const h = ['2026-11-09'];
    const r = row(staff(), '2026-11', markMonth('2026-11', {}, 's1', h), h);
    expect(r.week_off).toBe(6);
    expect(r.payable).toBe(15000);
  });

  it('a holiday added later beats an Absent already saved for that day', () => {
    const records = markMonth('2026-11', { '2026-11-09': 'absent' });
    expect(row(staff(), '2026-11', records).payable).toBe(14500);
    expect(row(staff(), '2026-11', records, ['2026-11-09']).payable).toBe(15000);
  });

  it('ignores an entry saved on a Sunday', () => {
    const k = dayKind(staff(), '2026-11-08', { status: 'absent' }, new Set());
    expect(k).toBe('week_off');
  });
});

describe('days not marked', () => {
  it('are counted and shown, and not deducted', () => {
    const records = markMonth('2026-11').slice(0, 10);
    const r = row(staff(), '2026-11', records);
    expect(r.present).toBe(10);
    expect(r.unmarked).toBe(15);
    expect(r.payable).toBe(15000);
  });
});

describe('joining and leaving during a month', () => {
  it('joining on the 16th of a 30-day month pays 15 days', () => {
    const r = row(staff({ joining_date: '2026-11-16' }), '2026-11', markMonth('2026-11'));
    expect(r.employed_days).toBe(15);
    expect(r.paid_days).toBe(15);
    expect(r.payable).toBe(7500);
  });

  it('leaving on the 10th with 1 absent pays 9 days', () => {
    const r = row(
      staff({ leaving_date: '2026-11-10' }),
      '2026-11',
      markMonth('2026-11', { '2026-11-02': 'absent' })
    );
    expect(r.employed_days).toBe(10);
    expect(r.paid_days).toBe(9);
    expect(r.payable).toBe(4500);
  });

  it('ignores absences outside the employed dates', () => {
    const r = row(
      staff({ joining_date: '2026-11-16' }),
      '2026-11',
      markMonth('2026-11', { '2026-11-02': 'absent' })
    );
    expect(r.absent).toBe(0);
    expect(r.paid_days).toBe(15);
  });

  it('counts the joining day and the leaving day as employed', () => {
    const s = staff({ joining_date: '2026-11-10', leaving_date: '2026-11-12' });
    expect(dayKind(s, '2026-11-09', undefined, new Set())).toBe('not_employed');
    expect(dayKind(s, '2026-11-10', undefined, new Set())).toBe('unmarked');
    expect(dayKind(s, '2026-11-12', undefined, new Set())).toBe('unmarked');
    expect(dayKind(s, '2026-11-13', undefined, new Set())).toBe('not_employed');
  });

  it('leaves out people who were not employed that month', () => {
    const list = [
      staff(),
      staff({ id: 's2', sno: 2, joining_date: '2026-12-01' }),
      staff({ id: 's3', sno: 3, joining_date: '2025-01-01', leaving_date: '2026-10-31' }),
    ];
    const rows = calculateMonth(list, '2026-11', markMonth('2026-11'), [], []);
    expect(rows.map(r => r.staff_id)).toEqual(['s1']);
  });

  it('never goes below zero paid days', () => {
    expect(paidDays(2, 30, 5, 5)).toBe(0);
  });
});

describe('salary changes', () => {
  const history = [
    { staff_id: 's1', salary: 12000, effective_from: '2020-01-01' },
    { staff_id: 's1', salary: 15000, effective_from: '2026-11-01' },
    { staff_id: 's2', salary: 99999, effective_from: '2026-01-01' },
  ];

  it('a raise never changes old months', () => {
    expect(salaryForMonth(staff(), '2026-10', history)).toBe(12000);
    expect(salaryForMonth(staff(), '2026-11', history)).toBe(15000);
    expect(salaryForMonth(staff(), '2026-12', history)).toBe(15000);
  });

  it('a raise during the month applies to that whole month', () => {
    const h = [
      { staff_id: 's1', salary: 12000, effective_from: '2020-01-01' },
      { staff_id: 's1', salary: 15000, effective_from: '2026-11-15' },
    ];
    expect(salaryForMonth(staff(), '2026-11', h)).toBe(15000);
  });

  it('a raise after the person left does not count', () => {
    const h = [
      { staff_id: 's1', salary: 12000, effective_from: '2020-01-01' },
      { staff_id: 's1', salary: 15000, effective_from: '2026-11-20' },
    ];
    expect(salaryForMonth(staff({ leaving_date: '2026-11-10' }), '2026-11', h)).toBe(12000);
  });

  it('falls back to the staff salary when there is no history', () => {
    expect(salaryForMonth(staff(), '2026-11', [])).toBe(15000);
  });
});

describe('rounding and totals', () => {
  it('rounds to the nearest rupee', () => {
    expect(payableSalary(10000, 29)).toBe(9667); // 9666.67
    expect(payableSalary(10000, 28.5)).toBe(9500);
    expect(payableSalary(10001, 15)).toBe(5001); // 5000.5
    expect(payableSalary(0, 30)).toBe(0);
  });

  it('does not mix up two people', () => {
    const list = [staff(), staff({ id: 's2', sno: 2, salary: 9000 })];
    const records = [
      ...markMonth('2026-11', { '2026-11-02': 'absent' }, 's1'),
      ...markMonth('2026-11', { '2026-11-02': 'half_day' }, 's2'),
    ];
    const rows = calculateMonth(list, '2026-11', records, [], []);
    expect(rows[0].payable).toBe(14500);
    expect(rows[1].paid_days).toBe(29.5);
    expect(rows[1].payable).toBe(8850);
  });
});
