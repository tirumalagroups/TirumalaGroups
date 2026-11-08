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

describe('salary / days in the month x paid days (salary 15000)', () => {
  it('nothing marked in February pays only the 4 Sundays, not the full salary', () => {
    const r = row(staff(), '2026-02', []);
    expect(r.week_off).toBe(4);
    expect(r.unmarked).toBe(24);
    expect(r.paid_days).toBe(4);
    expect(r.payable).toBe(2143); // 15000 / 28 x 4 = 2142.86
  });

  it('never absent pays the full salary in every month length', () => {
    for (const month of ['2026-02', '2028-02', '2026-11', '2026-12']) {
      const r = row(staff(), month, markMonth(month));
      expect(r.paid_days).toBe(monthDates(month).length);
      expect(r.payable).toBe(15000);
    }
  });

  it('one absent day costs a day of that month', () => {
    expect(row(staff(), '2026-02', markMonth('2026-02', { '2026-02-02': 'absent' })).payable).toBe(14464); // 27/28
    expect(row(staff(), '2026-11', markMonth('2026-11', { '2026-11-02': 'absent' })).payable).toBe(14500); // 29/30
    expect(row(staff(), '2026-12', markMonth('2026-12', { '2026-12-01': 'absent' })).payable).toBe(14516); // 30/31
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
    expect([r.present, r.half_day, r.absent, r.week_off]).toEqual([19, 2, 4, 5]);
    expect(r.paid_days).toBe(25);
    expect(r.payable).toBe(12500);
  });

  it('a half day counts as half a paid day', () => {
    expect(paidDays(10, 3, 4)).toBe(15.5);
  });
});

describe('week offs', () => {
  it('counts every Sunday as week off, with no entry needed', () => {
    const r = row(staff(), '2026-11', markMonth('2026-11'));
    expect(r.week_off).toBe(5);
    expect(r.present).toBe(25);
    expect(r.present + r.week_off).toBe(30);
  });

  it('counts a holiday as a paid week off', () => {
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
  it('earn nothing, and Payable goes up as days are marked', () => {
    const records = markMonth('2026-11').slice(0, 10);
    const r = row(staff(), '2026-11', records);
    expect(r.present).toBe(10);
    expect(r.unmarked).toBe(15);
    expect(r.paid_days).toBe(15); // 10 present + 5 Sundays
    expect(r.payable).toBe(7500);
  });
});

describe('joining and leaving during a month', () => {
  it('joining on the 16th of a 30-day month pays those 15 days', () => {
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

  it('divides by the days in the month, not the days employed', () => {
    const r = row(staff({ salary: 10000, joining_date: '2026-10-16' }), '2026-10', markMonth('2026-10'));
    expect(r.paid_days).toBe(16);
    expect(r.payable).toBe(5161); // 10000 / 31 x 16 = 5161.29
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
    expect(payableSalary(10000, 29, 30)).toBe(9667); // 9666.67
    expect(payableSalary(10000, 28.5, 30)).toBe(9500);
    expect(payableSalary(10001, 15, 30)).toBe(5001); // 5000.5
    expect(payableSalary(0, 30, 30)).toBe(0);
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
