import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { format, parseISO, addDays } from 'date-fns';
import { 
  Bell, Plus, Search, Calendar as CalendarIcon, List, Edit, Trash2, 
  Clock, CheckCircle, ChevronLeft, ChevronRight, User, 
  Sparkles, X, AlertTriangle, Eye
} from 'lucide-react';
import { supabaseDB, Reminder, User as DBUser } from '../lib/supabaseDatabase';
import { useAuth } from '../contexts/AuthContext';
import { useTableMode } from '../contexts/TableModeContext';
import { useBook } from '../contexts/BookContext';
import Card from '../components/UI/Card';
import Select from '../components/UI/Select';
import Input from '../components/UI/Input';
import Button from '../components/UI/Button';
import ModeLabel from '../components/UI/ModeLabel';
import RemindersCalendar from '../components/UI/RemindersCalendar';
import { 
  getReminderColorStatus, 
  calculateNextOccurrence 
} from '../utils/reminderHelper';
import { 
  isSoundEnabled, 
  setSoundEnabled, 
  getSoundVolume, 
  setSoundVolume 
} from '../utils/reminderSound';
import toast from 'react-hot-toast';

const Reminders: React.FC = () => {
  const { user } = useAuth();
  const { mode: tableMode } = useTableMode();
  const { currentBook } = useBook();
  
  // State variables
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [users, setUsers] = useState<DBUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const highlightReminderId = queryParams.get('highlightReminder') || location.state?.highlightReminderId;

  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  // Global sound states
  const [globalSoundEnabled, setGlobalSoundEnabled] = useState(isSoundEnabled());
  const [globalSoundVolume, setGlobalSoundVolume] = useState(getSoundVolume());

  useEffect(() => {
    const handleSoundChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setGlobalSoundEnabled(detail.enabled);
      }
    };
    const handleVolumeChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.volume === 'string') {
        setGlobalSoundVolume(detail.volume as 'soft' | 'normal' | 'loud');
      }
    };
    window.addEventListener('reminder-sound-changed', handleSoundChanged);
    window.addEventListener('reminder-sound-volume-changed', handleVolumeChanged);
    return () => {
      window.removeEventListener('reminder-sound-changed', handleSoundChanged);
      window.removeEventListener('reminder-sound-volume-changed', handleVolumeChanged);
    };
  }, []);

  // Handle highlight route logic
  useEffect(() => {
    if (highlightReminderId) {
      setActiveHighlightId(highlightReminderId);
      const timer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 5000); // 5 seconds highlight
      return () => clearTimeout(timer);
    }
  }, [highlightReminderId]);

  useEffect(() => {
    if (!loading && highlightReminderId) {
      setViewMode('list');
      setSelectedFilterDate(''); // clear date filter to show the target
      
      const timer = setTimeout(() => {
        const element = document.getElementById(`reminder-${highlightReminderId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, highlightReminderId]);
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('pending'); // default show pending
  const [filterAssignedUser, setFilterAssignedUser] = useState('');
  const [selectedFilterDate, setSelectedFilterDate] = useState('');

  // Modals state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState<Reminder | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');
  
  // New Reminder form state
  const [newReminder, setNewReminder] = useState({
    title: '',
    description: '',
    event_date: format(new Date(), 'yyyy-MM-dd'),
    event_time: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    reminder_type: 'one_time' as 'one_time' | 'recurring',
    recurring_interval: '' as 'daily' | 'weekly' | 'monthly' | 'yearly' | '',
    notify_before_days: 0,
    assigned_user_id: '' as string | null,
    category: 'GENERAL' as 'GENERAL' | 'VEHICLE' | 'LOAN' | 'STAFF' | 'DOCUMENT' | 'TAX' | 'MEETING' | 'FOLLOWUP',
    is_system_generated: false,
    play_sound: true
  });

  // Load reminders and users
  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const mode = tableMode === 'finance' ? 'regular' : tableMode;
      const data = await supabaseDB.getReminders(mode as 'regular' | 'itr', user.id, user.is_admin);
      setReminders(data);
      
      const userList = await supabaseDB.getUsers();
      setUsers(userList);
      
      // Dispatch refresh event to update sidebar count
      window.dispatchEvent(new CustomEvent('refresh-reminders-count'));
    } catch (error) {
      console.error('Error loading reminders data:', error);
      toast.error('Failed to load reminders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user, tableMode, currentBook?.id]);

  // Categories list
  const categories = [
    { value: 'GENERAL', label: 'General' },
    { value: 'VEHICLE', label: 'Vehicle Expiry' },
    { value: 'LOAN', label: 'Loan / EMI' },
    { value: 'STAFF', label: 'Staff / Salary' },
    { value: 'DOCUMENT', label: 'Document Expiry' },
    { value: 'TAX', label: 'Tax Filing' },
    { value: 'MEETING', label: 'Meeting' },
    { value: 'FOLLOWUP', label: 'Follow Up' }
  ];

  const priorities = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' }
  ];

  const statuses = [
    { value: 'pending', label: 'Pending' },
    { value: 'completed', label: 'Completed' },
    { value: 'all', label: 'All Statuses' }
  ];

  const notifyDaysOptions = [
    { value: '0', label: 'Same Day' },
    { value: '1', label: '1 Day Before' },
    { value: '3', label: '3 Days Before' },
    { value: '7', label: '7 Days Before' },
    { value: '15', label: '15 Days Before' },
    { value: '30', label: '30 Days Before' }
  ];

  const recurringIntervals = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' }
  ];

  // Map reminders to their active dates (unique sorted dates having active reminders)
  const uniqueReminderDates = useMemo(() => {
    const dates = reminders
      .filter(r => !r.deleted_at && (filterStatus === 'all' || r.status === filterStatus))
      .map(r => r.event_date);
    const unique = Array.from(new Set(dates));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [reminders, filterStatus]);

  // Navigate dates (skip empty days)
  const handleDateNavigate = (direction: 'prev' | 'next') => {
    if (uniqueReminderDates.length === 0) return;
    
    if (!selectedFilterDate) {
      // If no date is currently selected, pick today or the first/last date
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      if (direction === 'next') {
        const nextDate = uniqueReminderDates.find(d => d >= todayStr);
        setSelectedFilterDate(nextDate || uniqueReminderDates[0]);
      } else {
        const revDates = [...uniqueReminderDates].reverse();
        const prevDate = revDates.find(d => d <= todayStr);
        setSelectedFilterDate(prevDate || uniqueReminderDates[uniqueReminderDates.length - 1]);
      }
      return;
    }

    const currentIndex = uniqueReminderDates.indexOf(selectedFilterDate);
    if (direction === 'next') {
      if (currentIndex < uniqueReminderDates.length - 1) {
        setSelectedFilterDate(uniqueReminderDates[currentIndex + 1]);
      } else {
        toast.success('You have reached the last active date');
      }
    } else {
      if (currentIndex > 0) {
        setSelectedFilterDate(uniqueReminderDates[currentIndex - 1]);
      } else {
        toast.success('You have reached the first active date');
      }
    }
  };

  // Filtered Reminders List
  const filteredReminders = useMemo(() => {
    const highlighted = highlightReminderId 
      ? reminders.find(r => r.id === highlightReminderId)
      : null;

    const remaining = reminders.filter((r) => {
      if (highlightReminderId && r.id === highlightReminderId) {
        return false; // exclude from normal list to place it at the top
      }

      // 1. Search text
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const titleMatch = r.title?.toLowerCase().includes(query);
        const descMatch = r.description?.toLowerCase().includes(query);
        if (!titleMatch && !descMatch) return false;
      }

      // 2. Category
      if (filterCategory && r.category !== filterCategory) return false;

      // 3. Priority
      if (filterPriority && r.priority !== filterPriority) return false;

      // 4. Status
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;

      // 5. Assigned User
      if (filterAssignedUser) {
        if (filterAssignedUser === 'all_users') {
          if (r.assigned_user_id !== null) return false;
        } else {
          if (r.assigned_user_id !== filterAssignedUser) return false;
        }
      }

      // 6. Selected Date
      if (selectedFilterDate && r.event_date !== selectedFilterDate) return false;

      return true;
    });

    if (highlighted) {
      return [highlighted, ...remaining];
    }
    return remaining;
  }, [reminders, searchTerm, filterCategory, filterPriority, filterStatus, filterAssignedUser, selectedFilterDate, highlightReminderId]);

  // Form handlers
  const handleInputChange = (field: string, value: any) => {
    if (editingReminder) {
      setEditingReminder(prev => prev ? ({ ...prev, [field]: value }) : null);
    } else {
      setNewReminder(prev => ({ ...prev, [field]: value }));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (!user) return;

    if (!newReminder.title || !newReminder.event_date) {
      toast.error('Title and Date are required');
      return;
    }

    const payload = {
      title: newReminder.title,
      description: newReminder.description || null,
      event_date: newReminder.event_date,
      event_time: newReminder.event_time || null,
      priority: newReminder.priority,
      reminder_type: newReminder.reminder_type,
      recurring_interval: newReminder.reminder_type === 'recurring' ? (newReminder.recurring_interval || null) : null,
      notify_before_days: Number(newReminder.notify_before_days),
      assigned_user_id: newReminder.assigned_user_id || null,
      status: 'pending' as const,
      mode: (tableMode === 'finance' ? 'regular' : tableMode) as 'regular' | 'itr',
      category: newReminder.category,
      is_system_generated: newReminder.is_system_generated,
      created_by: user.id,
      completion_notes: null,
      completed_at: null,
      snoozed_until: null,
      deleted_at: null,
      book_id: currentBook?.id || null,
      play_sound: newReminder.play_sound
    };

    const result = await supabaseDB.createReminder(payload);
    if (result) {
      toast.success('Reminder created successfully!');
      loadData();
      setShowAddForm(false);
      // Reset form
      setNewReminder({
        title: '',
        description: '',
        event_date: format(new Date(), 'yyyy-MM-dd'),
        event_time: '',
        priority: 'medium',
        reminder_type: 'one_time',
        recurring_interval: '',
        notify_before_days: 0,
        assigned_user_id: '',
        category: 'GENERAL',
        is_system_generated: false,
        play_sound: true
      });
    } else {
      toast.error('Failed to create reminder');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (!editingReminder) return;

    const updates = {
      title: editingReminder.title,
      description: editingReminder.description,
      event_date: editingReminder.event_date,
      event_time: editingReminder.event_time,
      priority: editingReminder.priority,
      reminder_type: editingReminder.reminder_type,
      recurring_interval: editingReminder.reminder_type === 'recurring' ? editingReminder.recurring_interval : null,
      notify_before_days: Number(editingReminder.notify_before_days),
      assigned_user_id: editingReminder.assigned_user_id,
      category: editingReminder.category,
      status: editingReminder.status,
      play_sound: editingReminder.play_sound ?? true
    };

    const result = await supabaseDB.updateReminder(editingReminder.id, updates);
    if (result) {
      toast.success('Reminder updated successfully!');
      loadData();
      setEditingReminder(null);
    } else {
      toast.error('Failed to update reminder');
    }
  };

  const handleDelete = async (id: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this reminder?')) {
      const success = await supabaseDB.deleteReminder(id);
      if (success) {
        toast.success('Reminder deleted successfully');
        loadData();
      } else {
        toast.error('Failed to delete reminder');
      }
    }
  };

  // Snooze action
  const handleSnooze = async (reminder: Reminder, days: number) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    const targetDate = format(addDays(new Date(), days), 'yyyy-MM-dd');
    const result = await supabaseDB.updateReminder(reminder.id, {
      snoozed_until: targetDate
    });
    if (result) {
      toast.success(`Reminder snoozed for ${days} day(s)`);
      loadData();
    } else {
      toast.error('Failed to snooze reminder');
    }
  };

  // Seen action
  const handleMarkSeen = async (id: string) => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    const result = await supabaseDB.updateReminder(id, { seen: true });
    if (result) {
      toast.success('Reminder marked as seen');
      loadData();
    } else {
      toast.error('Failed to mark reminder as seen');
    }
  };

  // Completion action
  const handleCompleteSubmit = async () => {
    if (currentBook?.is_locked) {
      toast.error('This Book is Locked (Read Only). Writing/Editing/Deletion is blocked.');
      return;
    }
    if (!showCompleteModal || !user) return;

    const notes = completionNotes.trim() || null;
    const completedAt = new Date().toISOString();

    // 1. Update current reminder
    const result = await supabaseDB.updateReminder(showCompleteModal.id, {
      status: 'completed',
      completion_notes: notes,
      completed_at: completedAt
    });

    if (result) {
      toast.success('Reminder completed');
      
      // 2. Handle Recurring Reminder replication
      if (showCompleteModal.reminder_type === 'recurring' && showCompleteModal.recurring_interval) {
        const nextDate = calculateNextOccurrence(showCompleteModal.event_date, showCompleteModal.recurring_interval);
        
        console.log('🔄 Replicating recurring reminder. Next occurrence event_date:', nextDate);
        
        const nextReminder = {
          title: showCompleteModal.title,
          description: showCompleteModal.description,
          event_date: nextDate,
          event_time: showCompleteModal.event_time,
          priority: showCompleteModal.priority,
          reminder_type: 'recurring' as const,
          recurring_interval: showCompleteModal.recurring_interval,
          notify_before_days: showCompleteModal.notify_before_days,
          assigned_user_id: showCompleteModal.assigned_user_id,
          status: 'pending' as const,
          mode: showCompleteModal.mode,
          category: showCompleteModal.category,
          is_system_generated: showCompleteModal.is_system_generated,
          created_by: showCompleteModal.created_by,
          completion_notes: null,
          completed_at: null,
          snoozed_until: null,
          deleted_at: null,
          book_id: showCompleteModal.book_id,
          play_sound: showCompleteModal.play_sound ?? true
        };

        const replicated = await supabaseDB.createReminder(nextReminder);
        if (replicated) {
          toast.success(`Scheduled next occurrence for: ${format(parseISO(nextDate), 'dd-MM-yyyy')}`);
        } else {
          toast.error('Warning: Failed to auto-schedule next occurrence');
        }
      }

      loadData();
      setShowCompleteModal(null);
      setCompletionNotes('');
    } else {
      toast.error('Failed to complete reminder');
    }
  };

  const getPriorityBadgeClass = (_priority: string) => {
    return 'bg-slate-700 text-white border-slate-800 shadow-md';
  };

  return (
    <div className="min-h-screen flex flex-col space-y-4 pb-8">
      {/* Locked Book Banner */}
      {currentBook?.is_locked && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-center gap-3 no-print mb-6">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-red-800">This Book Is Locked (Read Only)</h3>
            <p className="text-xs text-red-700">Writing, editing, and deletion operations are disabled for this accounting period.</p>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
              <Bell className="w-8 h-8 text-blue-600 animate-swing" />
              Reminders & Events
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
          <p className="text-gray-500 text-sm">
            Configure alarms, follow-ups, meetings, and auto-generated system reminders
          </p>
        </div>
        
        <div className="flex flex-wrap items-center justify-end gap-2.5 min-w-0">
          {/* Sound Settings in Reminders Toolbar */}
          <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 p-1 rounded-xl shadow-sm">
            <button
              type="button"
              onClick={() => {
                const nextVal = !globalSoundEnabled;
                setGlobalSoundEnabled(nextVal);
                setSoundEnabled(nextVal);
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold font-outfit transition-all ${
                globalSoundEnabled
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
              title={globalSoundEnabled ? 'Disable Reminder Sound' : 'Enable Reminder Sound'}
            >
              {globalSoundEnabled ? '🔔 Sound ON' : '🔕 Sound OFF'}
            </button>
            
            <select
              value={globalSoundVolume}
              onChange={(e) => {
                const vol = e.target.value as 'soft' | 'normal' | 'loud';
                setGlobalSoundVolume(vol);
                setSoundVolume(vol);
              }}
              className="text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              title="Reminder Sound Volume"
            >
              <option value="soft">Soft Volume</option>
              <option value="normal">Normal Volume</option>
              <option value="loud">Loud Volume</option>
            </select>
          </div>

          {/* View Toggler */}
          <div className="bg-gray-100 border border-gray-200 p-0.5 rounded-xl flex">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold ${
                viewMode === 'list' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              List
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`p-2 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold ${
                viewMode === 'calendar' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              Calendar
            </button>
          </div>
          
          <Button variant="secondary" onClick={loadData}>
            Refresh
          </Button>
          {!currentBook?.is_locked && (
            <Button onClick={() => { setShowAddForm(true); setEditingReminder(null); }}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Reminder
            </Button>
          )}
        </div>
      </div>

      {/* Date Navigation & Summary Toolbar */}
      <Card className="bg-gradient-to-r from-gray-50 to-blue-50 border-gray-200 py-3 px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Date Navigate:</span>
            <button
              onClick={() => handleDateNavigate('prev')}
              className="p-1.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              disabled={uniqueReminderDates.length === 0}
              title="Previous Active Date"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 min-w-[120px] text-center shadow-sm flex items-center justify-center gap-1">
              <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
              {selectedFilterDate 
                ? format(parseISO(selectedFilterDate), 'dd-MMM-yyyy') 
                : 'All Active Dates'}
            </div>
            <button
              onClick={() => handleDateNavigate('next')}
              className="p-1.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              disabled={uniqueReminderDates.length === 0}
              title="Next Active Date"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {selectedFilterDate && (
              <button
                onClick={() => setSelectedFilterDate('')}
                className="p-1 bg-red-50 text-red-600 rounded-full hover:bg-red-100 border border-red-200 ml-1"
                title="Clear date filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="text-xs text-gray-600 bg-white px-3 py-1.5 rounded-lg border border-gray-200 font-medium">
            Showing <strong>{filteredReminders.length}</strong> reminder(s)
          </div>
        </div>
      </Card>

      {/* Main Grid View */}
      {viewMode === 'calendar' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RemindersCalendar
              reminders={reminders}
              onDateSelect={(date) => {
                setSelectedFilterDate(date);
                setViewMode('list'); // switch to list to show reminders
              }}
              selectedDate={selectedFilterDate}
            />
          </div>
          <div className="space-y-4">
            <Card title="Quick Filters" className="p-4">
              <div className="space-y-4">
                <Select
                  label="Category"
                  value={filterCategory}
                  onChange={setFilterCategory}
                  options={[{ value: '', label: 'All Categories' }, ...categories]}
                />
                <Select
                  label="Priority"
                  value={filterPriority}
                  onChange={setFilterPriority}
                  options={[{ value: '', label: 'All Priorities' }, ...priorities]}
                />
                <Select
                  label="Status"
                  value={filterStatus}
                  onChange={setFilterStatus}
                  options={statuses}
                />
                <Select
                  label="Assigned To"
                  value={filterAssignedUser}
                  onChange={setFilterAssignedUser}
                  options={[
                    { value: '', label: 'Everyone / All' },
                    { value: 'all_users', label: 'All Users (Shared)' },
                    ...users.map(u => ({ value: u.id, label: u.username }))
                  ]}
                />
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filters Bar */}
          <Card className="bg-white border-gray-200 shadow-sm p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {/* Category Filter */}
              <Select
                label="Category"
                value={filterCategory}
                onChange={setFilterCategory}
                options={[{ value: '', label: 'All Categories' }, ...categories]}
              />
              
              {/* Priority Filter */}
              <Select
                label="Priority"
                value={filterPriority}
                onChange={setFilterPriority}
                options={[{ value: '', label: 'All Priorities' }, ...priorities]}
              />

              {/* Status Filter */}
              <Select
                label="Status"
                value={filterStatus}
                onChange={setFilterStatus}
                options={statuses}
              />

              {/* User filter */}
              <Select
                label="Assigned To"
                value={filterAssignedUser}
                onChange={setFilterAssignedUser}
                options={[
                  { value: '', label: 'Everyone' },
                  { value: 'all_users', label: 'All Users' },
                  ...users.map(u => ({ value: u.id, label: u.username }))
                ]}
              />

              {/* Search Bar */}
              <div className="flex flex-col justify-end">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Search</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search details..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 pr-4 h-10 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* List Table */}
          <Card title="Reminders Log" subtitle={`${filteredReminders.length} reminder entries found`}>
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading reminders database...</p>
              </div>
            ) : filteredReminders.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-gray-25 border border-dashed rounded-xl">
                No reminders found matching selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Category</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Title</th>
                      <th className="px-4 py-3 text-center font-bold text-gray-700">Due Date</th>
                      <th className="px-4 py-3 text-center font-bold text-gray-700">Time</th>
                      <th className="px-4 py-3 text-center font-bold text-gray-700">Priority</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Assigned To</th>
                      <th className="px-4 py-3 text-center font-bold text-gray-700">Status</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Created By</th>
                      <th className="px-4 py-3 text-center font-bold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReminders.map((r) => {
                      const colorStatus = getReminderColorStatus(r);
                      const isSnoozed = r.snoozed_until && new Date(r.snoozed_until) > new Date();
                      const isHighlighted = r.id === activeHighlightId;
                      const todayStr = format(new Date(), 'yyyy-MM-dd');
                      const isDueUnseen = r.status === 'pending' && !r.seen && r.event_date <= todayStr;
                      
                      let rowBg = 'hover:bg-gray-50';
                      let borderStyle = 'border-b border-gray-100';

                      if (isHighlighted) {
                        rowBg = 'bg-[#FFF7ED] hover:bg-[#FFEDD5]';
                        borderStyle = 'border-2 border-[#F97316]';
                      } else if (isDueUnseen) {
                        rowBg = 'bg-orange-200 hover:bg-orange-300';
                        borderStyle = 'border-b-2 border-orange-400';
                      } else if (r.status === 'completed') {
                        rowBg = 'bg-green-25/50 hover:bg-green-25';
                      } else if (colorStatus === 'dark-red') {
                        rowBg = 'bg-red-25/70 hover:bg-red-25';
                      }

                      return (
                        <tr 
                          key={r.id} 
                          id={`reminder-${r.id}`}
                          className={`transition-all duration-1000 ${borderStyle} ${rowBg}`}
                        >
                          <td className="px-4 py-3 font-semibold text-xs text-gray-500">
                            <span className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-900 border border-slate-400 font-bold shadow-sm">
                              {r.category || 'GENERAL'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-gray-900 flex items-center gap-2">
                              {r.title}
                              {isHighlighted && (
                                <span className='inline-flex items-center text-[10px] font-bold text-orange-800 bg-orange-100 px-2 py-0.5 rounded-full border border-orange-300 animate-pulse'>
                                  📌 Selected Reminder
                                </span>
                              )}
                              {(r as any).pending_sync && (
                                <span className='inline-flex items-center text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 animate-pulse font-outfit'>
                                  🔄 Pending Sync
                                </span>
                              )}
                            </div>
                            {r.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{r.description}</div>}
                            {r.is_system_generated && (
                              <span className="inline-flex items-center text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold mt-1">
                                <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                                System
                              </span>
                            )}
                            {isSnoozed && (
                              <span className="inline-flex items-center text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-bold mt-1 ml-1.5">
                                <Clock className="w-2.5 h-2.5 mr-0.5" />
                                Snoozed until {format(parseISO(r.snoozed_until || ''), 'dd-MM-yyyy')}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap font-medium text-gray-700">
                            {format(parseISO(r.event_date), 'dd-MM-yyyy')}
                            {r.reminder_type === 'recurring' && (
                              <div className="text-[10px] text-blue-600 font-bold lowercase">
                                🔁 {r.recurring_interval}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600 text-xs">
                            {r.event_time ? r.event_time.slice(0, 5) : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${getPriorityBadgeClass(r.priority)}`}>
                              {r.priority}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-800 text-xs">
                            {r.assigned_username ? (
                              <span className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-gray-400" />
                                {r.assigned_username}
                              </span>
                            ) : (
                              <span className="text-blue-700 font-bold uppercase text-[10px] tracking-wide bg-blue-100 border border-blue-300 px-2 py-0.5 rounded-full shadow-sm">All Users</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {r.status === 'completed' ? (
                              <span className="px-2 py-0.5 text-xs font-bold bg-green-200 text-green-900 border border-green-400 rounded-full shadow-sm">Completed</span>
                            ) : (
                              <span className="px-2 py-0.5 text-xs font-bold bg-yellow-200 text-yellow-900 border border-yellow-400 rounded-full shadow-sm">Pending</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs font-semibold">
                            {r.creator_username || 'system'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              {!currentBook?.is_locked ? (
                                <>
                                  {r.status === 'pending' && (
                                    <>
                                      <button
                                        onClick={() => setShowCompleteModal(r)}
                                        title="Mark Completed"
                                        className="inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1.5 text-sm text-green-700 bg-green-50 border border-green-300 hover:bg-green-100 focus:ring-green-500"
                                      >
                                        <CheckCircle className="w-4 h-4" />
                                      </button>

                                      {!r.seen && (
                                        <button
                                          onClick={() => handleMarkSeen(r.id)}
                                          title="Mark Seen (Mute alerts/sound)"
                                          className="inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1.5 text-sm text-indigo-700 bg-indigo-50 border border-indigo-300 hover:bg-indigo-100 focus:ring-indigo-500"
                                        >
                                          <Eye className="w-4 h-4" />
                                        </button>
                                      )}

                                      {/* Snooze Dropdown */}
                                      <div className="relative group">
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          title="Snooze"
                                          className="px-2"
                                        >
                                          <Clock className="w-4 h-4" />
                                        </Button>
                                        <div className="absolute right-0 bottom-full mb-1 w-28 bg-white border border-gray-200 rounded-lg shadow-lg hidden group-hover:block z-30 py-1">
                                          <button onClick={() => handleSnooze(r, 1)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-700">1 Day</button>
                                          <button onClick={() => handleSnooze(r, 3)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-700">3 Days</button>
                                          <button onClick={() => handleSnooze(r, 7)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-700">7 Days</button>
                                        </div>
                                      </div>
                                    </>
                                  )}
                                  
                                  {/* View / Edit */}
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => { setEditingReminder(r); setShowAddForm(true); }}
                                    className="px-2"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>

                                  {/* Delete */}
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => handleDelete(r.id)}
                                    className="px-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-gray-400 italic">Locked</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Add / Edit Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4 pb-2 border-b">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-blue-600" />
                  {editingReminder ? 'Edit Reminder' : 'New Reminder Entry Form'}
                </h3>
                <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={editingReminder ? handleUpdate : handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Title *"
                    value={editingReminder ? editingReminder.title : newReminder.title}
                    onChange={val => handleInputChange('title', val)}
                    placeholder="Enter title..."
                    required
                  />
                  <Select
                    label="Category *"
                    value={editingReminder ? editingReminder.category : newReminder.category}
                    onChange={val => handleInputChange('category', val)}
                    options={categories}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-gray-700 mb-1">Description</label>
                  <textarea
                    value={editingReminder ? (editingReminder.description || '') : newReminder.description}
                    onChange={e => handleInputChange('description', e.target.value)}
                    placeholder="Enter details..."
                    className="w-full min-h-[80px] p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Event Date *"
                    type="date"
                    value={editingReminder ? editingReminder.event_date : newReminder.event_date}
                    onChange={val => handleInputChange('event_date', val)}
                    required
                  />
                  <Input
                    label="Event Time (optional)"
                    type="time"
                    value={editingReminder ? (editingReminder.event_time || '') : newReminder.event_time}
                    onChange={val => handleInputChange('event_time', val)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Priority *"
                    value={editingReminder ? editingReminder.priority : newReminder.priority}
                    onChange={val => handleInputChange('priority', val)}
                    options={priorities}
                  />
                  <div className="flex flex-col">
                    <Select
                      label="Notify Before *"
                      value={
                        editingReminder
                          ? ['0', '1', '3', '7', '15', '30'].includes(String(editingReminder.notify_before_days))
                            ? String(editingReminder.notify_before_days)
                            : 'custom'
                          : ['0', '1', '3', '7', '15', '30'].includes(String(newReminder.notify_before_days))
                            ? String(newReminder.notify_before_days)
                            : 'custom'
                      }
                      onChange={val => {
                        if (val === 'custom') {
                          handleInputChange('notify_before_days', 2);
                        } else {
                          handleInputChange('notify_before_days', Number(val));
                        }
                      }}
                      options={[
                        ...notifyDaysOptions,
                        { value: 'custom', label: 'Custom...' }
                      ]}
                    />
                    {editingReminder ? (
                      !['0', '1', '3', '7', '15', '30'].includes(String(editingReminder.notify_before_days)) && (
                        <div className="mt-2">
                          <Input
                            label="Custom Notify Days *"
                            type="number"
                            min={0}
                            value={editingReminder.notify_before_days}
                            onChange={val => handleInputChange('notify_before_days', Number(val))}
                          />
                        </div>
                      )
                    ) : (
                      !['0', '1', '3', '7', '15', '30'].includes(String(newReminder.notify_before_days)) && (
                        <div className="mt-2">
                          <Input
                            label="Custom Notify Days *"
                            type="number"
                            min={0}
                            value={newReminder.notify_before_days}
                            onChange={val => handleInputChange('notify_before_days', Number(val))}
                          />
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Reminder Type *"
                    value={editingReminder ? editingReminder.reminder_type : newReminder.reminder_type}
                    onChange={val => handleInputChange('reminder_type', val)}
                    options={[
                      { value: 'one_time', label: 'One Time' },
                      { value: 'recurring', label: 'Recurring' }
                    ]}
                  />
                  {(editingReminder ? editingReminder.reminder_type : newReminder.reminder_type) === 'recurring' && (
                    <Select
                      label="Recurring Interval *"
                      value={editingReminder ? (editingReminder.recurring_interval || '') : newReminder.recurring_interval}
                      onChange={val => handleInputChange('recurring_interval', val)}
                      options={recurringIntervals}
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Assigned To"
                    value={editingReminder ? (editingReminder.assigned_user_id || '') : (newReminder.assigned_user_id || '')}
                    onChange={val => handleInputChange('assigned_user_id', val || null)}
                    options={[
                      { value: '', label: 'All Users (Everyone)' },
                      ...users.map(u => ({ value: u.id, label: u.username }))
                    ]}
                  />
                  {editingReminder && (
                    <Select
                      label="Status"
                      value={editingReminder.status}
                      onChange={val => handleInputChange('status', val)}
                      options={[
                        { value: 'pending', label: 'Pending' },
                        { value: 'completed', label: 'Completed' }
                      ]}
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 py-2">
                  <input
                    type="checkbox"
                    id="play_sound_checkbox"
                    checked={editingReminder ? (editingReminder.play_sound ?? true) : newReminder.play_sound}
                    onChange={e => handleInputChange('play_sound', e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                  <label htmlFor="play_sound_checkbox" className="text-sm font-semibold text-gray-700 select-none cursor-pointer">
                    Play Sound for this Reminder
                  </label>
                </div>

                <div className="flex gap-3 pt-3 border-t">
                  <Button type="submit">
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (editingReminder) {
                        setEditingReminder(null);
                      } else {
                        setNewReminder({
                          title: '',
                          description: '',
                          event_date: format(new Date(), 'yyyy-MM-dd'),
                          event_time: '',
                          priority: 'medium',
                          reminder_type: 'one_time',
                          recurring_interval: '',
                          notify_before_days: 0,
                          assigned_user_id: '',
                          category: 'GENERAL',
                          is_system_generated: false,
                          play_sound: true
                        });
                      }
                      setShowAddForm(false);
                    }}
                  >
                    Reset / Close
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Completion Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2">
              <CheckCircle className="w-6 h-6 text-green-600 animate-pulse" />
              Complete Reminder
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Enter any completion notes or logs for <strong>{showCompleteModal.title}</strong>
            </p>

            <div className="space-y-4">
              <div className="flex flex-col">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Completion Notes</label>
                <textarea
                  value={completionNotes}
                  onChange={e => setCompletionNotes(e.target.value)}
                  placeholder="e.g. GST Filed Successfully, Vehicle Insurance Renewed, etc..."
                  className="w-full min-h-[90px] p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button onClick={handleCompleteSubmit}>
                  Confirm Complete
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCompleteModal(null);
                    setCompletionNotes('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reminders;
