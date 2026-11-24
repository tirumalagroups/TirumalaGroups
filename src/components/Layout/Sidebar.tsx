import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTableMode } from '../../contexts/TableModeContext';
import { Menu } from 'lucide-react';
import {
  Home,
  Edit,
  Book,
  BookOpen,
  FileEdit,
  Trash2,
  Replace,
  Upload,
  Truck,
  CreditCard,
  LogOut,
  Plus,
  FileText,
  CheckCircle,
  Download,
  Calculator,
  Users,
  Search,
  Camera,
  DollarSign,
  Phone,
  Shield,
  Bell,
  RefreshCw,
  CalendarCheck,
} from 'lucide-react';
import { supabaseDB } from '../../lib/supabaseDatabase';
import { useOffline } from '../../contexts/OfflineContext';

interface MenuItem {
  icon: React.ComponentType<any>;
  label: string;
  path: string;
  key: string;
  adminOnly?: boolean;
  showForAll?: boolean;
  regularOnly?: boolean;
}

const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const { isFinanceMode, mode: tableMode } = useTableMode();
  const navigate = useNavigate();
  const { pendingCount, attentionCount, isOnline } = useOffline();
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const unsynced = pendingCount + attentionCount;
  const handleLogout = () => {
    if (unsynced > 0 || !isOnline) setConfirmLogout(true);
    else logout();
  };
  const [activeRemindersCount, setActiveRemindersCount] = React.useState<number>(0);

  React.useEffect(() => {
    if (!user || isFinanceMode) {
      setActiveRemindersCount(0);
      return;
    }
    
    const fetchCount = async () => {
      const count = await supabaseDB.getActiveRemindersCount(
        tableMode as 'regular' | 'itr',
        user.id,
        user.is_admin
      );
      setActiveRemindersCount(count);
    };

    fetchCount();
    
    // Poll every 15 seconds
    const interval = setInterval(fetchCount, 15000);
    
    // Listen for custom event to refresh immediately
    const handleRefresh = () => {
      fetchCount();
    };
    window.addEventListener('refresh-reminders-count', handleRefresh);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('refresh-reminders-count', handleRefresh);
    };
  }, [user, tableMode, isFinanceMode]);

  // Debug: Log user features to help diagnose issues
  React.useEffect(() => {
    if (user) {
      console.log('🔍 Sidebar - Current user:', {
        username: user.username,
        is_admin: user.is_admin,
        features: user.features,
        featuresCount: user.features?.length || 0
      });
    }
  }, [user]);

  const menuItems: MenuItem[] = [
    { icon: Home, label: 'Dashboard', path: '/', key: 'dashboard' },
    { icon: Plus, label: 'New Entry', path: '/new-entry', key: 'new_entry' },
    { icon: Edit, label: 'Edit Entry', path: '/edit-entry', key: 'edit_entry' },
    {
      icon: FileText,
      label: 'Daily Report',
      path: '/daily-report',
      key: 'daily_report',
    },
    {
      icon: Book,
      label: 'Detailed Ledger',
      path: '/detailed-ledger',
      key: 'detailed_ledger',
    },
    {
      icon: BookOpen,
      label: 'Ledger Summary',
      path: '/ledger-summary',
      key: 'ledger_summary',
    },
    {
      icon: CheckCircle,
      label: 'Approve Records',
      path: '/approve-records',
      key: 'approve_records',
    },
    {
      icon: FileEdit,
      label: 'Edited Records',
      path: '/edited-records',
      key: 'edited_records',
    },
    {
      icon: Trash2,
      label: 'Deleted Records',
      path: '/deleted-records',
      key: 'deleted_records',
    },
    {
      icon: Replace,
      label: 'Replace Form',
      path: '/replace-form',
      key: 'replace_form',
    },
    { icon: Download, label: 'Export', path: '/export-excel', key: 'export' },
    {
      icon: Upload,
      label: 'CSV Upload',
      path: '/csv-upload',
      key: 'csv_upload',
    },
    {
      icon: Calculator,
      label: 'Balance Sheet',
      path: '/balance-sheet',
      key: 'balance_sheet',
    },
    { icon: Truck, label: 'Vehicles', path: '/vehicles', key: 'vehicles' },
    { icon: Bell, label: 'Reminders', path: '/reminders', key: 'reminders' },
    { icon: RefreshCw, label: 'Sync Center', path: '/sync-center', key: 'sync_center' },
    {
      icon: CreditCard,
      label: 'Bank Guarantees',
      path: '/bank-guarantees',
      key: 'bank_guarantees',
    },
    { icon: Users, label: 'Drivers', path: '/drivers', key: 'drivers' },
    // Admin only
    {
      icon: Users,
      label: 'User Management',
      path: '/user-management',
      key: 'users',
      adminOnly: true,
    },
    {
      icon: CalendarCheck,
      label: 'Attendance',
      path: '/attendance',
      key: 'attendance',
      adminOnly: true,
      regularOnly: true,
    },
    {
      icon: Book,
      label: 'Book Management',
      path: '/book-management',
      key: 'book_management',
    },
  ];

  const financeMenuItems: MenuItem[] = [
    { icon: Home, label: 'Finance Dashboard', path: '/finance', key: 'finance_dashboard' },
    { icon: Plus, label: 'Loan Entry', path: '/finance/loan-entry', key: 'loan_entry' },
    { icon: Edit, label: 'Edit Loan Entry', path: '/finance/edit-loan-entry', key: 'edit_loan_entry' },
    { icon: Users, label: 'Partners', path: '/finance/partners', key: 'partners' },
    { icon: Search, label: 'Aadhaar Search', path: '/finance/search', key: 'search' },
    { icon: Calculator, label: 'General Calculator', path: '/finance/calculator', key: 'calculator' },
    { icon: DollarSign, label: 'Capital Entry', path: '/finance/capital-entry', key: 'capital_entry' },
    { icon: Camera, label: 'Camera', path: '/finance/camera', key: 'camera' },
    { icon: BookOpen, label: 'Daybook', path: '/finance/daybook', key: 'daybook' },
    { icon: Book, label: 'Detailed Ledger', path: '/finance/detailed-ledger', key: 'detailed_ledger' },
    { icon: Book, label: 'General Ledger', path: '/finance/general-ledger', key: 'general_ledger' },
    { icon: Book, label: 'CD Ledger', path: '/finance/cd-ledger', key: 'cd_ledger' },
    { icon: Book, label: 'STBD Ledger', path: '/finance/stbd-ledger', key: 'stbd_ledger' },
    { icon: Book, label: 'HP Ledger', path: '/finance/hp-ledger', key: 'hp_ledger' },
    { icon: Book, label: 'TBD Ledger', path: '/finance/tbd-ledger', key: 'tbd_ledger' },
    { icon: Book, label: 'Dues Ledger', path: '/finance/dues-ledger', key: 'dues_ledger' },
    { icon: Phone, label: 'Payment Follow-up', path: '/finance/payment-followup', key: 'payment_followup' },
    { icon: FileText, label: 'P&L / Balance Sheet', path: '/finance/pl', key: 'pl' },
    { icon: FileText, label: 'Final Statement', path: '/finance/final-statement', key: 'final_statement' },
    { icon: FileText, label: 'Business Report', path: '/finance/business-report', key: 'business_report' },
    { icon: FileText, label: 'Partner Performance', path: '/finance/partner-performance', key: 'partner_performance' },
    { icon: FileText, label: 'New Customers', path: '/finance/new-customers', key: 'new_customers' },
    { icon: Phone, label: 'Phone Number Editor', path: '/finance/phone-editor', key: 'phone_editor' },
    { icon: FileEdit, label: 'Edited / Deleted Entry', path: '/finance/logs', key: 'logs' },
    {
      icon: Shield,
      label: 'User Access',
      path: '/finance/user-access-management',
      key: 'user_access_management',
      adminOnly: true,
    },
    { icon: RefreshCw, label: 'Sync Center', path: '/sync-center', key: 'sync_center' },
  ];

  const activeMenuItems = isFinanceMode ? financeMenuItems : menuItems;

  return (
    <aside className={`w-64 h-screen sticky top-0 left-0 z-30 shadow-xl rounded-r-2xl flex flex-col border-r ${
      isFinanceMode
        ? 'bg-gradient-to-b from-white via-green-50 to-green-100 border-green-100'
        : 'bg-gradient-to-b from-white via-blue-50 to-blue-100 border-blue-100'
    }`}>
      {/* Top: Logo/Brand and User Info */}
      <div className='flex flex-col gap-0'>
        {/* Logo/Brand */}
        <div className={`relative p-4 border-b shadow-sm flex flex-col items-center ${
          isFinanceMode
            ? 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50'
            : 'border-blue-200 bg-gradient-to-br from-orange-50 to-red-50'
        }`}>
          <button
            type="button"
            onClick={() => navigate('/mode-selection')}
            title="Back to Mode Selection"
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1 rounded text-gray-600 hover:text-gray-900 hover:bg-white/70 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-gray-900 finance-brand">
            Thirumala Group {isFinanceMode ? 'Finance' : ''}
          </h1>
        </div>
        {/* User Info */}
        <div className={`p-4 border-b flex items-center gap-3 ${
          isFinanceMode ? 'border-green-100 bg-green-50' : 'border-blue-100 bg-blue-50'
        }`}>
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow bg-gradient-to-br ${
            isFinanceMode ? 'from-green-500 to-emerald-600' : 'from-blue-500 to-purple-600'
          }`}>
            <span className="text-white finance-brand">
              {user?.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-gray-900 finance-section-heading">
              {user?.username}
            </p>
            <p className={`${isFinanceMode ? 'text-green-600' : 'text-blue-600'} finance-caption`}>
              {user?.is_admin ? 'Admin' : 'User'}
            </p>
          </div>
        </div>
      </div>
      {/* Scrollable Menu */}
      <nav className='flex-1 overflow-y-auto custom-scrollbar px-2 py-4'>
        <ul className='space-y-1'>
          {activeMenuItems
            .filter(item => {
              if (item.regularOnly && tableMode !== 'regular') {
                return false;
              }

              if (item.showForAll) {
                return true;
              }
              
              // Admin-only items: only show to admins
              if (item.adminOnly) {
                return user?.is_admin;
              }
              
              // For non-admin users, check if they have this feature
              if (!user?.is_admin) {
                const userFeatures = Array.isArray(user?.features) ? user.features : [];
                return userFeatures.includes(item.key);
              }
              
              return true;
            })
            .map(item => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative
                    ${
                      isActive
                        ? isFinanceMode
                          ? 'bg-green-100 text-green-700 font-bold border-l-4 border-green-600 shadow-sm'
                          : 'bg-blue-100 text-blue-700 font-bold border-l-4 border-blue-600 shadow-sm'
                        : isFinanceMode
                        ? 'text-gray-600 hover:bg-green-50 hover:text-green-800'
                        : 'text-gray-600 hover:bg-blue-50 hover:text-blue-800'
                    }
                    `
                  }
                >
                  <span className='w-5 h-5 flex items-center justify-center'>
                    <item.icon className='w-5 h-5 group-hover:scale-110 transition-transform' />
                  </span>
                  <span className='truncate flex items-center justify-between w-full'>
                    <span>{item.label}</span>
                    {item.key === 'reminders' && activeRemindersCount > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold leading-none bg-red-500 text-white shadow-sm">
                        {activeRemindersCount}
                      </span>
                    )}
                  </span>
                </NavLink>
              </li>
            ))}
        </ul>
      </nav>
      {/* Sticky Logout at Bottom */}
      <div className='p-4 bg-gradient-to-t from-blue-50 to-transparent border-t border-blue-100'>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors shadow-sm finance-section-heading"
        >
          <LogOut className='w-5 h-5' />
          Logout
        </button>
      </div>
      {confirmLogout && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]' role='alertdialog' aria-label='Log out'>
          <div className='bg-white rounded-xl shadow-2xl max-w-md w-full p-6'>
            <h2 className='text-xl font-bold text-gray-900'>Log out?</h2>
            {unsynced > 0 && (
              <p className='text-gray-700 mt-2'>
                <strong>{unsynced} {unsynced === 1 ? 'entry has' : 'entries have'} not reached the server.</strong>{' '}
                They stay safe on this computer and go when someone logs in here with internet. Do not clear this
                browser's data until then.
              </p>
            )}
            {!isOnline && (
              <p className='text-gray-700 mt-2'>You are offline, and logging in again needs internet.</p>
            )}
            <div className='flex justify-end gap-2 mt-5'>
              <button type='button' onClick={() => setConfirmLogout(false)} className='px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-semibold hover:bg-gray-300'>
                Stay Logged In
              </button>
              <button type='button' onClick={() => { setConfirmLogout(false); logout(); }} className='px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700'>
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
