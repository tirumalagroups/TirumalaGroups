import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import Button from '../UI/Button';
import Input from '../UI/Input';
import { MIN_PASSWORD, useAuth } from '../../contexts/AuthContext';

/** Shown instead of the app after an admin reset, or when the old password is shorter than 8. */
const ChangePasswordRequired: React.FC = () => {
  const { user, changePassword, logout } = useAuth();
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) {
      toast.error(`The new password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (next !== again) {
      toast.error('The two passwords are not the same');
      return;
    }
    setBusy(true);
    const result = await changePassword('', next);
    setBusy(false);
    if (result.success) toast.success('Password changed');
    else toast.error(result.error || 'Could not change the password');
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-yellow-50 flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-5'>
        <div className='flex items-center gap-3'>
          <KeyRound className='w-8 h-8 text-orange-600' />
          <div>
            <h1 className='text-xl font-bold text-gray-900'>Set a new password</h1>
            <p className='text-sm text-gray-600'>{user?.username}</p>
          </div>
        </div>
        <p className='text-sm text-gray-700'>
          Before using the app, please choose your own password. It must be at least {MIN_PASSWORD} characters.
        </p>
        <form onSubmit={submit} className='space-y-4'>
          <div className='relative'>
            <Input label='New password' password type={show ? 'text' : 'password'} value={next} onChange={setNext} required />
            <button type='button' onClick={() => setShow(v => !v)} className='absolute right-3 top-8 text-gray-400 hover:text-gray-600'>
              {show ? <EyeOff className='w-5 h-5' /> : <Eye className='w-5 h-5' />}
            </button>
          </div>
          <Input label='New password again' password type={show ? 'text' : 'password'} value={again} onChange={setAgain} required />
          <div className='flex justify-between gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => logout()}>Log Out</Button>
            <Button type='submit' disabled={busy}>{busy ? 'Saving...' : 'Save Password'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordRequired;
