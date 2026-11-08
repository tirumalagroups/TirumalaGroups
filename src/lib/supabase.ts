import { createClient } from '@supabase/supabase-js';

// Supabase configuration — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Validate configuration
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing Supabase configuration. Please check your environment variables.'
  );
}

// Create raw Supabase client
export const rawSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'X-Client-Info': 'thirumala-business-app',
    },
  },
  db: {
    schema: 'public',
  },
});

// Shared tables that must remain in the public schema
const SHARED_TABLES = [
  'users',
  'user_types',
  'user_access',
  'user_permissions',
  'user_credentials_log',
  'login_attempts',
  'login_activities',
  'login_history',
  'user_activities',
  'features',
  'audit_logs',
  'notification_settings',
  'ledger_settings',
  'attendance_staff',
  'attendance_salary_history',
  'attendance_records',
  'attendance_holidays',
  'attendance_month_locks',
  'attendance_logs',
];

// Helper to get table mode from storage
const getTableMode = (): 'regular' | 'itr' | 'finance' => {
  if (typeof window === 'undefined') return 'regular';
  const saved = sessionStorage.getItem('table_mode') || localStorage.getItem('table_mode');
  if (saved === 'itr' || saved === 'finance' || saved === 'regular') {
    return saved as 'regular' | 'itr' | 'finance';
  }
  return 'regular';
};

// Resolver for schema and table name
export function resolveSchemaAndTable(tableName: string): { schema: string; table: string } {
  // If it's a shared table, keep it in public schema
  if (SHARED_TABLES.includes(tableName)) {
    return { schema: 'public', table: tableName };
  }

  // Check if it's a finance table
  if (tableName.startsWith('finance_')) {
    let base = tableName.substring(8); // remove 'finance_'
    if (base === 'customers') {
      base = 'borrowers';
    } else if (base === 'transactions') {
      base = 'loan_transactions';
    } else if (base === 'dues') {
      base = 'due_entries';
    } else if (base === 'user_permissions') {
      return { schema: 'public', table: 'user_permissions' };
    }
    return { schema: 'finance', table: base };
  }

  // Otherwise, it's a regular/itr table
  // Clean the table name (remove _itr suffix if present)
  let baseTable = tableName;
  if (tableName.endsWith('_itr')) {
    baseTable = tableName.substring(0, tableName.length - 4);
  }

  // Resolve schema based on active mode
  const currentMode = getTableMode();
  const schema = currentMode === 'itr' ? 'itr' : currentMode === 'finance' ? 'finance' : 'regular';
  
  return { schema, table: baseTable };
}

// Helper to recursively wrap query builder and rewrite table names in select queries
function wrapBuilder(builder: any): any {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const origMethod = Reflect.get(target, prop, receiver);
      if (typeof origMethod === 'function') {
        return function (...args: any[]) {
          const methodName = String(prop);
          if (methodName === 'select' && args[0] && typeof args[0] === 'string') {
            let cols = args[0];
            cols = cols.replace(/finance_customers\b/g, 'borrowers');
            cols = cols.replace(/finance_transactions\b/g, 'loan_transactions');
            cols = cols.replace(/finance_dues\b/g, 'due_entries');
            cols = cols.replace(/finance_(\w+)\b/g, '$1');
            args[0] = cols;
          }
          const result = origMethod.apply(target, args);
          if (result && typeof result === 'object' && typeof result.then !== 'function') {
            return wrapBuilder(result);
          }
          return result;
        };
      }
      return origMethod;
    },
  });
}

