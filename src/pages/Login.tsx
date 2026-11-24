import React, { useState } from 'react';
import { rawSupabase } from '../lib/supabase';
import { LOGOUT_REASON_KEY, sessionEndMessage } from '../lib/sessionGuard';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import toast, { Toaster } from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import loginImage from '../assets/login-image.jpg';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Why the last login ended (another device, admin, midnight, no use), shown once
  const [endedReason] = useState(() => {
    const r = sessionStorage.getItem(LOGOUT_REASON_KEY);
    sessionStorage.removeItem(LOGOUT_REASON_KEY);
    return r;
  });
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotName, setForgotName] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const { mode } = useTableMode();

  if (user) {
    if (!mode) {
      return <Navigate to='/choose-mode' replace />;
    }
    return <Navigate to={mode === 'finance' ? '/finance' : '/'} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      toast.error('Please enter both username and password');
      return;
    }

    setLoading(true);
    const result = await login(username, password);

    if (result.success) {
      toast.success('Login successful!');
      navigate('/choose-mode', { replace: true });
    } else {
      toast.error(result.error || 'Login failed');
    }

    setLoading(false);
  };

  // Forgot password: the request goes to every admin, who sets a temporary password
  const sendForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotName.trim()) {
      toast.error('Please enter your username');
      return;
    }
    setForgotBusy(true);
    const { error } = await rawSupabase.rpc('request_password_reset', { p_username: forgotName.trim() });
    setForgotBusy(false);
    if (error) {
      toast.error('Could not send the request. Please check the internet and try again.');
      return;
    }
    setForgotSent(true);
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-yellow-50 flex items-center justify-center p-4'>
      <Toaster position='top-right' />

      <div className='max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden'>
        {/* Logo/Image and Title */}
        <div className='flex flex-col items-center justify-center px-8 pt-8 pb-4'>
          <img
            src={loginImage}
            alt='Lord Venkateswara'
            className='w-64 h-64 object-cover object-[50%_18%] mb-4 rounded-xl shadow'
          />
          <h1 className='text-2xl font-bold text-gray-900 text-center'>
            Thirumala Group
          </h1>
          <p className='text-gray-600 mt-1 text-center'>
            Cotton Business Management
          </p>
          <p className='text-gray-500 text-sm mt-1 text-center'>
            श्री तिरुमला कॉटन मिल्स
          </p>
        </div>

        {/* Login Form */}
        <div className='px-8 py-6'>
          <h2 className='text-xl font-semibold text-gray-900 mb-6 text-center'>
            Login
          </h2>

          {endedReason && endedReason !== 'logout' && (
            <div className='mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900'>
              {sessionEndMessage(endedReason)}
            </div>
          )}

          <form onSubmit={handleSubmit} className='space-y-4'>
            <Input
              label='Username'
              value={username}
              onChange={setUsername}
              placeholder='Enter your username'
              required
            />

            <div className='relative'>
              <Input
                label='Password'
                password type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                placeholder='Enter your password'
                required
              />
              <button
                type='button'
                onClick={() => setShowPassword(!showPassword)}
                className='absolute right-3 top-8 text-gray-400 hover:text-gray-600'
              >
                {showPassword ? (
                  <EyeOff className='w-5 h-5' />
                ) : (
                  <Eye className='w-5 h-5' />
                )}
              </button>
            </div>

            <Button
              type='submit'
              className='w-full mt-6 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700'
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className='mt-4 text-center'>
            <button
              type='button'
              onClick={() => { setForgotOpen(true); setForgotSent(false); setForgotName(username); }}
              className='text-sm font-medium text-orange-700 hover:text-orange-800 underline'
            >
              Forgot password?
            </button>
          </div>
        </div>
      </div>

      {forgotOpen && (
        <div className='fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4' role='dialog'>
          <div className='bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4'>
            <h3 className='text-lg font-bold text-gray-900'>Forgot password</h3>
            {forgotSent ? (
              <>
                <p className='text-sm text-gray-700'>
                  Your request has been sent to the admins. An admin will give you a temporary password;
                  you will be asked to set your own when you log in with it.
                </p>
                <div className='flex justify-end'>
                  <Button onClick={() => setForgotOpen(false)}>Close</Button>
                </div>
              </>
            ) : (
              <form onSubmit={sendForgot} className='space-y-4'>
                <p className='text-sm text-gray-700'>Enter your username. The admins will be told, and will give you a temporary password.</p>
                <Input label='Username' value={forgotName} onChange={setForgotName} placeholder='Enter your username' required />
                <div className='flex justify-end gap-2'>
                  <Button type='button' variant='secondary' onClick={() => setForgotOpen(false)}>Cancel</Button>
                  <Button type='submit' disabled={forgotBusy}>{forgotBusy ? 'Sending...' : 'Send Request'}</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
