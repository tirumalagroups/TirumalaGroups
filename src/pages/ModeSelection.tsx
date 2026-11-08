import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTableMode } from '../contexts/TableModeContext';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/UI/Button';
import { FileCheck, Briefcase, Wallet } from 'lucide-react';
import loginImage from '../assets/login-image.jpg';

const ModeSelection: React.FC = () => {
  const navigate = useNavigate();
  const { setMode } = useTableMode();
  const { user } = useAuth();

  const handleRegularMode = () => {
    setMode('regular');
    sessionStorage.setItem('finance_previous_mode', 'regular');
    localStorage.setItem('finance_previous_mode', 'regular');
    navigate('/', { replace: true });
  };

  const handleITRMode = () => {
    setMode('itr');
    sessionStorage.setItem('finance_previous_mode', 'itr');
    localStorage.setItem('finance_previous_mode', 'itr');
    navigate('/', { replace: true });
  };

  const handleFinanceMode = () => {
    const prev = sessionStorage.getItem('table_mode') || localStorage.getItem('table_mode');
    if (prev && prev !== 'finance') {
      sessionStorage.setItem('finance_previous_mode', prev);
      localStorage.setItem('finance_previous_mode', prev);
    }
    setMode('finance');
    navigate('/finance', { replace: true });
  };
  // Determine which modes the user can access based on their features
  // Admins have access to all modes
  const isAdmin = user?.is_admin || false;
  const featuresByMode = user?.featuresByMode || { regular: [], itr: [], finance: [] };
  
  // Check if user has features in regular mode
  const hasRegularFeatures = isAdmin || (featuresByMode.regular && featuresByMode.regular.length > 0);
  // Check if user has features in ITR mode
  const hasITRFeatures = isAdmin || (featuresByMode.itr && featuresByMode.itr.length > 0);
  
  // Show Finance option for admins and users with finance features
  const showFinance = isAdmin || (featuresByMode.finance && featuresByMode.finance.length > 0);
  
  // Determine grid layout based on number of visible buttons
  const visibleButtons = [hasRegularFeatures, hasITRFeatures, showFinance].filter(Boolean).length;
  let gridCols = 'grid-cols-1';
  if (visibleButtons === 2) {
    gridCols = 'grid-cols-1 sm:grid-cols-2';
  } else if (visibleButtons === 3) {
    gridCols = 'grid-cols-1 sm:grid-cols-2';
  }

  return (
    <div className='min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-yellow-50 flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden'>
        {/* Logo/Image and Title */}
        <div className='flex flex-col items-center justify-center px-8 pt-8 pb-6'>
          <img
            src={loginImage}
            alt='Lord Venkateswara'
            className='w-64 h-64 object-cover object-[50%_18%] mb-4 rounded-xl shadow'
          />
          <h1 className='text-3xl font-bold text-gray-900 text-center'>
            Thirumala Group
          </h1>
          <p className='text-gray-600 mt-2 text-center'>
            Cotton Business Management
          </p>
          <p className='text-gray-500 text-sm mt-1 text-center'>
            श्री तिरुमला कॉटन मिल्स
          </p>
        </div>

        {/* Mode Selection Buttons */}
        <div className='px-8 py-6'>
          <div className={`grid ${gridCols} gap-4`}>
            {hasRegularFeatures && (
              <Button
                onClick={handleRegularMode}
                className='w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-6 text-lg font-semibold shadow-lg flex flex-col gap-2'
              >
                <Briefcase className='w-8 h-8' />
                Regular Mode
              </Button>
            )}

            {hasITRFeatures && (
              <Button
                onClick={handleITRMode}
                className='w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white py-6 text-lg font-semibold shadow-lg flex flex-col gap-2'
              >
                <FileCheck className='w-8 h-8' />
                ITR Mode
              </Button>
            )}

            {showFinance && (
              <Button
                onClick={handleFinanceMode}
                className='w-full bg-gradient-to-r from-green-500 via-emerald-500 to-green-600 hover:from-green-600 hover:to-emerald-700 text-white py-6 text-lg font-semibold shadow-lg flex flex-col gap-2'
              >
                <Wallet className='w-8 h-8' />
                Finance
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModeSelection;