// Proxied supabase client wrapper
export const supabase = new Proxy(rawSupabase, {
  get(target, prop, receiver) {
    if (prop === 'from') {
      return (tableName: string) => {
        const { schema, table } = resolveSchemaAndTable(tableName);
        const builder = target.schema(schema).from(table);
        return wrapBuilder(builder);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

// Database types based on your schema
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          email: string;
          password_hash: string;
          user_type_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          email: string;
          password_hash: string;
          user_type_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          email?: string;
          password_hash?: string;
          user_type_id?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      companies: {
        Row: {
          id: string;
          company_name: string;
          address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_name: string;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_name?: string;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      company_main_accounts: {
        Row: {
          id: string;
          company_name: string;
          acc_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_name: string;
          acc_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_name?: string;
          acc_name?: string;
          created_at?: string;
        };
      };
      company_main_sub_acc: {
        Row: {
          id: string;
          company_name: string;
          acc_name: string;
          sub_acc: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_name: string;
          acc_name: string;
          sub_acc: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_name?: string;
          acc_name?: string;
          sub_acc?: string;
          created_at?: string;
        };
      };
      cash_book: {
        Row: {
          id: string;
          sno: number;
          acc_name: string;
          sub_acc_name: string | null;
          particulars: string | null;
          c_date: string;
          credit: number;
          debit: number;
          lock_record: boolean;
          company_name: string;
          address: string | null;
          staff: string | null;
          users: string | null;
          entry_time: string;
          sale_qty: number;
          purchase_qty: number;
          approved: boolean;
          edited: boolean;
          e_count: number;
          cb: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sno?: number;
          acc_name: string;
          sub_acc_name?: string | null;
          particulars?: string | null;
          c_date?: string;
          credit?: number;
          debit?: number;
          lock_record?: boolean;
          company_name: string;
          address?: string | null;
          staff?: string | null;
          users?: string | null;
          entry_time?: string;
          sale_qty?: number;
          purchase_qty?: number;
          approved?: boolean;
          edited?: boolean;
          e_count?: number;
          cb?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sno?: number;
          acc_name?: string;
          sub_acc_name?: string | null;
          particulars?: string | null;
          c_date?: string;
          credit?: number;
          debit?: number;
          lock_record?: boolean;
          company_name?: string;
          address?: string | null;
          staff?: string | null;
          users?: string | null;
          entry_time?: string;
          sale_qty?: number;
          purchase_qty?: number;
          approved?: boolean;
          edited?: boolean;
          e_count?: number;
          cb?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      bank_guarantees: {
        Row: {
          id: string;
          sno: number;
          bg_no: string;
          issue_date: string | null;
          exp_date: string | null;
          work_name: string | null;
          credit: number;
          debit: number;
          department: string | null;
          cancelled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sno?: number;
          bg_no: string;
          issue_date?: string | null;
          exp_date?: string | null;
          work_name?: string | null;
          credit?: number;
          debit?: number;
          department?: string | null;
          cancelled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sno?: number;
          bg_no?: string;
          issue_date?: string | null;
          exp_date?: string | null;
          work_name?: string | null;
          credit?: number;
          debit?: number;
          department?: string | null;
          cancelled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicles: {
        Row: {
          id: string;
          vehicle_no: string;
          vehicle_type: string | null;
          owner_name: string | null;
          contact_no: string | null;
          insurance_expiry: string | null;
          permit_expiry: string | null;
          fitness_expiry: string | null;
          puc_expiry: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vehicle_no: string;
          vehicle_type?: string | null;
          owner_name?: string | null;
          contact_no?: string | null;
          insurance_expiry?: string | null;
          permit_expiry?: string | null;
          fitness_expiry?: string | null;
          puc_expiry?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vehicle_no?: string;
          vehicle_type?: string | null;
          owner_name?: string | null;
          contact_no?: string | null;
          insurance_expiry?: string | null;
          permit_expiry?: string | null;
          fitness_expiry?: string | null;
          puc_expiry?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      drivers: {
        Row: {
          id: string;
          driver_name: string;
          license_no: string;
          contact_no: string | null;
          license_expiry: string | null;
          address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_name: string;
          license_no: string;
          contact_no?: string | null;
          license_expiry?: string | null;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          driver_name?: string;
          license_no?: string;
          contact_no?: string | null;
          license_expiry?: string | null;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}

// Helper functions for common operations
export const supabaseHelpers = {
  // Get current user
  async getCurrentUser() {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      return { user, error };
    } catch (error) {
      console.error('Error getting current user:', error);
      return { user: null, error };
    }
  },

  // Sign in
  async signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { data, error };
    } catch (error) {
      console.error('Error signing in:', error);
      return { data: null, error };
    }
  },

  // Sign out
  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      return { error };
    } catch (error) {
      console.error('Error signing out:', error);
      return { error };
    }
  },

  // Check if user is authenticated
  async isAuthenticated() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return !!session;
    } catch (error) {
      console.error('Error checking authentication:', error);
      return false;
    }
  },
};

export default supabase;
