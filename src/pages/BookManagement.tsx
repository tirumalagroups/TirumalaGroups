import React, { useState, useEffect } from 'react';
import { useBook, Book } from '../contexts/BookContext';
import { useAuth } from '../contexts/AuthContext';
import { supabaseDB } from '../lib/supabaseDatabase';
import { 
  Lock, 
  Unlock, 
  Archive, 
  Trash2, 
  Edit3, 
  Settings,
  FolderOpen,
  X,
  Database,
  Star,
  ShieldCheck,
  Shield
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// The app looks up these system books by their code, so their codes never change
const isSystemBookCode = (code?: string | null) => /-LEGACY$/i.test(String(code || '').trim());

interface BookMetrics {
  companies: number;
  accounts: number;
  transactions: number;
  vehicles: number;
  reminders: number;
}

const BookManagement: React.FC = () => {
  const { user } = useAuth();
  const { books, loading, toggleLock, toggleArchive, deleteBook, refreshBooks, setDefaultBook, toggleProtect, booksDeletedToday } = useBook();
  const [metrics, setMetrics] = useState<Record<string, BookMetrics>>({});
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Edit Modal State
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editColor, setEditColor] = useState('#3b82f6');
  const [updating, setUpdating] = useState(false);

  // Load metrics for all books
  const fetchAllMetrics = async () => {
    if (books.length === 0) return;
    setLoadingMetrics(true);
    const newMetrics: Record<string, BookMetrics> = {};
    
    try {
      await Promise.all(
        books.map(async (book) => {
          const m = await supabaseDB.getBookMetrics(book.id);
          newMetrics[book.id] = m;
        })
      );
      setMetrics(newMetrics);
    } catch (err) {
      console.error('Error fetching book metrics:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  useEffect(() => {
    fetchAllMetrics();
  }, [books]);

  const handleEditClick = (book: Book) => {
    setEditingBook(book);
    setEditCode(book.book_code || '');
    setEditName(book.name);
    setEditDesc(book.description || '');
    setEditColor(book.color || '#3b82f6');
  };

  const handleUpdateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBook) return;

    if (!editName.trim()) {
      toast.error('Book Name is required.');
      return;
    }
    const codeLocked = isSystemBookCode(editingBook.book_code);
    const newCode = codeLocked ? editingBook.book_code : editCode.trim().toUpperCase();
    if (!newCode) {
      toast.error('Book Code is required.');
      return;
    }
    if (newCode !== editingBook.book_code &&
        books.some(b => b.id !== editingBook.id && String(b.book_code || '').toUpperCase() === newCode)) {
      toast.error(`Book code "${newCode}" is already used by another book. Please choose a different code.`);
      return;
    }

    setUpdating(true);
    try {
      // Direct supabase update to update basic metadata fields
      const { error } = await supabaseDB.bypassScope(async () => {
        const { supabase } = await import('../lib/supabase');
        return await supabase
          .from('books')
          .update({
            book_code: newCode,
            name: editName.trim(),
            description: editDesc.trim(),
            // Start date stays the day the book was created; books have no end date.
            color: editColor,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingBook.id);
      });

      if (error) {
        // The database keeps book codes unique (another user may have just used this code)
        if ((error as any).code === '23505' || /duplicate|unique/i.test(error.message || '')) {
          throw new Error(`Book code "${newCode}" is already used by another book. Please choose a different code.`);
        }
        throw new Error(error.message);
      }

      toast.success(`Book "${editName}" updated successfully!`);
      setEditingBook(null);
      await refreshBooks();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update book details');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteClick = async (book: Book) => {
    if (book.is_protected) {
      toast.error('This book is protected. Remove the protection (shield) first.');
      return;
    }
    const confirmDelete = window.confirm(
      `Are you sure you want to delete the book "${book.name}" (${book.book_code})?\nThis action cannot be undone.`
    );
    if (!confirmDelete) return;

    // More than one book deleted on the same day: ask once more
    const deletedToday = await booksDeletedToday();
    if (deletedToday > 0) {
      const again = window.confirm(
        `Reminder: ${deletedToday} book${deletedToday === 1 ? '' : 's'} already deleted today.\n\nDo you really want to delete another book, "${book.name}" (${book.book_code})?`
      );
      if (!again) return;
    }

    const res = await deleteBook(book.id);
    if (!res.success) {
      toast.error(res.error || 'Failed to delete book.');
    }
  };

  if (!user?.is_admin) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-red-600">Access Denied</h2>
        <p className="text-gray-600 mt-2">Only administrators are authorized to manage books.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Title Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Database className="w-7 h-7 text-blue-600" /> Book Management
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Admin Console: Create, lock, archive, and monitor isolated financial periods and accounting books.
          </p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-500" /> Accounting Books ({books.length})
          </h3>
          <button 
            onClick={fetchAllMetrics} 
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
          >
            Refresh Data
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-3 text-sm">Loading books data...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="p-12 text-center max-w-sm mx-auto">
            <FolderOpen className="w-12 h-12 text-gray-300 mx-auto" />
            <h4 className="font-bold text-gray-700 mt-4">No Books Configured</h4>
            <p className="text-gray-500 text-sm mt-1">
              No books are active for this mode. Try switching between Regular and ITR mode to see their respective books.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="fit-table fit-lg text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider">
                  <th className="px-6 py-4">Book Code / Name</th>
                  <th className="px-6 py-4">Mode</th>
                  <th className="px-6 py-4">Status Badges</th>
                  <th className="px-6 py-4 text-center">Companies</th>
                  <th className="px-6 py-4 text-center">Accounts</th>
                  <th className="px-6 py-4 text-center">Transactions</th>
                  <th className="px-6 py-4 text-center">Vehicles</th>
                  <th className="px-6 py-4 text-center">Reminders</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                {books.map((book) => {
                  const m = metrics[book.id] || { companies: 0, accounts: 0, transactions: 0, vehicles: 0, reminders: 0 };
                  const isEmpty = m.companies === 0 && m.accounts === 0 && m.transactions === 0 && m.vehicles === 0 && m.reminders === 0;

                  return (
                    <tr key={book.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span 
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0 border shadow-sm"
                            style={{ backgroundColor: book.color || '#6b7280' }}
                          />
                          <div>
                            <span className="font-bold text-gray-900 block">{book.name}</span>
                            <span className="text-xs font-mono text-gray-400">{book.book_code}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          book.mode === 'itr' 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : 'bg-blue-50 text-blue-700 border border-blue-100'
                        }`}>
                          {book.mode === 'itr' ? 'ITR' : 'REGULAR'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {book.is_default && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 uppercase">
                              Default
                            </span>
                          )}
                          {book.is_protected && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase flex items-center gap-0.5">
                              <ShieldCheck className="w-2.5 h-2.5" /> Protected
                            </span>
                          )}
                          {book.is_locked ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 uppercase flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" /> Locked
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 uppercase flex items-center gap-0.5">
                              <Unlock className="w-2.5 h-2.5" /> Open
                            </span>
                          )}
                          {book.is_archived && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-700 border border-yellow-200 uppercase flex items-center gap-0.5">
                              <Archive className="w-2.5 h-2.5" /> Archived
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-semibold text-gray-800">{loadingMetrics ? '...' : m.companies}</td>
                      <td className="px-6 py-4 text-center font-semibold text-gray-800">{loadingMetrics ? '...' : m.accounts}</td>
                      <td className="px-6 py-4 text-center font-semibold text-gray-800">{loadingMetrics ? '...' : m.transactions}</td>
                      <td className="px-6 py-4 text-center font-semibold text-gray-800">{loadingMetrics ? '...' : m.vehicles}</td>
                      <td className="px-6 py-4 text-center font-semibold text-gray-800">{loadingMetrics ? '...' : m.reminders}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => !book.is_default && setDefaultBook(book.id)}
                            disabled={book.is_default}
                            title={book.is_default ? "This is the default book" : "Make this the default book"}
                            className={`p-1.5 border rounded-lg transition-colors shadow-sm ${
                              book.is_default
                                ? 'text-amber-500 border-amber-100 cursor-default'
                                : 'text-gray-400 border-gray-100 hover:text-amber-500 hover:bg-amber-50'
                            }`}
                          >
                            <Star className="w-4 h-4" fill={book.is_default ? 'currentColor' : 'none'} />
                          </button>

                          <button
                            onClick={() => toggleProtect(book.id, !book.is_protected)}
                            title={book.is_protected ? "Protected: cannot be deleted. Click to remove protection" : "Protect from deletion"}
                            className={`p-1.5 border rounded-lg transition-colors shadow-sm ${
                              book.is_protected
                                ? 'text-indigo-600 border-indigo-100 hover:bg-indigo-50'
                                : 'text-gray-400 border-gray-100 hover:text-indigo-600 hover:bg-indigo-50'
                            }`}
                          >
                            {book.is_protected ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                          </button>

                          <button
                            onClick={() => handleEditClick(book)}
                            title="Edit metadata"
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-gray-100 shadow-sm"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          
                          <button
                            onClick={() => toggleLock(book.id, !book.is_locked)}
                            title={book.is_locked ? "Unlock write access" : "Lock as read-only"}
                            className={`p-1.5 border rounded-lg transition-colors shadow-sm ${
                              book.is_locked 
                                ? 'text-red-600 border-red-100 hover:bg-red-50'
                                : 'text-gray-500 border-gray-100 hover:text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {book.is_locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </button>

                          <button
                            onClick={() => toggleArchive(book.id, !book.is_archived)}
                            title={book.is_archived ? "Unarchive book" : "Archive book (Hides from normal users)"}
                            className={`p-1.5 border rounded-lg transition-colors shadow-sm ${
                              book.is_archived 
                                ? 'text-yellow-600 border-yellow-100 hover:bg-yellow-50'
                                : 'text-gray-500 border-gray-100 hover:text-yellow-600 hover:bg-yellow-50'
                            }`}
                          >
                            <Archive className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDeleteClick(book)}
                            disabled={!isEmpty || book.is_default || !!book.is_protected}
                            title={
                              book.is_protected
                                ? "Protected: remove the shield to delete"
                                : book.is_default 
                                ? "Cannot delete default book" 
                                : !isEmpty 
                                  ? "Cannot delete book: records exist" 
                                  : "Delete empty book"
                            }
                            className={`p-1.5 border rounded-lg transition-colors shadow-sm ${
                              book.is_default || !isEmpty || book.is_protected
                                ? 'text-gray-300 border-gray-100 cursor-not-allowed'
                                : 'text-red-500 border-red-100 hover:bg-red-50 hover:text-red-700'
                            }`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Book Modal */}
      {editingBook && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-100 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <h3 className="text-lg font-bold">Edit Book Details</h3>
              <button 
                onClick={() => setEditingBook(null)}
                className="text-white/80 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleUpdateBook} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Book Code *
                </label>
                {isSystemBookCode(editingBook.book_code) ? (
                  <>
                    <input
                      type="text"
                      disabled
                      value={editingBook.book_code}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed font-mono uppercase"
                    />
                    <p className="text-[11px] text-gray-400 mt-0.5">This is a system book: the app finds it by this code, so it cannot be changed.</p>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      required
                      maxLength={50}
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                    />
                    <p className="text-[11px] text-gray-400 mt-0.5">Each book needs its own code. Entries stay with the book when the code changes.</p>
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Book Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FY 2026-27"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  placeholder="Write details about this book..."
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
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
                      onClick={() => setEditColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        editColor === c ? 'border-black scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingBook(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {updating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookManagement;
