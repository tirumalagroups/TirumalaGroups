import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Edit, Plus, Search } from 'lucide-react';
import Button from '../UI/Button';
import Input from '../UI/Input';
import { AttendanceStaff, relationText, SalaryChange } from '../../utils/attendanceCalc';
import { addStaff, updateStaff } from '../../services/attendanceService';
import { Dialog, errorText, fmtDate, fmtMoney } from './common';

const RELATIONS = ['S/O', 'D/O', 'W/O', 'C/O'];

const isLeft = (s: AttendanceStaff, today: string) => !!s.leaving_date && s.leaving_date < today;

const StaffDialog: React.FC<{
  staff: AttendanceStaff | null;
  allStaff: AttendanceStaff[];
  history: SalaryChange[];
  username: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}> = ({ staff, allStaff, history, username, onClose, onSaved }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [name, setName] = useState(staff?.name || '');
  const [relationType, setRelationType] = useState(staff?.relation_type || 'S/O');
  const [relationName, setRelationName] = useState(staff?.relation_name || '');
  const [village, setVillage] = useState(staff?.village || '');
  const [salary, setSalary] = useState(staff ? String(staff.salary) : '');
  const [joining, setJoining] = useState(staff?.joining_date || today);
  const [leaving, setLeaving] = useState(staff?.leaving_date || '');
  const [effectiveFrom, setEffectiveFrom] = useState(`${today.slice(0, 7)}-01`);
  const [salaryReason, setSalaryReason] = useState('');
  const [saving, setSaving] = useState(false);

  const salaryNumber = Number(salary);
  const salaryChanged = !!staff && salary !== '' && salaryNumber !== staff.salary;
  const ownHistory = useMemo(
    () =>
      staff
        ? history
            .filter(h => h.staff_id === staff.id)
            .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
        : [],
    [history, staff]
  );

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName) return toast.error('Name is compulsory');
    if (salary === '' || !Number.isFinite(salaryNumber) || salaryNumber < 0) {
      return toast.error('Enter a correct salary');
    }
    if (!joining) return toast.error('Joining date is compulsory');
    if (leaving && leaving < joining) return toast.error('Leaving date cannot be before joining date');
    if (salaryChanged && !effectiveFrom) return toast.error('Choose the date the new salary starts');
    if (salaryChanged && !salaryReason.trim()) return toast.error('Reason is compulsory for a salary change');

    const duplicate = allStaff.some(
      s =>
        s.id !== staff?.id &&
        s.name === cleanName &&
        s.relation_name === relationName.trim() &&
        s.village === village.trim()
    );
    if (duplicate) return toast.error('This job holder already exists');

    const input = {
      name: cleanName,
      relation_type: relationType,
      relation_name: relationName.trim(),
      village: village.trim(),
      joining_date: joining,
      leaving_date: leaving || null,
    };

    setSaving(true);
    try {
      if (staff) {
        await updateStaff(
          staff,
          input,
          salaryChanged ? { salary: salaryNumber, effectiveFrom, reason: salaryReason.trim() } : null,
          username
        );
      } else {
        await addStaff({ ...input, salary: salaryNumber }, username);
      }
      toast.success(staff ? 'Job holder saved' : 'Job holder added');
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={staff ? `Edit ${staff.name}` : 'Add Job Holder'} onClose={onClose} width='max-w-2xl'>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <Input label='Job Holder Name' required uppercase value={name} onChange={setName} className='sm:col-span-2' />
        <div>
          <label className='block font-bold text-gray-700 mb-1' style={{ fontFamily: 'Times New Roman', fontSize: 15 }}>
            Relation
          </label>
          <select
            value={relationType}
            onChange={e => setRelationType(e.target.value)}
            aria-label='Relation'
            className='w-full border border-gray-300 rounded-lg px-3 py-2 font-bold'
          >
            {RELATIONS.map(r => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <Input label='Relation Name' uppercase value={relationName} onChange={setRelationName} />
        <Input label='Village' uppercase value={village} onChange={setVillage} />
        <Input label='Salary (per month)' required type='number' min={0} value={salary} onChange={setSalary} />
        <Input label='Joining Date' required type='date' value={joining} onChange={setJoining} />
        <div>
          <Input label='Leaving Date' type='date' value={leaving} onChange={setLeaving} />
          {leaving && (
            <button type='button' onClick={() => setLeaving('')} className='text-sm text-blue-700 underline mt-1'>
              Clear (still working)
            </button>
          )}
        </div>
      </div>

      {salaryChanged && (
        <div className='mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <p className='sm:col-span-2 text-sm font-semibold text-amber-900'>
            Salary changing from {fmtMoney(staff!.salary)} to {fmtMoney(salaryNumber)}. Earlier months keep the old
            salary. The month this date falls in uses the new salary.
          </p>
          <Input label='New Salary From' required type='date' value={effectiveFrom} onChange={setEffectiveFrom} />
          <Input label='Reason' required uppercase value={salaryReason} onChange={setSalaryReason} />
        </div>
      )}

      {ownHistory.length > 0 && (
        <div className='mt-4'>
          <div className='font-semibold text-sm text-gray-700 mb-1'>Salary History</div>
          <table className='fit-table border border-gray-200'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='text-left font-semibold'>From</th>
                <th className='text-right font-semibold'>Salary</th>
              </tr>
            </thead>
            <tbody>
              {ownHistory.map(h => (
                <tr key={h.effective_from} className='border-t border-gray-100'>
                  <td>{fmtDate(h.effective_from)}</td>
                  <td className='text-right'>{fmtMoney(h.salary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className='flex justify-end gap-2 mt-5'>
        <Button variant='secondary' onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
};

const StaffTab: React.FC<{
  staff: AttendanceStaff[];
  history: SalaryChange[];
  username: string;
  onChanged: () => Promise<void>;
}> = ({ staff, history, username, onChanged }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'left' | 'all'>('active');
  const [editing, setEditing] = useState<AttendanceStaff | 'new' | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    return staff.filter(s => {
      if (filter === 'active' && isLeft(s, today)) return false;
      if (filter === 'left' && !isLeft(s, today)) return false;
      return !q || `${s.name} ${s.village} ${relationText(s)}`.toUpperCase().includes(q);
    });
  }, [staff, search, filter, today]);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative w-64'>
            <Search className='w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='Search name or village'
              className='w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm'
            />
          </div>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as typeof filter)}
            aria-label='Status'
            className='border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold'
          >
            <option value='active'>Active</option>
            <option value='left'>Left</option>
            <option value='all'>All</option>
          </select>
        </div>
        <Button icon={Plus} onClick={() => setEditing('new')}>
          Add Job Holder
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className='py-12 text-center text-gray-500'>
          {staff.length === 0 ? 'No job holders yet. Add the first one.' : 'Nothing matches this search.'}
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
                <th className='text-left font-semibold'>Joined</th>
                <th className='text-left font-semibold'>Left</th>
                <th className='text-center font-semibold'>Status</th>
                <th className='text-center font-semibold'>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => (
                <tr key={s.id} className='border-b border-gray-100 hover:bg-gray-50'>
                  <td className='text-center'>{s.sno}</td>
                  <td className='font-semibold'>{s.name}</td>
                  <td>{relationText(s)}</td>
                  <td>{s.village}</td>
                  <td className='text-right whitespace-nowrap'>{fmtMoney(s.salary)}</td>
                  <td className='whitespace-nowrap'>{fmtDate(s.joining_date)}</td>
                  <td className='whitespace-nowrap'>{fmtDate(s.leaving_date)}</td>
                  <td className='text-center'>
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        isLeft(s, today) ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {isLeft(s, today) ? 'Left' : 'Active'}
                    </span>
                  </td>
                  <td className='text-center'>
                    <button
                      type='button'
                      aria-label={`Edit ${s.name}`}
                      onClick={() => setEditing(s)}
                      className='inline-flex items-center gap-1 text-blue-700 border border-blue-200 rounded hover:bg-blue-50'
                    >
                      <Edit className='w-3.5 h-3.5' /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <StaffDialog
          staff={editing === 'new' ? null : editing}
          allStaff={staff}
          history={history}
          username={username}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
};

export default StaffTab;
