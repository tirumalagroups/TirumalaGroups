import React from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

/** A notice shortly before the login ends: at 12:00 AM, or after 30 minutes without use. */
const SessionWarningBanner: React.FC = () => {
  const { user, sessionWarning } = useAuth();
  if (!user || !sessionWarning) return null;
  return (
    <div className='fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-xl w-[calc(100%-2rem)] print:hidden' role='alert'>
      <div className='flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 shadow-lg'>
        <Clock className='w-5 h-5 shrink-0 mt-0.5' />
        <span>{sessionWarning}</span>
      </div>
    </div>
  );
};

export default SessionWarningBanner;
