import React, { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { Calendar, ChevronDown, Plus, X, Lock, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTableMode } from '../../contexts/TableModeContext';
import { useBook } from '../../contexts/BookContext';
import { useOffline } from '../../contexts/OfflineContext';
import { toast } from 'react-hot-toast';

const Header: React.FC = () => {
  const today = new Date();
  const { user } = useAuth();
  const { mode, setMode, isFinanceMode, isITRMode } = useTableMode();
  const { currentBook, books, selectBook, createBook } = useBook();
  const { connectionStatus, isSyncing, pendingCount, lastSyncAt, offlineSince } = useOffline();
  
  const [isOpen, setIsOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);



  // Form states for creating a book
  const [bookCode, setBookCode] = useState('');
  const [bookName, setBookName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [submitting, setSubmitting] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookCode.trim() || !bookName.trim()) {
      toast.error('Book Code and Name are required.');
      return;
    }

    setSubmitting(true);
    try {
      const newBook = await createBook({
        book_code: bookCode.trim().toUpperCase(),
        name: bookName.trim(),
        description: description.trim(),
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        color
      });

      if (newBook) {
        setShowModal(false);
        // Reset form
        setBookCode('');
        setBookName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
        setColor('#3b82f6');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const modeText = isFinanceMode 
    ? 'Finance Mode' 
    : isITRMode 
      ? 'ITR Mode' 
      : 'Regular Mode';

  return (
    <>
      <header className='bg-white shadow-sm border-b border-gray-200 px-6 py-4 sticky top-0 z-20'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-4'>
            <h2 className="text-gray-900 finance-h1">
              Dashboard
            </h2>
            <div className="flex items-center gap-2 text-gray-500 finance-input">
              <Calendar className='w-4 h-4' />
              {format(today, 'EEEE, MMMM do, yyyy')}
            </div>
          </div>

          <div className='flex items-center gap-4'>
            {/* Global Book & Report Selector */}
            {user && (
              <div className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all shadow-sm ${
                currentBook?.is_locked 
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : isFinanceMode
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                {/* Mode Select */}
                <div className="flex items-center gap-1">
                  <select
                    value={mode || 'regular'}
                    onChange={async (e) => {
                      await setMode(e.target.value as any);
                    }}
                    className={`bg-transparent font-semibold focus:outline-none cursor-pointer pr-1 ${
                      currentBook?.is_locked 
                        ? 'text-red-700'
                        : isFinanceMode
                          ? 'text-green-700'
                          : 'text-blue-700'
                    }`}
                  >
                    <option value="regular">Regular Mode</option>
                    <option value="itr">ITR Mode</option>
                    <option value="finance">Finance Mode</option>
                  </select>
                </div>

                <span className="text-gray-300">|</span>

                {/* Book Select */}
                <div className="flex items-center gap-1">
                  <span className="text-gray-500 font-semibold">Book:</span>
                  <select
                    value={currentBook?.id || ''}
                    onChange={(e) => selectBook(e.target.value)}
                    className={`bg-transparent font-bold focus:outline-none cursor-pointer pr-1 ${
                      currentBook?.is_locked 
                        ? 'text-red-700'
                        : isFinanceMode
                          ? 'text-green-700'
                          : 'text-blue-700'
                    }`}
                  >
                    {books.length === 0 ? (
                      <option value="">None</option>
                    ) : (
                      books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.book_code}
                        </option>
                      ))
                    )}
                  </select>
                  {user.is_admin && (
                    <button
                      onClick={() => setShowModal(true)}
                      className={`p-0.5 rounded transition-colors ${
                        isFinanceMode ? 'hover:bg-green-100' : 'hover:bg-blue-100'
                      }`}
                      title="Create New Book"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Offline Records Badge */}
            {pendingCount > 0 && (
              <Link 
                to="/sync-center" 
                className="flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-full text-xs font-bold hover:bg-amber-100 transition-colors animate-pulse"
                title="View Offline Queue"
              >
                Offline Records: <span className="font-extrabold">{pendingCount}</span>
              </Link>
            )}

            {/* Connection Status Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50/50 text-xs font-medium font-outfit shadow-sm select-none">
              {isSyncing ? (
                <span className="flex items-center gap-1.5 text-blue-700 font-bold">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" /> Syncing
                </span>
              ) : connectionStatus === 'CHECKING' ? (
                <span className="flex items-center gap-1.5 text-blue-700 font-bold">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" /> Checking
                </span>
              ) : connectionStatus === 'ONLINE' ? (
                <div className="flex flex-col text-left">
                  <span className="flex items-center gap-1.5 text-green-700 font-bold leading-tight">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" /> Online
                  </span>
                  {lastSyncAt && (
                    <span className="text-[9px] text-gray-400 font-normal leading-none mt-0.5">
                      Last Sync: {format(parseISO(lastSyncAt), 'hh:mm a')}
                    </span>
                  )}
                </div>
              ) : connectionStatus === 'BACKEND_ERROR' ? (
                <div className="flex flex-col text-left">
                  <span className="flex items-center gap-1.5 text-amber-700 font-bold leading-tight">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Server Error
                  </span>
                  <span className="text-[9px] text-amber-600 font-normal leading-none mt-0.5">
                    API Limited
                  </span>
                </div>
              ) : (
                <div className="flex flex-col text-left">
                  <span className="flex items-center gap-1.5 text-red-700 font-bold leading-tight">
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Offline
                  </span>
                  {offlineSince && (
                    <span className="text-[9px] text-gray-400 font-normal leading-none mt-0.5">
                      Offline Since: {format(parseISO(offlineSince), 'hh:mm a')}
                    </span>
                  )}
                </div>
              )}
            </div>



            <div className="flex items-center gap-2 finance-input">
              <span className='text-gray-600'>Welcome,</span>
              <span className="text-gray-900 font-bold">{user?.username}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Create Book Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-100 overflow-hidden transform transition-all duration-300 scale-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <h3 className="text-lg font-bold">Create New Book</h3>
              <button 
                onClick={() => setShowModal(false)}
                className="text-white/80 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateBook} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Book Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FY2026-27"
                  value={bookCode}
                  onChange={(e) => setBookCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                />
                <p className="text-[11px] text-gray-400 mt-0.5">Unique shorthand identifier for references.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Book Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FY 2026-27"
                  value={bookName}
                  onChange={(e) => setBookName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  placeholder="Write details about this book..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Label Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        color === c ? 'border-black scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;

