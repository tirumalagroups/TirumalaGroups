import React from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import FinanceSidebar from './FinanceSidebar';
import FinanceHeader from './FinanceHeader';
import { useTableMode } from '../../contexts/TableModeContext';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const ROUTE_PERMISSION_MAP: Record<string, string> = {
  '/finance': 'finance_dashboard',
  '/sync-center': 'sync_center',
  '/finance/loan-entry': 'loan_entry',
  '/finance/edit-loan-entry': 'edit_loan_entry',
  '/finance/new-customer': 'new_customers',
  '/finance/customers': 'new_customers',
  '/finance/new-partner': 'partners',
  '/finance/partners': 'partners',
  '/finance/cash-book': 'daybook',
  '/finance/capital-entry': 'capital_entry',
  '/finance/calculator': 'calculator',
  '/finance/search': 'search',
  '/finance/cd-ledger': 'cd_ledger',
  '/finance/hp-ledger': 'hp_ledger',
  '/finance/stbd-ledger': 'stbd_ledger',
  '/finance/tbd-ledger': 'tbd_ledger',
  '/finance/daily-report': 'daily_report',
  '/finance/detailed-ledger': 'detailed_ledger',
  '/finance/general-ledger': 'general_ledger',
  '/finance/dues-ledger': 'dues_ledger',
  '/finance/payment-followup': 'payment_followup',
  '/finance/call-history': 'payment_followup',
  '/finance/pl': 'pl',
  '/finance/final-statement': 'final_statement',
  '/finance/business-report': 'business_report',
  '/finance/partner-performance': 'partner_performance',
  '/finance/logs': 'logs',
  '/finance/user-access-management': 'user_access_management',
  '/finance/ledger-settings': 'ledger_settings',
  '/finance/transaction-approval': 'finance_approve_records',
  '/finance/edit-entry': 'finance_edit_entry',
};

const Layout: React.FC = () => {
  const { isFinanceMode } = useTableMode();
  const location = useLocation();
  const { user } = useAuth();

  if (isFinanceMode) {
    if (user && !user.is_admin) {
      const requiredKey = ROUTE_PERMISSION_MAP[location.pathname];
      const userFeatures = Array.isArray(user.features) ? user.features : [];
      if (requiredKey && !userFeatures.includes(requiredKey)) {
        toast.error("You do not have permission to access this page.", { id: 'route-guard-error' });
        return <Navigate to="/finance" replace />;
      }
    }

    return (
      <div className='flex flex-col h-screen overflow-hidden bg-slate-50 font-sans'>
        <FinanceHeader />
        <div className='flex flex-1 overflow-hidden'>
          <FinanceSidebar />
          <main className='flex-1 overflow-y-auto p-6'>
            <Outlet />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className='flex min-h-screen bg-gray-50'>
      <Sidebar />
      <div className='flex-1 flex flex-col overflow-hidden min-h-screen'>
        <Header />
        <main className='flex-1 overflow-y-auto p-6'>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
