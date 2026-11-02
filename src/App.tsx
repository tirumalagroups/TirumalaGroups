import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TableModeProvider, useTableMode } from './contexts/TableModeContext';
import { queryClient } from './lib/queryClient';
import Layout from './components/Layout/Layout';
import HoverHelp from './components/UI/HoverHelp';
import Login from './pages/Login';
import ModeSelection from './pages/ModeSelection';
import Dashboard from './pages/Dashboard';
import NewEntry from './pages/NewEntry';
import EditEntry from './pages/EditEntry';
import DailyReport from './pages/DailyReport';
import DetailedLedger from './pages/DetailedLedger';
import LedgerSummary from './pages/LedgerSummary';
import ApproveRecords from './pages/ApproveRecords';
import EditedRecords from './pages/EditedRecords';
import DeletedRecords from './pages/DeletedRecords';
import ReplaceForm from './pages/ReplaceForm';
import BalanceSheet from './pages/BalanceSheet';
import ExportExcel from './pages/ExportExcel';
import Vehicles from './pages/Vehicles';
import BankGuarantees from './pages/BankGuarantees';
import Drivers from './pages/Drivers';
import UserManagement from './pages/UserManagement';
import CsvUpload from './pages/CsvUpload';
import Reminders from './pages/Reminders';
import DebugInfo from './components/UI/DebugInfo';
import { BookProvider } from './contexts/BookContext';
import BookManagement from './pages/BookManagement';
import { OfflineProvider, useOffline } from './contexts/OfflineContext';
import SyncCenter from './pages/SyncCenter';


// Finance Mode Page Imports
import FinanceDashboard from './pages/finance/FinanceDashboard';
import LoanEntry from './pages/finance/LoanEntry';
import EditLoanEntry from './pages/finance/EditLoanEntry';
import Partners from './pages/finance/Partners';
import SearchPage from './pages/finance/Search';
import GeneralCalculator from './pages/finance/GeneralCalculator';
import CapitalEntry from './pages/finance/CapitalEntry';
import Camera from './pages/finance/Camera';
import Daybook from './pages/finance/Daybook';
import DailyReportFinance from './pages/finance/DailyReport';
import GeneralLedger from './pages/finance/GeneralLedger';
import DetailedLedgerFinance from './pages/finance/DetailedLedger';
import CDLedger from './pages/finance/CDLedger';
import STBDLedger from './pages/finance/STBDLedger';
import HPLedger from './pages/finance/HPLedger';
import TBDLedger from './pages/finance/TBDLedger';
import DuesLedger from './pages/finance/DuesLedger';
import OutstandingLedger from './pages/finance/OutstandingLedger';
import ProfitAndLoss from './pages/finance/ProfitAndLoss';
import FinalStatement from './pages/finance/FinalStatement';
import BusinessReport from './pages/finance/BusinessReport';
import PartnerPerformance from './pages/finance/PartnerPerformance';
import NewCustomers from './pages/finance/NewCustomers';
import PhoneNumberEditor from './pages/finance/PhoneNumberEditor';
import AadhaarSearch from './pages/finance/AadhaarSearch';
import EditedDeletedLogs from './pages/finance/EditedDeletedLogs';
import UserAccessManagement from './pages/finance/UserAccessManagement';
import OldDataEntry from './pages/finance/OldDataEntry';
import NewCustomer from './pages/finance/NewCustomer';
import Customers from './pages/finance/Customers';
import NewGuarantor from './pages/finance/NewGuarantor';
import Guarantors from './pages/finance/Guarantors';
import NewPartner from './pages/finance/NewPartner';
import CashBook from './pages/finance/CashBook';
import LedgerSettings from './pages/finance/LedgerSettings';
import PaymentFollowUp from './pages/finance/PaymentFollowUp';
import TransactionApproval from './pages/finance/TransactionApproval';
import CallHistory from './pages/finance/CallHistory';

