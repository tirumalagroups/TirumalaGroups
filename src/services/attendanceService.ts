// Saving and loading for the Attendance menu. All tables are shared across modes (see SHARED_TABLES).
// Every change writes to attendance_logs. If the change saves but its log does not,
// the caller gets an error saying so, because nothing should go unrecorded.
import { supabase } from '../lib/supabase';
import {
  AttendanceHoliday,
  AttendanceRecord,
  AttendanceStaff,
  AttendanceStatus,
  MonthSummaryRow,
  monthOf,
  SalaryChange,
  STATUS_LABEL,
} from '../utils/attendanceCalc';

export interface AttendanceLock {
  month: string;
  summary: MonthSummaryRow[];
  locked_by: string;
  locked_at: string;
}

export interface AttendanceLog {
  id: string;
  action: string;
  staff_id: string | null;
  staff_name: string;
  target_date: string;
  field: string;
  old_value: string;
  new_value: string;
  reason: string;
  changed_by: string;
  created_at: string;
}

export type LogInput = Partial<Omit<AttendanceLog, 'id' | 'created_at' | 'action' | 'changed_by'>> & {
  action: string;
};

export interface DayChange {
  staff: AttendanceStaff;
  status: AttendanceStatus;
  reason: string;
  existing?: AttendanceRecord;
}

export interface StaffInput {
  name: string;
  relation_type: string;
  relation_name: string;
  village: string;
  salary: number;
  joining_date: string;
  leaving_date: string | null;
}

const PAGE = 1000;

const fail = (error: { message?: string } | null, what: string) => {
  if (error) throw new Error(`${what}: ${error.message || 'unknown error'}`);
};

/** Reads past the 1000-row limit. `build` must apply a stable order. */
const readAll = async <T>(build: () => any, what: string): Promise<T[]> => {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    fail(error, what);
    all.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) return all;
  }
};

const writeLogs = async (logs: LogInput[], by: string) => {
  if (logs.length === 0) return;
  const { error } = await supabase
    .from('attendance_logs')
    .insert(logs.map(l => ({ ...l, changed_by: by })));
  if (error) {
    throw new Error(
      `The change was saved but its log was NOT recorded (${error.message}). Please tell the admin.`
    );
  }
};

const assertUnlocked = async (month: string) => {
  const { data, error } = await supabase
    .from('attendance_month_locks')
    .select('month')
    .eq('month', month);
  fail(error, 'Could not check the month');
  if (data && data.length > 0) throw new Error(`${month} is closed. Open the month first.`);
};

/** False when the Attendance SQL has not been run yet. */
export const attendanceTablesReady = async (): Promise<boolean> => {
  const { error } = await supabase.from('attendance_staff').select('id').limit(1);
  if (!error) return true;
  const missing =
    ['42P01', 'PGRST205', 'PGRST202'].includes(String(error.code)) ||
    /does not exist|schema cache/i.test(error.message || '');
  if (missing) return false;
  throw new Error(error.message);
};

export const getStaff = () =>
  readAll<AttendanceStaff>(
    () => supabase.from('attendance_staff').select('*').order('sno').order('id'),
    'Could not load job holders'
  ).then(rows => rows.map(r => ({ ...r, salary: Number(r.salary) })));

export const getSalaryHistory = () =>
  readAll<SalaryChange>(
    () => supabase.from('attendance_salary_history').select('*').order('effective_from').order('id'),
    'Could not load salary history'
  ).then(rows => rows.map(r => ({ ...r, salary: Number(r.salary) })));

export const getRecords = (from: string, to: string) =>
  readAll<AttendanceRecord>(
    () =>
      supabase
        .from('attendance_records')
        .select('*')
        .gte('attendance_date', from)
        .lte('attendance_date', to)
        .order('attendance_date')
        .order('id'),
    'Could not load attendance'
  );

export const getHolidays = () =>
  readAll<AttendanceHoliday>(
    () => supabase.from('attendance_holidays').select('*').order('holiday_date'),
    'Could not load holidays'
  );

export const getLocks = () =>
  readAll<AttendanceLock>(
    () => supabase.from('attendance_month_locks').select('*').order('month'),
    'Could not load closed months'
  );

export const getLogs = (from: string, to: string) =>
  readAll<AttendanceLog>(
    () =>
      supabase
        .from('attendance_logs')
        .select('*')
        .gte('created_at', from)
        .lt('created_at', to)
        .order('created_at', { ascending: false })
        .order('id'),
    'Could not load logs'
  );

// ---- Job holders ----

export const addStaff = async (input: StaffInput, by: string): Promise<void> => {
  const { data: last, error: lastError } = await supabase
    .from('attendance_staff')
    .select('sno')
    .order('sno', { ascending: false })
    .limit(1);
  fail(lastError, 'Could not get the next S.No');
  const sno = (last?.[0]?.sno || 0) + 1;

  const { data, error } = await supabase
    .from('attendance_staff')
    .insert({ ...input, sno, created_by: by })
    .select('id')
    .single();
  fail(error, 'Could not add the job holder');
  if (!data) throw new Error('Could not add the job holder');

  const { error: historyError } = await supabase.from('attendance_salary_history').insert({
    staff_id: data.id,
    salary: input.salary,
    effective_from: input.joining_date,
    created_by: by,
  });
  fail(historyError, 'Could not save the salary');

  await writeLogs(
    [
      {
        action: 'Job Holder Added',
        staff_id: data.id,
        staff_name: input.name,
        new_value: `${input.relation_type} ${input.relation_name}, ${input.village}, Salary ${input.salary}, Joined ${input.joining_date.split('-').reverse().join('/')}`,
      },
    ],
    by
  );
};

