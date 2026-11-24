import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, differenceInDays, addDays, parseISO } from 'date-fns';
import Card from '../components/UI/Card';
import Select from '../components/UI/Select';
import Input from '../components/UI/Input';
import Button from '../components/UI/Button';
import { supabaseDB, Reminder } from '../lib/supabaseDatabase';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import { getTableName } from '../lib/tableNames';
import { useOffline } from '../contexts/OfflineContext';
import { useDashboardStats, useCompanyBalances, useDropdownData, useInvalidateDashboard } from '../hooks/useDashboardData';
import ModeLabel from '../components/UI/ModeLabel';
import toast from 'react-hot-toast';
import {
  isSoundEnabled,
  setSoundEnabled,
  getSoundVolume,
  setSoundVolume,
  playReminderSound,
} from '../utils/reminderSound';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  AlertTriangle,
  Building,
  Users,
  RefreshCw,
  Key,
  Copy,
  X,
  Shield,
  Eye,
  EyeOff,
  ExternalLink,
  Bell,
  Clock,
  CheckCircle,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { canShowReminderNotification, getReminderColorStatus, calculateNextOccurrence } from '../utils/reminderHelper';
import RemindersCalendar from '../components/UI/RemindersCalendar';
import { useBook } from '../contexts/BookContext';
import PasswordResetRequestsCard from '../components/auth/PasswordResetRequestsCard';