// Error Boundary Component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
          <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center'>
            <div className='text-red-500 text-6xl mb-4'>⚠️</div>
            <h1 className='text-xl font-bold text-gray-900 mb-2'>
              Something went wrong
            </h1>
            <p className='text-gray-600 mb-4'>
              We're sorry, but something unexpected happened. Please try
              refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className='bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors'
            >
              Refresh Page
            </button>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className='mt-4 text-left'>
                <summary className='cursor-pointer text-sm text-gray-500'>
                  Error Details
                </summary>
                <pre className='mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto'>
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Offline Guard component to block access to unsupported routes when offline
const OfflineGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connectionStatus } = useOffline();

  if (connectionStatus === 'CHECKING') {
    return (
      <div className='min-h-[60vh] bg-white border border-gray-150 rounded-2xl p-8 flex flex-col items-center justify-center text-center max-w-lg mx-auto my-12 font-outfit shadow-sm'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4'></div>
        <h1 className='text-xl font-bold text-gray-900 mb-2'>
          Verifying Connection
        </h1>
        <p className='text-gray-600 mb-6 text-sm max-w-xs'>
          Please wait while we verify your network status.
        </p>
      </div>
    );
  }

  if (connectionStatus === 'OFFLINE') {
    return (
      <div className='min-h-[60vh] bg-white border border-gray-150 rounded-2xl p-8 flex flex-col items-center justify-center text-center max-w-lg mx-auto my-12 font-outfit shadow-sm'>
        <div className='w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4 text-3xl'>
          ⚠️
        </div>
        <h1 className='text-xl font-bold text-gray-900 mb-2'>
          Connection Required
        </h1>
        <p className='text-gray-600 mb-6 text-sm max-w-xs'>
          This feature requires an active internet connection. Please reconnect to continue.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};

// Main App Component - Must be inside AuthProvider
const AppContent: React.FC = () => {
  // Protected Route Component - Must be inside AuthProvider and Router
  // Defined here to ensure it's always within the AuthProvider context
  const ProtectedRouteWrapper: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useAuth();
    const { mode } = useTableMode();

    if (loading) {
      return (
        <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
          <div className='text-center'>
            <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto'></div>
            <p className='mt-4 text-gray-600'>Loading...</p>
          </div>
        </div>
      );
    }

    if (!user) {
      return <Navigate to='/login' replace />;
    }

    // If children provided, render them (for mode-selection/choose-mode page)
    if (children) {
      return <>{children}</>;
    }

    // Direct URL protection: if no mode is selected, redirect to /choose-mode
    if (!mode) {
      return <Navigate to='/choose-mode' replace />;
    }

    // Otherwise render Layout (for other protected routes)
    // Pass active mode as key to force complete layout and component remounting
    return <Layout key={mode} />;
  };

  return (
    <Router>
      <HoverHelp />
      <Toaster
        position='top-right'
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#4ade80',
              secondary: '#fff',
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />

      <Routes>
        <Route path='/login' element={<Login />} />
        <Route
          path='/mode-selection'
          element={
            <ProtectedRouteWrapper>
              <ModeSelection />
            </ProtectedRouteWrapper>
          }
        />
        <Route
          path='/choose-mode'
          element={
            <ProtectedRouteWrapper>
              <ModeSelection />
            </ProtectedRouteWrapper>
          }
        />
        <Route
          path='/*'
          element={<ProtectedRouteWrapper />}
        >
          <Route index element={<Dashboard />} />
          <Route path='new-entry' element={<NewEntry />} />
          <Route path='edit-entry' element={<EditEntry />} />
          <Route path='sync-center' element={<SyncCenter />} />
          <Route path='vehicles' element={<Vehicles />} />
          <Route path='reminders' element={<Reminders />} />
          <Route path='user-management' element={<UserManagement />} />
          <Route path='book-management' element={<BookManagement />} />
          
          {/* Guarded Routes requiring connection */}
          <Route path='daily-report' element={<OfflineGuard><DailyReport /></OfflineGuard>} />
          <Route path='detailed-ledger' element={<OfflineGuard><DetailedLedger /></OfflineGuard>} />
          <Route path='ledger-summary' element={<OfflineGuard><LedgerSummary /></OfflineGuard>} />
          <Route path='approve-records' element={<OfflineGuard><ApproveRecords /></OfflineGuard>} />
          <Route path='edited-records' element={<OfflineGuard><EditedRecords /></OfflineGuard>} />
          <Route path='deleted-records' element={<OfflineGuard><DeletedRecords /></OfflineGuard>} />
          <Route path='replace-form' element={<OfflineGuard><ReplaceForm /></OfflineGuard>} />
          <Route path='balance-sheet' element={<OfflineGuard><BalanceSheet /></OfflineGuard>} />
          <Route path='export-excel' element={<OfflineGuard><ExportExcel /></OfflineGuard>} />
          <Route path='bank-guarantees' element={<OfflineGuard><BankGuarantees /></OfflineGuard>} />
          <Route path='drivers' element={<OfflineGuard><Drivers /></OfflineGuard>} />
          <Route path='csv-upload' element={<OfflineGuard><CsvUpload /></OfflineGuard>} />

          {/* Finance Mode Routes (All Guarded Offline) */}
          <Route path='finance' element={<OfflineGuard><FinanceDashboard /></OfflineGuard>} />
          <Route path='finance/loan-entry' element={<OfflineGuard><LoanEntry /></OfflineGuard>} />
          <Route path='finance/edit-loan-entry' element={<OfflineGuard><EditLoanEntry /></OfflineGuard>} />
          <Route path='finance/partners' element={<OfflineGuard><Partners /></OfflineGuard>} />
          <Route path='finance/search' element={<OfflineGuard><SearchPage /></OfflineGuard>} />
          <Route path='finance/calculator' element={<OfflineGuard><GeneralCalculator /></OfflineGuard>} />
          <Route path='finance/capital-entry' element={<OfflineGuard><CapitalEntry /></OfflineGuard>} />
          <Route path='finance/camera' element={<OfflineGuard><Camera /></OfflineGuard>} />
          <Route path='finance/daybook' element={<OfflineGuard><Daybook /></OfflineGuard>} />
          <Route path='finance/daily-report' element={<OfflineGuard><DailyReportFinance /></OfflineGuard>} />
          <Route path='finance/general-ledger' element={<OfflineGuard><GeneralLedger /></OfflineGuard>} />
          <Route path='finance/detailed-ledger' element={<OfflineGuard><DetailedLedgerFinance /></OfflineGuard>} />
          <Route path='finance/cd-ledger' element={<OfflineGuard><CDLedger /></OfflineGuard>} />
          <Route path='finance/stbd-ledger' element={<OfflineGuard><STBDLedger /></OfflineGuard>} />
          <Route path='finance/hp-ledger' element={<OfflineGuard><HPLedger /></OfflineGuard>} />
          <Route path='finance/tbd-ledger' element={<OfflineGuard><TBDLedger /></OfflineGuard>} />
          <Route path='finance/dues-ledger' element={<OfflineGuard><DuesLedger /></OfflineGuard>} />
          <Route path='finance/outstanding' element={<OfflineGuard><OutstandingLedger /></OfflineGuard>} />
          <Route path='finance/payment-followup' element={<OfflineGuard><PaymentFollowUp /></OfflineGuard>} />
          <Route path='finance/call-history' element={<OfflineGuard><CallHistory /></OfflineGuard>} />
          <Route path='finance/pl' element={<OfflineGuard><ProfitAndLoss /></OfflineGuard>} />
          <Route path='finance/final-statement' element={<OfflineGuard><FinalStatement /></OfflineGuard>} />
          <Route path='finance/business-report' element={<OfflineGuard><BusinessReport /></OfflineGuard>} />
          <Route path='finance/partner-performance' element={<OfflineGuard><PartnerPerformance /></OfflineGuard>} />
          <Route path='finance/new-customers' element={<OfflineGuard><NewCustomers /></OfflineGuard>} />
          <Route path='finance/phone-editor' element={<OfflineGuard><PhoneNumberEditor /></OfflineGuard>} />
          <Route path='finance/aadhaar-search' element={<OfflineGuard><AadhaarSearch /></OfflineGuard>} />
          <Route path='finance/logs' element={<OfflineGuard><EditedDeletedLogs /></OfflineGuard>} />
          <Route path='finance/user-access-management' element={<OfflineGuard><UserAccessManagement /></OfflineGuard>} />
          <Route path='finance/old-data-entry' element={<OfflineGuard><OldDataEntry /></OfflineGuard>} />
          <Route path='finance/new-customer' element={<OfflineGuard><NewCustomer /></OfflineGuard>} />
          <Route path='finance/customers' element={<OfflineGuard><Customers /></OfflineGuard>} />
          <Route path='finance/new-guarantor' element={<OfflineGuard><NewGuarantor /></OfflineGuard>} />
          <Route path='finance/guarantors' element={<OfflineGuard><Guarantors /></OfflineGuard>} />
          <Route path='finance/new-partner' element={<OfflineGuard><NewPartner /></OfflineGuard>} />
          <Route path='finance/cash-book' element={<OfflineGuard><CashBook /></OfflineGuard>} />
          <Route path='finance/ledger-settings' element={<OfflineGuard><LedgerSettings /></OfflineGuard>} />
          <Route path='finance/transaction-approval' element={<OfflineGuard><TransactionApproval /></OfflineGuard>} />
        </Route>
      </Routes>
    </Router>
  );
};

import { setupAudioUnlock } from './utils/reminderSound';

const App: React.FC = () => {
  React.useEffect(() => {
    // Enable browser AudioContext unlock on first user interaction
    setupAudioUnlock();

    const handleWheel = () => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        activeElement.tagName === 'INPUT' &&
        (activeElement as HTMLInputElement).type === 'number'
      ) {
        (activeElement as HTMLInputElement).blur();
      }
    };

    document.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      document.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TableModeProvider>
            <BookProvider>
              <OfflineProvider>
                <AppContent />
                <DebugInfo isVisible={false} />
              </OfflineProvider>
            </BookProvider>
            {/* React Query DevTools - only in development */}
            {process.env.NODE_ENV === 'development' && (
              <ReactQueryDevtools initialIsOpen={false} />
            )}
          </TableModeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
