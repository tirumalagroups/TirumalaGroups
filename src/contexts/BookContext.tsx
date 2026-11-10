import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTableMode } from './TableModeContext';
import { useAuth } from './AuthContext';
import { supabaseDB } from '../lib/supabaseDatabase';
import { toast } from 'react-hot-toast';
import { db } from '../lib/offlineQueueDB';
import { queryClient } from '../lib/queryClient';

export interface Book {
  id: string;
  book_code: string;
  name: string;
  description?: string;
  mode: 'regular' | 'itr';
  start_date?: string;
  end_date?: string;
  is_default: boolean;
  is_active: boolean;
  is_locked: boolean;
  is_archived: boolean;
  /** Protected books cannot be deleted until an admin removes the protection */
  is_protected?: boolean;
  display_order: number;
  color?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

interface BookContextType {
  currentBook: Book | null;
  books: Book[];
  loading: boolean;
  selectBook: (bookId: string) => void | Promise<void>;
  isBookLocked: boolean;
  createBook: (bookData: Omit<Book, 'id' | 'is_default' | 'is_active' | 'is_locked' | 'is_archived' | 'display_order' | 'created_at' | 'updated_at' | 'mode'>) => Promise<Book | null>;
  toggleLock: (bookId: string, isLocked: boolean) => Promise<void>;
  setDefaultBook: (bookId: string) => Promise<void>;
  toggleProtect: (bookId: string, isProtected: boolean) => Promise<void>;
  booksDeletedToday: () => Promise<number>;
  toggleArchive: (bookId: string, isArchived: boolean) => Promise<void>;
  deleteBook: (bookId: string) => Promise<{ success: boolean; error?: string }>;
  refreshBooks: () => Promise<void>;
  reportFilter: string;
  setReportFilter: (filter: string) => void;
}

const BookContext = createContext<BookContextType | undefined>(undefined);

export const useBook = () => {
  const context = useContext(BookContext);
  if (context === undefined) {
    throw new Error('useBook must be used within a BookProvider');
  }
  return context;
};

export const BookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { mode: tableMode } = useTableMode();
  const { user } = useAuth();
  
  const [books, setBooks] = useState<Book[]>([]);
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  // The header "Report" selector was removed: reports always show All Reports
  // (Profit & Loss and Balance Sheet). Forget any choice saved by the old selector.
  const [reportFilter, setReportFilter] = useState<string>(() => {
    try { localStorage.removeItem('globalReportFilter'); } catch { /* storage unavailable */ }
    return 'ALL';
  });

  const handleSetReportFilter = (filter: string) => {
    setReportFilter(filter);
  };

  // Map active book mode (only regular and itr modes support books)
  const activeBookMode = (tableMode === 'itr' ? 'itr' : 'regular') as 'regular' | 'itr';