const STAFF_FIELDS: { key: keyof StaffInput; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'relation_type', label: 'Relation' },
  { key: 'relation_name', label: 'Relation Name' },
  { key: 'village', label: 'Village' },
  { key: 'joining_date', label: 'Joining Date' },
  { key: 'leaving_date', label: 'Leaving Date' },
];

export interface SalaryUpdate {
  salary: number;
  effectiveFrom: string;
  reason: string;
}

export const updateStaff = async (
  staff: AttendanceStaff,
  input: Omit<StaffInput, 'salary'>,
  salaryUpdate: SalaryUpdate | null,
  by: string
): Promise<void> => {
  const logs: LogInput[] = [];
  const patch: Record<string, unknown> = {};

  for (const { key, label } of STAFF_FIELDS) {
    const before = staff[key as keyof AttendanceStaff] ?? '';
    const after = input[key as keyof typeof input] ?? '';
    if (String(before) !== String(after)) {
      patch[key] = input[key as keyof typeof input];
      logs.push({
        action: 'Job Holder Edited',
        staff_id: staff.id,
        staff_name: input.name,
        field: label,
        old_value: String(before),
        new_value: String(after),
      });
    }
  }

  if (salaryUpdate) {
    await assertUnlocked(monthOf(salaryUpdate.effectiveFrom));
    const { error } = await supabase.from('attendance_salary_history').upsert(
      {
        staff_id: staff.id,
        salary: salaryUpdate.salary,
        effective_from: salaryUpdate.effectiveFrom,
        created_by: by,
      },
      { onConflict: 'staff_id,effective_from' }
    );
    fail(error, 'Could not save the salary');

    // The staff row always carries the latest salary
    const { data: latest, error: latestError } = await supabase
      .from('attendance_salary_history')
      .select('salary')
      .eq('staff_id', staff.id)
      .order('effective_from', { ascending: false })
      .limit(1);
    fail(latestError, 'Could not read the salary');
    patch.salary = latest?.[0]?.salary ?? salaryUpdate.salary;

    logs.push({
      action: 'Salary Changed',
      staff_id: staff.id,
      staff_name: input.name,
      target_date: salaryUpdate.effectiveFrom,
      field: 'Salary',
      old_value: String(staff.salary),
      new_value: String(salaryUpdate.salary),
      reason: salaryUpdate.reason,
    });
  }

  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from('attendance_staff')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', staff.id);
  fail(error, 'Could not save the job holder');
  await writeLogs(logs, by);
};

// ---- Daily attendance ----

export const saveDay = async (
  date: string,
  changes: DayChange[],
  changeReason: string,
  by: string
): Promise<void> => {
  if (changes.length === 0) return;
  await assertUnlocked(monthOf(date));

  const now = new Date().toISOString();
  const rows = changes.map(c => ({
    staff_id: c.staff.id,
    attendance_date: date,
    status: c.status,
    reason: c.reason,
    marked_by: c.existing?.marked_by || by,
    marked_at: c.existing?.marked_at || now,
    updated_by: by,
    updated_at: now,
  }));
  const { error } = await supabase
    .from('attendance_records')
    .upsert(rows, { onConflict: 'staff_id,attendance_date' });
  fail(error, 'Could not save attendance');

  await writeLogs(
    changes.map(c => ({
      action: c.existing ? 'Attendance Changed' : 'Attendance Marked',
      staff_id: c.staff.id,
      staff_name: c.staff.name,
      target_date: date,
      field: 'Status',
      old_value: c.existing
        ? `${STATUS_LABEL[c.existing.status]}${c.existing.reason ? ` (${c.existing.reason})` : ''}`
        : '',
      new_value: `${STATUS_LABEL[c.status]}${c.reason ? ` (${c.reason})` : ''}`,
      reason: c.existing ? changeReason : c.reason,
    })),
    by
  );
};

// ---- Holidays ----

export const addHoliday = async (date: string, name: string, by: string): Promise<void> => {
  await assertUnlocked(monthOf(date));
  const { error } = await supabase
    .from('attendance_holidays')
    .insert({ holiday_date: date, name, created_by: by });
  if (error?.code === '23505') throw new Error('That date is already a holiday');
  fail(error, 'Could not add the holiday');
  await writeLogs([{ action: 'Holiday Added', target_date: date, new_value: name }], by);
};

export const removeHoliday = async (holiday: AttendanceHoliday, by: string): Promise<void> => {
  await assertUnlocked(monthOf(holiday.holiday_date));
  const { error } = await supabase
    .from('attendance_holidays')
    .delete()
    .eq('holiday_date', holiday.holiday_date);
  fail(error, 'Could not remove the holiday');
  await writeLogs(
    [{ action: 'Holiday Removed', target_date: holiday.holiday_date, old_value: holiday.name }],
    by
  );
};

// ---- Closing a month ----

export const lockMonth = async (
  month: string,
  summary: MonthSummaryRow[],
  by: string
): Promise<void> => {
  const total = summary.reduce((sum, r) => sum + r.payable, 0);
  const { error } = await supabase
    .from('attendance_month_locks')
    .insert({ month, summary, locked_by: by });
  if (error?.code === '23505') throw new Error('This month is already closed');
  fail(error, 'Could not close the month');
  await writeLogs(
    [
      {
        action: 'Month Closed',
        target_date: month,
        new_value: `${summary.length} job holders, total payable ${total}`,
      },
    ],
    by
  );
};

export const unlockMonth = async (month: string, reason: string, by: string): Promise<void> => {
  const { error } = await supabase.from('attendance_month_locks').delete().eq('month', month);
  fail(error, 'Could not open the month');
  await writeLogs([{ action: 'Month Opened', target_date: month, reason }], by);
};
