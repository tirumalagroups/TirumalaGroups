import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabaseFinance } from '../../lib/supabaseFinance';
import {
  Home,
  PlusCircle,
  Edit,
  FileText,
  UserPlus,
  Users,
  BookOpen,
  DollarSign,
  Calculator,
  Search,
  Book,
  AlertCircle,
  TrendingUp,
  FileCheck,
  Briefcase,
  BarChart3,
  History,
  Shield,
  Settings,
  RefreshCw,
  Phone,
  PhoneCall,
} from 'lucide-react';

interface MenuItem {
  icon: React.ComponentType<any>;
  label: string;
  path: string;
  key: string;
  adminOnly?: boolean;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const FinanceSidebar: React.FC = () => {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!user?.is_admin) return;

    const fetchCount = async () => {
      try {
        const count = await supabaseFinance.getPendingApprovalsCount();
        setPendingCount(count);
      } catch (err) {
        console.error(err);
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 10000);
    return () => clearInterval(interval);
  }, [user]);

  const sections: MenuSection[] = [
    {
      title: 'Overview',
      items: [
        { icon: Home, label: 'Dashboard', path: '/finance', key: 'finance_dashboard' },
        { icon: RefreshCw, label: 'Sync Center', path: '/sync-center', key: 'sync_center' },
      ],
    },
    {
      title: 'Entries',
      items: [
        { icon: PlusCircle, label: 'New Loan', path: '/finance/loan-entry', key: 'loan_entry' },
        { icon: Edit, label: 'Edit Loan', path: '/finance/edit-loan-entry', key: 'edit_loan_entry' },
        { icon: Edit, label: 'Edit Entry', path: '/finance/edit-entry', key: 'finance_edit_entry' },
        { icon: UserPlus, label: 'New Customer', path: '/finance/new-customer', key: 'new_customers' },
        { icon: Users, label: 'Customers', path: '/finance/customers', key: 'new_customers' },
        { icon: UserPlus, label: 'New Partner', path: '/finance/new-partner', key: 'partners' },
        { icon: Users, label: 'Partners', path: '/finance/partners', key: 'partners' },
        { icon: BookOpen, label: 'Day Book Entry', path: '/finance/cash-book', key: 'daybook' },
        { icon: DollarSign, label: 'Capital Entry', path: '/finance/capital-entry', key: 'capital_entry' },
        { icon: Calculator, label: 'Calculator', path: '/finance/calculator', key: 'calculator' },
        { icon: Search, label: 'Aadhaar Search', path: '/finance/search', key: 'search' },
      ],
    },
    {
      title: 'Ledgers',
      items: [
        { icon: Book, label: 'CD Ledger', path: '/finance/cd-ledger', key: 'cd_ledger' },
        { icon: Book, label: 'HP Ledger', path: '/finance/hp-ledger', key: 'hp_ledger' },
        { icon: Book, label: 'STBD Ledger', path: '/finance/stbd-ledger', key: 'stbd_ledger' },
        { icon: Book, label: 'TBD Ledger', path: '/finance/tbd-ledger', key: 'tbd_ledger' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { icon: FileText, label: 'Daily Report', path: '/finance/daily-report', key: 'daily_report' },
        { icon: Book, label: 'Detailed Ledger', path: '/finance/detailed-ledger', key: 'detailed_ledger' },
        { icon: BookOpen, label: 'General Ledger', path: '/finance/general-ledger', key: 'general_ledger' },
        { icon: AlertCircle, label: 'Dues List', path: '/finance/dues-ledger', key: 'dues_ledger' },
        { icon: Phone, label: 'Payment Follow-up', path: '/finance/payment-followup', key: 'payment_followup' },
        { icon: PhoneCall, label: 'Call History', path: '/finance/call-history', key: 'payment_followup' },
        { icon: TrendingUp, label: 'P&L / Balance Sheet', path: '/finance/pl', key: 'pl' },
        { icon: FileCheck, label: 'Final Statement', path: '/finance/final-statement', key: 'final_statement' },
        { icon: Briefcase, label: 'Business Details', path: '/finance/business-report', key: 'business_report' },
        { icon: BarChart3, label: 'Partner Performance', path: '/finance/partner-performance', key: 'partner_performance' },
      ],
    },
    {
      title: 'Admin',
      items: [
        { icon: History, label: 'Edited / Deleted Entry', path: '/finance/logs', key: 'logs' },
        {
          icon: Shield,
          label: 'User Management',
          path: '/finance/user-access-management',
          key: 'user_access_management',
          adminOnly: true,
        },
        {
          icon: FileCheck,
          label: 'Approve Records',
          path: '/finance/transaction-approval',
          key: 'finance_approve_records',
        },
      ],
    },
    {
      title: 'Settings',
      items: [
        { icon: Settings, label: 'Ledger Settings', path: '/finance/ledger-settings', key: 'ledger_settings', adminOnly: true },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-150 flex flex-col select-none shrink-0 h-full overflow-y-auto custom-scrollbar font-outfit">
      <div className="flex-1 py-4 px-3 space-y-6">
        {sections.map((section, sIdx) => {
          // Filter items based on permissions
          const allowedItems = section.items.filter(item => {
            if (item.adminOnly) {
              return user?.is_admin;
            }
            if (!user?.is_admin) {
              const userFeatures = Array.isArray(user?.features) ? user.features : [];
              return userFeatures.includes(item.key);
            }
            return true;
          });

          if (allowedItems.length === 0) return null;

          return (
            <div key={sIdx} className="space-y-1.5">
              <h3 className="px-3 text-slate-400 tracking-[0.5px] mb-2 finance-small-label uppercase">
                {section.title}
              </h3>
              <ul className="space-y-0.5">
                {allowedItems.map((item, iIdx) => (
                  <li key={iIdx}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/finance'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all uppercase tracking-[0.16px]
                        ${
                          isActive
                            ? 'bg-[#0f172a] text-white shadow-sm'
                            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-3">
                            <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                            <span>{item.label}</span>
                          </div>
                          {item.label === 'Approve Records' && pendingCount > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shadow-sm animate-pulse min-w-[18px] text-center leading-none">
                              {pendingCount}
                            </span>
                          )}
                        </div>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </aside>
  );
};

export default FinanceSidebar;