  const refreshBooks = useCallback(async () => {
    if (!user || !tableMode || tableMode === 'finance') {
      setBooks([]);
      setCurrentBook(null);
      supabaseDB.setBookId('');
      supabaseDB.setBookLocked(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Offline fallback: load selected book from localStorage if offline to prevent clearing selection
      const useOfflineBook = () => {
        const storageKey = activeBookMode === 'itr' ? 'itrSelectedBook' : 'regularSelectedBook';
        const storedBookId = localStorage.getItem(storageKey);
        if (storedBookId) {
          let remembered: Book | null = null;
          try {
            remembered = JSON.parse(localStorage.getItem(`offlineBook_${activeBookMode}`) || 'null');
          } catch {
            remembered = null;
          }
          const dummyBook: Book = remembered?.id === storedBookId ? remembered : {
            id: storedBookId,
            book_code: 'OFFLINE',
            name: activeBookMode === 'itr' ? 'ITR Mode' : 'Regular Mode',
            mode: activeBookMode,
            is_default: false,
            is_active: true,
            is_locked: false,
            is_archived: false,
            display_order: 0
          };
          setCurrentBook(dummyBook);
          setBooks([dummyBook]);
          supabaseDB.setBookId(storedBookId);
          supabaseDB.setBookLocked(dummyBook.is_locked);
          setLoading(false);
          return true;
        }
        return false;
      };

      if ((!navigator.onLine || !supabaseDB.isOnline) && useOfflineBook()) {
        return;
      }

      // Query books filtering out deleted ones.
      // Filter by mode ('regular' or 'itr'). 
      // Non-admins shouldn't see archived books.
      let query = supabase
        .from('books')
        .select('*')
        .eq('mode', activeBookMode)
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (!user.is_admin) {
        query = query.eq('is_archived', false);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching books:', error);
        useOfflineBook();
        return;
      }

      const fetchedBooks: Book[] = data || [];
      setBooks(fetchedBooks);

      // Determine which book is selected
      const storageKey = activeBookMode === 'itr' ? 'itrSelectedBook' : 'regularSelectedBook';
      const storedBookId = localStorage.getItem(storageKey);

      // The book in use before this refresh, to notice when the choice changes by itself
      const previousBookId = supabaseDB.currentBookId || '';
      let selected: Book | null = null;

      if (storedBookId) {
        selected = fetchedBooks.find(b => b.id === storedBookId) || null;
      }

      // If no valid stored selection, pick default book
      if (!selected && fetchedBooks.length > 0) {
        selected = fetchedBooks.find(b => b.is_default) || fetchedBooks[0];
      }

      if (selected) {
        setCurrentBook(selected);
        localStorage.setItem(storageKey, selected.id);
        localStorage.setItem(`offlineBook_${activeBookMode}`, JSON.stringify(selected));
        
        // Sync database client with current book ID and lock status
        supabaseDB.setBookId(selected.id);
        supabaseDB.setBookLocked(selected.is_locked);
      } else {
        setCurrentBook(null);
        supabaseDB.setBookId('');
        supabaseDB.setBookLocked(false);
      }

      // A different book is now in use (for example the first book just created, or the saved one
      // was deleted): open screens reload their lists instead of showing the old book until a page reload
      if ((selected?.id || '') !== previousBookId) {
        queryClient.invalidateQueries();
        window.dispatchEvent(new CustomEvent('book-changed', { detail: selected }));
      }
    } catch (err) {
      console.error('❌ Error in refreshBooks:', err);
    } finally {
      setLoading(false);
    }
  }, [user, activeBookMode]);

  // Load/Reload books when user or active book mode changes
  useEffect(() => {
    // Synchronously reset book selection and database state on mode transitions
    setCurrentBook(null);
    supabaseDB.setBookId('');
    supabaseDB.setBookLocked(false);

    refreshBooks();
  }, [refreshBooks]);

  // Refresh books list when network status changes to online
  useEffect(() => {
    const handleOnline = () => {
      console.log('📶 Network back online, refreshing books list...');
      refreshBooks();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshBooks]);

  const selectBook = async (bookId: string, knownBook?: Book) => {
    try {
      const count = await db.queued_operations
        .where('status')
        .equals('pending_sync')
        .count();
      if (count > 0) {
        toast.error(`Cannot switch books while there are ${count} unsynchronized records. Please sync first.`);
        return;
      }
    } catch (err) {
      console.error('Failed to check offline queue before switching book:', err);
    }

    const selected = books.find(b => b.id === bookId) || (knownBook?.id === bookId ? knownBook : undefined);
    if (selected) {
      // Clear all React Query cache so next render fetches fresh data for the new book
      queryClient.clear();
      setCurrentBook(selected);
      const storageKey = activeBookMode === 'itr' ? 'itrSelectedBook' : 'regularSelectedBook';
      localStorage.setItem(storageKey, selected.id);
      
      // Update global DB client state
      supabaseDB.setBookId(selected.id);
      supabaseDB.setBookLocked(selected.is_locked);

      // Trigger custom window event to notify queries of book change
      window.dispatchEvent(new CustomEvent('book-changed', { detail: selected }));
      toast.success(`Switched to Book: ${selected.name}`);
    }
  };

  const createBook = async (bookData: Omit<Book, 'id' | 'is_default' | 'is_active' | 'is_locked' | 'is_archived' | 'display_order' | 'created_at' | 'updated_at' | 'mode'>) => {
    if (!user?.is_admin) {
      toast.error('Only administrators can create books.');
      return null;
    }

    try {
      const count = await db.queued_operations
        .where('status')
        .equals('pending_sync')
        .count();
      if (count > 0) {
        toast.error(`Cannot create a new book while there are ${count} unsynchronized records. Please sync first.`);
        return null;
      }
    } catch (err) {
      console.error('Failed to check offline queue before creating book:', err);
    }

    try {
      // Create new book. Starts completely empty by default.
      const { data, error } = await supabase
        .from('books')
        .insert({
          ...bookData,
          mode: activeBookMode,
          created_by: user.id,
          is_default: false,
          is_active: true,
          is_locked: false,
          is_archived: false,
          display_order: books.length > 0 ? Math.max(...books.map(b => b.display_order)) + 1 : 0
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      toast.success(`Book "${bookData.name}" created successfully!`);
      await refreshBooks();
      
      // Select the newly created book
      if (data) {
        await selectBook(data.id, data as Book);
      }

      return data as Book;
    } catch (error: any) {
      console.error('❌ Error creating book:', error);
      toast.error(error.message || 'Failed to create book');
      return null;
    }
  };

  const toggleLock = async (bookId: string, isLocked: boolean) => {
    if (!user?.is_admin) {
      toast.error('Only administrators can lock/unlock books.');
      return;
    }

    try {
      const { error } = await supabase
        .from('books')
        .update({ is_locked: isLocked, updated_at: new Date().toISOString() })
        .eq('id', bookId);

      if (error) throw error;

      toast.success(isLocked ? 'Book locked successfully (Read-Only).' : 'Book unlocked successfully.');
      await refreshBooks();
      
      // If we updated the active book, make sure client state syncs
      if (currentBook?.id === bookId) {
        supabaseDB.setBookLocked(isLocked);
        // Dispatch event to refresh views
        window.dispatchEvent(new CustomEvent('book-changed', { detail: { ...currentBook, is_locked: isLocked } }));
      }
    } catch (error: any) {
      console.error('❌ Error updating book lock status:', error);
      toast.error(error.message || 'Failed to update book lock status');
    }
  };

  // Makes this book the default of its mode (Regular or ITR); the old default stops being one.
  // The new one is set first, so there is never a moment without a default.
  const setDefaultBook = async (bookId: string) => {
    if (!user?.is_admin) {
      toast.error('Only administrators can change the default book.');
      return;
    }
    try {
      const now = new Date().toISOString();
      const { error: setErr } = await supabase.from('books').update({ is_default: true, updated_at: now }).eq('id', bookId);
      if (setErr) throw setErr;
      const { error: clearErr } = await supabase
        .from('books')
        .update({ is_default: false, updated_at: now })
        .eq('mode', activeBookMode)
        .eq('is_default', true)
        .neq('id', bookId);
      if (clearErr) throw clearErr;
      const name = books.find(b => b.id === bookId)?.name || 'Book';
      toast.success(`"${name}" is now the default book.`);
      await refreshBooks();
    } catch (error: any) {
      console.error('❌ Error setting default book:', error);
      toast.error(error.message || 'Failed to set the default book');
    }
  };

  // Protection: a protected book cannot be deleted. Needs the is_protected column (see the SQL).
  const toggleProtect = async (bookId: string, isProtected: boolean) => {
    if (!user?.is_admin) {
      toast.error('Only administrators can protect books.');
      return;
    }
    try {
      const { error } = await supabase
        .from('books')
        .update({ is_protected: isProtected, updated_at: new Date().toISOString() })
        .eq('id', bookId);
      if (error) {
        if (['PGRST204', '42703'].includes((error as any).code || '')) {
          throw new Error('Book protection is not set up in the database yet. Run the book protection SQL first.');
        }
        throw error;
      }
      toast.success(isProtected ? 'Book protected: it cannot be deleted.' : 'Protection removed: the book can be deleted.');
      await refreshBooks();
    } catch (error: any) {
      console.error('❌ Error updating book protection:', error);
      toast.error(error.message || 'Failed to update book protection');
    }
  };

  // How many books of this mode were deleted today, for the extra warning before another delete
  const booksDeletedToday = async (): Promise<number> => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { count, error } = await supabase
      .from('books')
      .select('id', { count: 'exact', head: true })
      .eq('mode', activeBookMode)
      .gte('deleted_at', startOfToday.toISOString());
    if (error) {
      console.error('❌ Error counting deleted books:', error);
      return 0;
    }
    return count || 0;
  };

  const toggleArchive = async (bookId: string, isArchived: boolean) => {
    if (!user?.is_admin) {
      toast.error('Only administrators can archive/unarchive books.');
      return;
    }

    try {
      const { error } = await supabase
        .from('books')
        .update({ is_archived: isArchived, updated_at: new Date().toISOString() })
        .eq('id', bookId);

      if (error) throw error;

      toast.success(isArchived ? 'Book archived successfully.' : 'Book unarchived successfully.');
      await refreshBooks();
    } catch (error: any) {
      console.error('❌ Error updating book archive status:', error);
      toast.error(error.message || 'Failed to update book archive status');
    }
  };

  const deleteBook = async (bookId: string): Promise<{ success: boolean; error?: string }> => {
    if (!user?.is_admin) {
      toast.error('Only administrators can delete books.');
      return { success: false, error: 'Unauthorized' };
    }

    // Retrieve book to find its code/details
    const targetBook = books.find(b => b.id === bookId);
    if (!targetBook) {
      return { success: false, error: 'Book not found' };
    }

    if (targetBook.is_default) {
      return { success: false, error: 'Cannot delete the default legacy book.' };
    }
    if (targetBook.is_protected) {
      return { success: false, error: 'This book is protected. Remove the protection (shield) first.' };
    }

    try {
      // Step 14: Check ALL related tables for any records.
      // Call deletion check inside database service
      const checkResult = await supabaseDB.verifyBookIsEmpty(bookId);
      if (!checkResult.isEmpty) {
        return { 
          success: false, 
          error: `Cannot delete book because records exist. Only empty books can be deleted. (${checkResult.details})`
        };
      }

      // Soft delete by setting deleted_at (or hard delete if user demands, but let's soft delete for safety)
      const { error } = await supabase
        .from('books')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', bookId);

      if (error) throw error;

      toast.success(`Book "${targetBook.name}" deleted successfully.`);
      await refreshBooks();

      // If we deleted the currently active book, switch to the default legacy book
      if (currentBook?.id === bookId) {
        const defaultBook = books.find(b => b.is_default && b.id !== bookId);
        if (defaultBook) {
          selectBook(defaultBook.id);
        }
      }

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error deleting book:', error);
      return { success: false, error: error.message || 'Failed to delete book' };
    }
  };

  const isBookLocked = currentBook ? currentBook.is_locked : false;

  return (
    <BookContext.Provider
      value={{
        currentBook,
        books,
        loading,
        selectBook,
        isBookLocked,
        createBook,
        toggleLock,
        setDefaultBook,
        toggleProtect,
        booksDeletedToday,
        toggleArchive,
        deleteBook,
        refreshBooks,
        reportFilter,
        setReportFilter: handleSetReportFilter
      }}
    >
      {children}
    </BookContext.Provider>
  );
};