const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, changePassword } = useAuth();
  const { mode: tableMode, isITRMode } = useTableMode();
  const { currentBook } = useBook();
  const { isOnline, pendingCount, isSyncing, lastSyncAt, offlineSince, triggerSync } = useOffline();

  useEffect(() => {
    if (tableMode === 'finance') {
      navigate('/finance', { replace: true });
    }
  }, [tableMode, navigate]);

  const [selectedDate, setSelectedDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  );

  if (tableMode === 'finance') {
    return null;
  }
  const [userCredentials, setUserCredentials] = useState<any[]>([]);
  const [showCredentials, setShowCredentials] = useState(true);

  // Expiry states
  const [vehicleStats, setVehicleStats] = useState<{ expired: number; expiring: number } | null>(null);
  const [bgStats, setBgStats] = useState<{ expired: number; expiring: number } | null>(null);
  const [driverStats, setDriverStats] = useState<{ expired: number; expiring: number } | null>(null);

  // Today summary state
  const [todaySummary, setTodaySummary] = useState<{
    entries: number;
    credit: number;
    debit: number;
    pending: number;
  } | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);

  // Company Balances filtering & sorting
  const [companySearch, setCompanySearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'cr' | 'dr'>('all');
  const [sortField, setSortField] = useState<'name' | 'balance' | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Timestamp tracking
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Password change modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Reminders states
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderStats, setReminderStats] = useState<{
    pending: number;
    today: number;
    upcoming: number;
    overdue: number;
    completed: number;
  }>({ pending: 0, today: 0, upcoming: 0, overdue: 0, completed: 0 });
  const [activeReminders, setActiveReminders] = useState<Reminder[]>([]);
  const [showLoginAlert, setShowLoginAlert] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>('');
  const [selectedDateReminders, setSelectedDateReminders] = useState<Reminder[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  
  // Quick complete / snooze states
  const [completionReminder, setCompletionReminder] = useState<Reminder | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);

  // Sound settings state & sync
  const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled());
  const [soundVolume, setSoundVolumeState] = useState(getSoundVolume());
  const playedReminderIdsRef = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleSoundChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setSoundEnabledState(detail.enabled);
      }
    };
    const handleVolumeChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.volume === 'string') {
        setSoundVolumeState(detail.volume as 'soft' | 'normal' | 'loud');
      }
    };
    window.addEventListener('reminder-sound-changed', handleSoundChanged);
    window.addEventListener('reminder-sound-volume-changed', handleVolumeChanged);
    return () => {
      window.removeEventListener('reminder-sound-changed', handleSoundChanged);
      window.removeEventListener('reminder-sound-volume-changed', handleVolumeChanged);
    };
  }, []);

  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabledState(nextVal);
    setSoundEnabled(nextVal);
  };

  const handleVolumeChange = (vol: 'soft' | 'normal' | 'loud') => {
    setSoundVolumeState(vol);
    setSoundVolume(vol);
    // Play a preview sound when changing volume
    setTimeout(() => {
      playReminderSound();
    }, 50);
  };

  // Trigger sound when active reminders load or update
  useEffect(() => {
    if (activeReminders.length === 0) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    let playSound = false;
    activeReminders.forEach((r) => {
      // Only play sound when:
      // 1. Reminder is due (event_date <= today)
      // 2. Reminder has sound enabled (play_sound !== false)
      // 3. Global sound is enabled (handled inside playReminderSound())
      // 4. Reminder has not been marked as Seen or Completed
      const isDue = r.event_date <= todayStr;
      const hasSoundEnabled = r.play_sound !== false;
      const isUnseen = !r.seen;
      const isPending = r.status === 'pending';

      if (isDue && hasSoundEnabled && isUnseen && isPending && !playedReminderIdsRef.current.has(r.id)) {
        playedReminderIdsRef.current.add(r.id);
        playSound = true;
      } else if (!playedReminderIdsRef.current.has(r.id)) {
        // Track non-playing reminders too to avoid future re-plays
        playedReminderIdsRef.current.add(r.id);
      }
    });

    if (playSound) {
      playReminderSound();
    }
  }, [activeReminders]);

  // React Query hooks for data fetching
  const { data: stats, isLoading: statsLoading, isFetching: statsFetching } = useDashboardStats(selectedDate);
  const { data: companyBalances, isLoading: companyLoading, isFetching: companyFetching } = useCompanyBalances();

  // Process company balances for search, filter (All / CR / DR), and sorting
  const processedCompanyBalances = React.useMemo(() => {
    if (!companyBalances) return [];

    let result = [...companyBalances];

    // 1. Search filter
    if (companySearch) {
      const searchLower = companySearch.toLowerCase().trim();
      result = result.filter(c => c.companyName.toLowerCase().includes(searchLower));
    }

    // 2. CR / DR filter
    if (balanceFilter === 'cr') {
      result = result.filter(c => c.closingBalance >= 0);
    } else if (balanceFilter === 'dr') {
      result = result.filter(c => c.closingBalance < 0);
    }

    // 3. Sorting
    if (sortField === 'name') {
      result.sort((a, b) => {
        const comp = a.companyName.localeCompare(b.companyName);
        return sortAsc ? comp : -comp;
      });
    } else if (sortField === 'balance') {
      result.sort((a, b) => {
        return sortAsc ? a.closingBalance - b.closingBalance : b.closingBalance - a.closingBalance;
      });
    }

    return result;
  }, [companyBalances, companySearch, balanceFilter, sortField, sortAsc]);
  const { companies, pendingApprovals, uniqueSubAccountsCount, distinctMainAccountsCount, distinctCompaniesCount, activeOperatorCount, isLoading: dropdownLoading } = useDropdownData();
  const { invalidateAll } = useInvalidateDashboard();

  // Combined loading states
  const loading = statsLoading || companyLoading || dropdownLoading;
  const autoUpdating = statsFetching || companyFetching;

  // Helper to format currency in Indian style
  const formatIndianNumber = (num: number | undefined | null) => {
    if (num === undefined || num === null || isNaN(num)) return '0';
    return num.toLocaleString('en-IN');
  };

  const fetchTodaySummary = async () => {
    setTodayLoading(true);
    try {
      const todayDateStr = format(new Date(), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from(getTableName('cash_book'))
        .select('credit, debit, approved')
        .eq('c_date', todayDateStr);

      if (error) throw error;

      if (data) {
        const entries = data.length;
        const credit = data.reduce((sum, entry) => sum + (parseFloat(entry.credit) || 0), 0);
        const debit = data.reduce((sum, entry) => sum + (parseFloat(entry.debit) || 0), 0);
        const pending = data.filter(entry => !entry.approved).length;

        setTodaySummary({ entries, credit, debit, pending });
      }
    } catch (error) {
      console.error('Error fetching today summary:', error);
    } finally {
      setTodayLoading(false);
    }
  };

  const checkExpiries = async () => {
    try {
      const today = new Date();
      
      // Check Vehicles
      const vehiclesData = await supabaseDB.getVehicles();
      let expiredVCount = 0;
      let expiringVCount = 0;
      vehiclesData.forEach(vehicle => {
        const dates = [
          vehicle.tax_exp_date,
          vehicle.insurance_exp_date,
          vehicle.fitness_exp_date,
          vehicle.permit_exp_date,
        ];
        
        let hasExpired = false;
        let hasExpiring = false;
        
        dates.forEach(dStr => {
          if (dStr) {
            const expiry = new Date(dStr);
            const diffDays = differenceInDays(expiry, today);
            if (diffDays < 0) {
              hasExpired = true;
            } else if (diffDays <= 30) {
              hasExpiring = true;
            }
          }
        });
        
        if (hasExpired) {
          expiredVCount++;
        } else if (hasExpiring) {
          expiringVCount++;
        }
      });
      
      setVehicleStats(expiredVCount > 0 || expiringVCount > 0 ? { expired: expiredVCount, expiring: expiringVCount } : null);
      
      // Check Bank Guarantees
      const bgData = await supabaseDB.getBankGuarantees();
      let expiredBGCount = 0;
      let expiringBGCount = 0;
      bgData.forEach(bg => {
        if (!bg.cancelled && bg.exp_date) {
          const expiry = new Date(bg.exp_date);
          const diffDays = differenceInDays(expiry, today);
          if (diffDays < 0) {
            expiredBGCount++;
          } else if (diffDays <= 30) {
            expiringBGCount++;
          }
        }
      });
      
      setBgStats(expiredBGCount > 0 || expiringBGCount > 0 ? { expired: expiredBGCount, expiring: expiringBGCount } : null);

      // Check Drivers
      const driversData = await supabaseDB.getDrivers();
      let expiredDCount = 0;
      let expiringDCount = 0;
      driversData.forEach(driver => {
        if (driver.exp_date) {
          const expiry = new Date(driver.exp_date);
          const diffDays = differenceInDays(expiry, today);
          if (diffDays < 0) {
            expiredDCount++;
          } else if (diffDays <= 30) {
            expiringDCount++;
          }
        }
      });
      
      setDriverStats(expiredDCount > 0 || expiringDCount > 0 ? { expired: expiredDCount, expiring: expiringDCount } : null);
    } catch (error) {
      console.error('Error checking expiries on dashboard:', error);
    }
  };

  const fetchRemindersData = async () => {
    if (!user?.id) return;
    const mode = tableMode === 'itr' ? 'itr' : 'regular';
    try {
      const allReminders = await supabaseDB.getReminders(mode, user.id, !!user.is_admin);
      setReminders(allReminders);
      
      const statsData = await supabaseDB.getReminderStats(mode, user.id, !!user.is_admin);
      setReminderStats(statsData);

      // Filter active reminders
      const todayDate = new Date();
      const active = allReminders.filter(r => canShowReminderNotification(r, todayDate));
      
      // Sort active reminders:
      // Priority: Overdue > Today > Tomorrow > Upcoming
      const getReminderGroupWeight = (r: Reminder, today: Date) => {
        const color = getReminderColorStatus(r, today);
        if (color === 'dark-red') return 4; // Overdue
        if (color === 'red') return 3;      // Today
        if (color === 'orange') return 2;   // Tomorrow
        return 1;                           // Upcoming (yellow/blue)
      };

      const priorityWeights = { critical: 4, high: 3, medium: 2, low: 1 };

      const sortedActive = [...active].sort((a, b) => {
        const todayDate = new Date();
        const weightA = getReminderGroupWeight(a, todayDate);
        const weightB = getReminderGroupWeight(b, todayDate);
        
        if (weightA !== weightB) {
          return weightB - weightA;
        }
        
        const prioA = priorityWeights[a.priority] || 0;
        const prioB = priorityWeights[b.priority] || 0;
        return prioB - prioA;
      });

      setActiveReminders(sortedActive);

      // Check for login alert modal (show once per day if there are active notifications)
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const hideUntil = localStorage.getItem('reminders_hide_until');
      if (active.length > 0 && hideUntil !== todayStr) {
        setShowLoginAlert(true);
      }
    } catch (error) {
      console.error('Error fetching reminders for dashboard:', error);
    }
  };

  const handleSnooze = async (reminder: Reminder, days: number) => {
    try {
      const snoozeDate = format(addDays(new Date(), days), 'yyyy-MM-dd');
      const updated = await supabaseDB.updateReminder(reminder.id, {
        snoozed_until: snoozeDate,
      });
      if (updated) {
        toast.success(`Reminder snoozed for ${days} day${days > 1 ? 's' : ''}`);
        fetchRemindersData();
        window.dispatchEvent(new Event('refresh-reminders-count'));
      } else {
        toast.error('Failed to snooze reminder');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error snoozing reminder');
    }
  };

  const handleMarkSeen = async (reminder: Reminder) => {
    try {
      const updated = await supabaseDB.updateReminder(reminder.id, {
        seen: true,
      });
      if (updated) {
        toast.success('Reminder marked as seen');
        // Remove from played set so it doesn't linger
        playedReminderIdsRef.current.delete(reminder.id);
        fetchRemindersData();
        window.dispatchEvent(new Event('refresh-reminders-count'));
      } else {
        toast.error('Failed to mark reminder as seen');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error marking reminder as seen');
    }
  };

  const handleCompleteSubmit = async () => {
    if (!completionReminder || !user) return;
    setIsCompleting(true);
    const notes = completionNotes.trim() || null;
    const completedAt = new Date().toISOString();

    try {
      const result = await supabaseDB.updateReminder(completionReminder.id, {
        status: 'completed',
        completion_notes: notes,
        completed_at: completedAt,
      });

      if (result) {
        toast.success('Reminder completed successfully');

        // Handle recurring reminder replication
        if (completionReminder.reminder_type === 'recurring' && completionReminder.recurring_interval) {
          const nextDate = calculateNextOccurrence(completionReminder.event_date, completionReminder.recurring_interval);
          
          const nextReminder = {
            title: completionReminder.title,
            description: completionReminder.description,
            event_date: nextDate,
            event_time: completionReminder.event_time,
            priority: completionReminder.priority,
            reminder_type: 'recurring' as const,
            recurring_interval: completionReminder.recurring_interval,
            notify_before_days: completionReminder.notify_before_days,
            assigned_user_id: completionReminder.assigned_user_id,
            status: 'pending' as const,
            mode: completionReminder.mode,
            category: completionReminder.category,
            is_system_generated: completionReminder.is_system_generated,
            created_by: completionReminder.created_by,
            completion_notes: null,
            completed_at: null,
            snoozed_until: null,
            deleted_at: null,
            book_id: completionReminder.book_id,
            play_sound: completionReminder.play_sound ?? true
          };

          const replicated = await supabaseDB.createReminder(nextReminder);
          if (replicated) {
            toast.success(`Scheduled next occurrence for: ${format(parseISO(nextDate), 'dd-MM-yyyy')}`);
          }
        }

        fetchRemindersData();
        window.dispatchEvent(new Event('refresh-reminders-count'));
        setCompletionReminder(null);
        setCompletionNotes('');
      } else {
        toast.error('Failed to complete reminder');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error completing reminder');
    } finally {
      setIsCompleting(false);
    }
  };

  // Run initial checks on mount and mode/selected date/active book change
  useEffect(() => {
    fetchTodaySummary();
    checkExpiries();
    fetchRemindersData();
  }, [tableMode, selectedDate, currentBook?.id]);

  // Sync lastUpdated time when fetches complete
  useEffect(() => {
    if (!loading && !autoUpdating) {
      setLastUpdated(format(new Date(), 'hh:mm:ss a'));
    }
  }, [loading, autoUpdating]);

  // Listen for storage events to refresh when new entries are created
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dashboard-refresh' && e.newValue) {
        invalidateAll();
        fetchTodaySummary();
        checkExpiries();
        fetchRemindersData();
        // Clear the trigger
        localStorage.removeItem('dashboard-refresh');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only set up listener once

  // Also check for refresh trigger on component mount
  useEffect(() => {
    const refreshTrigger = localStorage.getItem('dashboard-refresh');
    if (refreshTrigger) {
      invalidateAll();
      fetchTodaySummary();
      checkExpiries();
      fetchRemindersData();
      localStorage.removeItem('dashboard-refresh');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only check on mount

  // Load credentials on mount - from database first, then localStorage as fallback
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        // Try to fetch from database first
        // This will silently return empty array if table doesn't exist (404 errors handled in supabaseDatabase)
        const dbCredentials = await supabaseDB.getRecentUserCredentials(10);
        if (dbCredentials && dbCredentials.length > 0) {
          setUserCredentials(dbCredentials.reverse()); // Show newest first
          // Also sync to localStorage for offline access
          localStorage.setItem('user_credentials', JSON.stringify(dbCredentials));
          return;
        }
      } catch (error: any) {
        // Silently handle errors (table might not exist - that's okay)
        // Only log if it's not a table not found error
        const isTableNotFound =
          error?.code === '42P01' ||
          error?.message?.includes('does not exist') ||
          error?.message?.includes('not found') ||
          error?.status === 404;

        if (!isTableNotFound) {
          console.log('Could not load credentials from database, using localStorage:', error);
        }
      }

      // Fallback to localStorage if database fetch fails or returns empty
      localStorage.removeItem('user_credentials'); // passwords are no longer kept
      const credentials: any[] = [];
      setUserCredentials(credentials.reverse()); // Show newest first
    };

    loadCredentials();
  }, []); // Only run on mount

  // Listen for table mode changes and refresh all data
  useEffect(() => {
    console.log('🔄 Table mode changed to:', tableMode, isITRMode ? 'ITR' : 'Regular');
    invalidateAll();
  }, [tableMode, invalidateAll]);

  // Listen for custom events to refresh dashboard
  useEffect(() => {
    const handleDashboardRefresh = async () => {
      invalidateAll();
      fetchTodaySummary();
      checkExpiries();
      fetchRemindersData();
      // Also reload credentials when dashboard refreshes - from database first
      // This will silently return empty array if table doesn't exist (404 errors handled in supabaseDatabase)
      try {
        const dbCredentials = await supabaseDB.getRecentUserCredentials(10);
        if (dbCredentials && dbCredentials.length > 0) {
          setUserCredentials(dbCredentials.reverse()); // Show newest first
          // Also sync to localStorage
          localStorage.setItem('user_credentials', JSON.stringify(dbCredentials));
          return;
        }
      } catch (error: any) {
        // Silently handle errors (table might not exist - that's okay)
        // Only log if it's not a table not found error
        const isTableNotFound =
          error?.code === '42P01' ||
          error?.message?.includes('does not exist') ||
          error?.message?.includes('not found') ||
          error?.status === 404;

        if (!isTableNotFound) {
          console.log('Could not load credentials from database, using localStorage:', error);
        }
      }

      // Fallback to localStorage
      localStorage.removeItem('user_credentials'); // passwords are no longer kept
      const credentials: any[] = [];
      setUserCredentials(credentials.reverse()); // Show newest first
    };

    window.addEventListener('dashboard-refresh', handleDashboardRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleDashboardRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - event listener doesn't need dependencies

  // Copy credentials to clipboard
  const copyCredentials = (username: string, password: string) => {
    const text = `Username: ${username}\nPassword: ${password}`;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Credentials copied to clipboard!');
    }).catch(() => {
      toast.error('Failed to copy credentials');
    });
  };

  // Remove credentials from display
  const removeCredentials = (index: number) => {
    const updated = [...userCredentials];
    updated.splice(index, 1);
    setUserCredentials(updated);
    localStorage.setItem('user_credentials', JSON.stringify(updated.reverse()));
  };

  // Feature names mapping
  const featureNames: { [key: string]: string } = {
    dashboard: 'Dashboard',
    new_entry: 'New Entry',
    edit_entry: 'Edit Entry',
    daily_report: 'Daily Report',
    detailed_ledger: 'Detailed Ledger',
    ledger_summary: 'Ledger Summary',
    approve_records: 'Approve Records',
    edited_records: 'Edited Records',
    deleted_records: 'Deleted Records',
    replace_form: 'Replace Form',
    export: 'Export',
    csv_upload: 'CSV Upload',
    balance_sheet: 'Balance Sheet',
    vehicles: 'Vehicles',
    bank_guarantees: 'Bank Guarantees',
    drivers: 'Drivers',
  };

  // Set up Supabase real-time subscription for automatic updates
  useEffect(() => {
    console.log('🔄 Setting up Supabase real-time subscription for dashboard...');

    let isMounted = true;

    const subscription = supabase
      .channel('cash_book_changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'cash_book'
        },
        (payload) => {
          if (!isMounted) return;
          console.log('📊 Database change detected:', payload.eventType, payload.new || payload.old);
          // Show a subtle notification that dashboard is updating
          toast.success('Dashboard updated automatically', {
            duration: 2000,
            position: 'top-right',
            style: {
              background: '#10B981',
              color: 'white',
            },
          });
          // Invalidate React Query cache to trigger refetch
          invalidateAll();
          fetchTodaySummary();
          checkExpiries();
          fetchRemindersData();
        }
      )
      .subscribe();

    const remindersSubscription = supabase
      .channel('reminders_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reminders'
        },
        (payload) => {
          if (!isMounted) return;
          console.log('📊 Reminders change detected:', payload.eventType, payload.new || payload.old);
          fetchRemindersData();
          window.dispatchEvent(new Event('refresh-reminders-count'));
        }
      )
      .subscribe();

    return () => {
      console.log('🔄 Cleaning up Supabase real-time subscription...');
      isMounted = false;
      subscription.unsubscribe();
      remindersSubscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - only run once on mount

  // Manual refresh function
  const handleManualRefresh = () => {
    invalidateAll();
    fetchTodaySummary();
    checkExpiries();
    fetchRemindersData();
    toast.success('Dashboard refreshed!', {
      duration: 2000,
      position: 'top-right',
    });
  };

  // Handle password change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('All fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (newPassword.length < 4) {
      toast.error('New password must be at least 4 characters');
      return;
    }

    setChangingPassword(true);
    const result = await changePassword(currentPassword, newPassword);

    if (result.success) {
      toast.success('Password changed successfully!');
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      toast.error(result.error || 'Failed to change password');
    }

    setChangingPassword(false);
  };



  const dateOptions = [
    { value: format(new Date(), 'yyyy-MM-dd'), label: 'Today' },
    {
      value: format(new Date(Date.now() - 86400000), 'yyyy-MM-dd'),
      label: 'Yesterday',
    },
    {
      value: format(new Date(Date.now() - 2 * 86400000), 'yyyy-MM-dd'),
      label: '2 Days Ago',
    },
    {
      value: format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd'),
      label: 'Last Week',
    },
  ];

  return (
    <div className='min-h-screen flex flex-col space-y-6'>
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-center gap-3 no-print">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-xs text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      {/* Forgot-password requests waiting for an admin */}
      <PasswordResetRequestsCard />

      {/* Welcome Header */}
      <div className='flex items-center justify-between'>
        <div>
          <div className='flex items-center gap-3 mb-1'>
            <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2.5'>
              Welcome back, {user?.username}!
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                currentBook?.is_locked 
                  ? 'bg-red-100 text-red-700' 
                  : tableMode === 'itr' 
                    ? 'bg-emerald-100 text-emerald-700' 
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {tableMode === 'itr' ? 'ITR Mode' : 'Regular Mode'} | {currentBook?.book_code || 'No Book'}
              </span>
            </h1>
            <ModeLabel />
          </div>
          <p className='text-gray-600'>
            Here's your business overview for today.
            {companyBalances && companyBalances.length > 0 && (
              <span className='ml-2 text-blue-600 font-medium'>
                ({companyBalances.length} companies tracked)
              </span>
            )}
          </p>
        </div>

        <div className='flex items-center gap-4'>
          {lastUpdated && (
            <div className='flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg text-xs text-gray-500 no-print'>
              <span className='relative flex h-2 w-2'>
                <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75'></span>
                <span className='relative inline-flex rounded-full h-2 w-2 bg-green-500'></span>
              </span>
              <span>Last updated: {lastUpdated}</span>
            </div>
          )}
          {autoUpdating && !loading && (
            <div className='flex items-center gap-2 text-sm text-green-600'>
              <div className='w-2 h-2 bg-green-600 rounded-full animate-pulse'></div>
              Auto-updating all 67k+ transactions...
            </div>
          )}
          {loading && (
            <div className='flex items-center gap-2 text-sm text-blue-600'>
              <div className='w-2 h-2 bg-blue-600 rounded-full animate-pulse'></div>
              Processing all transactions...
            </div>
          )}
          <button
            onClick={handleManualRefresh}
            disabled={loading || autoUpdating}
            className='flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            <RefreshCw className={`w-4 h-4 ${(loading || autoUpdating) ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing...' : autoUpdating ? 'Auto-updating...' : 'Refresh'}
          </button>
          <Select
            value={selectedDate}
            onChange={setSelectedDate}
            options={dateOptions}
            className='w-40'
          />
        </div>
      </div>

      {/* Synchronization Warning Banner */}
      {pendingCount > 0 && (
        <div 
          onClick={() => navigate('/sync-center')}
          className="flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-300 transition-all rounded-xl cursor-pointer shadow-sm text-sm no-print font-outfit mb-3"
        >
          <div className="flex items-center gap-2 text-amber-800 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{pendingCount} {pendingCount === 1 ? 'Record' : 'Records'} Awaiting Synchronization</span>
          </div>
          <span className="text-xs text-amber-600 font-semibold hover:underline">
            Open Sync Center →
          </span>
        </div>
      )}

      {/* Persistent Expiry Notifications Box */}
      {(vehicleStats || bgStats || driverStats) && (
        <div className='flex flex-wrap gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex-shrink-0 no-print'>
          {vehicleStats && (
            <div 
              onClick={() => navigate('/vehicles?highlightExpiring=true')}
              className='bg-white border border-gray-200 hover:border-gray-300 transition-all rounded px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer shadow-sm text-xs'
            >
              <span className='font-bold text-gray-700'>Vehicle Expiry:</span>
              {vehicleStats.expired > 0 && (
                <span className='text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded'>
                  {vehicleStats.expired} expired
                </span>
              )}
              {vehicleStats.expiring > 0 && (
                <span className='text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded'>
                  {vehicleStats.expiring} expiring soon
                </span>
              )}
              <ExternalLink className='w-3.5 h-3.5 text-gray-400 ml-0.5' />
            </div>
          )}
          {bgStats && (
            <div 
              onClick={() => navigate('/bank-guarantees?highlightExpiring=true')}
              className='bg-white border border-gray-200 hover:border-gray-300 transition-all rounded px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer shadow-sm text-xs'
            >
              <span className='font-bold text-gray-700'>Bank Guarantee Expiry:</span>
              {bgStats.expired > 0 && (
                <span className='text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded'>
                  {bgStats.expired} expired
                </span>
              )}
              {bgStats.expiring > 0 && (
                <span className='text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded'>
                  {bgStats.expiring} expiring soon
                </span>
              )}
              <ExternalLink className='w-3.5 h-3.5 text-gray-400 ml-0.5' />
            </div>
          )}
          {driverStats && (
            <div 
              onClick={() => navigate('/drivers?highlightExpiring=true')}
              className='bg-white border border-gray-200 hover:border-gray-300 transition-all rounded px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer shadow-sm text-xs'
            >
              <span className='font-bold text-gray-700'>Driver Expiry:</span>
              {driverStats.expired > 0 && (
                <span className='text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded'>
                  {driverStats.expired} expired
                </span>
              )}
              {driverStats.expiring > 0 && (
                <span className='text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded'>
                  {driverStats.expiring} expiring soon
                </span>
              )}
              <ExternalLink className='w-3.5 h-3.5 text-gray-400 ml-0.5' />
            </div>
          )}
        </div>
      )}

      {/* Persistent Reminders Notifications Box */}
      {activeReminders.length > 0 && (
        <div className='flex flex-col gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex-shrink-0 no-print'>
          <div className='flex items-center gap-2 text-xs font-bold text-gray-700 border-b border-gray-200 pb-1.5 mb-1'>
            <Bell className='w-4 h-4 text-blue-600 animate-swing animate-pulse' />
            <span>Active Reminders ({activeReminders.length})</span>
          </div>
          <div className='flex flex-wrap gap-2'>
            {activeReminders.map((r) => {
              const colorStatus = getReminderColorStatus(r);
              let colorClass = 'bg-blue-50 text-blue-800 border-blue-200';
              let label = 'Upcoming';
              
              if (colorStatus === 'dark-red') {
                colorClass = 'bg-red-100 text-red-900 border-red-300';
                label = 'Overdue';
              } else if (colorStatus === 'red') {
                colorClass = 'bg-red-50 text-red-800 border-red-200';
                label = 'Today';
              } else if (colorStatus === 'orange') {
                colorClass = 'bg-orange-50 text-orange-800 border-orange-200';
                label = 'Tomorrow';
              } else if (colorStatus === 'yellow') {
                colorClass = 'bg-yellow-50 text-yellow-800 border-yellow-200';
                label = 'Soon';
              }

            return (
                <div 
                  key={r.id}
                  onClick={() => navigate(`/reminders?highlightReminder=${r.id}`)}
                  className={`border transition-all rounded px-2.5 py-1.5 flex items-center justify-between gap-3 shadow-sm text-xs cursor-pointer ${
                    (colorStatus === 'dark-red' || colorStatus === 'red')
                      ? 'bg-orange-100 text-orange-950 border-orange-300 hover:border-orange-400'
                      : colorClass
                  }`}
                >
                  <div className='flex items-center gap-2'>
                    <span className='font-bold uppercase tracking-wider text-[9px] bg-white/80 px-1 py-0.5 rounded shadow-sm border border-black/5'>{label}</span>
                    <span className='font-bold'>{r.title}</span>
                    <span className='text-gray-500 font-semibold'>({format(parseISO(r.event_date), 'dd-MM')})</span>
                    {r.is_system_generated && (
                      <span className='inline-flex items-center text-[8px] bg-indigo-100 text-indigo-800 px-1 rounded font-bold uppercase tracking-tight'>System</span>
                    )}
                  </div>
                  <div className='flex items-center gap-1.5' onClick={(e) => e.stopPropagation()}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setCompletionReminder(r); }}
                      className='text-[10px] font-bold bg-white text-green-700 hover:bg-green-50 px-2 py-0.5 rounded border border-green-200 transition-colors flex items-center gap-0.5 shadow-sm'
                    >
                      <CheckCircle className='w-3 h-3' /> Complete
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleMarkSeen(r); }}
                      className='text-[10px] font-bold bg-white text-indigo-700 hover:bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 transition-colors flex items-center gap-0.5 shadow-sm'
                      title='Mark as seen (mute alerts)'
                    >
                      <Eye className='w-3 h-3' /> Seen
                    </button>
                    {/* Snooze Dropdown */}
                    <div className='relative group'>
                      <button className='text-[10px] font-bold bg-white text-slate-700 hover:bg-slate-50 px-2 py-0.5 rounded border border-slate-200 transition-colors flex items-center gap-0.5 shadow-sm'>
                        <Clock className='w-3 h-3' /> Snooze
                      </button>
                      <div className='absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded shadow-lg hidden group-hover:block z-30 py-1 min-w-[70px]'>
                        <button onClick={() => handleSnooze(r, 1)} className='w-full text-left px-2 py-1 text-[10px] hover:bg-slate-50 text-slate-700 font-semibold'>1 Day</button>
                        <button onClick={() => handleSnooze(r, 3)} className='w-full text-left px-2 py-1 text-[10px] hover:bg-slate-50 text-slate-700 font-semibold'>3 Days</button>
                        <button onClick={() => handleSnooze(r, 7)} className='w-full text-left px-2 py-1 text-[10px] hover:bg-slate-50 text-slate-700 font-semibold'>7 Days</button>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/reminders?highlightReminder=${r.id}`); }}
                      className='text-slate-400 hover:text-slate-600 p-0.5'
                      title='View details'
                    >
                      <ExternalLink className='w-3 h-3' />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3'>
        <Card 
          onClick={() => navigate('/detailed-ledger')}
          className='bg-gradient-to-br from-green-50 to-emerald-50 text-green-950 p-3 border border-green-200 cursor-pointer hover:shadow-md transition-shadow duration-200'
        >
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-green-700 text-xs font-semibold uppercase tracking-wider'>Total Credit</p>
              <p className='text-lg font-bold mt-1 text-green-900'>
                {statsLoading ? (
                  <span className='text-gray-400 animate-pulse'>Loading...</span>
                ) : stats?.totalCredit !== undefined ? (
                  `${formatIndianNumber(stats.totalCredit)} CR`
                ) : (
                  <span className='text-red-500'>Error loading</span>
                )}
              </p>
            </div>
            <TrendingUp className='w-5 h-5 text-green-600 shrink-0' />
          </div>
        </Card>

        <Card 
          onClick={() => navigate('/detailed-ledger')}
          className='bg-gradient-to-br from-red-50 to-rose-50 text-red-950 p-3 border border-red-200 cursor-pointer hover:shadow-md transition-shadow duration-200'
        >
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-red-700 text-xs font-semibold uppercase tracking-wider'>Total Debit</p>
              <p className='text-lg font-bold mt-1 text-red-900'>
                {statsLoading ? (
                  <span className='text-gray-400 animate-pulse'>Loading...</span>
                ) : stats?.totalDebit !== undefined ? (
                  `${formatIndianNumber(stats.totalDebit)} DR`
                ) : (
                  <span className='text-red-500'>Error loading</span>
                )}
              </p>
            </div>
            <TrendingDown className='w-5 h-5 text-red-600 shrink-0' />
          </div>
        </Card>

        <Card 
          onClick={() => navigate('/detailed-ledger')}
          className='bg-gradient-to-br from-blue-50 to-sky-50 text-blue-950 p-3 border border-blue-200 cursor-pointer hover:shadow-md transition-shadow duration-200'
        >
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-blue-700 text-xs font-semibold uppercase tracking-wider'>Net Balance</p>
              <p className='text-lg font-bold mt-1 text-blue-900'>
                {statsLoading ? (
                  <span className='text-gray-400 animate-pulse'>Loading...</span>
                ) : stats?.balance !== undefined ? (
                  stats.balance >= 0 
                    ? `${formatIndianNumber(stats.balance)} CR`
                    : `${formatIndianNumber(Math.abs(stats.balance))} DR`
                ) : (
                  <span className='text-red-500'>Error loading</span>
                )}
              </p>
            </div>
            <DollarSign className='w-5 h-5 text-blue-600 shrink-0' />
          </div>
        </Card>

        <Card 
          onClick={() => navigate('/detailed-ledger')}
          className='bg-gradient-to-br from-purple-50 to-indigo-50 text-purple-950 p-3 border border-purple-200 cursor-pointer hover:shadow-md transition-shadow duration-200'
        >
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-purple-700 text-xs font-semibold uppercase tracking-wider'>Transactions</p>
              <p className='text-lg font-bold mt-1 text-purple-900'>
                {statsLoading ? (
                  <span className='text-gray-400 animate-pulse'>Loading...</span>
                ) : stats?.totalTransactions !== undefined ? (
                  formatIndianNumber(stats.totalTransactions)
                ) : (
                  <span className='text-red-500'>Error loading</span>
                )}
              </p>
            </div>
            <FileText className='w-5 h-5 text-purple-600 shrink-0' />
          </div>
        </Card>

        <Card 
          onClick={() => navigate('/approve-records')}
          className='bg-gradient-to-br from-orange-50 to-amber-50 text-orange-950 p-3 border border-orange-200 cursor-pointer hover:shadow-md transition-shadow duration-200'
        >
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-orange-700 text-xs font-semibold uppercase tracking-wider'>Pending</p>
              <p className='text-lg font-bold mt-1 text-orange-900'>
                {pendingApprovals?.data !== undefined ? (
                  formatIndianNumber(pendingApprovals.data)
                ) : (
                  '0'
                )}
              </p>
            </div>
            <AlertTriangle className='w-5 h-5 text-orange-600 shrink-0' />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Today's Summary Card */}
        <Card
          title="Today's Summary"
          subtitle={`Real-time overview for today (${format(new Date(), 'dd/MM/yyyy')})`}
          className="bg-gradient-to-br from-slate-50 to-zinc-50 border-slate-200 h-full"
        >
          {todayLoading ? (
            <div className='text-center py-4 text-gray-500'>
              <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-slate-600 mx-auto'></div>
              <p className='mt-2 text-xs'>Loading today's summary...</p>
            </div>
          ) : todaySummary ? (
            <div className='grid grid-cols-2 gap-3'>
              <div className='bg-white p-3 rounded-lg border border-slate-200 shadow-sm'>
                <div className='text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1'>Today's Entries</div>
                <div className='text-sm font-bold text-slate-800'>{todaySummary.entries}</div>
              </div>
              <div className='bg-white p-3 rounded-lg border border-slate-200 shadow-sm'>
                <div className='text-[10px] font-semibold text-orange-600 uppercase tracking-wider mb-1'>Today's Pending</div>
                <div className='text-sm font-bold text-orange-700'>{todaySummary.pending}</div>
              </div>
              <div className='bg-white p-3 rounded-lg border border-slate-200 shadow-sm col-span-2'>
                <div className='flex justify-between items-center'>
                  <div>
                    <div className='text-[10px] font-semibold text-green-600 uppercase tracking-wider mb-0.5'>Today's Credit</div>
                    <div className='text-sm font-bold text-green-700'>{formatIndianNumber(todaySummary.credit)} CR</div>
                  </div>
                  <div>
                    <div className='text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-0.5'>Today's Debit</div>
                    <div className='text-sm font-bold text-red-700'>{formatIndianNumber(todaySummary.debit)} DR</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className='text-center py-4 text-gray-500 text-xs'>No statistics recorded today.</div>
          )}
        </Card>

        {/* Offline Queue Card */}
        <Card
          title="Offline Queue"
          subtitle="Local synchronization stats & actions"
          className="bg-gradient-to-br from-slate-50 to-zinc-50 border-slate-200 h-full font-outfit"
        >
          <div className="flex flex-col h-full justify-between space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                ) : (
                  <span className="flex h-2 w-2 relative">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                )}
                <span className="text-xs font-bold text-slate-700">
                  {isOnline ? '🟢 Connected' : '🔴 Working Offline'}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-semibold">
                {isOnline && lastSyncAt ? (
                  `Last Sync: ${(() => {
                    try {
                      return format(new Date(lastSyncAt), 'hh:mm a');
                    } catch (e) {
                      return '';
                    }
                  })()}`
                ) : (!isOnline && offlineSince) ? (
                  `Offline Since: ${(() => {
                    try {
                      return format(new Date(offlineSince), 'hh:mm a');
                    } catch (e) {
                      return '';
                    }
                  })()}`
                ) : ''}
              </span>
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center items-center py-4">
              {pendingCount === 0 ? (
                <>
                  <CheckCircle className="w-8 h-8 text-green-500 mb-1" />
                  <span className="text-xs font-bold text-green-700">✓ All Data Synced</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-8 h-8 text-amber-500 mb-1 animate-pulse" />
                  <span className="text-xs font-bold text-amber-700">{pendingCount} Pending Sync</span>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={triggerSync}
                disabled={!isOnline || isSyncing || pendingCount === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold rounded-lg text-xs transition-colors shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/sync-center')}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-bold border border-slate-200 rounded-lg text-xs transition-colors shadow-sm text-center"
              >
                Sync Center
              </button>
            </div>
          </div>
        </Card>

        {/* Reminders Summary Card */}
        <Card
          title="Reminders Summary"
          subtitle="Status of active and recurring reminders"
          onClick={() => navigate('/reminders')}
          className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border-blue-100 cursor-pointer hover:shadow-md transition-shadow h-full animate-pulse-subtle"
        >
          <div className='grid grid-cols-6 gap-2 text-center'>
            <div className='col-span-2 bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center py-2.5'>
              <div className='text-[9px] font-bold text-red-600 uppercase tracking-wider mb-0.5'>Overdue</div>
              <div className='text-sm font-extrabold text-red-700'>{reminderStats.overdue}</div>
            </div>
            <div className='col-span-2 bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center py-2.5'>
              <div className='text-[9px] font-bold text-orange-600 uppercase tracking-wider mb-0.5'>Today</div>
              <div className='text-sm font-extrabold text-orange-700'>{reminderStats.today}</div>
            </div>
            <div className='col-span-2 bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center py-2.5'>
              <div className='text-[9px] font-bold text-blue-600 uppercase tracking-wider mb-0.5'>Upcoming</div>
              <div className='text-sm font-extrabold text-blue-700'>{reminderStats.upcoming}</div>
            </div>
            <div className='col-span-3 bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center py-2.5 mt-1'>
              <div className='text-[9px] font-bold text-amber-600 uppercase tracking-wider mb-0.5'>Pending</div>
              <div className='text-sm font-extrabold text-amber-700'>{reminderStats.pending}</div>
            </div>
            <div className='col-span-3 bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center py-2.5 mt-1'>
              <div className='text-[9px] font-bold text-green-600 uppercase tracking-wider mb-0.5'>Completed</div>
              <div className='text-sm font-extrabold text-green-700'>{reminderStats.completed}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* User Login Credentials Section - Only show for Admin */}
      {user?.is_admin && userCredentials.length > 0 && showCredentials && (
        <Card className='bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200'>
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-2'>
              <Key className='w-5 h-5 text-blue-600' />
              <h2 className='text-xl font-bold text-gray-900'>Recently Created Login Credentials</h2>
            </div>
            <button
              onClick={() => setShowCredentials(false)}
              className='text-gray-400 hover:text-gray-600 transition-colors'
              title='Hide credentials'
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          <div className='space-y-3'>
            {userCredentials.map((cred, index) => (
              <div
                key={index}
                className='bg-white rounded-lg p-4 border border-blue-200 shadow-sm hover:shadow-md transition-shadow'
              >
                <div className='flex items-start justify-between gap-4'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2 mb-2'>
                      <span className='font-semibold text-gray-900'>Username:</span>
                      <code className='bg-blue-50 text-blue-700 px-2 py-1 rounded text-sm font-mono'>
                        {cred.username}
                      </code>
                      {cred.is_admin && (
                        <span className='inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-semibold'>
                          <Shield className='w-3 h-3' />
                          Admin
                        </span>
                      )}
                    </div>

                    <div className='flex items-center gap-2 mb-3'>
                      <span className='font-semibold text-gray-900'>Password:</span>
                      <code className='bg-red-50 text-red-700 px-2 py-1 rounded text-sm font-mono'>
                        {cred.password}
                      </code>
                    </div>

                    <div className='mb-2'>
                      <span className='text-sm font-semibold text-gray-700'>Access Features: </span>
                      {cred.is_admin ? (
                        <span className='text-sm text-green-700 font-medium'>All Features (Admin)</span>
                      ) : cred.features && cred.features.length > 0 ? (
                        <div className='flex flex-wrap gap-1 mt-1'>
                          {cred.features.map((featureKey: string) => (
                            <span
                              key={featureKey}
                              className='inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium border border-blue-200'
                            >
                              {featureNames[featureKey] || featureKey}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className='text-sm text-gray-500'>None (Dashboard only)</span>
                      )}
                    </div>

                    {cred.created_at && (
                      <p className='text-xs text-gray-500 mt-2'>
                        Created: {format(new Date(cred.created_at), 'MMM dd, yyyy HH:mm')}
                      </p>
                    )}
                  </div>

                  <div className='flex flex-col gap-2'>
                    <button
                      onClick={() => copyCredentials(cred.username, cred.password)}
                      className='flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm'
                      title='Copy credentials'
                    >
                      <Copy className='w-4 h-4' />
                      Copy
                    </button>
                    <button
                      onClick={() => removeCredentials(index)}
                      className='flex items-center gap-2 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm'
                      title='Remove from list'
                    >
                      <X className='w-4 h-4' />
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className='mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg'>
            <p className='text-sm text-yellow-800'>
              <strong>Note:</strong> These credentials are stored locally in your browser. Share them securely with the team member.
              They can use these credentials to login to the system.
            </p>
          </div>
        </Card>
      )}

      {/* Show button to display credentials if hidden */}
      {user?.is_admin && userCredentials.length > 0 && !showCredentials && (
        <Card className='bg-blue-50 border border-blue-200'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Key className='w-5 h-5 text-blue-600' />
              <p className='text-gray-700'>
                You have {userCredentials.length} created user credential(s).
              </p>
            </div>
            <button
              onClick={() => setShowCredentials(true)}
              className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm'
            >
              Show Credentials
            </button>
          </div>
        </Card>
      )}

      {/* Quick Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        <Card 
          onClick={() => navigate('/ledger-summary')}
          className='bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-200 p-3 hover:shadow-md cursor-pointer transition-shadow'
        >
          <div className='flex items-center gap-2'>
            <Building className='w-5 h-5 text-indigo-600' />
            <div>
              <p className='font-medium text-indigo-800 text-xs'>Total Companies</p>
              <p className='text-lg font-bold text-indigo-900'>
                {distinctCompaniesCount?.data || companies?.data?.length || 0}
              </p>
            </div>
          </div>
        </Card>

        <Card className='bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200 p-3'>
          <div className='flex items-center gap-2'>
            <FileText className='w-5 h-5 text-emerald-600' />
            <div>
              <p className='font-medium text-emerald-800 text-xs'>Total Accounts</p>
              <p className='text-lg font-bold text-emerald-900'>
                {distinctMainAccountsCount?.data || 0}
              </p>
            </div>
          </div>
        </Card>

        <Card className='bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 p-3'>
          <div className='flex items-center gap-2'>
            <FileText className='w-5 h-5 text-purple-600' />
            <div>
              <p className='font-medium text-purple-800 text-xs'>Sub Accounts</p>
              <p className='text-lg font-bold text-purple-900'>
                {uniqueSubAccountsCount?.data || 0}
              </p>
            </div>
          </div>
        </Card>

        <Card 
          onClick={() => navigate('/user-management')}
          className='bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200 p-3 hover:shadow-md cursor-pointer transition-shadow'
        >
          <div className='flex items-center gap-2'>
            <Users className='w-5 h-5 text-amber-600' />
            <div>
              <p className='font-medium text-amber-800 text-xs'>Active Users</p>
              <p className='text-lg font-bold text-amber-900'>
                {activeOperatorCount?.data || 0}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Two column grid layout for closing balances and mini calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          {/* Company Closing Balances Table */}
          <Card
            title='Company Closing Balances'
            subtitle='Current balance for each company (Credit - Debit)'
          >
            {loading ? (
              <div className='text-center py-8'>
                <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto'></div>
                <p className='mt-2 text-gray-600'>Loading company balances...</p>
              </div>
            ) : !companyBalances || companyBalances.length === 0 ? (
              <div className='text-center py-8 text-gray-500'>
                No company data found.
              </div>
            ) : (
              <div className='flex flex-col space-y-4'>
                {/* Filter and Search Toolbar */}
                <div className='flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200'>
                  {/* Filter Buttons */}
                  <div className='flex gap-1 items-center w-full sm:w-auto'>
                    <span className='text-xs font-semibold text-gray-500 mr-2'>Filter:</span>
                    <button
                      type='button'
                      onClick={() => setBalanceFilter('all')}
                      className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                        balanceFilter === 'all'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                      }`}
                    >
                      All
                    </button>
                    <button
                      type='button'
                      onClick={() => setBalanceFilter('cr')}
                      className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                        balanceFilter === 'cr'
                          ? 'bg-green-600 text-white shadow-sm'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                      }`}
                    >
                      CR (Credit)
                    </button>
                    <button
                      type='button'
                      onClick={() => setBalanceFilter('dr')}
                      className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                        balanceFilter === 'dr'
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                      }`}
                    >
                      DR (Debit)
                    </button>
                  </div>

                  {/* Search Box */}
                  <div className='relative w-full sm:w-64'>
                    <input
                      type='text'
                      placeholder='Search company name...'
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      className='w-full px-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                    {companySearch && (
                      <button
                        type='button'
                        onClick={() => setCompanySearch('')}
                        className='absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold'
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Table */}
                {processedCompanyBalances.length === 0 ? (
                  <div className='text-center py-6 text-gray-500 bg-white border rounded-lg'>
                    No companies match the selected search or filters.
                  </div>
                ) : (
                  <div className='overflow-x-auto'>
                    <table className='w-full text-xs'>
                      <thead className='sticky top-0 bg-gray-50 z-10'>
                        <tr className='border-b border-gray-200 select-none'>
                          <th 
                            onClick={() => {
                              if (sortField === 'name') {
                                setSortAsc(!sortAsc);
                              } else {
                                setSortField('name');
                                setSortAsc(true);
                              }
                            }}
                            className='text-left py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors'
                          >
                            Company Name {sortField === 'name' ? (sortAsc ? ' ↑' : ' ↓') : ''}
                          </th>
                          <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                            Total Credit
                          </th>
                          <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                            Total Debit
                          </th>
                          <th 
                            onClick={() => {
                              if (sortField === 'balance') {
                                setSortAsc(!sortAsc);
                              } else {
                                setSortField('balance');
                                setSortAsc(false); // Default to high-to-low sort for balances
                              }
                            }}
                            className='text-right py-3 px-4 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors'
                          >
                            Closing Balance {sortField === 'balance' ? (sortAsc ? ' ↑' : ' ↓') : ''}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {processedCompanyBalances.map((company, index) => (
                          <tr
                            key={company.companyName}
                            className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                            }`}
                          >
                            <td className='py-3 px-4 font-medium text-gray-900'>
                              {company.companyName}
                            </td>
                            <td className='py-3 px-4 text-right text-green-600 font-medium'>
                              {formatIndianNumber(company.totalCredit)}
                            </td>
                            <td className='py-3 px-4 text-right text-red-600 font-medium'>
                              {formatIndianNumber(company.totalDebit)}
                            </td>
                            <td className='py-3 px-4 text-right font-semibold'>
                              <span
                                className={`px-2 py-1 rounded-full text-sm font-semibold whitespace-nowrap ${
                                  company.closingBalance >= 0
                                    ? 'bg-green-50 text-green-700 border border-green-200'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                }`}
                              >
                                {company.closingBalance >= 0
                                  ? `${formatIndianNumber(company.closingBalance)} CR`
                                  : `${formatIndianNumber(Math.abs(company.closingBalance))} DR`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Summary Footer */}
                    <div className='mt-4 p-4 bg-gray-100 rounded-lg border'>
                      <div className='grid grid-cols-4 gap-4 text-sm'>
                        <div className='font-semibold text-gray-900'>
                          Total Companies: {processedCompanyBalances.length}
                        </div>
                        <div className='text-right text-green-600 font-semibold'>
                          {formatIndianNumber(processedCompanyBalances.reduce((sum, c) => sum + c.totalCredit, 0))}
                        </div>
                        <div className='text-right text-red-600 font-semibold'>
                          {formatIndianNumber(processedCompanyBalances.reduce((sum, c) => sum + c.totalDebit, 0))}
                        </div>
                        <div className='text-right'>
                          {(() => {
                            const totalBal = processedCompanyBalances.reduce((sum, c) => sum + c.closingBalance, 0);
                            return (
                              <span
                                className={`px-2 py-1 rounded-full text-sm font-bold ${
                                  totalBal >= 0
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {totalBal >= 0
                                  ? `${formatIndianNumber(totalBal)} CR`
                                  : `${formatIndianNumber(Math.abs(totalBal))} DR`}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
        
        <div className="space-y-6 lg:sticky lg:top-4">
          <Card title="Reminders Calendar" subtitle="Monthly view of scheduled reminders">
            <div className="flex flex-col gap-4">
              <div className="flex justify-center">
                <RemindersCalendar
                  reminders={reminders}
                  isMini={true}
                  onDateSelect={(dateStr) => {
                    setSelectedCalendarDate(dateStr);
                    const dateReminders = reminders.filter(r => r.event_date === dateStr && !r.deleted_at);
                    setSelectedDateReminders(dateReminders);
                    setShowCalendarModal(true);
                  }}
                />
              </div>

              {/* Reminder Sound Controls */}
              <div className="border-t border-gray-150 pt-4 flex flex-col gap-3 font-outfit" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    {soundEnabled ? (
                      <>
                        <span className="text-sm">🔔</span> Reminder Sound: ON
                      </>
                    ) : (
                      <>
                        <span className="text-sm">🔕</span> Reminder Sound: OFF
                      </>
                    )}
                  </span>
                  <button
                    onClick={handleToggleSound}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all shadow-sm ${
                      soundEnabled
                        ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                    }`}
                  >
                    {soundEnabled ? 'Turn OFF' : 'Turn ON'}
                  </button>
                </div>
                
                {soundEnabled && (
                  <div className="flex items-center justify-between text-xs bg-gray-50 p-2 rounded-lg border border-gray-200">
                    <span className="text-gray-500 font-medium text-[11px]">Chime Volume:</span>
                    <div className="flex gap-1">
                      {(['soft', 'normal', 'loud'] as const).map((vol) => (
                        <button
                          key={vol}
                          onClick={() => handleVolumeChange(vol)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${
                            soundVolume === vol
                              ? 'bg-blue-600 text-white shadow-sm scale-105'
                              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          {vol}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Change Password Card - Visible in both ITR and Regular modes */}
      <Card
        title='Change Password'
        subtitle='Update your account password'
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <Key className='w-5 h-5 text-gray-600' />
            <div>
              <p className='text-sm text-gray-600'>
                Click the button below to change your password
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowPasswordModal(true)}
            className='bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700'
          >
            Change Password
          </Button>
        </div>
      </Card>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg shadow-xl max-w-md w-full mx-4'>
            <div className='flex items-center justify-between p-6 border-b border-gray-200'>
              <h2 className='text-xl font-bold text-gray-900 flex items-center gap-2'>
                <Key className='w-5 h-5 text-gray-600' />
                Change Password
              </h2>
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className='text-gray-400 hover:text-gray-600'
              >
                <X className='w-5 h-5' />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className='p-6 space-y-4'>
              <div className='relative'>
                <Input
                  label='Current Password'
                  password type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  placeholder='Enter current password'
                  required
                />
                <button
                  type='button'
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className='absolute right-3 top-8 text-gray-400 hover:text-gray-600'
                >
                  {showCurrentPassword ? (
                    <EyeOff className='w-5 h-5' />
                  ) : (
                    <Eye className='w-5 h-5' />
                  )}
                </button>
              </div>

              <div className='relative'>
                <Input
                  label='New Password'
                  password type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={setNewPassword}
                  placeholder='Enter new password (min 4 characters)'
                  required
                />
                <button
                  type='button'
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className='absolute right-3 top-8 text-gray-400 hover:text-gray-600'
                >
                  {showNewPassword ? (
                    <EyeOff className='w-5 h-5' />
                  ) : (
                    <Eye className='w-5 h-5' />
                  )}
                </button>
              </div>

              <div className='relative'>
                <Input
                  label='Confirm New Password'
                  password type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder='Confirm new password'
                  required
                />
                <button
                  type='button'
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className='absolute right-3 top-8 text-gray-400 hover:text-gray-600'
                >
                  {showConfirmPassword ? (
                    <EyeOff className='w-5 h-5' />
                  ) : (
                    <Eye className='w-5 h-5' />
                  )}
                </button>
              </div>

              <div className='flex gap-3 pt-4'>
                <Button
                  type='button'
                  variant='secondary'
                  onClick={() => {
                    setShowPasswordModal(false);
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                  className='flex-1'
                >
                  Cancel
                </Button>
                <Button
                  type='submit'
                  disabled={changingPassword}
                  className='flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700'
                >
                  {changingPassword ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Login Alert Modal */}
      {showLoginAlert && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl p-6 border border-gray-100">
            <div className="flex items-center gap-3 mb-4 pb-2 border-b">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Upcoming Reminders & Events Alert</h3>
                <p className="text-xs text-gray-500">You have active reminders that need your attention</p>
              </div>
            </div>
            
            <div className="max-h-[300px] overflow-y-auto space-y-3 mb-6 pr-1">
              {activeReminders.slice(0, 5).map((r) => {
                const colorStatus = getReminderColorStatus(r);
                let colorClass = 'border-l-4 border-blue-500 bg-blue-25';
                if (colorStatus === 'dark-red') colorClass = 'border-l-4 border-red-500 bg-red-25';
                else if (colorStatus === 'red') colorClass = 'border-l-4 border-red-400 bg-red-25';
                else if (colorStatus === 'orange') colorClass = 'border-l-4 border-orange-400 bg-orange-25';
                else if (colorStatus === 'yellow') colorClass = 'border-l-4 border-yellow-400 bg-yellow-25';

                return (
                  <div 
                    key={r.id} 
                    onClick={() => {
                      setShowLoginAlert(false);
                      navigate(`/reminders?highlightReminder=${r.id}`);
                    }}
                    className={`p-3 rounded-lg flex items-start justify-between gap-3 text-xs cursor-pointer hover:opacity-90 transition-opacity ${colorClass}`}
                  >
                    <div>
                      <div className="font-bold text-gray-800">{r.title}</div>
                      {r.description && <div className="text-gray-600 mt-1 line-clamp-2">{r.description}</div>}
                      <div className="text-[10px] text-gray-500 mt-1">
                        Due: {format(parseISO(r.event_date), 'dd-MM-yyyy')} {r.event_time ? `at ${r.event_time.slice(0,5)}` : ''} | Priority: <span className="font-bold uppercase">{r.priority}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {activeReminders.length > 5 && (
                <div className="text-center text-xs text-gray-500 font-semibold pt-1">
                  + {activeReminders.length - 5} more reminders
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <Button
                variant="secondary"
                onClick={() => {
                  const todayStr = format(new Date(), 'yyyy-MM-dd');
                  localStorage.setItem('reminders_hide_until', todayStr);
                  setShowLoginAlert(false);
                }}
                className="flex-1 text-xs"
              >
                Don't Show Again Today
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowLoginAlert(false)}
                className="flex-1 text-xs"
              >
                Dismiss
              </Button>
              <Button
                onClick={() => {
                  setShowLoginAlert(false);
                  navigate('/reminders');
                }}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-xs text-white"
              >
                View All Reminders
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mini Calendar Details Modal */}
      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl p-5 border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b mb-4">
              <h3 className="text-md font-bold text-gray-900 flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-blue-600" />
                Reminders for {selectedCalendarDate ? format(parseISO(selectedCalendarDate), 'dd-MM-yyyy') : ''}
              </h3>
              <button onClick={() => setShowCalendarModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="max-h-[350px] overflow-y-auto space-y-3 mb-4 pr-1">
              {selectedDateReminders.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">No reminders scheduled for this date.</p>
              ) : (
                selectedDateReminders.map((r) => {
                  const isCompleted = r.status === 'completed';
                  return (
                    <div 
                      key={r.id} 
                      className={`p-3 rounded-lg border text-xs relative ${
                        isCompleted 
                          ? 'bg-green-25 border-green-200 text-green-800' 
                          : r.priority === 'critical'
                            ? 'bg-red-25 border-red-200 text-red-900'
                            : r.priority === 'high'
                              ? 'bg-orange-25 border-orange-200 text-orange-900'
                              : r.priority === 'medium'
                                ? 'bg-yellow-25 border-yellow-200 text-yellow-900'
                                : 'bg-blue-25 border-blue-200 text-blue-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="inline-block text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-white/70 shadow-sm mb-1.5 mr-2">
                            {r.category || 'GENERAL'}
                          </span>
                          <span className="inline-block text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-white/70 shadow-sm mb-1.5">
                            {r.priority}
                          </span>
                          <h4 className="font-bold text-gray-800 text-sm">{r.title}</h4>
                          {r.description && <p className="text-gray-600 mt-1">{r.description}</p>}
                          {r.event_time && <p className="text-gray-500 mt-1 font-mono text-[10px]">Time: {r.event_time.slice(0, 5)}</p>}
                          {r.completion_notes && (
                            <div className="mt-2 bg-white/80 p-2 rounded border border-green-200 text-[11px] text-green-700 font-medium">
                              Notes: {r.completion_notes}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 items-end">
                          {r.status === 'pending' && (
                            <>
                              <button
                                onClick={() => {
                                  setShowCalendarModal(false);
                                  setCompletionReminder(r);
                                }}
                                className="px-2.5 py-1 text-[10px] font-bold bg-green-600 hover:bg-green-700 text-white rounded shadow-sm flex items-center gap-1 transition-colors"
                              >
                                <CheckCircle className="w-3.5 h-3.5" /> Done
                              </button>
                              <div className="relative group">
                                <button className="px-2.5 py-1 text-[10px] font-bold bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded shadow-sm flex items-center gap-1 transition-colors">
                                  <Clock className="w-3.5 h-3.5" /> Snooze
                                </button>
                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg hidden group-hover:block z-30 py-1 min-w-[70px]">
                                  <button onClick={() => { setShowCalendarModal(false); handleSnooze(r, 1); }} className="w-full text-left px-2 py-1 text-[10px] hover:bg-gray-100 text-gray-700 font-semibold">1 Day</button>
                                  <button onClick={() => { setShowCalendarModal(false); handleSnooze(r, 3); }} className="w-full text-left px-2 py-1 text-[10px] hover:bg-gray-100 text-gray-700 font-semibold">3 Days</button>
                                  <button onClick={() => { setShowCalendarModal(false); handleSnooze(r, 7); }} className="w-full text-left px-2 py-1 text-[10px] hover:bg-gray-100 text-gray-700 font-semibold">7 Days</button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="secondary" onClick={() => setShowCalendarModal(false)}>Close</Button>
              <Button 
                size="sm" 
                onClick={() => {
                  setShowCalendarModal(false);
                  navigate('/reminders');
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Go to Reminders Page
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Complete Notes Modal */}
      {completionReminder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full shadow-xl p-5 border border-gray-100">
            <h3 className="text-md font-bold text-gray-900 mb-2 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Complete Reminder
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Enter any completion notes or logs for <strong>{completionReminder.title}</strong>
            </p>
            <textarea
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="e.g. Finished task, paid tax..."
              className="w-full min-h-[80px] p-2.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCompletionReminder(null);
                  setCompletionNotes('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCompleteSubmit}
                disabled={isCompleting}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isCompleting ? 'Completing...' : 'Confirm Complete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
