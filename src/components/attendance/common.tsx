import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Button from '../UI/Button';

export const fmtDate = (date: string | null | undefined): string => {
  if (!date) return '-';
  const [y, m, d] = date.slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : date;
};

export const fmtMoney = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const fmtDays = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

export const shiftMonth = (month: string, by: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const MonthPicker: React.FC<{ value: string; onChange: (m: string) => void }> = ({
  value,
  onChange,
}) => (
  <div className='flex items-center gap-1'>
    <button
      type='button'
      aria-label='Previous month'
      onClick={() => onChange(shiftMonth(value, -1))}
      className='p-2 rounded-lg border border-gray-300 hover:bg-gray-50'
    >
      <ChevronLeft className='w-4 h-4' />
    </button>
    <input
      type='month'
      value={value}
      onChange={e => e.target.value && onChange(e.target.value)}
      aria-label='Month'
      className='border border-gray-300 rounded-lg px-3 py-1.5 font-bold text-sm'
    />
    <button
      type='button'
      aria-label='Next month'
      onClick={() => onChange(shiftMonth(value, 1))}
      className='p-2 rounded-lg border border-gray-300 hover:bg-gray-50'
    >
      <ChevronRight className='w-4 h-4' />
    </button>
  </div>
);

export const Dialog: React.FC<{
  title: string;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}> = ({ title, onClose, width = 'max-w-lg', children }) => (
  <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'>
    <div className={`bg-white rounded-lg shadow-2xl w-full ${width} max-h-[92vh] flex flex-col`}>
      <div className='flex items-center justify-between px-5 py-3 border-b'>
        <h3 className='text-lg font-bold text-gray-900'>{title}</h3>
        <button type='button' aria-label='Close' onClick={onClose} className='p-1 rounded hover:bg-gray-100'>
          <X className='w-5 h-5' />
        </button>
      </div>
      <div className='p-5 overflow-y-auto'>{children}</div>
    </div>
  </div>
);

/** Asks for a compulsory reason, for changes that must be explained in the log. */
export const ReasonDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}> = ({ title, message, confirmLabel, danger, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onCancel}>
      <div className='text-sm text-gray-700 mb-3'>{message}</div>
      <label className='block text-sm font-bold text-gray-700 mb-1'>
        Reason <span className='text-red-500'>*</span>
      </label>
      <textarea
        autoFocus
        rows={2}
        value={reason}
        onChange={e => setReason(e.target.value.toUpperCase())}
        className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold'
      />
      <div className='flex justify-end gap-2 mt-4'>
        <Button variant='secondary' onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving...' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
};
