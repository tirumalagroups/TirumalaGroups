// Attendance salary rules. No database or screen code here, so every rule can be tested.
//
// Salary = salary / days in the month x paid days
// Paid days = present days + (half days x 0.5) + week offs
//
// Sundays and holidays are paid week offs. Days not marked and days outside the person's
// joining and leaving dates earn nothing.

export type AttendanceStatus = 'present' | 'half_day' | 'absent';
export type DayKind = AttendanceStatus | 'week_off' | 'unmarked' | 'not_employed';

export interface AttendanceStaff {
  id: string;
  sno: number;
  name: string;
  relation_type: string;
  relation_name: string;
  village: string;
  salary: number;
  joining_date: string;
  leaving_date: string | null;
}

export interface AttendanceRecord {
  id?: string;
  staff_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  reason: string;
  marked_by?: string;
  marked_at?: string;
  updated_by?: string;
  updated_at?: string;
}

export interface SalaryChange {
  staff_id: string;
  salary: number;
  effective_from: string;
}

export interface AttendanceHoliday {
  holiday_date: string;
  name: string;
}

export interface MonthSummaryRow {
  staff_id: string;
  sno: number;
  name: string;
  relation: string;
  village: string;
  salary: number;
  present: number;
  half_day: number;
  absent: number;
  week_off: number;
  unmarked: number;
  employed_days: number;
  paid_days: number;
  payable: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const daysInMonth = (month: string): number => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

export const monthDates = (month: string): string[] =>
  Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);

export const monthOf = (date: string): string => date.slice(0, 7);

export const isSunday = (date: string): boolean => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 0;
};

export const isEmployedOn = (
  staff: Pick<AttendanceStaff, 'joining_date' | 'leaving_date'>,
  date: string
): boolean => staff.joining_date <= date && (!staff.leaving_date || staff.leaving_date >= date);

export const relationText = (s: Pick<AttendanceStaff, 'relation_type' | 'relation_name'>): string =>
  [s.relation_type, s.relation_name].filter(Boolean).join(' ').trim();

/** What a day counts as for this person. A Sunday or holiday always wins over a saved entry. */
export const dayKind = (
  staff: Pick<AttendanceStaff, 'joining_date' | 'leaving_date'>,
  date: string,
  record: Pick<AttendanceRecord, 'status'> | undefined,
  holidayDates: ReadonlySet<string>
): DayKind => {
  if (!isEmployedOn(staff, date)) return 'not_employed';
  if (isSunday(date) || holidayDates.has(date)) return 'week_off';
  return record ? record.status : 'unmarked';
};

/** Salary in force on the person's last employed day of the month. */
export const salaryForMonth = (
  staff: Pick<AttendanceStaff, 'id' | 'salary' | 'leaving_date'>,
  month: string,
  history: readonly SalaryChange[]
): number => {
  const monthEnd = `${month}-${pad(daysInMonth(month))}`;
  const lastDay = staff.leaving_date && staff.leaving_date < monthEnd ? staff.leaving_date : monthEnd;
  const own = history
    .filter(h => h.staff_id === staff.id)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (own.length === 0) return Number(staff.salary) || 0;
  const inForce = own.filter(h => h.effective_from <= lastDay).pop();
  return Number((inForce ?? own[0]).salary) || 0;
};

export const paidDays = (present: number, halfDays: number, weekOffs: number): number =>
  present + halfDays * 0.5 + weekOffs;

export const payableSalary = (salary: number, paid: number, monthLength: number): number =>
  Math.round((salary * paid) / monthLength);

/** One summary row for one person, or null if they were not employed in that month. */
export const calculateStaffMonth = (
  staff: AttendanceStaff,
  month: string,
  records: readonly AttendanceRecord[],
  holidayDates: ReadonlySet<string>,
  history: readonly SalaryChange[]
): MonthSummaryRow | null => {
  const byDate = new Map(
    records.filter(r => r.staff_id === staff.id).map(r => [r.attendance_date, r] as const)
  );
  const counts = { present: 0, half_day: 0, absent: 0, week_off: 0, unmarked: 0 };
  let employedDays = 0;
  for (const date of monthDates(month)) {
    const kind = dayKind(staff, date, byDate.get(date), holidayDates);
    if (kind === 'not_employed') continue;
    employedDays += 1;
    counts[kind] += 1;
  }
  if (employedDays === 0) return null;

  const salary = salaryForMonth(staff, month, history);
  const paid = paidDays(counts.present, counts.half_day, counts.week_off);
  return {
    staff_id: staff.id,
    sno: staff.sno,
    name: staff.name,
    relation: relationText(staff),
    village: staff.village,
    salary,
    ...counts,
    employed_days: employedDays,
    paid_days: paid,
    payable: payableSalary(salary, paid, daysInMonth(month)),
  };
};

export const calculateMonth = (
  staffList: readonly AttendanceStaff[],
  month: string,
  records: readonly AttendanceRecord[],
  holidays: readonly AttendanceHoliday[],
  history: readonly SalaryChange[]
): MonthSummaryRow[] => {
  const holidayDates = new Set(holidays.map(h => h.holiday_date));
  return staffList
    .map(s => calculateStaffMonth(s, month, records, holidayDates, history))
    .filter((r): r is MonthSummaryRow => r !== null)
    .sort((a, b) => a.sno - b.sno);
};

export const STATUS_LABEL: Record<DayKind, string> = {
  present: 'Present',
  half_day: 'Half Day',
  absent: 'Absent',
  week_off: 'Week Off',
  unmarked: 'Not Marked',
  not_employed: '-',
};

export const needsReason = (status: AttendanceStatus): boolean => status !== 'present';
